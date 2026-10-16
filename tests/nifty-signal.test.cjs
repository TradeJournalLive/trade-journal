const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/niftySignal.ts');
const copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { niftySignalCandle } = copy.exports;
test('normalizes native TradingView placeholders using actual bar close', () => {
  assert.deepEqual(niftySignalCandle({ kind: 'SIGNAL', high: '23010.2', low: '22990', barOpen: '2026-10-16T04:30:00Z' }, '1'), { kind: 'SIGNAL', high: 23010.2, low: 22990, closedAt: '2026-10-16T04:31:00.000Z' });
});
test('webhook payload cannot impersonate market-data ticks', () => {
  assert.equal(niftySignalCandle({ kind: 'TICK', high: 23000, low: 22990, closedAt: '2026-10-16T04:30:00Z' }, '1'), null);
  assert.equal(niftySignalCandle({ kind: 'SIGNAL', high: '{{high}}', low: '{{low}}' }, '1'), null);
});
