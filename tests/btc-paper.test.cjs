const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/btcPaperEngine.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { emptyBtcState, btcSignal: rawBtcSignal, btcTick, btcView } = copy.exports;
const time = n => new Date(Date.UTC(2026, 9, 16, 22, 0, n)).toISOString();
const signal = (action = 'BUY', id = 'buy') => ({ id, action, symbol: 'DELTAIN:BTCUSD.P', receivedAt: time(1), closedAt: time(0), high: 80100, low: 80000, signalPrice: 80080 });
function tick(n, price, bid = price - 1, ask = price + 1) { return { timestamp: time(n), tradeAt: time(n), quoteAt: time(n), price, bid, ask, bidBtc: 2, askBtc: 2, mark: price, markAt: time(n), maintenanceRate: .0025, previous15m: { high: 81000, low: 79000, closedAt: time(0) } }; }
// Standard fixtures include uninterrupted, unbroken prices during alert delivery.
function btcSignal(state, signal) {
  const end = Date.parse(state.previousTick?.timestamp || signal.receivedAt), start = Date.parse(signal.closedAt);
  const priceHistory = [];
  for (let at = start; at <= end; at += 1000) priceHistory.push({ second: Math.floor(at / 1000), first: at, last: Math.min(at + 999, end), low: 80050, high: 80050, gap: 1000 });
  return rawBtcSignal({ ...state, previousTick: state.previousTick || tick((end - Date.parse(time(0))) / 1000, 80050), priceHistory }, signal);
}
test('breakout before alert processing is missed even if price returned inside', () => {
  let s = { ...emptyBtcState(), enabled: true };
  for (let n = 0; n <= 4; n++) s = btcTick(s, tick(n, n === 2 ? 79990 : 80050));
  s = rawBtcSignal(s, { ...signal('SELL', 'missed'), receivedAt: time(4) });
  assert.equal(s.status, 'MISSED_BREAKOUT'); assert.equal(s.setup, null);
  s = btcTick(btcTick(s, tick(5, 80001)), tick(6, 79999));
  assert.equal(s.position, null);
});
test('missing delivery-period price history is unverifiable', () => {
  const s = rawBtcSignal({ ...emptyBtcState(), enabled: true }, signal());
  assert.equal(s.status, 'UNVERIFIABLE_BREAKOUT_HISTORY'); assert.equal(s.setup, null);
});
test('first breakout without sufficient depth is not retried on a re-cross', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  s = btcTick(s, tick(2, 80099)); const shallow = tick(3, 80101); shallow.askBtc = .1;
  s = btcTick(s, shallow); assert.equal(s.status, 'MISSED_BREAKOUT_UNFILLED');
  s = btcTick(btcTick(s, tick(4, 80099)), tick(5, 80101));
  assert.equal(s.position, null); assert.equal(s.setup, null);
});
test('fresh breakout with stale execution quote is missed, not retried', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  s = btcTick(s, tick(2, 80099));
  s = btcTick(s, { ...tick(8, 80101), quoteAt: time(1) });
  assert.equal(s.status, 'MISSED_BREAKOUT_UNFILLED');
  s = btcTick(btcTick(s, tick(9, 80099)), tick(10, 80101));
  assert.equal(s.position, null);
});
function entry() { let s = { ...emptyBtcState(), enabled: true }; s = btcSignal(s, signal()); s = btcTick(s, tick(2, 80099)); return btcTick(s, tick(3, 80101)); }
test('delayed signals allow fresh breakout entries without extending ten-candle validity', () => {
  const delayed = { ...signal(), receivedAt: time(12) };
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, delayed);
  assert.ok(s.setup);
  s = btcTick(btcTick(s, tick(13, 80099)), tick(14, 80101));
  assert.equal(s.position.openedAt, time(14));
  const expired = btcSignal({ ...emptyBtcState(), enabled: true }, { ...delayed, receivedAt: time(601) });
  assert.equal(btcTick(expired, tick(602, 80101)).position, null);
  assert.equal(btcTick(expired, tick(602, 80101)).setup, null);
  assert.equal(btcSignal({ ...emptyBtcState(), enabled: true }, { ...delayed, closedAt: time(13) }).status, 'INVALID_SIGNAL_CANDLE');
});
test('24/7 crossing enters at ask, stop is candle low and target is 3R', () => {
  const s = entry(), p = s.position;
  assert.equal(p.entry, 80102); assert.equal(p.trigger, 80100); assert.equal(p.stop, 80000); assert.equal(p.target, 80408);
  assert.equal(p.initialMargin, 801.02); assert.equal(p.entryDifference, 2);
  const closed = btcTick(s, tick(4, 80410, 80409, 80411));
  assert.equal(closed.trades[0].reason, 'TARGET_3R'); assert.equal(closed.trades[0].pnl, 307);
});
test('new positions do not exit at 1.5R and saved older targets remain unchanged', () => {
  const s = entry();
  assert.ok(btcTick(s, tick(4, 80257, 80256, 80258)).position);
  const legacy = { ...s, position: { ...s.position, target: 80255 } };
  const closed = btcTick(legacy, tick(4, 80257, 80256, 80258));
  assert.equal(closed.trades[0].reason, 'TARGET_1_5R');
  assert.equal(closed.trades[0].target, 80255);
});
test('short uses bid entry, ask exit and P&L is not multiplied by leverage', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal('SELL', 'sell'));
  s = btcTick(s, tick(2, 80001)); s = btcTick(s, tick(3, 79999));
  assert.equal(s.position.entry, 79998); assert.equal(s.position.stop, 80100);
  s = btcTick(s, tick(4, 79690, 79689, 79691));
  assert.equal(s.trades[0].pnl, 307); assert.equal(s.trades[0].quantityBtc, 1);
});
test('no NIFTY range cap, but stale quotes and insufficient depth never fill', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  assert.ok(s.setup); s = btcTick(s, tick(2, 80099));
  const stale = tick(8, 80101); stale.quoteAt = time(1);
  assert.equal(btcTick(s, stale).position, null);
  const shallow = tick(3, 80101); shallow.askBtc = .9;
  assert.equal(btcTick(s, shallow).position, null);
});
test('ten-candle expiry and Binance signals are rejected', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal()); s = btcTick(s, tick(2, 80099));
  s = btcTick(s, tick(600, 80101)); assert.equal(s.setup, null); assert.equal(s.position, null);
  const other = btcSignal({ ...emptyBtcState(), enabled: true }, { ...signal(), symbol: 'BINANCE:BTCUSDT' });
  assert.equal(other.status, 'REJECTED_DIFFERENT_PRICE_FEED'); assert.equal(other.setup, null);
});
test('same-direction signals cannot queue re-entry while a position is open', () => {
  const s = btcSignal(entry(), { ...signal('BUY', 'second'), closedAt: time(4), receivedAt: time(4) });
  assert.equal(s.setup, null); assert.ok(s.position);
});
test('invalid mark price blocks entry', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  s = btcTick(s, tick(2, 80099));
  assert.equal(btcTick(s, { ...tick(3, 80101), mark: 0 }).position, null);
});
test('opposite signal exits but does not reverse immediately; duplicate ignored', () => {
  const sell = { ...signal('SELL', 'sell'), receivedAt: time(4), closedAt: time(4) };
  let s = btcSignal(btcTick(entry(), tick(4, 80090)), sell); assert.deepEqual(btcSignal(s, sell), s);
  s = btcTick(s, tick(5, 80090)); assert.equal(s.trades[0].reason, 'OPPOSITE_SIGNAL'); assert.equal(s.position, null); assert.ok(s.setup);
});
test('15m trail no longer exits BTC; initial candle stop remains active', () => {
  const trail = tick(4, 80080); trail.previous15m.low = 80090;
  assert.ok(btcTick(entry(), trail).position);
  const stopped = tick(4, 79998); stopped.previous15m = undefined;
  assert.equal(btcTick(entry(), stopped).trades[0].reason, 'SIGNAL_CANDLE_STOP');
});
test('2R moves long stop to entry, persists on restart and exits at executable bid', () => {
  const before = btcTick(entry(), tick(4, 80306, 80305, 80307));
  assert.equal(before.position.stop, 80000);
  const moved = btcTick(before, tick(5, 80307, 80306, 80308));
  assert.equal(moved.position.stop, 80102);
  assert.equal(moved.position.initialRisk, 102);
  assert.equal(moved.position.target, 80408);
  const closed = btcTick(JSON.parse(JSON.stringify(moved)), tick(6, 80102, 80101, 80103));
  assert.equal(closed.trades[0].reason, 'COST_TO_COST_STOP');
  assert.equal(closed.trades[0].pnl, -1);
});
test('short 2R uses executable ask and does not require 15m history', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal('SELL', 'short-ctc'));
  const first = tick(2, 80001), cross = tick(3, 79999);
  delete first.previous15m; delete cross.previous15m;
  s = btcTick(btcTick(s, first), cross);
  s = btcTick(s, tick(4, 79793, 79792, 79794));
  assert.equal(s.position.stop, 79998);
  assert.equal(s.position.target, 79692);
  const closed = btcTick(s, tick(5, 79998, 79997, 79999));
  assert.equal(closed.trades[0].reason, 'COST_TO_COST_STOP');
});
test('monitoring gaps pause entries and exclude post-gap exits from verified totals', () => {
  const s = btcTick(entry(), tick(30, 80500));
  assert.equal(s.enabled, false);
  assert.equal(s.trades[0].reason, 'MONITORING_INTERRUPTED');
  assert.ok(s.trades[0].monitoringGap);
  assert.equal(btcView(s, time(31)).realized, 0);
  assert.equal(btcView(s, time(31)).tradeCount, 0);
});
test('gap interruption survives insufficient exit depth and restart', () => {
  const quote = tick(30, 80500); quote.bidBtc = 0;
  const s = btcTick(entry(), quote);
  assert.ok(s.position.monitoringGap);
  assert.equal(btcView(s, time(31)).unrealized, null);
  const closed = btcTick(JSON.parse(JSON.stringify(s)), tick(31, 80500));
  assert.equal(closed.trades[0].reason, 'MONITORING_INTERRUPTED');
});
test('manual stop request closes at executable quote without fabricating a fill', () => {
  const s = entry(); s.enabled = false; s.setup = null; s.pendingExit = 'MANUAL_STOP_AND_CLOSE';
  const closed = btcTick(s, tick(4, 80110));
  assert.equal(closed.trades[0].reason, 'MANUAL_STOP_AND_CLOSE');
  assert.equal(closed.trades[0].exit, 80109);
  assert.equal(closed.position, null);
});
test('restart checkpoints preserve gross P&L and never add leverage exposure', () => {
  const s = btcTick(entry(), tick(4, 80410, 80409, 80411)), v = btcView(s, time(5));
  const compact = { ...s, trades: [], realizedBase: v.realized, tradeCountBase: v.tradeCount };
  assert.equal(btcView(compact, time(6)).realized, 307); assert.equal(btcView(compact).tradeCount, 1);
});
