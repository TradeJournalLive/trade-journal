const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const path = require("node:path");
function load(name) {
  const file = path.resolve(__dirname, `../app/lib/algo/${name}.ts`);
  const copy = new Module(file, module);
  copy.require = id => id.startsWith("./") ? load(id.slice(2)) : require(id);
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
test("NIFTY accepts the 14:55 signal but rejects later entry setups", () => {
  const at = minute => `2026-10-16T09:${minute}:00Z`;
  for (const [minute, accepted] of [["25", true], ["26", false]]) {
    const signal = { ...buy, receivedAt: at(minute), signal: { ...buy.signal, metadata: { niftyPaper: { ...buy.signal.metadata.niftyPaper, closedAt: at(minute) } } } };
    const result = buildNiftyOptionsPaper([enabled, signal], at(minute));
    assert.equal(Boolean(result.checkpoint.setup), accepted);
    if (!accepted) assert.equal(result.checkpoint.decisions.at(-1).status, "SIGNAL_AFTER_CUTOFF");
  }
});
test("late opposite signals still request an exit without arming a new setup", () => {
  const open = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011)], time(3));
  const late = event("late-sell", 4, { kind: "SIGNAL", high: 25020, low: 25000, closedAt: "2026-10-16T09:26:00Z" }, "SELL");
  late.receivedAt = "2026-10-16T09:26:01Z";
  const result = buildNiftyOptionsPaper([late], late.receivedAt, open.checkpoint);
  assert.equal(result.checkpoint.pendingExit, "OPPOSITE_SIGNAL");
  assert.equal(result.checkpoint.setup, null);
});
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
test("full position exits at 5R without partial-lot allocation", () => {
  const result = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 200)], time(5));
  assert.equal(result.trades[0].reason, "TARGET_5R");
  assert.equal(result.realized, 100 * 65); assert.equal(result.position, null);
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
  const events = [enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 200)];
  const first = buildNiftyOptionsPaper(events.slice(0, 4), time(3));
  const restarted = buildNiftyOptionsPaper(events.slice(4), time(5), first.checkpoint);
  assert.deepEqual(restarted, buildNiftyOptionsPaper(events, time(5)));
  assert.equal(buildNiftyOptionsPaper([events[4]], time(5), restarted.checkpoint).trades.length, 1);
});
test("compacted checkpoint retains lifetime P&L without replaying the trade ledger", () => {
  const closed = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011), tick(4, 25012, 200)], time(5));
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
test("new single-lot trade exits all quantity at 5R", () => {
  const open = newBook(1);
  const held = buildNiftyOptionsPaper([v2(4, 25012, 130)], time(4), open.checkpoint);
  assert.ok(held.position); assert.equal(held.trades.length, 0);
  const closed = buildNiftyOptionsPaper([v2(5, 25012, 200)], time(5), held.checkpoint);
  assert.equal(closed.trades[0].reason, 'TARGET_5R'); assert.equal(closed.realized, 6500);
});
test("legacy open position uses 5R while preserving original entry and stop", () => {
  const old = buildNiftyOptionsPaper([enabled, buy, tick(2, 25009), tick(3, 25011)], time(3));
  const result = buildNiftyOptionsPaper([v2(4, 25012, 130)], time(4), old.checkpoint);
  assert.equal(result.trades.length, 0); assert.equal(result.position.entry, 100);
});
test("old partial allocation upgrades only remaining target without losing booked fills", () => {
  const checkpoint = newBook(2).checkpoint;
  checkpoint.position.quantity = 65; checkpoint.position.lots = 1;
  checkpoint.position.realizedPnl = 6500;
  checkpoint.position.exitFills = [{ price: 200, quantity: 65, at: time(4), reason: 'TARGET_2X' }];
  checkpoint.position.targets = [{ price: 200, quantity: 65, filled: true }, { price: 250, quantity: 65, filled: false }];
  const before = structuredClone(checkpoint);
  const upgraded = buildNiftyOptionsPaper([], time(5), checkpoint);
  assert.deepEqual(checkpoint, before);
  assert.deepEqual(upgraded.position.targets, [{ price: 200, quantity: 65, filled: false }]);
  assert.equal(upgraded.position.realizedPnl, 6500);
  const closed = buildNiftyOptionsPaper([v2(6, 25012, 200)], time(6), upgraded.checkpoint);
  assert.equal(closed.realized, 13000); assert.equal(closed.trades[0].exitFills.length, 2);
});
test("15-minute level no longer exits but opposite signal still closes", () => {
  const open = newBook(2), trail = v2(4, 24899, 110);
  assert.ok(buildNiftyOptionsPaper([trail], time(4), open.checkpoint).position);
  const sell = event('sell-new', 4, { kind: 'SIGNAL', high: 25020, low: 25000, closedAt: time(4) }, 'SELL');
  assert.equal(buildNiftyOptionsPaper([sell, v2(5, 25012, 110)], time(5), open.checkpoint).trades[0].reason, 'OPPOSITE_SIGNAL');
});
test("two lots close together at 5R across restart without partial allocation", () => {
  const open = newBook(2);
  const partial = buildNiftyOptionsPaper([v2(4, 25012, 150)], time(4), open.checkpoint);
  assert.equal(partial.position.quantity, 130); assert.equal(partial.position.lots, 2);
  assert.equal(partial.realized, 0); assert.equal(partial.trades.length, 0);
  const compact = { ...partial.checkpoint, trades: [], realizedBase: partial.realized - (partial.position.realizedPnl ?? 0) };
  const repeated = buildNiftyOptionsPaper([v2(5, 25012, 150)], time(5), compact);
  assert.equal(repeated.position.quantity, 130); assert.equal(repeated.realized, 0);
  const below = buildNiftyOptionsPaper([v2(6, 25012, 199)], time(6), repeated.checkpoint);
  assert.ok(below.position);
  const final = buildNiftyOptionsPaper([v2(7, 25012, 200)], time(7), below.checkpoint);
  assert.equal(final.position, null); assert.equal(final.realized, 13000); assert.equal(final.tradeCount, 1);
  assert.equal(final.trades[0].exit, 200); assert.equal(final.trades[0].quantity, 130);
  assert.equal(final.trades[0].exitFills.length, 1); assert.equal(final.size.lots, 2);
});
test("unreached 5R keeps original premium stop and sizes once on exit", () => {
  const partial = buildNiftyOptionsPaper([v2(4, 25012, 150)], time(4), newBook(2).checkpoint);
  const final = buildNiftyOptionsPaper([v2(5, 25012, 79)], time(5), partial.checkpoint);
  assert.equal(final.trades[0].reason, 'PREMIUM_SL'); assert.equal(final.realized, -21 * 130);
  assert.equal(final.size.lots, 3);
});
test("new entry sweeps recorded asks within four points and targets its average fill", () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const entry = v2(3, 25011, 129, 65);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 130, quantity: 65 }, { price: 132, quantity: 65 }]; c.depthAt = time(3); });
  const result = buildNiftyOptionsPaper([buy, v2(2, 25009), entry], time(3), seed);
  assert.equal(result.position.entry, 131); assert.equal(result.position.entryFill.slippage, 1);
  assert.equal(result.position.targets[0].price, 231); assert.equal(result.position.targets.length, 1);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks[1].price = 134.05; });
  const skipped = buildNiftyOptionsPaper([buy, v2(2, 25009), entry], time(3), seed);
  assert.equal(skipped.position, null); assert.equal(skipped.status, 'WAITING_FOR_ENTRY_DEPTH');
});
test("stale depth or unreported quantity cannot fabricate a new fill", () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const entry = v2(8, 25011, 99, 65);
  entry.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 100, quantity: 10000 }]; c.depthAt = time(0); });
  assert.equal(buildNiftyOptionsPaper([buy, v2(7, 25009), entry], time(8), seed).position, null);
  const unknown = v2(3, 25011); unknown.signal.metadata.niftyPaper.contracts.forEach(c => { delete c.askSize; });
  assert.equal(buildNiftyOptionsPaper([buy, v2(2, 25009), unknown], time(3), seed).position, null);
});
test("5R exit requires enough observed bid quantity for the whole position", () => {
  const open = newBook(2), exit = v2(4, 25012, 310);
  exit.signal.metadata.niftyPaper.contracts.forEach(c => { c.bidSize = 65; });
  const held = buildNiftyOptionsPaper([exit], time(4), open.checkpoint);
  assert.equal(held.position.quantity, 130); assert.equal(held.trades.length, 0);
  const closed = buildNiftyOptionsPaper([v2(5, 25012, 310)], time(5), held.checkpoint);
  assert.equal(closed.trades[0].quantity, 130); assert.equal(closed.realized, 210 * 130);
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

test('late synchronized depth fills the locked contract without another index crossing', () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 11;
  const waiting = buildNiftyOptionsPaper([buy, v2(2, 25009), v2(3, 25011, 111.5, 390)], time(3), seed);
  assert.equal(waiting.position, null); assert.equal(waiting.status, 'WAITING_FOR_ENTRY_DEPTH');
  const next = v2(4, 25012, 111.3, 195);
  next.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 112.3, quantity: 195 }, { price: 112.35, quantity: 715 }]; c.depthAt = time(4); });
  const filled = buildNiftyOptionsPaper([next], time(4), waiting.checkpoint);
  assert.equal(filled.position.quantity, 715);
  assert.equal(filled.position.entryFill.initialAsk, 112.5);
  assert.equal(filled.position.openedAt, time(4));
  assert.equal(filled.position.contract.id, '25050-CE');
});
test('bounded attempt expires, survives restart, and cannot re-enter on a later crossing', () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const waiting = buildNiftyOptionsPaper([buy, v2(2, 25009), v2(3, 25011, 99, 65)], time(3), seed);
  const expired = buildNiftyOptionsPaper([v2(5, 25012, 99, 1000)], time(5), waiting.checkpoint);
  assert.equal(expired.setup, null); assert.equal(expired.position, null);
  assert.equal(expired.checkpoint.decisions.at(-1).status, 'ENTRY_SKIPPED_DEPTH_UNAVAILABLE');
  assert.equal(buildNiftyOptionsPaper([v2(6, 25009), v2(7, 25011, 99, 1000)], time(7), expired.checkpoint).position, null);
});
test('waiting never moves the original four-point limit or fills after index reversal', () => {
  const seed = buildNiftyOptionsPaper([enabled], time(1)).checkpoint; seed.size.lots = 2;
  const waiting = buildNiftyOptionsPaper([buy, v2(2, 25009), v2(3, 25011, 99, 65)], time(3), seed);
  const expensive = v2(4, 25012, 104, 1000);
  expensive.signal.metadata.niftyPaper.contracts.forEach(c => { c.asks = [{ price: 105, quantity: 1000 }]; c.depthAt = time(4); });
  assert.equal(buildNiftyOptionsPaper([expensive], time(4), waiting.checkpoint).position, null);
  const reversed = buildNiftyOptionsPaper([v2(4, 25009, 99, 1000), v2(5, 25011, 99, 1000)], time(5), waiting.checkpoint);
  assert.equal(reversed.position, null); assert.equal(reversed.setup, null);
});
