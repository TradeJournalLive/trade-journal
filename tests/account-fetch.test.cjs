const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/accountFetch.ts'), m = new Module(file, module);
let token = 'current-account-token', sent;
m.require = id => id === './supabaseClient' ? { supabase: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } } } : require(id);
m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const fetchOriginal = global.fetch, windowOriginal = global.window;
test.before(() => { global.window = { location: { origin: 'https://panel.test' } }; global.fetch = async (input, init) => { sent = { input, init }; return { ok: true }; }; });
test.after(() => { global.fetch = fetchOriginal; global.window = windowOriginal; });
test('account requests use the current token rather than stale caller headers', async () => {
  token = 'account-b'; await m.exports.accountFetch('/api/algo/paper', { headers: { Authorization: 'Bearer old-account-a' } });
  assert.equal(sent.init.headers.get('Authorization'), 'Bearer account-b');
});
test('account tokens are never sent to another origin', async () => {
  sent = null; await assert.rejects(m.exports.accountFetch('https://evil.test/collect'), /origin/); assert.equal(sent, null);
});
test('signed-out requests cannot silently reuse a stale cookie identity', async () => {
  token = null; await m.exports.accountFetch('/api/algo/paper');
  assert.equal(sent.init.headers.get('Authorization'), 'Bearer signed-out');
});
