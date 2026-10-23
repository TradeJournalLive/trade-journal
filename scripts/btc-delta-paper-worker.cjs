// Separate public-data worker. No broker login, signing key, or order API.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), Module = require('node:module');
const ts = require('typescript'), WebSocket = require('ws');
const { createDeltaDepth } = require('./delta-depth.cjs');
const { retryablePoll, canRetryPublish, feedNeedsReconnect, reconcileHeartbeat } = require('./btc-worker-health.cjs');
require('@next/env').loadEnvConfig(process.cwd(), false);
const { createClient } = require('@supabase/supabase-js');
const file = path.resolve(__dirname, '../app/lib/algo/btcPaperEngine.ts'), moduleCopy = new Module(file, module);
moduleCopy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { emptyBtcState, btcSignal, btcTick, btcView, btcCancelSetup } = moduleCopy.exports;
const config = JSON.parse(fs.readFileSync('.paper-worker/config.json', 'utf8'));
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const owner = hash(config.webhookSecret), workerId = crypto.randomUUID(), strategy = '__btc_delta_worker__', table = 'tradingview_signal_events';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const directory = path.resolve('.paper-worker/btc'); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const checkpoint = path.join(directory, 'checkpoint.json'), now = () => new Date().toISOString();
let saved, lease, workerStatus = 'STARTING', socket, lastFrame = 0, quote, trade, mark, trail, product, after, lastRejectedLog = 0, depthBook;
let connectedAt = 0, watchdog;
const seenRows = new Set(), persisted = new Set(), persistedDecisions = new Map();
const heartbeatAttempts = new Set();
function audit(kind, data) { fs.appendFileSync(path.join(directory, `${now().slice(0, 10)}.jsonl`), JSON.stringify({ at: now(), kind, data }) + '\n', { mode: 0o600 }); }
function save() { if (!saved) return; saved.savedAt = now(); saved.owner = owner; fs.writeFileSync(`${checkpoint}.tmp`, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(`${checkpoint}.tmp`, checkpoint); }
function update(next, tick) {
  const old = saved.state;
  if (old.status !== next.status || old.setup?.id !== next.setup?.id || old.trades.length !== next.trades.length) {
    audit('DECISION', { status: next.status, priorStatus: old.status, signalId: old.setup?.id || next.setup?.id, at: now() });
  }
  saved.state = next;
  if (old.position?.openedAt !== next.position?.openedAt || old.position?.quantityBtc !== next.position?.quantityBtc || old.trades.length !== next.trades.length || old.setup?.id !== next.setup?.id) {
    if (tick) audit('EXECUTION_SNAPSHOT', tick);
    save();
  }
}
async function publicGet(endpoint) {
  const r = await fetch(`https://api.india.delta.exchange/v2/${endpoint}`, { signal: AbortSignal.timeout(10000) });
  const v = await r.json(); if (!r.ok || v.success !== true) throw new Error('DELTA_PUBLIC_DATA_UNAVAILABLE'); return v.result;
}
async function history() {
  const end = Math.floor(Date.now() / 1000);
  const bars = await publicGet(`history/candles?resolution=15m&symbol=BTCUSD&start=${end - 7200}&end=${end}`);
  const bar = bars.filter(v => v.time * 1000 + 900000 <= Date.now()).sort((a, b) => a.time - b.time).pop();
  if (bar) trail = { high: Number(bar.high), low: Number(bar.low), closedAt: new Date(bar.time * 1000 + 900000).toISOString() };
}
function onMessage(raw) {
  lastFrame = Date.now(); const v = JSON.parse(raw);
  if (v.type === 'error') { workerStatus = 'DELTA_SUBSCRIPTION_ERROR'; return; }
  if (v.type === 'ob_updates') {
    try {
      if (depthBook.accept(v)) {
        const depth = depthBook.snapshot();
        if (!quote || Date.parse(depth.at) >= Date.parse(quote.at)) quote = { bid: depth.bids[0].price, ask: depth.asks[0].price, bidBtc: depth.bids[0].quantityBtc, askBtc: depth.asks[0].quantityBtc, at: depth.at };
      }
    }
    catch (error) { workerStatus = 'DEPTH_RESYNC_REQUIRED'; audit('FEED_HEALTH', { reason: String(error.message) }); socket.terminate(); return; }
  }
  if (v.sy === 'BTCUSD' && v.type === 'ob_l1') {
    const at = new Date(Number(v.ts) / 1000).toISOString();
    if (!quote || Date.parse(at) >= Date.parse(quote.at)) quote = { bid: Number(v.bp), ask: Number(v.ap), bidBtc: Number(v.bs) * Number(product.contract_value), askBtc: Number(v.as) * Number(product.contract_value), at };
  }
  if (v.sy === 'BTCUSD' && v.type === 'trades') {
    const at = new Date(Number(v.t) / 1000).toISOString();
    if (!trade || Date.parse(at) >= Date.parse(trade.at)) trade = { price: Number(v.p), at };
  }
  if (v.sy === 'MARK:BTCUSD' && v.type === 'mark_price') mark = { price: Number(v.p), at: new Date(Number(v.ts) / 1000).toISOString() };
  if (!['ob_l1', 'ob_updates', 'trades', 'mark_price'].includes(v.type) || !quote || !trade) return;
  // A feed can remain connected while database ownership is uncertain.
  if (Date.now() - Date.parse(lease) >= 12000) { workerStatus = 'STORAGE_LEASE_UNVERIFIED'; return; }
  const timestamp = now();
  const tick = { timestamp, executionVersion: 2, contractBtc: Number(product.contract_value), depth: depthBook.snapshot(), tradeAt: trade.at, quoteAt: quote.at, price: trade.price, bid: quote.bid, ask: quote.ask, bidBtc: quote.bidBtc, askBtc: quote.askBtc, mark: mark?.price ?? 0, markAt: mark?.at ?? '', maintenanceRate: Number(product.maintenance_margin) / 100, previous15m: trail };
  const next = btcTick(saved.state, tick);
  if (next.previousTick?.timestamp === timestamp) { const { depth, ...prices } = tick; audit('TICK', { ...prices, depthSequence: depth?.sequence, depthAt: depth?.at }); workerStatus = 'RECEIVING_DELTA_BTCUSD'; }
  else if (Date.now() - lastRejectedLog > 30000) {
    lastRejectedLog = Date.now();
    audit('REJECTED_UPDATE', { quoteAgeMs: Date.parse(timestamp) - Date.parse(quote.at), tradeAgeMs: Date.parse(timestamp) - Date.parse(trade.at), bid: quote.bid, ask: quote.ask, status: next.status });
  }
  update(next, tick);
}
function connect() {
  connectedAt = Date.now(); lastFrame = 0;
  quote = undefined;
  trade = undefined; mark = undefined; depthBook.reset();
  socket = new WebSocket('wss://public-socket.india.delta.exchange');
  socket.on('open', () => { lastFrame = Date.now(); workerStatus = 'SOCKET_CONNECTED_WAITING_FOR_QUOTES'; socket.send(JSON.stringify({ type: 'subscribe', payload: { channels: [{ name: 'ob_l1', symbols: ['BTCUSD'] }, { name: 'ob_updates', symbols: ['BTCUSD'] }, { name: 'trades', symbols: ['BTCUSD'] }, { name: 'mark_price', symbols: ['MARK:BTCUSD'] }] } })); socket.send(JSON.stringify({ type: 'enable_heartbeat' })); });
  socket.on('message', raw => { try { onMessage(raw); } catch { workerStatus = 'STOPPED_DELTA_PROCESSING_ERROR'; console.error(workerStatus); save(); process.exit(1); } });
  socket.on('close', () => { workerStatus = 'FEED_DISCONNECTED'; });
  socket.on('error', () => { workerStatus = 'FEED_ERROR'; });
}
function rowBase(id, at, name) { return { secret_hash: owner, strategy_id: name, signal_id: id, symbol: 'BTC', action: 'EXIT', received_at: at, signal_timestamp: at, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: { id, strategyId: name, symbol: 'DELTA:BTCUSD', source: 'TRADINGVIEW', action: 'EXIT', timestamp: at, createdAt: at, status: 'VALIDATED', metadata: { btcPaper: { kind: 'INTERNAL' } } }, decision: {} }; }
async function publish() {
  const at = now(), snapshot = structuredClone(saved), view = btcView(snapshot.state, at);
  const pending = view.trades.filter(t => !persisted.has(`${t.id}:${t.openedAt}`));
  if (pending.length) {
    const r = await db.from(table).upsert(pending.map(t => ({ ...rowBase(hash(`${t.id}:${t.openedAt}`), t.closedAt, '__btc_delta_trade__'), raw_payload: { trade: t } })), { onConflict: 'secret_hash,strategy_id,signal_id' }).abortSignal(AbortSignal.timeout(4000));
    if (r.error) throw new Error('BTC_LEDGER_UNAVAILABLE');
    pending.forEach(t => persisted.add(`${t.id}:${t.openedAt}`));
  }
  const decisions = (snapshot.state.decisions || []).filter(d => persistedDecisions.get(d.id) !== JSON.stringify(d));
  if (decisions.length) {
    const result = await db.from(table).upsert(decisions.map(d => ({ ...rowBase(hash(d.id), d.receivedAt, '__btc_delta_decision__'), raw_payload: { decision: d } })), { onConflict: 'secret_hash,strategy_id,signal_id' }).abortSignal(AbortSignal.timeout(4000));
    if (result.error) throw new Error('BTC_DECISION_STORAGE_UNAVAILABLE');
    decisions.forEach(d => persistedDecisions.set(d.id, JSON.stringify(d)));
  }
  const partial = snapshot.state.position && !snapshot.state.position.monitoringGap ? snapshot.state.position.realizedPnl || 0 : 0;
  snapshot.state = { ...snapshot.state, trades: [], decisions: (snapshot.state.decisions || []).slice(-100), realizedBase: view.realized - partial, tradeCountBase: view.tradeCount };
  heartbeatAttempts.add(at);
  let acknowledgedAt = at;
  const r = await db.from(table).update({ received_at: at, raw_payload: { workerId, saved: snapshot, workerStatus, executionVersion: 2, book: { ...view, decisions: (view.decisions || []).slice(-100), trades: [] } } }).eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').eq('received_at', lease).select('id').abortSignal(AbortSignal.timeout(4000));
  if (r.error || r.data?.length !== 1) {
    // A timed-out request may still have committed. Verify ownership before retrying.
    const check = await db.from(table).select('received_at,raw_payload').eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').maybeSingle().abortSignal(AbortSignal.timeout(4000));
    if (check.error) throw new Error('BTC_HEARTBEAT_STORAGE_UNAVAILABLE');
    const outcome = reconcileHeartbeat(check.data, workerId, [...heartbeatAttempts], lease);
    audit('STORAGE_HEALTH', { reason: `HEARTBEAT_RECONCILED_${outcome}` });
    if (outcome === 'LOST') throw new Error('BTC_LEASE_OR_STORAGE_LOST');
    if (outcome === 'UNCHANGED') throw new Error('BTC_HEARTBEAT_STORAGE_UNAVAILABLE');
    acknowledgedAt = check.data.received_at;
  }
  heartbeatAttempts.clear(); lease = acknowledgedAt; save();
}
async function poll() {
  const r = await db.from(table).select('id,received_at,signal,raw_payload').eq('secret_hash', owner).in('strategy_id', ['btc_delta_breakout_v1', '__paper_control__']).gte('received_at', after).order('received_at').order('id').limit(1000).abortSignal(AbortSignal.timeout(4000));
  if (r.error) throw new Error('BTC_SIGNAL_STORAGE_UNAVAILABLE');
  if (r.data?.length === 1000) throw new Error('BTC_SIGNAL_BACKLOG_OR_STORAGE_ERROR');
  for (const v of r.data || []) {
    if (seenRows.has(v.id)) continue; seenRows.add(v.id);
    const control = v.raw_payload?.paperControl;
    if (control?.market === 'BTC' && control.stopAndClose === true) {
      saved.state = btcCancelSetup(saved.state, now()); saved.state.enabled = false;
      if (saved.state.position && saved.state.pendingExit !== 'MONITORING_INTERRUPTED') saved.state.pendingExit = 'MANUAL_STOP_AND_CLOSE';
      saved.state.status = saved.state.position ? 'AWAITING_MANUAL_CLOSE' : 'DISABLED';
      save(); continue;
    }
    if (control?.market === 'BTC' && typeof control.btcBreakoutEnabled === 'boolean') { if (!control.btcBreakoutEnabled) saved.state = btcCancelSetup(saved.state, now()); saved.state.enabled = control.btcBreakoutEnabled; saved.state.status = saved.state.position ? 'OPEN' : saved.state.enabled ? 'WAITING_FOR_SIGNAL' : 'DISABLED'; save(); continue; }
    const candle = v.signal?.metadata?.btcPaper;
    if (v.signal?.metadata?.diagnostic || v.raw_payload?.automation?.mode !== 'PAPER' || candle?.kind !== 'SIGNAL' || v.signal.timeframe !== '1' || !['BUY', 'SELL'].includes(v.signal.action)) continue;
    const signal = { id: v.signal.id, action: v.signal.action, symbol: v.signal.symbol, receivedAt: v.received_at, closedAt: candle.closedAt, high: candle.high, low: candle.low, signalPrice: v.signal.price };
    audit('SIGNAL', signal); const next = btcSignal(saved.state, signal); audit('SIGNAL_DECISION', { signalId: signal.id, status: next.status, enabled: next.enabled }); update(next);
  }
  if (r.data?.length) after = new Date(Date.parse(r.data[r.data.length - 1].received_at) - 60000).toISOString();
}
async function main() {
  const old = await db.from(table).select('received_at,raw_payload').eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').maybeSingle().abortSignal(AbortSignal.timeout(4000));
  if (old.error) throw new Error('BTC_STORAGE_UNAVAILABLE');
  if (old.data && Date.now() - Date.parse(old.data.received_at) < 15000) throw new Error('BTC_ANOTHER_WORKER_ACTIVE');
  saved = old.data?.raw_payload?.saved;
  if (fs.existsSync(checkpoint)) { const local = JSON.parse(fs.readFileSync(checkpoint, 'utf8')); if (local.owner === owner && Date.parse(local.savedAt) > Date.parse(saved?.savedAt || '1970-01-01')) saved = local; }
  if (!saved) { const end = new Date(); end.setUTCMonth(end.getUTCMonth() + 1); saved = { startedAt: now(), endsAt: end.toISOString(), state: emptyBtcState() }; }
  after = old.data ? new Date(Date.parse(old.data.received_at) - 60000).toISOString() : saved.startedAt;
  lease = now();
  const row = { ...rowBase('state', lease, strategy), raw_payload: { workerId, saved, workerStatus } };
  const claim = old.data ? await db.from(table).update(row).eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').eq('received_at', old.data.received_at).select('id') : await db.from(table).insert(row).select('id');
  if (claim.error || claim.data?.length !== 1) throw new Error('BTC_LEASE_UNAVAILABLE'); save();
  product = await publicGet('products/BTCUSD');
  if (product.symbol !== 'BTCUSD' || product.contract_type !== 'perpetual_futures' || product.notional_type !== 'vanilla' || product.state !== 'live' || product.trading_status !== 'operational' || Math.abs(1 / Number(product.contract_value) - Math.round(1 / Number(product.contract_value))) > 1e-8 || Number(product.initial_margin) > 1) throw new Error('BTC_CONTRACT_NOT_SUPPORTED');
  depthBook = createDeltaDepth(Number(product.contract_value));
  connect(); let published = Date.now();
  // Keep feed recovery independent of awaited database requests.
  watchdog = setInterval(() => {
    if (!feedNeedsReconnect({ readyState: socket.readyState, openState: WebSocket.OPEN, connectingState: WebSocket.CONNECTING, quoteAt: quote?.at, lastFrame, connectedAt })) return;
    audit('FEED_HEALTH', { reason: 'WATCHDOG_RECONNECT', quoteAgeMs: quote ? Date.now() - Date.parse(quote.at) : null, readyState: socket.readyState });
    socket.removeAllListeners(); socket.on('error', () => {}); socket.terminate();
    workerStatus = 'RECONNECTING_DELTA_FEED'; connect();
  }, 1000);
  console.log('Delta BTC public-data paper worker started. No order API.');
  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    if (Date.now() - published > 3000) {
      try { await publish(); published = Date.now(); }
      catch (error) {
        audit('STORAGE_HEALTH', { reason: error.message, leaseAgeMs: Date.now() - Date.parse(lease) });
        save();
        if (!canRetryPublish(error, lease)) throw error;
        continue;
      }
    }
    try { await poll(); }
    catch (error) {
      if (!retryablePoll(error)) throw error;
      audit('STORAGE_HEALTH', { reason: error.message }); save();
    }
  }
}
process.on('SIGTERM', () => { save(); process.exit(0); });
process.on('SIGINT', () => { save(); process.exit(0); });
main().then(() => process.exit(0)).catch(async e => { clearInterval(watchdog); workerStatus = `STOPPED_${/^[A-Z_]+$/.test(e.message) ? e.message : 'UNEXPECTED_ERROR'}`; console.error(`${now()} ${workerStatus}`); audit('WORKER_STOP', { reason: workerStatus }); save(); process.exit(1); });
