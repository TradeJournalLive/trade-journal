const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(name) {
  const file = path.join(__dirname, '../app/lib/algo', `${name}.ts`), compiled = new Module(file, module);
  compiled.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return compiled.exports;
}
const { niftyFreshSessionAt, niftyLotsForLoss, startNiftyLossCycle, finishNiftyCycleTrade } = load('niftyLossCycle');

test('worksheet thresholds advance on the exact paisa, not on each losing trade', () => {
  for (const [loss, lots] of [[0,1],[1299.99,1],[1300,2],[3899.99,2],[3900,3],[7799.99,3],[7800,4],[9000,4],[13000,5],[819000,36],[865800,37]]) {
    assert.equal(niftyLotsForLoss(loss), lots, `loss ${loss}`);
  }
});

test('rollout waits until IST cutoff and a flat account, funds ten lakh, and retains old trades', () => {
  const s = { position: null, nextLots: 11, balance: 987654, trades: [{ pnl: -12346 }], lossCycleFrom: niftyFreshSessionAt };
  startNiftyLossCycle(s, '2026-11-16T18:29:59.999Z');
  assert.equal(s.nextLots, 11);
  s.position = { signalId: 'legacy' }; startNiftyLossCycle(s, niftyFreshSessionAt);
  assert.equal(s.lossCycle, undefined);
  s.position = null; startNiftyLossCycle(s, niftyFreshSessionAt);
  assert.equal(s.nextLots, 1);
  assert.equal(s.balance, 1000000);
  assert.deepEqual(s.capitalReset, { at: niftyFreshSessionAt, previousBalance: 987654, netAtReset: 0 });
  assert.deepEqual(s.trades, [{ pnl: -12346 }]);
});

test('net losses and partial profits carry through restart and the next day; a target resets only the deficit', () => {
  let s = { position: null, nextLots: 1, balance: 1000000, lossCycleFrom: niftyFreshSessionAt };
  startNiftyLossCycle(s, niftyFreshSessionAt);
  finishNiftyCycleTrade(s, -1299.99, 'PREMIUM_SL'); assert.equal(s.nextLots, 1);
  finishNiftyCycleTrade(s, -0.01, 'TIME_EXIT'); assert.equal(s.nextLots, 2);
  finishNiftyCycleTrade(s, -2600, 'PREMIUM_SL'); assert.equal(s.nextLots, 3);
  finishNiftyCycleTrade(s, -6100, 'PREMIUM_SL'); assert.equal(s.nextLots, 4);
  finishNiftyCycleTrade(s, 1000, 'TIME_EXIT'); assert.equal(s.lossCycle.loss, 9000); assert.equal(s.nextLots, 4);
  s = JSON.parse(JSON.stringify(s)); startNiftyLossCycle(s, '2026-11-18T03:47:00.000Z');
  assert.equal(s.nextLots, 4);
  finishNiftyCycleTrade(s, 1300, 'OPPOSITE_BREAKOUT'); assert.equal(s.nextLots, 3);
  finishNiftyCycleTrade(s, 2000, 'PREMIUM_TARGET'); assert.equal(s.nextLots, 1);
  assert.deepEqual(s.lossCycle, { loss: 0, net: -5700, count: 7 });
});

test('a reset after activation is one-time and HAMS recovery uses only net cash changes since it', () => {
  const { newLimitState } = load('niftyLimitPaper');
  const { emptyHamsState } = load('hamsFinalPaper');
  const { hamsRecoveryView } = load('hamsHistory');
  const trade = (n, pnl, version) => ({ signalId: `t${n}`, openedAt: `2026-11-17T04:0${n}:00Z`, closedAt: `2026-11-17T04:0${n}:01Z`, pnl, sizing: { version }, ruleVersion: 2, reason: 'TIME_EXIT' });
  const rulesV2 = newLimitState(niftyFreshSessionAt, 3, false, true);
  Object.assign(rulesV2, { lossCycleFrom: niftyFreshSessionAt, lossCycle: { loss: 1400, net: -1400, count: 1 }, balance: 1050000, nextLots: 2 });
  startNiftyLossCycle(rulesV2, '2026-11-17T04:02:00Z');
  assert.equal(rulesV2.balance, 1000000);
  assert.equal(rulesV2.nextLots, 2);
  assert.equal(rulesV2.capitalReset.netAtReset, -1400);
  rulesV2.balance = 1000199.50;
  startNiftyLossCycle(rulesV2, '2026-11-17T04:04:00Z');
  assert.equal(rulesV2.balance, 1000199.50);
  const saved = { ...emptyHamsState(), balance: rulesV2.balance, rulesV2, trades: [trade(0, 51400, 1), trade(1, -1400, 2)] };
  const { state } = hamsRecoveryView(saved, [], [{ type: 'TRADE', value: trade(3, 199.50, 2) }]);
  assert.equal(state.balance, 1000199.50);
  assert.equal(state.rulesV2.balance, 1000199.50);
  assert.equal(state.trades.length, 3);
  assert.equal(state.rulesV2.capitalReset.previousBalance, 1050000);
});

test('execution uses the planned lots and actual net P&L without changing premium rules', () => {
  const { newLimitState, markLimitPaper } = load('niftyLimitPaper');
  const t = n => new Date(Date.parse('2026-11-17T04:00:00Z') + n * 1000).toISOString();
  let s = newLimitState(t(0), 1, true, true);
  s.lossCycleFrom = niftyFreshSessionAt; s.balance = 940000;
  s.setup = { id: 'new', action: 'BUY', closedAt: t(-60), receivedAt: t(-58), high: 22500, low: 22495, interval: 1, triggered:true, attempt:{contractId:'CE',reference:100,at:t(0)} };
  const q = (n,bid,ask) => ({ id:'CE', expiry:'2026-11-17', strike:22500, side:'CE', lotSize:65, at:t(n), bid, ask, bidSize:500, askSize:500 });
  s = markLimitPaper(s, { at:t(0), spot:22501, chain:[q(0,99,100)] });
  assert.ok(s.position, JSON.stringify(s.decisions));
  assert.equal(s.position.lots, 1);
  assert.equal(s.position.stop, 80);
  assert.equal(s.position.target, 200);
  s = markLimitPaper(s, { at:t(1), spot:22501, chain:[q(1,80,81)] });
  assert.equal(s.trades[0].grossPnl, -1300);
  assert.equal(s.lossCycle.loss, -s.trades[0].pnl);
  assert.ok(s.lossCycle.loss > 1300);
  assert.equal(s.nextLots, 2);
});
