// Demo quotes only. No MT5 order API, trading password, or broker requests.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), Module = require('node:module'), ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), false);
const { createClient } = require('@supabase/supabase-js');
const file = path.resolve('app/lib/algo/goldPaperEngine.ts'), compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { emptyGoldState, goldTick, goldSignal, goldView } = compiled.exports;
const config = JSON.parse(fs.readFileSync('.paper-worker/config.json', 'utf8'));
const hash = v => crypto.createHash('sha256').update(v).digest('hex'), owner = hash(config.webhookSecret), workerId = crypto.randomUUID();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const directory = path.resolve('.paper-worker/gold'); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const checkpoint = path.join(directory, 'checkpoint.json');
const source = path.join(os.homedir(), 'Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/1to2-gold-quote.json');
const table = 'tradingview_signal_events', strategy = '__gold_mt5_worker__';
let state, lease, startedAt, pollAfter, lastSequence, closing = false;
const persisted = new Set(), decisions = new Map(), rowsSeen = new Set();
const now = () => new Date().toISOString();
function save() { fs.writeFileSync(checkpoint + '.tmp', JSON.stringify({ owner, savedAt: now(), startedAt, state }), { mode: 0o600 }); fs.renameSync(checkpoint + '.tmp', checkpoint); }
function audit(kind, data) { fs.appendFileSync(path.join(directory, now().slice(0, 10) + '.jsonl'), JSON.stringify({ at: now(), kind, data }) + '\n', { mode: 0o600 }); }
function row(name, id, at, data) { return { secret_hash: owner, strategy_id: name, signal_id: id, symbol: 'GOLD', action: 'EXIT', received_at: at, signal_timestamp: at, status: 'VALIDATED', accepted: false, execution_mode: 'PAPER', stage: 'SIGNAL_RECEIVED', signal: { id, strategyId: name, symbol: 'VANTAGE:XAUUSD', action: 'EXIT', source: 'TRADINGVIEW', timestamp: at, createdAt: at, metadata: {}, status: 'VALIDATED' }, decision: {}, raw_payload: data }; }
async function publish() {
  for (const t of state.trades) {
    const id = hash(t.id + ':' + t.openedAt); if (persisted.has(id)) continue;
    const r = await db.from(table).upsert(row('__gold_mt5_trade__', id, t.closedAt, { trade: t }), { onConflict: 'secret_hash,strategy_id,signal_id' });
    if (r.error) throw Error('GOLD_LEDGER_UNAVAILABLE'); persisted.add(id);
  }
  for (const d of state.decisions) {
    const value = JSON.stringify(d); if (decisions.get(d.id) === value) continue;
    const r = await db.from(table).upsert(row('__gold_mt5_decision__', hash(d.id), d.receivedAt, { decision: d }), { onConflict: 'secret_hash,strategy_id,signal_id' });
    if (r.error) throw Error('GOLD_DECISION_STORAGE_UNAVAILABLE'); decisions.set(d.id, value);
  }
  const at = now(), view = goldView(state);
  const r = await db.from(table).update({ received_at: at, raw_payload: { workerId, startedAt, savedAt: at, book: { ...view, trades: [], decisions: view.decisions.slice(-100) }, state: { ...state, history: [], trades: [], decisions: state.decisions.slice(-100) } } }).eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').eq('received_at', lease).select('id');
  if (r.error || r.data?.length !== 1) throw Error('GOLD_LEASE_LOST'); lease = at; save();
}
async function poll() {
  const r = await db.from(table).select('id,received_at,strategy_id,signal,raw_payload').eq('secret_hash', owner).in('strategy_id', ['gold_vantage_tracking_v1', '__paper_control__']).gte('received_at', pollAfter).order('received_at').order('id').limit(1000);
  if (r.error || r.data?.length === 1000) throw Error('GOLD_SIGNAL_STORAGE_UNAVAILABLE');
  for (const row of r.data || []) {
    if (rowsSeen.has(row.id)) continue; rowsSeen.add(row.id);
    const control = row.raw_payload?.paperControl;
    if (control?.market === 'GOLD' && typeof control.goldBreakoutEnabled === 'boolean') {
      state.enabled = control.goldBreakoutEnabled;
      if (!state.enabled) state.setup = null;
      audit('CONTROL', { enabled: state.enabled }); save(); continue;
    }
    const v = row.signal, m = v?.metadata;
    if (row.strategy_id !== 'gold_vantage_tracking_v1' || v.symbol !== 'VANTAGE:XAUUSD' || v.timeframe !== '1' || !['BUY', 'SELL'].includes(v.action) || m?.diagnostic) continue;
    const closed = Date.parse(m?.barOpen) + 60000;
    const signal = { id: v.id, action: v.action, receivedAt: row.received_at, closedAt: Number.isFinite(closed) ? new Date(closed).toISOString() : '', high: Number(m?.high), low: Number(m?.low) };
    state = goldSignal(state, signal); audit('SIGNAL_DECISION', state.decisions.at(-1)); save();
  }
  if (r.data?.length) pollAfter = r.data[r.data.length - 1].received_at;
}
async function main() {
  const old = await db.from(table).select('received_at,raw_payload').eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').maybeSingle();
  if (old.error) throw Error('GOLD_STORAGE_UNAVAILABLE');
  if (old.data && Date.now() - Date.parse(old.data.received_at) < 15000) throw Error('GOLD_ANOTHER_WORKER_ACTIVE');
  state = old.data?.raw_payload?.state || emptyGoldState(); startedAt = old.data?.raw_payload?.startedAt || now();
  if (fs.existsSync(checkpoint)) { const local = JSON.parse(fs.readFileSync(checkpoint, 'utf8')); if (local.owner === owner && Date.parse(local.savedAt) > Date.parse(old.data?.received_at || '1970-01-01')) { state = local.state; startedAt = local.startedAt; } }
  pollAfter = old.data ? new Date(Date.parse(old.data.received_at) - 60000).toISOString() : startedAt;
  lease = now(); const initial = row(strategy, 'state', lease, { workerId, startedAt, state, book: goldView(state) });
  const claim = old.data ? await db.from(table).update(initial).eq('secret_hash', owner).eq('strategy_id', strategy).eq('signal_id', 'state').eq('received_at', old.data.received_at).select('id') : await db.from(table).insert(initial).select('id');
  if (claim.error || claim.data?.length !== 1) throw Error('GOLD_LEASE_UNAVAILABLE'); save();
  let published = 0, polled = 0;
  while (!closing) {
    const at = Date.now();
    try {
      const quote = JSON.parse(fs.readFileSync(source, 'utf8'));
      if (quote.sequence !== lastSequence) {
        lastSequence = quote.sequence;
        const oldPosition = state.position, count = state.trades.length;
        state = goldTick(state, quote, at);
        if (oldPosition?.openedAt !== state.position?.openedAt || oldPosition?.stop !== state.position?.stop || count !== state.trades.length) { audit('EXECUTION', { quote, position: state.position, trade: count !== state.trades.length ? state.trades.at(-1) : null }); save(); }
      }
    } catch { state.status = 'WAITING_FOR_MT5_BRIDGE'; }
    if (at - polled >= 1000) { await poll(); polled = at; }
    if (at - published >= 5000) { await publish(); published = at; }
    await new Promise(r => setTimeout(r, 200));
  }
}
process.on('SIGTERM', () => { closing = true; if (state) save(); });
main().catch(e => { console.error(/^[A-Z_]+$/.test(e.message) ? e.message : 'GOLD_WORKER_ERROR'); process.exitCode = 1; });
