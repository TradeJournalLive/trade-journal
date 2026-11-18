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
const { paperFyersConnection } = require('./paper-fyers-connection.cjs');
const { readDepth, withDepth } = require('./nifty-depth.cjs');
const { quarantineInterruptedPosition, recoverOnNextSignal } = require('./nifty-independent-recovery.cjs');
const { createWorkerDiagnostics } = require('./worker-diagnostics.cjs');
const { reconcileHamsPublish } = require('./hams-journal.cjs');
const { createTickAudit } = require('./nifty-tick-audit.cjs');
function load(name) {
  const file = path.resolve(__dirname, `../app/lib/algo/${name}.ts`), copy = new Module(file, module);
  copy.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  return copy.exports;
}
const { buildNiftyOptionsPaper } = load('niftyPaperEngine');
const { buildNiftyLimitPaper } = load('niftyLimitAdapter');
const { observeLimitIndex } = load('niftyLimitPaper');
const { niftyFreshSessionAt, niftyPaperStatus } = load('niftyLossCycle');
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
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.PAPER_WEBHOOK_SECRET || (!env.PAPER_FYERS_APP_ID && !env.PAPER_WORKER_PANEL_ORIGIN)) {
  console.error('Missing server configuration: Supabase, PAPER_WEBHOOK_SECRET and PAPER_FYERS_APP_ID are required.'); process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) }
});
const secretHash = hash(env.PAPER_WEBHOOK_SECRET), workerId = crypto.randomUUID();
let state, book, lease, connection, socket, master = [], quotes = new Map(), index, trail, lastMasterDay;
let status = 'STARTING', processed = new Set(), pollAfter, lastPublish = 0, failed = false;
let feedAt = null, polling = false, publishing = false, flushing = false, refreshing = false;
let pollRetryAt = 0, pollFailures = 0, publishRetryAt = 0, publishFailures = 0;
let pollOffset = 0, pollUntil = null, pollLastAt = null, stopping = false;
let pollTask = Promise.resolve(), publishTask = Promise.resolve(), flushTask = Promise.resolve();
let firstFailure = null;
let queue = Promise.resolve();
const depths = new Map();
const persistedTrades = new Set();
const persistedDecisions = new Map();
const auditTick = createTickAudit({ directory, io: fs, clock: Date.now, onDisabled: value => console.error(JSON.stringify({ at: now(), operation: 'optional.tick.audit', ...value })) });
const diagnostics = createWorkerDiagnostics({
  emit: value => { audit('DIAGNOSTIC', value); if (['TASK_FAILED', 'ERROR', 'STOP_REQUESTED'].includes(value.type)) console.error(JSON.stringify(value)); },
  secrets: () => [env.PAPER_WEBHOOK_SECRET, env.SUPABASE_SERVICE_ROLE_KEY, env.ALGO_CONNECTION_ENCRYPTION_KEY, env.PAPER_WORKER_ACCESS_KEY, connection?.accessToken],
  context: () => ({ workerId, strategy: 'NIFTY', status, feedAt, leaseAgeMs: lease ? Date.now() - Date.parse(lease) : null, openPosition: Boolean(book?.position) })
});
const storageError = (code, cause) => Object.assign(new Error(code, { cause }), { code });
const retryDelay = n => Math.min(15000, 1000 * 2 ** Math.min(n - 1, 4));
function owned() { return Boolean(lease && Date.now() - Date.parse(lease) < 10000); }
function guardOwnership() {
  if (!lease || owned()) return true;
  if (!state?.recoveryIncidents?.some(i => !i.acknowledgedAt) && quarantineInterruptedPosition(state, now())) saveLocal();
  return false;
}
function fail(operation, error) {
  firstFailure ||= error;
  diagnostics.stop(operation, error);
  failed = true;
}
function audit(type, data) {
  fs.appendFileSync(path.join(directory, `${day(now())}.jsonl`), JSON.stringify({ at: now(), type, data }) + '\n', { mode: 0o600 });
}
function event(id, data, action = 'EXIT', timestamp = now()) {
  return { receivedAt: timestamp, signal: { id, strategyId: 'nifty_paper_feed_v1', symbol: 'NSE:NIFTY', action, timeframe: '1', metadata: { niftyPaper: data } }, raw: { automation: { mode: 'PAPER' } } };
}
function observePausedPrices(events) {
  const s=state?.checkpoint?.rulesV2;
  if(!s)return;
  for(const e of events){
    const data=e.signal?.metadata?.niftyPaper,age=Date.now()-Date.parse(data?.timestamp);
    if(e.signal?.symbol!=='NSE:NIFTY'||data?.kind!=='TICK'||!Number.isFinite(age)||age<0||age>5000)continue;
    // Record real observations, never evaluate the unknown position's exits.
    s.ticks=observeLimitIndex(s.ticks,String(data.timestamp),Number(data.price));
  }
}
function advance(events) {
  if (!guardOwnership()) { observePausedPrices(events); return; }
  if(state?.recoveryIncidents?.some(i=>!i.acknowledgedAt)) {
    observePausedPrices(events);
    for(const e of events){
      const control=e.raw?.paperControl;
      if(control?.market==='NIFTY' && typeof control.niftyOptionsEnabled==='boolean') {
        state.checkpoint.rulesV2.enabled=control.niftyOptionsEnabled;
        state.checkpoint.enabled=control.niftyOptionsEnabled;
        saveLocal();
      }
    }
    if(!recoverOnNextSignal(state,events,now()))return;
    audit('RECOVERY_AUTO_EXCLUDED',{reason:'NEXT_SIGNAL_INDEPENDENT'});
  }
  const before = book?.trades.length ?? 0;
  const previousPosition = book?.position?.openedAt;
  const previousQuantity = book?.position?.quantity;
  book = buildNiftyLimitPaper(events, now(), state.checkpoint, niftyFreshSessionAt);
  state.checkpoint = book.checkpoint;
  for (const trade of book.trades.slice(before)) audit('TRADE', trade);
  if (before !== book.trades.length || previousPosition !== book.position?.openedAt || previousQuantity !== book.position?.quantity) saveLocal();
}
function saveLocal() {
  if (!state) return;
  state.savedAt = now(); state.owner = secretHash;
  const fd = fs.openSync(`${localFile}.tmp`, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(`${localFile}.tmp`, localFile);
}
async function api(endpoint) {
  const response = await fetch(`https://api-t1.fyers.in/${endpoint}`, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok || result.s === 'error') throw new Error('FYERS_DATA_UNAVAILABLE');
  return result;
}
async function credentials() {
  const shared = await paperFyersConnection(env, env.PAPER_WEBHOOK_SECRET);
  if (shared) return shared;
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
  if (failed || stopping) return;
  const rows = Array.isArray(message) ? message : [message];
  for (const row of rows) {
    if (!row || !row.symbol) continue;
    if (row.type === 'dp') {
      const depth = readDepth(row, now());
      if (depth) depths.set(row.symbol, depth);
      continue;
    }
    const timestamp = Number(row.exch_feed_time) * 1000;
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5000) continue;
    if (row.symbol === indexSymbol && Number(row.ltp) > 0) index = { price: Number(row.ltp), at: timestamp };
    else if (Number(row.bid_price) > 0 && Number(row.ask_price) >= Number(row.bid_price)) quotes.set(row.symbol, { bid: Number(row.bid_price), ask: Number(row.ask_price), timestamp: new Date(timestamp).toISOString(), bidSize: Number(row.bid_size), askSize: Number(row.ask_size) });
    if (row.symbol !== indexSymbol && row.symbol !== book?.position?.contract.id) continue;
    if (!index || (!book?.checkpoint?.rulesV2?.emergency?.pending && Date.now() - index.at > 5000)) continue;
    const timestampISO = now();
    if (minutes(timestampISO) < 555 || minutes(timestampISO) > 930) continue;
    status = 'RECEIVING_FYERS_TICKS';
    feedAt = timestampISO;
    const nearestExpiry = master.map(c => c.expiry).sort()[0];
    const contracts = master.filter(c => (c.expiry === nearestExpiry && Math.abs(c.strike - index.price) <= 700) || c.id === book?.position?.contract.id).map(c => ({ ...c, ...(withDepth(quotes.get(c.id), depths.get(c.id), timestampISO) || { bid: 0, ask: 0, timestamp: '' }) }));
    const tick = { kind: 'TICK', executionVersion: 2, indexSymbol: 'NSE:NIFTY', timestamp: timestampISO, price: index.price, nearestExpiry, chainComplete: true, previous15m: trail, contracts };
    auditTick(tick, book?.position?.contract.id);
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
  socket.on('connect', () => { status = 'SOCKET_CONNECTED_WAITING_FOR_FRESH_DATA'; quotes.clear(); depths.clear(); index = undefined; socket.subscribe([indexSymbol, ...new Set(symbols)]); socket.subscribe([...new Set(symbols)], true); });
  socket.on('message', message => { queue = queue.then(() => { if (!failed && !stopping) marketTick(message); }).catch(error => { status = 'PROCESSING_ERROR'; fail('feed.processing', error); }); });
  socket.on('error', () => { status = 'FEED_ERROR_RECONNECT_REQUIRED'; });
  socket.on('close', () => { status = 'FEED_DISCONNECTED'; });
  socket.connect();
  if (socket.autoreconnect) socket.autoreconnect(50);
}
async function subscriptions() {
  const result = await api(`data/options-chain-v3?symbol=${encodeURIComponent(indexSymbol)}&strikecount=12`);
  const symbols = (result.data?.optionsChain || []).filter(row => ['CE', 'PE'].includes(row.option_type)).map(row => row.symbol);
  if (book?.position) symbols.push(book.position.contract.id);
  if (symbols.length && socket?.isConnected()) { socket.subscribe([...new Set(symbols)]); socket.subscribe([...new Set(symbols)], true); }
}
function summary(value = state) {
  const { checkpoint, ...result } = buildNiftyOptionsPaper([], now(), value.checkpoint);
  return { ...result, trades: [], trial: { startedAt: value.startedAt, endsAt: null, timeframe: '1', executionVersion: 2, depthSymbols: depths.size, workerStatus: status, heartbeatAt: now() }, feesIncluded: Boolean(checkpoint.rulesV2) };
}
function paperStatus(value) {
  const s = value.checkpoint?.rulesV2;
  const review = Boolean(value.recoveryIncidents?.some(i=>!i.acknowledgedAt));
  const result = s ? niftyPaperStatus(s, review ? 'RECOVERY_REVIEW_REQUIRED' : !owned() ? 'OWNERSHIP_UNCONFIRMED' : pollFailures ? 'SIGNAL_STORAGE_RETRY' : publishFailures ? 'SNAPSHOT_STORAGE_RETRY' : status, feedAt, review) : null;
  if (result?.position && review) result.position.mark = null;
  return result;
}
async function flushLedgers() {
  const at = now();
  const result = buildNiftyOptionsPaper([], at, structuredClone(state.checkpoint));
  const decisions = (result.checkpoint.decisions || []).filter(d => persistedDecisions.get(d.id) !== JSON.stringify(d));
  if (decisions.length) {
    const rows = decisions.map(d => ({ secret_hash: secretHash, strategy_id: '__nifty_paper_decision__', signal_id: hash(d.id), symbol: 'NIFTY', action: 'EXIT', received_at: d.receivedAt, signal_timestamp: d.receivedAt, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: { ...event(hash(d.id), { kind: 'INTERNAL' }).signal, strategyId: '__nifty_paper_decision__' }, decision: {}, raw_payload: { decision: d } }));
    const stored = await db.from(TABLE).upsert(rows, { onConflict: 'secret_hash,strategy_id,signal_id' });
    if (stored.error) throw storageError('DECISION_LEDGER_STORAGE_RETRY', stored.error);
    decisions.forEach(d => persistedDecisions.set(d.id, JSON.stringify(d)));
  }
  const unpersisted = result.trades.filter(trade => !persistedTrades.has(`${trade.signalId}:${trade.openedAt}`));
  if (unpersisted.length) {
    const rows = unpersisted.map(trade => {
      const id = hash(`${trade.signalId}:${trade.openedAt}`);
      return { secret_hash: secretHash, strategy_id: '__nifty_paper_trade__', signal_id: id, symbol: 'NIFTY', action: 'EXIT', received_at: trade.closedAt, signal_timestamp: trade.closedAt, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: { ...event(id, { kind: 'PAPER_TRADE' }).signal, strategyId: '__nifty_paper_trade__' }, decision: {}, raw_payload: { trade } };
    });
    const saved = await db.from(TABLE).upsert(rows, { onConflict: 'secret_hash,strategy_id,signal_id' });
    if (saved.error) throw storageError('TRADE_LEDGER_STORAGE_RETRY', saved.error);
    unpersisted.forEach(trade => persistedTrades.add(`${trade.signalId}:${trade.openedAt}`));
  }
}
async function publish() {
  const at = now(), snapshot = structuredClone(state);
  saveLocal();
  let result;
  try {
    result = await db.from(TABLE).update({ received_at: at, raw_payload: { workerId, state: snapshot, book: summary(snapshot), dashboard: paperStatus(snapshot) } }).eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').eq('received_at', lease).eq('raw_payload->>workerId', workerId).select('id');
  } catch (error) { result = { error }; }
  const confirmed = await reconcileHamsPublish(result, () => db.from(TABLE).select('received_at,worker_id:raw_payload->>workerId').eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').maybeSingle(), workerId, at);
  lease = confirmed.lease;
  if (!confirmed.committed) throw storageError('SNAPSHOT_WRITE_UNCONFIRMED', result.error);
  lastPublish = Date.parse(at); saveLocal();
}
async function poll() {
  pollUntil ||= now();
  let response;
  try {
    response = await db.from(TABLE).select('id,received_at,signal,raw_payload').eq('secret_hash', secretHash).or('strategy_id.eq.__paper_control__,signal->metadata->niftyPaper->>kind.eq.SIGNAL').gte('received_at', pollAfter).lte('received_at', pollUntil).order('received_at').order('id').range(pollOffset, pollOffset + 999);
  } catch (cause) { throw storageError('SIGNAL_STORAGE_READ_FAILED', cause); }
  const { data, error } = response;
  if (error) throw storageError('SIGNAL_STORAGE_READ_FAILED', error);
  if (!Array.isArray(data)) throw storageError('SIGNAL_STORAGE_INVALID_RESPONSE', new Error('Expected a signal page'));
  if (failed || stopping || !guardOwnership()) return;
  const events = [];
  for (const row of data || []) {
    if (processed.has(row.id)) continue;
    if (row.raw_payload?.paperControl?.niftyOptionsEnabled !== undefined || row.signal?.metadata?.niftyPaper?.kind === 'SIGNAL') {
      const value = { receivedAt: row.received_at, signal: row.signal, raw: row.raw_payload || {} };
      audit('SIGNAL_OR_CONTROL', value); events.push(value);
    }
  }
  advance(events);
  for (const row of data) processed.add(row.id);
  if (data.length) pollLastAt = data.at(-1).received_at;
  if (data.length === 1000) {
    pollOffset += data.length;
    diagnostics.write('SIGNAL_PAGE_CONTINUES', { offset: pollOffset });
  } else {
    if (pollLastAt) pollAfter = new Date(Date.parse(pollLastAt) - 60000).toISOString();
    pollOffset = 0; pollUntil = null; pollLastAt = null;
  }
  state.signalPollAfter = pollAfter;
}
function startPoll() {
  if (polling || failed || stopping || Date.now() < pollRetryAt) return pollTask;
  polling = true;
  pollTask = diagnostics.run('supabase.signal.poll', poll).then(() => { pollFailures = 0; pollRetryAt = 0; }).catch(error => {
    if (!['SIGNAL_STORAGE_READ_FAILED', 'SIGNAL_STORAGE_INVALID_RESPONSE'].includes(error.code)) { fail('signal.process', error); return; }
    pollFailures++; pollRetryAt = Date.now() + retryDelay(pollFailures);
  }).finally(() => { polling = false; });
  return pollTask;
}
function startPublish() {
  if (publishing || failed || stopping || Date.now() < publishRetryAt) return publishTask;
  publishing = true;
  publishTask = diagnostics.run('supabase.snapshot.publish', publish).then(() => { publishFailures = 0; publishRetryAt = 0; }).catch(error => {
    if (error.code === 'HAMS_OWNERSHIP_LOST') { fail('snapshot.ownership', error); return; }
    if (!['HAMS_STORAGE_RETRY', 'SNAPSHOT_WRITE_UNCONFIRMED'].includes(error.code)) { fail('snapshot.local', error); return; }
    publishFailures++; publishRetryAt = Date.now() + Math.min(5000, retryDelay(publishFailures));
  }).finally(() => { publishing = false; });
  return publishTask;
}
let ledgerRetryAt = 0, ledgerFailures = 0;
function startLedgerFlush() {
  if (flushing || failed || stopping || Date.now() < ledgerRetryAt) return flushTask;
  flushing = true;
  flushTask = diagnostics.run('supabase.ledger.flush', flushLedgers).then(() => { ledgerFailures = 0; ledgerRetryAt = 0; }).catch(() => {
    ledgerFailures++; ledgerRetryAt = Date.now() + retryDelay(ledgerFailures);
  }).finally(() => { flushing = false; });
  return flushTask;
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
    state = { startedAt: now() };
    advance([{ ...event('enable', {}), raw: { paperControl: { market: 'NIFTY', niftyOptionsEnabled: true } } }]);
  } else {
    quarantineInterruptedPosition(state,now());
    book=buildNiftyLimitPaper([],now(),state.checkpoint,niftyFreshSessionAt);
    advance([]);
  }
  pollAfter = state.signalPollAfter || (old ? new Date(Date.parse(old.received_at) - 60000).toISOString() : state.startedAt);
  const claimedAt = now();
  const row = { secret_hash: secretHash, strategy_id: STRATEGY, signal_id: 'state', symbol: 'NIFTY', action: 'EXIT', received_at: claimedAt, signal_timestamp: claimedAt, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: event('state', { kind: 'WORKER' }).signal, decision: {}, raw_payload: { workerId, state, book: summary(), dashboard: paperStatus(state) } };
  const claim = old ? await db.from(TABLE).update(row).eq('secret_hash', secretHash).eq('strategy_id', STRATEGY).eq('signal_id', 'state').eq('received_at', old.received_at).select('id') : await db.from(TABLE).insert(row).select('id');
  if (claim.error) throw new Error('WORKER_LEASE_WRITE_FAILED', { cause: claim.error });
  if (claim.data?.length !== 1) throw new Error('WORKER_LEASE_CHANGED_DURING_STARTUP');
  lease = claimedAt;
  saveLocal();
  await connect();
  let lastHistory = 0, lastCredentials = Date.now(), lastPoll = 0;
  console.log('NIFTY paper worker started; broker order calls are disabled.');
  while (!failed) {
    await new Promise(resolve => setTimeout(resolve, 200));
    await queue;
    guardOwnership();
    if (Date.now() - lastPoll >= 1000) { lastPoll = Date.now(); void startPoll(); }
    if (!refreshing && (Date.now() - lastHistory > 30000 || Date.now() - lastCredentials > 60000)) {
      refreshing = true;
      lastHistory = Date.now();
      void diagnostics.run('fyers.refresh', async () => {
        if (Date.now() - lastCredentials > 60000) {
          const updated = await credentials();
          if (updated.accessToken !== connection.accessToken) { fail('credentials.refresh', new Error('TOKEN_REFRESH_RESTART')); return; }
          lastCredentials = Date.now();
        }
        await subscriptions();
      }).catch(() => { status = 'CREDENTIAL_OR_SUBSCRIPTION_REFRESH_RETRY'; }).finally(() => { refreshing = false; });
    }
    if (lastMasterDay !== day(now())) throw new Error('DAILY_RESTART_REQUIRED');
    if (Date.now() - lastPublish >= 5000) void startPublish();
    if (Date.now() - lastPublish < 1000) void startLedgerFlush();
  }
  throw firstFailure || new Error('PAPER_WORKER_STOPPED');
}
process.on('SIGINT', () => { saveLocal(); process.exit(0); });
process.on('SIGTERM', () => { saveLocal(); process.exit(0); });
main().catch(async error => {
  stopping = true;
  diagnostics.stop('main', error);
  const reason = /^[A-Z_]+$/.test(error.message) ? error.message : 'UNEXPECTED_ERROR';
  console.error('Paper worker stopped:', reason);
  if (reason === 'UNEXPECTED_ERROR') {
    const frame = String(error.stack || '').split('\n').find(line => line.includes('nifty-paper-worker.cjs:'))?.trim();
    const code = String(error.code || error.cause?.code || '');
    console.error('Paper worker diagnostic:', error.name, /^[A-Z0-9_]+$/.test(code) ? code : '', frame || 'No local stack frame');
  }
  status = `STOPPED_${reason}`;
  // Do not race or overwrite an in-flight ownership write during shutdown.
  await Promise.allSettled([pollTask, publishTask, flushTask]);
  if (state) saveLocal();
  process.exit(1);
});
