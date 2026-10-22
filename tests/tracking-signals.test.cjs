const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/trackingSignals.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { isolateTrackingSignal, NIFTY_TRACKING_STRATEGY } = copy.exports;
test('tracking strategy cannot enable execution or submit paper trigger metadata', () => {
  const source = { strategyId: NIFTY_TRACKING_STRATEGY, automation: { enabled: true, mode: 'LIVE' }, metadata: { niftyPaper: { kind: 'SIGNAL' }, btcPaper: {}, paperBarOpen: true, signal: 'BUY' } };
  const result = isolateTrackingSignal(source);
  assert.equal(result.automation.enabled, false);
  assert.equal(result.automation.mode, 'PAPER');
  assert.deepEqual(result.metadata, { signal: 'BUY', trackingOnly: true });
  assert.equal(source.automation.enabled, true);
});
test('existing strategy payloads remain untouched', () => {
  const source = { strategyId: 'nifty_breakout_options_v1', automation: { enabled: true }, metadata: { niftyPaper: {} } };
  assert.equal(isolateTrackingSignal(source), source);
});
test('Vantage gold tracking also forces execution off', () => {
  const result = isolateTrackingSignal({ strategyId: copy.exports.GOLD_TRACKING_STRATEGY, automation: { enabled: true, mode: 'LIVE' }, metadata: { niftyPaper: {}, btcPaper: {} } });
  assert.deepEqual(result.automation, { enabled: false, mode: 'PAPER', underlying: 'GOLD' });
  assert.deepEqual(result.metadata, { trackingOnly: true });
});
