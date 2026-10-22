const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/btcPaperEngine.ts');
const copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { btcRules, btcTick, emptyBtcState } = copy.exports;
test('new BTC entries request 0.1 BTC and record partial remainder against that size', () => {
  assert.equal(btcRules.quantityBtc, 0.1);
  const at = n => new Date(Date.UTC(2026, 9, 22, 0, 0, n)).toISOString();
  for (const available of [0.1, 0.04]) {
    const quote = { timestamp: at(2), tradeAt: at(2), quoteAt: at(2), price: 101, bid: 101, ask: 102, bidBtc: 1, askBtc: available, mark: 101, markAt: at(2), maintenanceRate: 0.0025, executionVersion: 2, contractBtc: 0.001 };
    const state = { ...emptyBtcState(), enabled: true, previousTick: { ...quote, timestamp: at(1), price: 99 }, setup: { id: 'size-test', action: 'BUY', high: 100, low: 90, closedAt: at(0), receivedAt: at(1), signalPrice: 99, breakoutVerified: true } };
    const next = btcTick(state, quote);
    assert.equal(next.position.quantityBtc, available);
    assert.equal(next.position.initialMargin, 102 * available / 100);
    assert.equal(next.position.canceledEntryBtc, available === 0.1 ? 0 : 0.06);
    assert.equal(next.decisions.at(-1).canceledBtc, next.position.canceledEntryBtc);
    assert.equal(next.decisions.at(-1).status, available === 0.1 ? 'ENTERED' : 'PARTIALLY_FILLED');
  }
});
