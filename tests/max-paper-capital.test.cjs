const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/maxPaperCapital.ts');
const compiled = new Module(file);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { maxPaperCapital } = compiled.exports;
const at = n => new Date(Date.UTC(2026, 10, 9, 0, n)).toISOString();
const trade = (n, capital, pnl, reason) => ({ openedAt: at(n), closedAt: at(n + 1), capital, pnl, reason });
const capital = t => t.capital;

test('counts prior losses plus entry capital and resets only at a target', () => {
  const trades = [
    trade(0, 60000, -20000, 'PREMIUM_SL'),
    trade(1, 80000, 10000, 'TIME_EXIT'),
    trade(2, 100000, -30000, 'PREMIUM_SL'),
    trade(3, 200000, 60000, 'PREMIUM_TARGET'),
    trade(4, 220000, -5000, 'PREMIUM_SL'),
  ];
  assert.equal(maxPaperCapital(trades.reverse(), null, capital), 250000);
});

test('includes an unfinished segment without adding earlier entry premiums', () => {
  assert.equal(maxPaperCapital([trade(0, 100, -25, 'SIGNAL_CANDLE_STOP')], { openedAt: at(1) }, capital, 150), 175);
  assert.equal(maxPaperCapital([], null, capital), null);
});
