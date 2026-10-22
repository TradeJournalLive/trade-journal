const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/goldPaperEngine.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { emptyGoldState, goldTick, goldSignal, goldView, validGoldQuote } = copy.exports;
const base = Date.parse('2026-10-22T16:00:00Z'), iso = n => new Date(base + n * 1000).toISOString();
const quote = (n, bid, ask = bid + 0.2) => ({ symbol: 'XAUUSD', server: 'VantageMarkets-Demo', demo: true, currency: 'USD', tickAtMs: base + n * 1000, exportedAtMs: base + n * 1000, bid, ask, contractSize: 100, volumeMin: .01, volumeMax: 10, volumeStep: .01, tickSize: .01, margin003: 120, leverage: 100 });
const tick = (s, n, bid, ask) => goldTick(s, quote(n, bid, ask), base + n * 1000);
const signal = (action = 'BUY', id = 'buy') => ({ id, action, receivedAt: iso(2), closedAt: iso(0), high: 4010, low: 4000 });
function setup(action = 'BUY') { let s = { ...emptyGoldState(), enabled: true }; for (let n = 0; n <= 2; n++) s = tick(s, n, 4005); return goldSignal(s, signal(action)); }
test('gold accepts only fresh USD demo Vantage quotes and valid lot increments', () => {
  const q = quote(0, 4005);
  assert.equal(validGoldQuote(q, base), true);
  for (const changes of [{ demo: false }, { currency: 'EUR' }, { server: 'MetaQuotes-Demo' }, { tickAtMs: base - 6000 }, { volumeStep: .1 }, { ask: 3999 }]) assert.equal(validGoldQuote({ ...q, ...changes }, base), false);
});
test('gold 0.03 lots uses contract units, bid breakout and ask entry with signal SL', () => {
  const s = tick(setup(), 3, 4011), p = s.position;
  assert.equal(p.lots, .03); assert.equal(p.units, 3); assert.equal(p.entry, 4011.2); assert.equal(p.stop, 4000);
  assert.ok(Math.abs(p.target - 4044.8) < 1e-8); assert.equal(p.margin, 120);
  assert.equal(s.decisions.at(-1).status, 'ENTERED');
  const close = tick(s, 4, 4045);
  assert.equal(close.trades[0].reason, 'TARGET_3R'); assert.equal(close.trades[0].pnl, (4045 - p.entry) * 3);
});
test('gold shorts exit on ask and move stop to entry only after 2R', () => {
  let s = tick(setup('SELL'), 3, 3999, 3999.2);
  assert.equal(s.position.stop, 4010); assert.equal(s.position.target, 3966);
  s = tick(s, 4, 3976, 3976.2); assert.equal(s.position.stop, 3999);
  s = tick(s, 5, 3998.9, 3999.1);
  assert.equal(s.trades[0].reason, 'BREAK_EVEN_STOP'); assert.ok(Math.abs(s.trades[0].pnl + .3) < 1e-8);
});
test('gold skips already-missed breakouts and missing delivery-period coverage', () => {
  let s = { ...emptyGoldState(), enabled: true }; s = tick(s, 0, 4005); s = tick(s, 1, 4011); s = tick(s, 2, 4005);
  s = goldSignal(s, signal()); assert.equal(s.setup, null); assert.equal(s.decisions.at(-1).status, 'MISSED_BREAKOUT');
  s = goldSignal({ ...emptyGoldState(), enabled: true }, signal()); assert.equal(s.decisions.at(-1).status, 'UNVERIFIABLE_HISTORY');
});
test('gold monitoring gaps exclude affected P&L and stale quotes never fill', () => {
  let s = tick(setup(), 3, 4011); s = tick(s, 10, 3999);
  assert.equal(s.trades[0].unverified, true); assert.equal(goldView(s, base + 10000).realized, 0);
  const waiting = setup(); const stale = goldTick(waiting, quote(3, 4011), base + 20000); assert.equal(stale.position, null);
});
test('gold opposite signal exits held trade, but cannot reverse on the same tick', () => {
  let s = tick(setup(), 3, 4011);
  s = goldSignal(s, { ...signal('SELL', 'sell'), receivedAt: iso(4), closedAt: iso(3), high: 4020, low: 4005 });
  s = tick(s, 4, 4010); assert.equal(s.trades.length, 1); assert.equal(s.trades[0].reason, 'OPPOSITE_SIGNAL'); assert.equal(s.position, null);
});
test('read-only MT5 exporter contains no broker order submission', () => {
  const source = fs.readFileSync(require('node:path').resolve(__dirname, '../scripts/mt5/GoldPriceBridge.mq5'), 'utf8');
  assert.doesNotMatch(source, /OrderSend|CTrade|trade\.Buy|trade\.Sell/);
  assert.match(source, /ACCOUNT_TRADE_MODE_DEMO/);
});
