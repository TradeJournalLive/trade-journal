const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const filename = require("node:path").resolve(__dirname, "../app/lib/algo/niftyRules.ts");
const copy = new Module(filename, module);
copy._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { niftyBreakout, niftyExit, premiumStopDistance, nextNiftySize, niftyTargets, niftyEntryFill } = copy.exports;
test("index crossings, validity and session boundaries", () => {
  const setup = { action: "BUY", high: 25030, low: 25000 };
  assert.equal(niftyBreakout(setup, 25030, 25031, 10, 894), "CE");
  assert.equal(niftyBreakout(setup, 25031, 25032, 1, 600), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 11, 600), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 1, 895), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 1, 914), null);
  assert.equal(niftyBreakout(setup, 25030, 25031, 1, 915), null);
  assert.equal(niftyBreakout({ ...setup, high: 25036 }, 25035, 25037, 1, 600), null);
  assert.equal(niftyBreakout({ ...setup, action: "SELL" }, 25000, 24999, 1, 600), "PE");
});
test("one 10R target covers all lots using original premium risk", () => {
  for (const lots of [1, 2, 3, 4, 5, 8]) {
    const plan = niftyTargets(130, lots, 65);
    assert.equal(plan.length, 1); assert.equal(plan[0].price, 330); assert.equal(plan[0].quantity, lots * 65);
  }
  assert.equal(niftyTargets(50, 1, 65)[0].price, 150);
});
test("depth fill allows exactly four points, rejects duplicates and invalid sizes", () => {
  assert.equal(niftyEntryFill(130, 130, [{ price: 130, quantity: 65 }, { price: 134, quantity: 65 }]).price, 132);
  assert.equal(niftyEntryFill(130, 130, [{ price: 130, quantity: 65 }, { price: 134.05, quantity: 65 }]), null);
  assert.equal(niftyEntryFill(130, 130, [{ price: 130, quantity: 65 }, { price: 130, quantity: 65 }]), null);
  assert.equal(niftyEntryFill(130, 130, [{ price: 130, quantity: NaN }]), null);
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
test("no index trail; premium stop, opposite signal, 10R and time exits remain", () => {
  const input = { side: "CE", entryPremium: 100, premium: 99, index: 24999, previous15m: { high: 25030, low: 25000 }, oppositeSignal: false, minutesIST: 600 };
  assert.equal(niftyExit(input), null);
  assert.equal(niftyExit({ ...input, side: "PE", index: 25031 }), null);
  assert.equal(niftyExit({ ...input, oppositeSignal: true }), "OPPOSITE_SIGNAL");
  assert.equal(niftyExit({ ...input, index: 25010, premium: 80 }), "PREMIUM_SL");
  assert.equal(niftyExit({ ...input, index: 25010, minutesIST: 894 }), null);
  assert.equal(niftyExit({ ...input, index: 25010, minutesIST: 895 }), "TIME_EXIT");
  assert.equal(niftyExit({ ...input, index: 25010, minutesIST: 914 }), "TIME_EXIT");
  assert.equal(niftyExit({ ...input, minutesIST: 915 }), "TIME_EXIT");
  for (const premium of [130, 200, 250, 299.95]) assert.equal(niftyExit({ ...input, premium }), null);
  assert.equal(niftyExit({ ...input, premium: 300 }), "TARGET_10R");
});
