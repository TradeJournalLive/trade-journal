const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const filename = require("node:path").resolve(__dirname, "../app/lib/algo/paperEngine.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const moduleCopy = new Module(filename, module);
moduleCopy._compile(compiled.outputText, filename);
const { buildPaperBooks } = moduleCopy.exports;
test("next candle fills use exact matching open, never the signal close or a different feed", () => {
  const enabled = control(true); enabled.raw.paperControl.nextCandle = true;
  const buy = signal("b", "BUY", 100, 1); buy.signal.timeframe = "1"; buy.signal.metadata.signalBarTime = "2026-10-15T10:00:00Z";
  assert.equal(buildPaperBooks([enabled, buy]).BTC.position, null);
  assert.equal(buildPaperBooks([enabled, buy]).BTC.pending.signalPrice, 100);
  const candle = signal("open1", "EXIT", 102, 1); candle.signal.timeframe = "1"; candle.signal.metadata.paperBarOpen = true;
  const sell = signal("s", "SELL", 110, 2); sell.signal.timeframe = "1"; sell.signal.metadata.signalBarTime = "2026-10-15T10:01:00Z";
  const candle2 = signal("open2", "EXIT", 108, 2); candle2.signal.timeframe = "1"; candle2.signal.metadata.paperBarOpen = true;
  const book = buildPaperBooks([enabled, buy, candle, sell, candle2]).BTC;
  assert.equal(book.trades[0].entry, 102); assert.equal(book.trades[0].exit, 108); assert.equal(book.trades[0].points, 6);
  assert.equal(book.position.side, "SHORT"); assert.equal(book.position.entry, 108);
  candle.signal.symbol = "OANDA:BTCUSD";
  assert.equal(buildPaperBooks([enabled, buy, candle]).BTC.position, null);
});
function signal(id, action, price, minute = 1, symbol = "BTCUSDT") {
  const time = `2026-10-15T10:${String(minute).padStart(2, "0")}:00Z`;
  return { receivedAt: time, signal: { id, strategyId: "test", action, price, symbol, timestamp: time, metadata: {} }, raw: { automation: { mode: "PAPER", enabled: true } } };
}
function control(enabled, market = "BTC", minute = 0) {
  const event = signal(`control-${minute}`, "EXIT", undefined, minute);
  event.raw = { paperControl: { enabled, market } };
  return event;
}
test("only new signals after enabling enter; opposite signals reverse; repeated and duplicate signals do not add entries", () => {
  const sell = signal("s", "SELL", 120, 4);
  const events = [signal("old", "BUY", 80), control(true, "BTC", 2), signal("b", "BUY", 100, 3), sell, sell, signal("s2", "SELL", 115, 5)];
  const book = buildPaperBooks(events).BTC;
  assert.equal(book.trades.length, 1);
  assert.equal(book.trades[0].points, 20);
  assert.equal(book.position.side, "SHORT");
  assert.equal(book.position.entry, 120);
  assert.deepEqual(buildPaperBooks(events).BTC, book);
});
test("off prevents new entries but permits opposite-signal exit of an existing position", () => {
  const book = buildPaperBooks([control(true), signal("b", "BUY", 100), control(false, "BTC", 2), signal("s", "SELL", 90, 3)]).BTC;
  assert.equal(book.trades[0].points, -10);
  assert.equal(book.position, null);
  assert.equal(book.enabled, false);
});
test("markets are isolated and diagnostic/live signals never execute", () => {
  const diagnostic = signal("d", "BUY", 10, 2); diagnostic.signal.metadata.diagnostic = true;
  const live = signal("live", "BUY", 10, 3); live.raw.automation.mode = "LIVE";
  const books = buildPaperBooks([control(true), diagnostic, live, signal("n", "BUY", 20000, 4, "NIFTY")]);
  assert.equal(books.BTC.position, null); assert.equal(books.NIFTY.position, null);
});
test("different price feeds cannot close one another's positions", () => {
  const book = buildPaperBooks([control(true), signal("b", "BUY", 100), signal("s", "SELL", 110, 2, "BTCUSD")]).BTC;
  assert.equal(book.trades.length, 0); assert.equal(book.position.entry, 100);
});
test("NIFTY past cutoff is marked pending rather than fabricating a closing price", () => {
  const entry = signal("b", "BUY", 22000, 1, "NIFTY"); entry.receivedAt = "2026-10-15T04:30:00Z";
  const book = buildPaperBooks([control(true, "NIFTY"), entry], "2026-10-15T10:00:00Z").NIFTY;
  // The control is later than entry, so that old signal must not open a position.
  assert.equal(book.position, null);
  const enabled = control(true, "NIFTY"); enabled.receivedAt = "2026-10-15T04:00:00Z";
  const active = buildPaperBooks([enabled, entry], "2026-10-15T10:00:00Z").NIFTY;
  assert.equal(active.pendingSessionClose, true); assert.equal(active.trades.length, 0);
});
test("slippage worsens both long and short fills and reconciles gross to net", () => {
  const enabled = control(true); enabled.raw.paperControl.slippage = 2;
  const book = buildPaperBooks([enabled, signal("b", "BUY", 100), signal("s", "SELL", 120, 2), signal("b2", "BUY", 110, 3)]).BTC;
  assert.equal(book.trades[0].grossPoints, 20); assert.equal(book.trades[0].points, 16);
  assert.equal(book.trades[1].grossPoints, 10); assert.equal(book.trades[1].points, 6);
  for (const trade of book.trades) assert.equal(trade.points, trade.grossPoints - trade.slippagePoints);
});
test("changing feeds preserves unresolved positions and ignores later events from the old feed", () => {
  const change = control(true, "BTC", 2); change.raw.paperControl.symbol = "OANDA:BTCUSD";
  const book = buildPaperBooks([control(true), signal("b", "BUY", 100), change, signal("o", "SELL", 110, 3, "OANDA:BTCUSD"), signal("old", "SELL", 120, 4)]).BTC;
  assert.equal(book.unresolvedPositions.length, 1); assert.equal(book.unresolvedPositions[0].symbol, "BTCUSDT");
  assert.equal(book.position.symbol, "OANDA:BTCUSD"); assert.equal(book.trades.length, 0);
});
