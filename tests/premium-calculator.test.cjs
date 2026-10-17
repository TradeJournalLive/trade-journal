const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/premiumCalculator.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { premiumCalculation: calc, completedPremiumCandle: candle } = copy.exports;
test('premium target stays anchored to close, amounts use entry and whole-lot quantity', () => {
  const v = calc(100, 90, 102, 2, 65); assert.equal(v.stop, 90); assert.equal(v.target, 115); assert.equal(v.riskAmount, 1560); assert.equal(v.rewardAmount, 1690); assert.equal(v.quantity, 130);
  assert.equal(calc(100, 90, 100, 1, 65).actualRR, 1.5);
});
test('invalid candles and quantity fail; entries beyond levels are explicitly flagged', () => {
  for (const args of [[100,100,100,1,65],[100,90,100,0,65],[100,90,100,1.5,65],[NaN,90,100,1,65]]) assert.throws(() => calc(...args));
  assert.ok(calc(100,90,89,1,65).warning); assert.ok(calc(100,90,116,1,65).warning);
});
test('only completed valid five-minute candles are eligible, regardless of response order', () => {
  const rows = [[1200,100,110,90,105],[900,100,110,90,100],[600,100,110,90,101]];
  assert.equal(candle(rows, 1499000).close, 100); assert.equal(candle(rows, 1500000).close, 105); assert.equal(candle([],1500000), null);
});
