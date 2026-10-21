const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/btcPaperEngine.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { emptyBtcState, btcSignal: rawBtcSignal, btcTick, btcView, btcDepthFill, btcCancelSetup } = copy.exports;
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
test('monitoring gaps preserve the entries switch and exclude post-gap exits from verified totals', () => {
  const s = btcTick(entry(), tick(30, 80500));
  assert.equal(s.enabled, true);
  assert.equal(s.trades[0].reason, 'TARGET_3R');
  assert.ok(s.trades[0].monitoringGap);
  assert.equal(btcView(s, time(31)).realized, 0);
  assert.equal(btcView(s, time(31)).tradeCount, 0);
});
test('gap recovery discards old setups without switching off or resuming them', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  s = btcTick(s, tick(2, 80099));
  s = btcTick(s, tick(30, 80101));
  assert.equal(s.enabled, true); assert.equal(s.setup, null); assert.equal(s.position, null);
  s = btcTick(s, tick(31, 80099));
  assert.equal(s.status, 'WAITING_FOR_SIGNAL'); assert.equal(s.position, null);
  const manualOff = { ...s, enabled: false };
  assert.equal(btcTick(manualOff, tick(55, 80090)).enabled, false);
});
test('gap interruption survives insufficient exit depth and restart', () => {
  const quote = tick(30, 80500); quote.bidBtc = 0;
  const s = btcTick(entry(), quote);
  assert.ok(s.position.monitoringGap);
  assert.equal(btcView(s, time(31)).unrealized, null);
  const closed = btcTick(JSON.parse(JSON.stringify(s)), tick(31, 80500));
  assert.equal(closed.trades[0].reason, 'TARGET_3R');
});
test('manual stop request closes at executable quote without fabricating a fill', () => {
  const s = entry(); s.enabled = false; s.setup = null; s.pendingExit = 'MANUAL_STOP_AND_CLOSE';
  const closed = btcTick(s, tick(4, 80110));
  assert.equal(closed.trades[0].reason, 'MANUAL_STOP_AND_CLOSE');
  assert.equal(closed.trades[0].exit, 80109);
  assert.equal(closed.position, null);
});
test('fresh quotes can execute stops even when last traded price is old', () => {
  const quote = tick(30, 80101, 79999, 80000); quote.tradeAt = time(3);
  const closed = btcTick(entry(), quote);
  assert.equal(closed.trades[0].reason, 'SIGNAL_CANDLE_STOP');
  assert.equal(closed.trades[0].exit, 79999);
});
test('brief quote gap does not force a position closed', () => {
  const s = btcTick(entry(), tick(20, 80110));
  assert.ok(s.position); assert.ok(s.position.monitoringGap);
  assert.equal(s.trades.length, 0); assert.equal(s.enabled, true);
  assert.equal(s.pendingExit, null);
});
test('old last trade alone cannot create a breakout entry', () => {
  let s = btcSignal({ ...emptyBtcState(), enabled: true }, signal());
  s = btcTick(s, tick(2, 80099));
  const quote = tick(10, 80101); quote.tradeAt = time(1);
  assert.equal(btcTick(s, quote).position, null);
});
test('restart checkpoints preserve gross P&L and never add leverage exposure', () => {
  const s = btcTick(entry(), tick(4, 80410, 80409, 80411)), v = btcView(s, time(5));
  const compact = { ...s, trades: [], realizedBase: v.realized, tradeCountBase: v.tradeCount };
  assert.equal(btcView(compact, time(6)).realized, 307); assert.equal(btcView(compact).tradeCount, 1);
});

