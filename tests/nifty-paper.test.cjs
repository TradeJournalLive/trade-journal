const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const path = require("node:path");
function load(name) {
  const file = path.resolve(__dirname, `../app/lib/algo/${name}.ts`);
  const copy = new Module(file, module);
  copy.require = id => id === "./niftyRules" ? load("niftyRules") : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  return copy.exports;
}
const { buildNiftyOptionsPaper } = load("niftyPaperEngine");
const time = second => `2026-10-16T04:31:${String(second).padStart(2, "0")}Z`;
function event(id, second, data, action = "EXIT") { return { receivedAt: time(second), signal: { id, strategyId: "nifty", symbol: "NSE:NIFTY", action, timeframe: "1", metadata: { niftyPaper: data } }, raw: { automation: { mode: "PAPER" } } }; }
function tick(second, price, bid = 99) {
  return event(`tick-${second}`, second, { kind: "TICK", indexSymbol: "NSE:NIFTY", timestamp: time(second), price, nearestExpiry: "2026-10-20", chainComplete: true,
    previous15m: { high: 25100, low: 24900, closedAt: "2026-10-16T04:30:00Z" },
    contracts: [24950, 25000, 25050].flatMap(strike => ["CE", "PE"].map(side => ({ id: `${strike}-${side}`, expiry: "2026-10-20", strike, side, lotSize: 65, bid, ask: bid + 1, timestamp: time(second) }))) });
}
const enabled = { ...event("control", 0, {}), raw: { paperControl: { market: "NIFTY", enabled: false, niftyOptionsEnabled: true } } };
const buy = event("buy", 1, { kind: "SIGNAL", high: 25010, low: 24990, closedAt: time(0) }, "BUY");
test("full position exits at 1.5R without partial-lot allocation", () => {
  const result = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 130)], time(5));
  assert.equal(result.trades[0].reason, "TARGET_1_5R");
  assert.equal(result.realized, 30 * 65); assert.equal(result.position, null);
});
test("breakout buys nearest-expiry OTM at ask and premium SL exits bid; raises size", () => {
  const events = [enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 79)];
  const result = buildNiftyOptionsPaper(events, time(5));
  assert.equal(result.trades.length, 1); assert.equal(result.trades[0].entry, 100);
  assert.equal(result.trades[0].contract.strike, 25050); assert.equal(result.trades[0].exit, 79);
  assert.equal(result.realized, -21 * 65); assert.equal(result.size.lots, 2);
  assert.equal(result.position, null);
});
test("does not fill without fresh quotes or an actual crossing", () => {
  const stale = tick(3, 25011); stale.signal.metadata.niftyPaper.contracts.forEach(c => c.timestamp = "2026-10-16T04:30:00Z");
  assert.equal(buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), stale], time(4)).position, null);
  assert.equal(buildNiftyOptionsPaper([enabled, buy, tick(2, 25011), tick(3, 25012)], time(4)).position, null);
});
test("opposite signal closes only on fresh premium and never immediately reverses", () => {
  const sell = event("sell", 4, { kind: "SIGNAL", high: 25020, low: 25000, closedAt: time(4) }, "SELL");
  const events = [enabled, buy, tick(2, 25009), tick(3, 25011), sell, tick(5, 25012, 105)];
  const result = buildNiftyOptionsPaper(events, time(6));
  assert.equal(result.trades[0].reason, "OPPOSITE_SIGNAL"); assert.equal(result.position, null);
  assert.equal(result.setup.action, "SELL");
  assert.deepEqual(buildNiftyOptionsPaper([...events, events[4]], time(6)), result);
});
test("checkpoint restart matches full replay without duplicating a trade", () => {
  const events = [enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 130)];
  const first = buildNiftyOptionsPaper(events.slice(0, 4), time(3));
  const restarted = buildNiftyOptionsPaper(events.slice(4), time(5), first.checkpoint);
  assert.deepEqual(restarted, buildNiftyOptionsPaper(events, time(5)));
  assert.equal(buildNiftyOptionsPaper([events[4]], time(5), restarted.checkpoint).trades.length, 1);
});
test("compacted checkpoint retains lifetime P&L without replaying the trade ledger", () => {
  const closed = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 130)], time(5));
  const compact = { ...closed.checkpoint, trades: [], realizedBase: closed.realized, tradeCountBase: closed.tradeCount };
  const restored = buildNiftyOptionsPaper([], time(6), compact);
  assert.equal(restored.realized, closed.realized);
  assert.equal(restored.tradeCount, 1);
  assert.equal(restored.trades.length, 0);
});
test("premium stop is not blocked by missing completed 15m history", () => {
  const stop = tick(4, 25012, 79);
  delete stop.signal.metadata.niftyPaper.previous15m;
  const result = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), stop], time(5));
  assert.equal(result.trades[0].reason, "PREMIUM_SL");
  assert.notEqual(result.status, "OPEN");
});
test("missing ATM quote cannot shift the selected OTM strike", () => {
  const entry = tick(3, 25011);
  entry.signal.metadata.niftyPaper.contracts.filter(c => c.strike === 25000).forEach(c => c.timestamp = "2026-10-16T04:30:00Z");
  const result = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), entry], time(4));
  assert.equal(result.position.contract.strike, 25050);
});
test("insufficient quoted quantity never fabricates a full fill", () => {
  const entry = tick(3, 25011);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => c.askSize = 10);
  assert.equal(buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), entry], time(4)).position, null);
  const exit = tick(4, 25012, 79);
  exit.signal.metadata.niftyPaper.contracts.forEach(c => c.bidSize = 10);
  const result = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), exit], time(5));
  assert.equal(result.trades.length, 0);
  assert.ok(result.position);
});
