const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(name) {
  const file = path.join(root, 'app/lib/algo', name + '.ts'), m = new Module(file, module);
  m.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
const { buildRehearsalPlan: build, runRehearsalChecks, marketTimestamp, liveOrdersEnabled, liveRehearsalMode } = load('liveRehearsal');
const now = Date.parse('2026-11-19T04:00:00Z');
const draft = () => ({ symbol: 'NSE:NIFTY26NOV25250CE', recoveryLoss: 0, limit: 100, stop: 80, target: 200, maxLots: 1, maxCapital: 10000, dailyLossLimit: 2500, dayNet: 0, estimatedCharges: 80, maxSpread: 2, maxSlippage: 2 });
const quote = () => ({ symbol: draft().symbol, lotSize: 65, bid: 99, ask: 100, timestamp: now / 1000, status: 'ok' });
const blocked = (p, code) => { assert.equal(p.valid, false); assert.ok(p.checks.some(c => c.code === code && !c.ok)); };
test('valid rehearsal computes capital and stop risk including charges, but can never enable real orders', () => {
  const d = draft(), q = quote(), before = structuredClone({ d, q }), p = build(d, q, now);
  assert.equal(p.valid, true); assert.equal(p.quantity, 65); assert.equal(p.capital, 6580);
  assert.equal(p.plannedLoss, 1380); assert.equal(p.plannedProfit, 6420);
  assert.equal(p.realOrdersEnabled, false); assert.equal(liveOrdersEnabled, false); assert.equal(liveRehearsalMode, 'REHEARSAL_ONLY');
  assert.deepEqual({ d, q }, before);
});
test('sizing uses the production sheet function, with no +1 progression or total P&L rule', () => {
  for (const [loss, lots] of [[0,1],[1299.99,1],[1300,2],[3899.99,2],[3900,3],[9000,4]]) {
    const p = build({ ...draft(), recoveryLoss: loss, maxLots: 100, maxCapital: 1000000, dailyLossLimit: 100000 }, quote(), now);
    assert.equal(p.lots, lots); assert.equal(p.valid, true);
  }
});
test('missing, stale and future market timestamps fail closed, with no receipt-time fallback', () => {
  for (const timestamp of [null, '09:30:00', '2026-11-19T04:00:00', 0, (now-5001)/1000, now+1, 'not-a-date']) blocked(build(draft(), { ...quote(), timestamp }, now), 'FRESH_QUOTE');
  for (const timestamp of [now, now/1000, String(now/1000), new Date(now).toISOString(), (now-5000)/1000]) assert.equal(build(draft(), { ...quote(), timestamp }, now).valid, true);
  assert.ok(Number.isNaN(marketTimestamp(null)));
});
test('contract, quote and exchange size must match with no hard-coded size fallback', () => {
  blocked(build(draft(), null, now), 'LOT_SIZE');
  for (const lotSize of [null, 0, -1, 65.5, Infinity]) blocked(build(draft(), { ...quote(), lotSize }, now), 'LOT_SIZE');
  blocked(build(draft(), { ...quote(), symbol: 'NSE:OTHERCE' }, now), 'MARKET_MATCH');
  blocked(build({ ...draft(), symbol: 'NSE:BANKNIFTY26NOVCE' }, quote(), now), 'CONTRACT');
  assert.equal(build(draft(), { ...quote(), lotSize: 75 }, now).quantity, 75);
});
test('midnight/date-only REST timestamps cannot masquerade as fresh streaming ticks', () => {
  const midnight = Date.parse('2026-11-19T00:00:00Z');
  const p = build(draft(), { ...quote(), timestamp: midnight/1000 }, midnight + 1000);
  blocked(p, 'FRESH_QUOTE'); assert.match(p.checks.find(c => c.code === 'FRESH_QUOTE').detail, /midnight timestamp/);
});
test('invalid, crossed and wide books cannot validate an order plan', () => {
  for (const change of [{bid: null},{ask: null},{bid: 101},{ask: 0},{status:'error'}]) blocked(build(draft(), { ...quote(), ...change }, now), 'BOOK');
  blocked(build({ ...draft(), maxSpread: 0.5 }, quote(), now), 'SPREAD');
  blocked(build({ ...draft(), limit: 103 }, quote(), now), 'LIMIT_PRICE');
});
test('risk limits block rather than silently resizing or omitting charges', () => {
  blocked(build({ ...draft(), recoveryLoss: 1300 }, quote(), now), 'LOT_CAP');
  blocked(build({ ...draft(), maxCapital: 6500 }, quote(), now), 'CAPITAL');
  blocked(build({ ...draft(), dailyLossLimit: 1300 }, quote(), now), 'DAILY_LOSS');
  blocked(build({ ...draft(), dayNet: -1200 }, quote(), now), 'DAILY_LOSS');
  blocked(build({ ...draft(), dayNet: -2500 }, quote(), now), 'DAILY_LOSS');
  assert.equal(build({ ...draft(), dayNet: 10000 }, quote(), now).remainingLossBudget, 2500);
});
test('invalid numeric drafts and protection plans fail validation without throwing', () => {
  for (const change of [{recoveryLoss:NaN},{limit:Infinity},{target:100},{stop:100},{estimatedCharges:-1},{estimatedCharges:0},{maxLots:1.5},{maxCapital:-1},{maxSlippage:-1},{maxSpread:-1}]) assert.equal(build({ ...draft(), ...change }, quote(), now).valid, false);
});
test('the browser suite runs actual validation functions and identifies its fixtures', () => {
  const rows = runRehearsalChecks(); assert.equal(rows.length,8); assert.ok(rows.every(r => r.passed));
});
test('new workspace has only read-only API calls, no background polling or worker controls', () => {
  const source = fs.readFileSync(path.join(root, 'app/dashboard/LiveTestingWorkspace.tsx'),'utf8');
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)|setInterval|\/api\/algo\/paper["']|\/api\/algo\/hams-final/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|accessToken|placeOrder|modifyOrder|cancelOrder/);
  const panel = fs.readFileSync(path.join(root,'app/dashboard/AlgoTradingPanel.tsx'),'utf8');
  assert.match(panel, /label: "Live Testing", id: "live"/); assert.match(panel, /sectionReady && activeSection !== "live" && <BrokerReadinessAlert/);
  assert.match(panel, /sectionReady \? renderSection\(\)/);
});