function v2(n, price, bids, asks) {
  const t=tick(n,price,bids[0].price,asks[0].price);
  return {...t,executionVersion:2,contractBtc:.001,bidBtc:bids[0].quantityBtc,askBtc:asks[0].quantityBtc,depth:{at:time(n),sequence:n,bids,asks}};
}
function depthEntry(asks=[{price:80102,quantityBtc:.4},{price:80104,quantityBtc:.6}]) {
  let s=btcSignal({...emptyBtcState(),enabled:true},signal());s=btcTick(s,tick(2,80099));
  return btcTick(s,v2(3,80101,[{price:80101,quantityBtc:2}],asks));
}
test('BTC depth entry sweeps asks within five dollars and anchors 3R to actual average',()=>{
  const s=depthEntry(),p=s.position;
  assert.equal(p.quantityBtc,1);assert.ok(Math.abs(p.entry-80103.2)<1e-8);assert.equal(p.entryFill.fills.length,2);
  assert.ok(Math.abs(p.entryFill.slippage-1.2)<1e-8);
  assert.ok(Math.abs(p.target-(p.entry+3*(p.entry-p.stop)))<1e-8);
  assert.equal(s.decisions.at(-1).status,'ENTERED');assert.equal(s.decisions.at(-1).filledBtc,1);
});
test('partial entry cancels remainder, never tops up, and scales margin and P&L',()=>{
  const s=depthEntry([{price:80102,quantityBtc:.4},{price:80107.5,quantityBtc:2}]);
  assert.equal(s.position.quantityBtc,.4);assert.equal(s.position.canceledEntryBtc,.6);
  assert.equal(s.position.initialMargin,80102*.4/100);assert.equal(s.setup,null);
  assert.equal(s.decisions.at(-1).status,'PARTIALLY_FILLED');
  const held=btcTick(s,v2(4,80110,[{price:80109,quantityBtc:2}],[{price:80110,quantityBtc:2}]));
  assert.equal(held.position.quantityBtc,.4);
  const closed=btcTick(held,v2(5,80500,[{price:80500,quantityBtc:2}],[{price:80501,quantityBtc:2}]));
  assert.equal(closed.trades[0].quantityBtc,.4);assert.equal(closed.trades[0].pnl,(80500-80102)*.4);
});
test('short depth fill sweeps bids within five dollars, not upward asks',()=>{
  let s=btcSignal({...emptyBtcState(),enabled:true},signal('SELL','short-depth'));
  s=btcTick(s,tick(2,80001));
  s=btcTick(s,v2(3,79999,[{price:79998,quantityBtc:.3},{price:79994,quantityBtc:.7}],[{price:79999,quantityBtc:2}]));
  assert.equal(s.position.quantityBtc,1);assert.ok(Math.abs(s.position.entry-79995.2)<1e-8);
  assert.ok(s.position.entryFill.slippage<=5);assert.equal(s.position.stop,80100);
});
test('entry limit is inclusive and invalid/mismatched depth cannot invent fills',()=>{
  assert.equal(btcDepthFill([{price:100,quantityBtc:.4},{price:105,quantityBtc:.6}],true,1,.001,100,'a',5).quantityBtc,1);
  assert.equal(btcDepthFill([{price:100,quantityBtc:.4},{price:105.01,quantityBtc:.6}],true,1,.001,100,'a',5).quantityBtc,.4);
  assert.equal(btcDepthFill([{price:100,quantityBtc:.0005}],true,1,.001,100,'a',5),null);
  assert.equal(btcDepthFill([{price:101,quantityBtc:1}],true,1,.001,100,'a',5),null);
  assert.equal(btcDepthFill([{price:100,quantityBtc:1},{price:100,quantityBtc:1}],true,1,.001,100,'a',5),null);
});
test('partial exits use each snapshot once and survive restart without double-counting',()=>{
  const s=depthEntry();
  const partial=btcTick(s,v2(4,80500,[{price:80500,quantityBtc:.3},{price:80499,quantityBtc:.2}],[{price:80501,quantityBtc:2}]));
  assert.equal(partial.position.quantityBtc,.5);assert.equal(partial.pendingExit,'TARGET_3R');
  const pnl=(80500-s.position.entry)*.3+(80499-s.position.entry)*.2;
  assert.ok(Math.abs(btcView(partial,time(4)).realized-pnl)<1e-8);
  const repeat=v2(5,80500,[{price:80500,quantityBtc:.3},{price:80499,quantityBtc:.2}],[{price:80501,quantityBtc:2}]);
  repeat.depth={...repeat.depth,at:time(4),sequence:4};
  const unchanged=btcTick(JSON.parse(JSON.stringify(partial)),repeat);
  assert.equal(unchanged.position.quantityBtc,.5);
  const compact={...unchanged,trades:[],realizedBase:btcView(unchanged).realized-unchanged.position.realizedPnl};
  const final=btcTick(compact,v2(6,80490,[{price:80490,quantityBtc:1}],[{price:80491,quantityBtc:2}]));
  assert.equal(final.position,null);assert.equal(final.trades.length,1);assert.equal(final.trades[0].quantityBtc,1);
  assert.ok(Math.abs(final.trades[0].pnl-(pnl+(80490-s.position.entry)*.5))<1e-8);
  assert.equal(btcView(final).tradeCount,1);
});
test('missing deep levels still allow only the actual best-price partial quantity',()=>{
  const s=depthEntry([{price:80102,quantityBtc:.4}]);
  assert.equal(s.position.quantityBtc,.4);
  const miss=v2(3,80101,[{price:80101,quantityBtc:2}],[{price:80102,quantityBtc:.3},{price:80104,quantityBtc:.7}]);
  miss.depth.at=time(-10);
  let initial=btcSignal({...emptyBtcState(),enabled:true},signal());initial=btcTick(initial,tick(2,80099));
  assert.equal(btcTick(initial,miss).position.quantityBtc,.3);
});
test('decisions distinguish pre-receipt breaks, expiry, and superseding signals',()=>{
  let s=btcSignal({...emptyBtcState(),enabled:true},signal());
  const newer={...signal('BUY','newer'),receivedAt:time(2)};
  s=btcSignal(s,newer);assert.equal(s.decisions.find(d=>d.id==='buy').status,'SUPERSEDED');
  assert.equal(s.decisions.find(d=>d.id==='newer').status,'WAITING_FOR_BREAKOUT');
  s=btcTick(s,tick(600,80101));assert.equal(s.position,null);
  assert.ok(s.decisions.some(d=>d.status==='MONITORING_INTERRUPTED'));
});
test('new partial quantity still moves stop at 2R and preserves the 3R target',()=>{
  const s=depthEntry([{price:80102,quantityBtc:.4}]),p=s.position;
  const moved=btcTick(s,v2(4,80307,[{price:80306,quantityBtc:1}],[{price:80307,quantityBtc:1}]));
  assert.equal(moved.position.stop,p.entry);assert.equal(moved.position.target,p.target);
  const final=btcTick(moved,v2(5,80101,[{price:80101,quantityBtc:1}],[{price:80102,quantityBtc:1}]));
  assert.equal(final.trades[0].reason,'COST_TO_COST_STOP');assert.equal(final.trades[0].quantityBtc,.4);
});
test('a previously consumed book cannot be reused after a different exit snapshot',()=>{
  const s=depthEntry();
  const quote=n=>v2(n,80500,[{price:80500,quantityBtc:.2}],[{price:80501,quantityBtc:1}]);
  const one=btcTick(s,quote(4)),two=btcTick(one,quote(5)),again=quote(6);
  again.depth={...again.depth,at:time(4),sequence:4};
  assert.equal(btcTick(two,again).position.quantityBtc,.6);
});
test('switch-off gives waiting signals a durable cancellation reason',()=>{
  const s=btcSignal({...emptyBtcState(),enabled:true},signal());
  const canceled=btcCancelSetup(s,time(2));
  assert.equal(canceled.setup,null);assert.equal(canceled.decisions[0].status,'CANCELED');
  assert.ok(s.setup);
});
