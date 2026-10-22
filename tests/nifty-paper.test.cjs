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
test("delayed signals remain eligible for a newly observed breakout", () => {
  const delayed = { ...buy, receivedAt: time(12) };
  const result = buildNiftyOptionsPaper([enabled, delayed, tick(13, 25009), tick(14, 25011)], time(15));
  assert.equal(result.position.openedAt, time(14));
  assert.equal(result.position.entry, 100);
  assert.equal(buildNiftyOptionsPaper([enabled, delayed, tick(13, 25011), tick(14, 25012)], time(15)).position, null);
});
test("delayed delivery never extends the ten-candle validity window", () => {
  const delayed = event("expired", 12, { kind: "SIGNAL", high: 25010, low: 24990, closedAt: "2026-10-16T04:20:00Z" }, "BUY");
  const result = buildNiftyOptionsPaper([enabled, delayed, tick(13, 25009), tick(14, 25011)], time(15));
  assert.equal(result.position, null);
  assert.equal(result.setup, null);
});
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
test("display health tolerates checkpoint polling without relaxing execution quotes", () => {
  const valid = buildNiftyOptionsPaper([enabled, tick(2, 25009)], time(3));
  const saved = { ...valid.checkpoint, status: 'WAITING_FOR_COMPLETED_15M_CANDLE' };
  const refreshed = buildNiftyOptionsPaper([], time(12), saved);
  assert.equal(refreshed.status, 'WAITING_FOR_SIGNAL');
  assert.equal(refreshed.stale, false);
  assert.equal(buildNiftyOptionsPaper([], time(20), saved).stale, true);
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

function v2(second, price, bid = 99, askSize = 6500) {
  const e = tick(second, price, bid), data = e.signal.metadata.niftyPaper;
  data.executionVersion = 2;
  data.contracts.forEach(c => { c.askSize = askSize; c.bidSize = 6500; });
  return e;
}
function newBook(lots) {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint;
  seed.size.lots = lots;
  return buildNiftyOptionsPaper([buy, v2(2, 25009), v2(3, 25011)], time(3), seed);
}
test("new single-lot trade ignores legacy 1.5R and exits at double premium", () => {
  const open = newBook(1);
  const held = buildNiftyOptionsPaper([v2(4, 25012, 130)], time(4), open.checkpoint);
  assert.ok(held.position); assert.equal(held.trades.length, 0);
  const closed = buildNiftyOptionsPaper([v2(5, 25012, 200)], time(5), held.checkpoint);
  assert.equal(closed.trades[0].reason, 'TARGET_2X'); assert.equal(closed.realized, 6500);
});
test("existing old position retains its recorded legacy rule on version-two ticks", () => {
  const old = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011)], time(3));
  const result = buildNiftyOptionsPaper([v2(4, 25012, 130)], time(4), old.checkpoint);
  assert.equal(result.trades[0].reason, 'TARGET_1_5R');
});
test("new targets never disable the completed 15-minute trail or opposite signal exit", () => {
  const open = newBook(2), trail = v2(4, 24899, 110);
  assert.equal(buildNiftyOptionsPaper([trail], time(4), open.checkpoint).trades[0].reason, 'INDEX_15M_TRAIL');
  const sell = event('sell-new', 4, { kind: 'SIGNAL', high: 25020, low: 25000, closedAt: time(4) }, 'SELL');
  assert.equal(buildNiftyOptionsPaper([sell, v2(5, 25012, 110)], time(5), open.checkpoint).trades[0].reason, 'OPPOSITE_SIGNAL');
});
test("two lots book one at double, remainder at 2.5x; restart keeps partial P&L once", () => {
  const open = newBook(2);
  const partial = buildNiftyOptionsPaper([v2(4, 25012, 200)], time(4), open.checkpoint);
  assert.equal(partial.position.quantity, 65); assert.equal(partial.position.lots, 1);
  assert.equal(partial.realized, 6500); assert.equal(partial.trades.length, 0);
  const compact = { ...partial.checkpoint, trades: [], realizedBase: partial.realized - partial.position.realizedPnl };
  const repeated = buildNiftyOptionsPaper([v2(5, 25012, 200)], time(5), compact);
  assert.equal(repeated.position.quantity, 65); assert.equal(repeated.realized, 6500);
  const final = buildNiftyOptionsPaper([v2(6, 25012, 250)], time(6), repeated.checkpoint);
  assert.equal(final.position, null); assert.equal(final.realized, 16250); assert.equal(final.tradeCount, 1);
  assert.equal(final.trades[0].exit, 225); assert.equal(final.trades[0].quantity, 130);
  assert.equal(final.trades[0].exitFills.length, 2); assert.equal(final.size.lots, 2);
});
test("partial target keeps original premium stop and sizes once on final exit", () => {
  const partial = buildNiftyOptionsPaper([v2(4, 25012, 200)], time(4), newBook(2).checkpoint);
  const final = buildNiftyOptionsPaper([v2(5, 25012, 79)], time(5), partial.checkpoint);
  assert.equal(final.trades[0].reason, 'PREMIUM_SL'); assert.equal(final.realized, (100 - 21) * 65);
  assert.equal(final.size.lots, 3);
});
test("new entry sweeps recorded asks within four points and targets its average fill", () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const entry = v2(3, 25011, 129, 65);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 130, quantity: 65 }, { price: 132, quantity: 65 }]; c.depthAt = time(3); });
  const result = buildNiftyOptionsPaper([buy, v2(2, 25009), entry], time(3), seed);
  assert.equal(result.position.entry, 131); assert.equal(result.position.entryFill.slippage, 1);
  assert.equal(result.position.targets[0].price, 262); assert.equal(result.position.targets[1].price, 327.5);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks[1].price = 134.05; });
  const skipped = buildNiftyOptionsPaper([buy, v2(2, 25009), entry], time(3), seed);
  assert.equal(skipped.position, null); assert.equal(skipped.status, 'ENTRY_SKIPPED_INSUFFICIENT_DEPTH_WITHIN_4_POINTS');
});
test("stale depth or unreported quantity cannot fabricate a new fill", () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const entry = v2(8, 25011, 99, 65);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 100, quantity: 10000 }]; c.depthAt = time(0); });
  assert.equal(buildNiftyOptionsPaper([buy, v2(7, 25009), entry], time(8), seed).position, null);
  const unknown = v2(3, 25011); unknown.signal.metadata.niftyPaper.contracts.forEach(c => { delete c.askSize; });
  assert.equal(buildNiftyOptionsPaper([buy, v2(2, 25009), unknown], time(3), seed).position, null);
});
test("gap over both targets never reuses the same bid quantity twice", () => {
  const open = newBook(2), exit = v2(4, 25012, 260);
  exit.signal.metadata.niftyPaper.contracts.forEach(c => { c.bidSize = 65; });
  const held = buildNiftyOptionsPaper([exit], time(4), open.checkpoint);
  assert.equal(held.position.quantity, 65); assert.equal(held.trades.length, 0);
  const closed = buildNiftyOptionsPaper([v2(5, 25012, 260)], time(5), held.checkpoint);
  assert.equal(closed.trades[0].quantity, 130); assert.equal(closed.realized, 160 * 130);
});
test('NIFTY records exact range rejection and entry reasons without changing fills',()=>{
  const invalid=event('range',1,{kind:'SIGNAL',high:25132.65,low:25000,closedAt:time(0)},'SELL');
  const rejected=buildNiftyOptionsPaper([enabled,invalid],time(2));
  assert.equal(rejected.checkpoint.decisions[0].status,'INVALID_SIGNAL_CANDLE');
  assert.match(rejected.checkpoint.decisions[0].reason,/132.65/);
  const entered=newBook(1);assert.equal(entered.checkpoint.decisions.find(d=>d.id==='buy').status,'ENTERED');
});
test('NIFTY reports the existing 15-minute entry gate explicitly',()=>{
  const first=tick(2,25009);delete first.signal.metadata.niftyPaper.previous15m;
  const result=buildNiftyOptionsPaper([enabled,buy,first],time(3));
  assert.equal(result.position,null);
  assert.equal(result.checkpoint.decisions.find(d=>d.id==='buy').status,'WAITING_FOR_COMPLETED_15M_CANDLE');
});
