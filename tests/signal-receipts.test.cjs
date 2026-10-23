const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function fixture(secret = 'owner-secret') {
  const calls = [], file = path.resolve(__dirname, '../app/api/algo/signals/route.ts'), copy = new Module(file, module);
  copy.require = id => id === 'next/server' ? { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers }) } }
    : id.endsWith('/connection') ? { connectionSecret: async () => secret, saveConnection: async s => calls.push(['save', s]), sameOrigin: () => true }
    : id.endsWith('/signalStore') ? { listPersistedAlgoSignalEvents: async (s, limit, date) => { calls.push(['receipts', s, date]); return { ok: true, events: [{ signal: { id: 'saved' } }] }; } }
    : id.endsWith('/signalExecution') ? { addSignalExecutions: async (s, events) => { calls.push(['details', s]); return events.map(e => ({ ...e, execution: { status: 'ENTERED' } })); } } : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
  return { api: copy.exports, calls };
}
test('receipt-only endpoint returns saved events without execution-history reads', async () => {
  const f = fixture(), r = await f.api.GET(new Request('https://panel.test/api/algo/signals?date=2026-10-23&receipts=1'));
  assert.equal(r.status, 200); assert.equal(r.body.events[0].signal.id, 'saved');
  assert.deepEqual(f.calls, [['receipts', 'owner-secret', '2026-10-23']]);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
});
test('normal endpoint still enriches decisions; anonymous receipt requests are denied', async () => {
  const f = fixture(), r = await f.api.GET(new Request('https://panel.test/api/algo/signals?date=2026-10-23'));
  assert.equal(r.body.events[0].execution.status, 'ENTERED');
  assert.equal((await fixture(null).api.GET(new Request('https://panel.test/api/algo/signals?receipts=1'))).status, 401);
});
test('connect-and-load preserves selected date and skips slow details in receipt mode', async () => {
  const f = fixture(), r = await f.api.POST(new Request('https://panel.test/api/algo/signals?date=2026-10-23&receipts=1', { method: 'POST', body: JSON.stringify({ secret: 'private-secret' }) }));
  assert.equal(r.status, 200); assert.deepEqual(f.calls, [['save', 'private-secret'], ['receipts', 'private-secret', '2026-10-23']]);
});
test('panel prevents same-key overlap and renders receipts before detail lookup', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/dashboard/AlgoTradingPanel.tsx'), 'utf8');
  assert.match(source, /if \(signalRequest\.current\?\.key === key\) return/);
  assert.match(source, /setInterval\(refresh, 2000\)/);
  assert.ok(source.indexOf('setSignalEvents(previous => events.map') < source.indexOf('const detailsController'));
  assert.match(source, /details\.get\(`\$\{event\.signal\.id\}:\$\{event\.receivedAt\}`\) \?\? event\.execution/);
});
