const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), path = require('node:path');
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative), copy = new Module(filename, module);
  copy.require = id => id in mocks ? mocks[id] : id.startsWith('.') ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), id + '.ts')), mocks) : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename); return copy.exports;
}
const dates = load('app/lib/algo/reportDates.ts');
test('calendar filters use entry day in IST, including midnight and overnight trades', () => {
  const trades = [{ openedAt: '2026-10-21T18:29:59Z', closedAt: '2026-10-21T20:00:00Z' }, { openedAt: '2026-10-21T18:30:00Z' }];
  assert.equal(dates.istDay(trades[0].openedAt), '2026-10-21');
  assert.equal(dates.istDay(trades[1].openedAt), '2026-10-22');
  assert.equal(dates.istTime(trades[1].openedAt), '00:00:00');
  assert.deepEqual(dates.onTradeDate(trades, '2026-10-21'), [trades[0]]);
  assert.equal(dates.onTradeDate(trades, '').length, 2);
  assert.equal(dates.istTime(undefined), ''); assert.equal(dates.istDay('invalid'), '');
});
test('signal close, arrival and execution stay distinct; ambiguous/missing matches stay blank', () => {
  const event = { receivedAt: '2026-10-21T05:00:12Z', signal: { id: 's', symbol: 'NSE:NIFTY', timestamp: '2026-10-21T04:59:00Z', metadata: { niftyPaper: { closedAt: '2026-10-21T05:00:00Z' } } } };
  assert.equal(dates.signalTime(event), '2026-10-21T05:00:00Z');
  const times = dates.tradeSignalTimes([event], 's', 'NSE:NIFTY', '2026-10-21T05:01:00Z');
  assert.equal(times.signalReceivedAt, event.receivedAt); assert.notEqual(times.signalReceivedAt, times.signalClosedAt);
  assert.equal(dates.tradeSignalTimes([event, event], 's', 'NSE:NIFTY', '2026-10-21T05:01:00Z').signalClosedAt, undefined);
  assert.equal(dates.tradeSignalTimes([event], 's', 'OTHER', '2026-10-21T05:01:00Z').signalClosedAt, undefined);
  assert.equal(dates.tradeSignalTimes([event], 's', 'NSE:NIFTY', '2026-10-21T04:00:00Z').signalClosedAt, undefined);
});
test('trade exports distinguish open, unverified and legacy records without invented amounts', () => {
  const api = load('app/lib/algo/tradeReports.ts');
  const books = { BTC: { trades: [], position: null, delta: { position: { id: 'open', side: 'LONG', quantityBtc: 1, openedAt: '2026-10-21T05:00:30Z', entry: 100, stop: 90, target: 130, signalClosedAt: '2026-10-21T05:00:00Z', signalReceivedAt: '2026-10-21T05:00:12Z', initialMargin: 1 }, trades: [{ id: 'bad', side: 'SHORT', quantityBtc: 1, openedAt: '2026-10-21T04:00:00Z', closedAt: '2026-10-21T04:10:00Z', entry: 105, exit: 100, pnl: 5, monitoringGap: { from: 'x', to: 'y' } }] } }, GOLD: { trades: [{ id: 'legacy', signalId: 's', symbol: 'OANDA:XAUUSD', side: 'LONG', openedAt: '2026-10-21T05:00:00Z', closedAt: '2026-10-21T05:15:00Z', entry: 2000, exit: 2001, points: 1 }], position: null } };
  const records = api.buildTradeReports(books, []);
  const bad = records.find(t => t.signalId === 'bad'), open = records.find(t => t.signalId === 'open'), legacy = records.find(t => t.signalId === 's');
  assert.equal(bad.pnl, undefined); assert.equal(bad.recordedPnl, 5); assert.match(bad.quality, /unverified/);
  assert.equal(open.status, 'OPEN'); assert.equal(open.closedAt, undefined);
  assert.equal(legacy.currency, 'POINTS'); assert.equal(legacy.capital, undefined); assert.equal(legacy.signalAt, undefined);
  const row = api.tradeRows([open])[0];
  assert.equal(row[0], '2026-10-21'); assert.equal(row[6], '10:30:00'); assert.equal(row[8], '10:30:12'); assert.equal(row[9], '10:30:30'); assert.equal(row[12], '');
});
test('a persisted close wins over an older open heartbeat for the same trade', () => {
  const api = load('app/lib/algo/tradeReports.ts');
  const position = { id: 'same', side: 'LONG', openedAt: '2026-10-21T05:00:00Z', entry: 100, quantityBtc: 1 };
  const result = api.buildTradeReports({ BTC: { trades: [], position: null, delta: { position, trades: [{ ...position, closedAt: '2026-10-21T05:02:00Z', exit: 110, pnl: 10 }] } } }, []);
  assert.equal(result.length, 1); assert.equal(result[0].status, 'CLOSED'); assert.equal(result[0].exit, 110);
});
test('history date control renders a labelled native calendar and All dates option', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const filename = path.resolve(__dirname, '../app/dashboard/HistoryDatePicker.tsx'), copy = new Module(filename, module);
  copy.require = require;
  copy._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  const html = renderToStaticMarkup(React.createElement(copy.exports.default, { label: 'Trade entry date - IST', value: '2026-10-21', onChange() {}, allowAll: true }));
  assert.match(html, /type="date"/); assert.match(html, /aria-label="Trade entry date - IST"/); assert.match(html, /All dates/);
});
