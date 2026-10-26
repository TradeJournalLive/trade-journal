const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function render(state) {
  const file = path.resolve(__dirname, '../app/dashboard/BrokerReadinessAlert.tsx');
  const loaded = new Module(file, module); let call = 0;
  loaded.require = id => id === 'react' ? { ...React, useEffect() {}, useState: initial => [call++ === 0 ? state : initial, () => {}] }
    : id === '../lib/accountFetch' ? { accountFetch() { throw Error('Render must not access broker'); } } : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return renderToStaticMarkup(React.createElement(loaded.exports.default, { onConnect() {} }));
}
test('FYERS green is visible only for verified readiness and does not imply worker health', () => {
  assert.match(render('ready'), /FYERS connected · GREEN/);
  assert.match(render('ready'), /worker status is separate/);
  assert.doesNotMatch(render('checking'), /GREEN/);
  assert.match(render('checking'), /Connection not yet verified/);
});
test('disconnected and unavailable checks show distinct red states with reconnect', () => {
  assert.match(render('signin'), /FYERS disconnected · RED/);
  assert.match(render('unavailable'), /FYERS connection unverified · RED/);
  assert.match(render('signin'), /CONNECT FYERS/);
});
