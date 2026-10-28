const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const file = path.resolve(__dirname, '../app/lib/algo/btcPaperEngine.ts'), loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { btcNextQuantity, btcRequestedQuantity, btcTick, btcCompactTrades, emptyBtcState, btcSizingPolicy } = loaded.exports;
const at = n => new Date(Date.UTC(2026, 9, 28, 0, 0, n)).toISOString();
const tick = (n, bid) => ({ timestamp: at(n), quoteAt: at(n), tradeAt: at(n), price: bid + 1, bid, ask: bid + 2, bidBtc: 1, askBtc: 1, mark: bid + 1, markAt: at(n), maintenanceRate: .0025 });
function open(size = 0.1) {
  return { ...emptyBtcState(), enabled: true, nextQuantityBtc: size, previousTick: tick(0, 100), position: { id: 'trade', sizingPolicy: btcSizingPolicy, requestedQuantityBtc: size, quantityBtc: size, entryQuantityBtc: size, entry: 100, side: 'LONG', stop: 90, initialRisk: 10, target: 130, openedAt: at(0), estimatedLiquidation: 1, leverage: 100 } };
}
test('SL steps exactly 0.1 up to cap; target resets; other exits preserve size', () => {
  let size = 0.1;
  for (const expected of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.8]) { size = btcNextQuantity(size, 'SIGNAL_CANDLE_STOP'); assert.equal(size, expected); }
  assert.equal(btcNextQuantity(size, 'TARGET_3R'), 0.1);
  for (const reason of ['OPPOSITE_SIGNAL', 'COST_TO_COST_STOP', 'MANUAL_STOP_AND_CLOSE', 'ESTIMATED_ISOLATED_MARGIN_EXIT']) assert.equal(btcNextQuantity(0.4, reason), 0.4);
  for (const value of [NaN, Infinity, -1, 0.9, 0.35]) assert.equal(btcRequestedQuantity({ nextQuantityBtc: value }), 0.1);
});
test('size changes once at confirmed closure and persists after ledger compaction/restart', () => {
  const closed = btcTick(open(), tick(1, 89));
  assert.equal(closed.nextQuantityBtc, 0.2); assert.equal(closed.position, null);
  const compact = btcCompactTrades(closed, new Set([`${closed.trades[0].id}:${closed.trades[0].openedAt}`]));
  const restored = btcTick(JSON.parse(JSON.stringify(compact)), tick(2, 100));
  assert.equal(restored.nextQuantityBtc, 0.2); assert.equal(restored.trades.length, 0);
  assert.equal(btcTick(open(0.4), tick(1, 130)).nextQuantityBtc, 0.1);
});
test('break-even, opposite exits, unverified closes and legacy positions never increase size', () => {
  const be = open(0.3); be.position.breakEven = true; be.position.stop = 100;
  assert.equal(btcTick(be, tick(1, 99)).nextQuantityBtc, 0.3);
  const opposite = open(0.3); opposite.pendingExit = 'OPPOSITE_SIGNAL';
  assert.equal(btcTick(opposite, tick(1, 95)).nextQuantityBtc, 0.3);
  const gap = open(0.3); gap.position.monitoringGap = { from: at(0), to: at(1) };
  assert.equal(btcTick(gap, tick(1, 89)).nextQuantityBtc, 0.3);
  const legacy = open(); delete legacy.position.sizingPolicy;
  assert.equal(btcTick(legacy, tick(1, 89)).nextQuantityBtc, 0.1);
});
test('actual entry requests the saved size and records partial requested/filled/canceled quantities', () => {
  const s = { ...emptyBtcState(), enabled: true, nextQuantityBtc: 0.4, previousTick: tick(0, 100), setup: { id: 'sized', action: 'BUY', symbol: 'DELTAIN:BTCUSD.P', receivedAt: at(0), closedAt: at(0), high: 105, low: 95, signalPrice: 101, breakoutVerified: true } };
  const entry = { ...tick(1, 106), executionVersion: 2, contractBtc: 0.001, askBtc: 0.2 };
  const result = btcTick(s, entry);
  assert.equal(result.position.requestedQuantityBtc, 0.4);
  assert.equal(result.position.quantityBtc, 0.2);
  assert.equal(result.position.canceledEntryBtc, 0.2);
  assert.equal(result.decisions[0].requestedBtc, 0.4);
  assert.equal(result.decisions[0].canceledBtc, 0.2);
  assert.equal(result.nextQuantityBtc, 0.4);
});
test('partial exit does not change size until final fill; repeated tick cannot advance twice', () => {
  const s = open(0.4);
  s.position.entryFill = { liquidityId: 'original', price: 100, quantityBtc: 0.4, initialQuote: 100, slippage: 0, fills: [] };
  const first = { ...tick(1, 89), executionVersion: 2, contractBtc: 0.001, bidBtc: 0.2 };
  const partial = btcTick(s, first);
  assert.equal(partial.position.quantityBtc, 0.2); assert.equal(partial.nextQuantityBtc, 0.4);
  const done = btcTick(partial, { ...first, timestamp: at(2), quoteAt: at(2), tradeAt: at(2), markAt: at(2) });
  assert.equal(done.position, null); assert.equal(done.nextQuantityBtc, 0.5);
  assert.equal(btcTick(done, { ...first, timestamp: at(3) }).nextQuantityBtc, 0.5);
});
