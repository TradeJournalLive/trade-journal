const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const filename = require("node:path").resolve(__dirname, "../app/lib/algo/niftyRules.ts");
const copy = new Module(filename, module);
copy._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { niftyBreakout, niftyExit, premiumStopDistance, nextNiftySize } = copy.exports;
test("index crossings, validity and session boundaries", () => {
  const setup = { action: "BUY", high: 25030, low: 25000 };
  assert.equal(niftyBreakout(setup, 25030, 25031, 10, 894), "CE");
  assert.equal(niftyBreakout(setup, 25031, 25032, 1, 600), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 11, 600), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 1, 895), null);
  assert.equal(niftyBreakout({ ...setup, high: 25036 }, 25035, 25037, 1, 600), null);
  assert.equal(niftyBreakout({ ...setup, action: "SELL" }, 25000, 24999, 1, 600), "PE");
});
test("premium SL uses smaller of twenty points and twenty percent", () => {
  assert.equal(premiumStopDistance(50), 10);
  assert.equal(premiumStopDistance(200), 20);
});
test("SL increases immediately; two other losses increase once; wins never reset size", () => {
  let state = nextNiftySize({ lots: 1, consecutiveLosses: 0 }, { points: -5, stopLoss: false });
  assert.deepEqual(state, { lots: 1, consecutiveLosses: 1 });
  state = nextNiftySize(state, { points: -5, stopLoss: false });
  assert.deepEqual(state, { lots: 2, consecutiveLosses: 0 });
  state = nextNiftySize(state, { points: -20, stopLoss: true });
  assert.equal(state.lots, 3);
  assert.equal(nextNiftySize(state, { points: 40, stopLoss: false }).lots, 3);
});
test("CE trails completed index low, PE trails high, time exits at 14:55", () => {
  const input = { side: "CE", entryPremium: 100, premium: 99, index: 24999, previous15m: { high: 25030, low: 25000 }, oppositeSignal: false, minutesIST: 600 };
  assert.equal(niftyExit(input), "INDEX_15M_TRAIL");
  assert.equal(niftyExit({ ...input, side: "PE", index: 25031 }), "INDEX_15M_TRAIL");
  assert.equal(niftyExit({ ...input, index: 25010, premium: 80 }), "PREMIUM_SL");
  assert.equal(niftyExit({ ...input, minutesIST: 895 }), "TIME_EXIT");
  assert.equal(niftyExit({ ...input, index: 25010, premium: 130 }), "TARGET_1_5R");
});
