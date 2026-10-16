/* Read-only FYERS feed; this process intentionally imports no order API. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false);
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse/sync');
const { fyersDataSocket } = require('fyers-api-v3');
function load(name) {
  const file = path.resolve(__dirname, `../app/lib/algo/${name}.ts`), copy = new Module(file, module);
  copy.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  return copy.exports;
}
const { buildNiftyOptionsPaper } = load('niftyPaperEngine');
const TABLE = 'tradingview_signal_events', STRATEGY = '__nifty_paper_worker__';
const indexSymbol = 'NSE:NIFTY50-INDEX';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();
const day = time => new Date(Date.parse(time) + 330 * 60000).toISOString().slice(0, 10);
const minutes = time => { const d = new Date(Date.parse(time) + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const directory = path.resolve('.paper-worker');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const localFile = path.join(directory, 'checkpoint.json');
const env = process.env;
const configFile = path.join(directory, 'config.json');
if (fs.existsSync(configFile)) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  env.PAPER_WEBHOOK_SECRET ||= config.webhookSecret;
  env.PAPER_FYERS_APP_ID ||= config.fyersAppId;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.PAPER_WEBHOOK_SECRET || !env.PAPER_FYERS_APP_ID) {
  console.error('Missing server configuration: Supabase, PAPER_WEBHOOK_SECRET and PAPER_FYERS_APP_ID are required.'); process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const secretHash = hash(env.PAPER_WEBHOOK_SECRET), workerId = crypto.randomUUID();
let state, book, lease, connection, socket, master = [], quotes = new Map(), index, trail, lastMasterDay;
let status = 'STARTING', processed = new Set(), pollAfter, lastPublish = 0, failed = false;
let queue = Promise.resolve();
function audit(type, data) {
  fs.appendFileSync(path.join(directory, `${day(now())}.jsonl`), JSON.stringify({ at: now(), type, data }) + '\n', { mode: 0o600 });
}
function event(id, data, action = 'EXIT', timestamp = now()) {
  return { receivedAt: timestamp, signal: { id, strategyId: 'nifty_paper_feed_v1', symbol: 'NSE:NIFTY', action, timeframe: '1', metadata: { niftyPaper: data } }, raw: { automation: { mode: 'PAPER' } } };
}
function advance(events) {
  const before = book?.trades.length ?? 0;
  const previousPosition = book?.position?.openedAt;
  book = buildNiftyOptionsPaper(events, now(), state.checkpoint);
  state.checkpoint = book.checkpoint;
  for (const trade of book.trades.slice(before)) audit('TRADE', trade);
  if (before !== book.trades.length || previousPosition !== book.position?.openedAt) saveLocal();
}
function saveLocal() {
  if (!state) return;
  state.savedAt = now(); state.owner = secretHash;
  fs.writeFileSync(`${localFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(`${localFile}.tmp`, localFile);
}
async function api(endpoint) {
  const response = await fetch(`https://api-t1.fyers.in/${endpoint}`, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok || result.s === 'error') throw new Error('FYERS_DATA_UNAVAILABLE');
  return result;
}
async function credentials() {
  const { data, error } = await db.from(TABLE).select('raw_payload').eq('strategy_id', '__fyers_connection__').order('received_at', { ascending: false }).limit(100);
  if (error) throw new Error('CONNECTION_STORAGE_UNAVAILABLE');
  const key = crypto.createHash('sha256').update(`fyers:${env.ALGO_CONNECTION_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY}`).digest();
  const matches = [];
  for (const row of data || []) {
    try {
      const raw = Buffer.from(row.raw_payload.sealed || '', 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
      if (value.appId === env.PAPER_FYERS_APP_ID && value.accessToken) matches.push(value);
    } catch { /* Other devices may use another encryption key. */ }
  }
  if (!matches.length) throw new Error('CONNECT_MATCHING_FYERS_APP');
  return matches[0];
}
async function instruments() {
  const response = await fetch('https://public.fyers.in/sym_details/NSE_FO.csv', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('CONTRACT_MASTER_UNAVAILABLE');
  master = parse(await response.text(), { skip_empty_lines: true }).filter(row => row[13] === 'NIFTY' && ['CE', 'PE'].includes(row[16])).map(row => ({ id: row[9], expiry: day(new Date(Number(row[8]) * 1000).toISOString()), strike: Number(row[15]), side: row[16], lotSize: Number(row[3]) })).filter(row => row.expiry >= day(now()) && Number.isSafeInteger(row.lotSize) && row.lotSize > 0);
  if (!master.length) throw new Error('NO_NIFTY_CONTRACTS');
  lastMasterDay = day(now());
}
async function history() {
  const today = day(now());
  const result = await api(`data/history?symbol=${encodeURIComponent(indexSymbol)}&resolution=15&date_format=1&range_from=${today}&range_to=${today}&cont_flag=1`);
  const completed = (result.candles || []).filter(c => Number(c[0]) * 1000 + 900000 <= Date.now()).sort((a, b) => a[0] - b[0]).pop();
  trail = completed ? { high: Number(completed[2]), low: Number(completed[3]), closedAt: new Date(Number(completed[0]) * 1000 + 900000).toISOString() } : undefined;
}
function marketTick(message) {
  const rows = Array.isArray(message) ? message : [message];
  for (const row of rows) {
    if (!row || !row.symbol) continue;
    const timestamp = Number(row.exch_feed_time) * 1000;
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5000) continue;
    if (row.symbol === indexSymbol && Number(row.ltp) > 0) index = { price: Number(row.ltp), at: timestamp };
    else if (Number(row.bid_price) > 0 && Number(row.ask_price) >= Number(row.bid_price)) quotes.set(row.symbol, { bid: Number(row.bid_price), ask: Number(row.ask_price), timestamp: new Date(timestamp).toISOString(), bidSize: Number(row.bid_size), askSize: Number(row.ask_size) });
    if (row.symbol !== indexSymbol && row.symbol !== book?.position?.contract.id) continue;
    if (!index || Date.now() - index.at > 5000) continue;
    const timestampISO = now();
    if (minutes(timestampISO) < 555 || minutes(timestampISO) > 930) continue;
    status = 'RECEIVING_FYERS_TICKS';
    const nearestExpiry = master.map(c => c.expiry).sort()[0];
    const contracts = master.filter(c => (c.expiry === nearestExpiry && Math.abs(c.strike - index.price) <= 700) || c.id === book?.position?.contract.id).map(c => ({ ...c, ...(quotes.get(c.id) || { bid: 0, ask: 0, timestamp: '' }) }));
    const tick = { kind: 'TICK', indexSymbol: 'NSE:NIFTY', timestamp: timestampISO, price: index.price, nearestExpiry, chainComplete: true, previous15m: trail, contracts };
    audit('TICK', tick);
    advance([event(`tick-${crypto.randomUUID()}`, tick, 'EXIT', timestampISO)]);
  }
}
async function connect() {
  connection = await credentials();
  await instruments();
  const result = await api(`data/options-chain-v3?symbol=${encodeURIComponent(indexSymbol)}&strikecount=12`);
  const symbols = (result.data?.optionsChain || []).filter(row => ['CE', 'PE'].includes(row.option_type)).map(row => row.symbol);
  if (!symbols.length) throw new Error('OPTION_SUBSCRIPTIONS_UNAVAILABLE');
  if (book?.position) symbols.push(book.position.contract.id);
  socket = fyersDataSocket.getInstance(`${connection.appId}:${connection.accessToken}`, directory, false);
  socket.on('connect', () => { status = 'SOCKET_CONNECTED_WAITING_FOR_FRESH_DATA'; socket.subscribe([indexSymbol, ...new Set(symbols)]); });
  socket.on('message', message => { queue = queue.then(() => marketTick(message)).catch(() => { status = 'PROCESSING_ERROR'; failed = true; }); });
  socket.on('error', () => { status = 'FEED_ERROR_RECONNECT_REQUIRED'; });
  socket.on('close', () => { status = 'FEED_DISCONNECTED'; });
  socket.connect();
  if (socket.autoreconnect) socket.autoreconnect(50);
}
async function subscriptions() {
  const result = await api(`data/options-chain-v3?symbol=${encodeURIComponent(indexSymbol)}&strikecount=12`);
  const symbols = (result.data?.optionsChain || []).filter(row => ['CE', 'PE'].includes(row.option_type)).map(row => row.symbol);
  if (book?.position) symbols.push(book.position.contract.id);
  if (symbols.length && socket?.isConnected()) socket.subscribe([...new Set(symbols)]);
}
function summary() {
  const { checkpoint, ...result } = buildNiftyOptionsPaper([], now(), state.checkpoint);
  return { ...result, trial: { startedAt: state.startedAt, endsAt: state.endsAt, timeframe: '1', workerStatus: status, heartbeatAt: now() }, feesIncluded: false };
}
async function publish() {
  const at = now();
  const { data, error } = await db.from(TABLE).update({ received_at: at, raw_payload: { workerId, state, book: summary() } }).eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').eq('received_at', lease).select('id');
  if (error || data?.length !== 1) throw new Error('WORKER_LEASE_OR_STORAGE_LOST');
  lease = at; lastPublish = Date.now(); saveLocal();
}
async function poll() {
  const { data, error } = await db.from(TABLE).select('id,received_at,signal,raw_payload').eq('secret_hash', secretHash).neq('strategy_id', STRATEGY).gte('received_at', pollAfter).order('received_at').order('id').limit(1000);
  if (error || data?.length === 1000) throw new Error('SIGNAL_BACKLOG_OR_STORAGE_ERROR');
  const events = [];
  for (const row of data || []) {
    if (processed.has(row.id)) continue;
    processed.add(row.id);
    if (row.raw_payload?.paperControl?.niftyOptionsEnabled !== undefined || row.signal?.metadata?.niftyPaper?.kind === 'SIGNAL') {
      const value = { receivedAt: row.received_at, signal: row.signal, raw: row.raw_payload || {} };
      audit('SIGNAL_OR_CONTROL', value); events.push(value);
    }
  }
  if (data?.length) pollAfter = new Date(Date.parse(data[data.length - 1].received_at) - 60000).toISOString();
  advance(events);
}
async function main() {
  const { data: old, error } = await db.from(TABLE).select('received_at,raw_payload').eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').maybeSingle();
  if (error) throw new Error('WORKER_STORAGE_UNAVAILABLE');
  if (old && Date.now() - Date.parse(old.received_at) < 15000) throw new Error('ANOTHER_WORKER_ACTIVE');
  state = old?.raw_payload?.state;
  if (fs.existsSync(localFile)) {
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    if (local.owner === secretHash && Date.parse(local.savedAt) > Date.parse(state?.savedAt || '1970-01-01')) state = local;
  }
  if (!state) {
    const startedAt = now(), end = new Date(startedAt); end.setUTCMonth(end.getUTCMonth() + 1);
    state = { startedAt, endsAt: end.toISOString() };
    advance([{ ...event('enable', {}), raw: { paperControl: { market: 'NIFTY', niftyOptionsEnabled: true } } }]);
  } else advance([]);
  pollAfter = old ? new Date(Date.parse(old.received_at) - 60000).toISOString() : state.startedAt;
  lease = now();
  const row = { secret_hash: secretHash, strategy_id: STRATEGY, signal_id: 'state', symbol: 'NIFTY', action: 'EXIT', received_at: lease, signal_timestamp: lease, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: event('state', { kind: 'WORKER' }).signal, decision: {}, raw_payload: { workerId, state, book: summary() } };
  const claim = old ? await db.from(TABLE).update(row).eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').eq('received_at', old.received_at).select('id') : await db.from(TABLE).insert(row).select('id');
  if (claim.error || claim.data?.length !== 1) throw new Error('WORKER_LEASE_UNAVAILABLE');
  saveLocal(); await connect();
  let lastHistory = 0, lastCredentials = Date.now();
  console.log('NIFTY paper worker started; broker order calls are disabled.');
  while (!failed) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await queue;
    await poll();
    if (Date.now() >= Date.parse(state.endsAt)) advance([{ ...event('trial-end', {}), raw: { paperControl: { market: 'NIFTY', niftyOptionsEnabled: false } } }]);
    if (Date.now() - lastHistory > 30000) {
      lastHistory = Date.now();
      try { await history(); } catch { trail = undefined; status = 'HISTORY_UNAVAILABLE'; }
      try { await subscriptions(); } catch { status = 'SUBSCRIPTION_REFRESH_FAILED'; }
    }
    if (Date.now() - lastCredentials > 60000) {
      const updated = await credentials();
      if (updated.accessToken !== connection.accessToken) throw new Error('TOKEN_REFRESH_RESTART');
      lastCredentials = Date.now();
    }
    if (lastMasterDay !== day(now())) throw new Error('DAILY_RESTART_REQUIRED');
    if (Date.now() - lastPublish >= 2000) await publish();
    if (Date.now() >= Date.parse(state.endsAt) && !book.position) break;
  }
  if (failed) throw new Error('PAPER_WORKER_STOPPED');
  await publish(); process.exit(0);
}
process.on('SIGINT', () => { saveLocal(); process.exit(0); });
process.on('SIGTERM', () => { saveLocal(); process.exit(0); });
main().catch(async error => {
  const reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'UNEXPECTED_ERROR';
  console.error('Paper worker stopped:', reason);
  status = `STOPPED_${reason}`;
  if (state && lease) { try { await publish(); } catch {} }
  process.exit(1);
});
