const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const file = path.resolve(__dirname, '../app/lib/algo/btcPerformance.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { isPointOneBtc, btcProgressionPerformance: pointOneBtcPerformance, btcDateRange, inBtcPerformanceScope } = copy.exports;
test('new progression sizes are included but untagged earlier sizes stay excluded', () => {
  assert(inBtcPerformanceScope({ quantityBtc: 0.2, requestedQuantityBtc: 0.2, sizingPolicy: 'SL_STEP_0_1_CAP_0_8_V1' }));
  assert.equal(inBtcPerformanceScope({ quantityBtc: 0.2 }), false);
  assert.equal(inBtcPerformanceScope({ quantityBtc: 0.9, requestedQuantityBtc: 0.9, sizingPolicy: 'SL_STEP_0_1_CAP_0_8_V1' }), false);
});
test('date range includes both boundaries in IST, supports all dates and rejects reversed range', () => {
  const rows = [{ openedAt: '2026-10-27T18:29:59Z' }, { openedAt: '2026-10-27T18:30:00Z' }, { openedAt: '2026-10-28T18:29:59Z' }, { openedAt: '2026-10-28T18:30:00Z' }];
  assert.deepEqual(btcDateRange(rows, '2026-10-28', '2026-10-28'), rows.slice(1, 3));
  assert.equal(btcDateRange(rows, '', '').length, 4);
  assert.equal(btcDateRange(rows, '2026-10-29', '2026-10-28').length, 0);
});
test('0.1 request scope includes its partial fills but never a partial fill of an older 1 BTC request', () => {
  assert(isPointOneBtc({ quantityBtc: 0.1 }));
  assert(isPointOneBtc({ quantityBtc: 0.02, entryQuantityBtc: 0.04, canceledEntryBtc: 0.06 }));
  assert.equal(isPointOneBtc({ quantityBtc: 0.1, entryQuantityBtc: 0.1, canceledEntryBtc: 0.9 }), false);
  assert.equal(isPointOneBtc({ quantityBtc: 1 }), false);
});
test('0.1 lifetime totals ignore older quantity, monitoring gaps and compacted all-size base', () => {
  const trades = [{ quantityBtc: 1, pnl: 1000 }, { quantityBtc: 0.1, pnl: 12 }, { quantityBtc: 0.1, pnl: -2 }, { quantityBtc: 0.1, pnl: 99, monitoringGap: {} }];
  const book = { trades, position: { quantityBtc: 0.1, realizedPnl: 3 }, unrealized: 4, realizedBase: 9000 };
  const result = pointOneBtcPerformance(book);
  assert.equal(result.realized, 13); assert.equal(result.tradeCount, 2); assert.equal(result.unrealized, 4);
  assert.equal(result.trades.length, 3); assert.equal(book.trades.length, 4);
});
test('older open position contributes no P&L; no position is zero; unverified open stays unavailable', () => {
  assert.equal(pointOneBtcPerformance({ trades: [], position: { quantityBtc: 1, realizedPnl: 10 }, unrealized: 50 }).unrealized, null);
  assert.equal(pointOneBtcPerformance({ trades: [], position: null, unrealized: null }).unrealized, 0);
  const r = pointOneBtcPerformance({ trades: [], position: { quantityBtc: 0.1, monitoringGap: {}, realizedPnl: 9 }, unrealized: null });
  assert.equal(r.realized, 0); assert.equal(r.unrealized, null);
});
