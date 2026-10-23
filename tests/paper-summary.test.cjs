const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const file = path.resolve(__dirname, '../app/dashboard/PaperLifetimeSummary.tsx'), copy = new Module(file, module);
copy.require = id => require(id);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
test('shared lifetime summary renders exact labels, zero and unavailable values honestly', () => {
  const html = renderToStaticMarkup(React.createElement(copy.exports.default, { realized: '0 INR gross', openPnl: '-- INR gross', closedTrades: 0 }));
  for (const text of ['Lifetime realized', 'Open P&amp;L', 'Lifetime closed trades', '0 INR gross', '-- INR gross', '>0</strong>']) assert.ok(html.includes(text), text);
  assert.ok(renderToStaticMarkup(React.createElement(copy.exports.default, { realized: '--', openPnl: '--' })).includes('>--</strong>'));
});
test('all active instruments use lifetime sources, not date-filtered trade arrays', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, `../app/dashboard/${name}.tsx`), 'utf8');
  assert.match(read('BtcDeltaPaper'), /closedTrades=\{book\?\.tradeCount\}/);
  assert.match(read('SignalPaperTrading'), /closedTrades=\{book\?\.options\?\.tradeCount\}/);
  for (const name of ['BtcDeltaPaper', 'SignalPaperTrading']) assert.ok(read(name).includes('<PaperLifetimeSummary'));
});
