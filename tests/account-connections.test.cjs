const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), crypto = require('node:crypto');
const filename = require('node:path').resolve(__dirname, '../app/lib/algo/accountConnections.ts');
const rows = new Map(), jar = new Map(), cookieOptions = new Map(); let unavailable = false, authorization = null;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function from() {
  let operation = 'select', payload, ignore = false, filters = [];
  const query = {
    select() { return query; }, eq(k, v) { filters.push([k, v]); return query; },
    upsert(v, options) { operation = 'upsert'; payload = v; ignore = options.ignoreDuplicates; return query; },
    delete() { operation = 'delete'; return query; }, single() { return query; }, maybeSingle() { return query; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (unavailable) return { data: null, error: { message: 'unavailable' } };
        if (operation === 'upsert') {
          const k = `${payload.secret_hash}:${payload.strategy_id}:${payload.signal_id}`;
          if (!ignore || !rows.has(k)) rows.set(k, structuredClone(payload));
          return { error: null };
        }
        const matches = [...rows.entries()].filter(([, r]) => filters.every(([k,v]) => r[k] === v));
        if (operation === 'delete') { for (const [k] of matches) rows.delete(k); return { error: null }; }
        return { data: matches[0]?.[1] || null, error: null };
      }).then(resolve, reject);
    }
  }; return query;
}
const db = { from, auth: { getUser: async token => token === 'valid-a' ? { data: { user: { id: 'user-a' } }, error: null } : token === 'valid-b' ? { data: { user: { id: 'user-b' } }, error: null } : { data: {}, error: {} } } };
const copy = new Module(filename, module);
copy.require = id => id === 'next/headers' ? { headers: () => ({ get: () => authorization }), cookies: () => ({ get: k => jar.has(k) ? { value: jar.get(k) } : undefined }) } : id === './signalStore' ? { getServerSupabase: () => db, hashWebhookSecret: hash } : require(id);
copy._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const api = copy.exports;
test.beforeEach(() => { rows.clear(); jar.clear(); unavailable = false; authorization = null; process.env.ALGO_CONNECTION_ENCRYPTION_KEY = 'test-only-account-key'; });
test('account identity requires a server-verified session, not a claimed user id', async () => {
  assert.equal(await api.accountId(), null);
  jar.set(api.ACCOUNT_COOKIE, 'fake-jwt'); assert.equal(await api.accountId(), null);
  jar.set(api.ACCOUNT_COOKIE, 'valid-a'); assert.equal(await api.accountId(), 'user-a');
  jar.set(api.ACCOUNT_COOKIE, 'valid-b'); assert.equal(await api.accountId(), 'user-b');
  jar.clear(); assert.equal(await api.accountId(), null);
});
test('same account resolves its connection across devices; other account sees nothing', async () => {
  await api.bindAccountConnection('user-a', 'webhook', 'test-secret');
  jar.clear(); assert.equal(await api.readAccountConnection('user-a', 'webhook'), 'test-secret');
  assert.equal(await api.readAccountConnection('user-b', 'webhook'), null);
  assert.equal(JSON.stringify([...rows.values()]).includes('test-secret'), false);
  assert.ok([...rows.values()].every(r => r.secret_hash !== hash('account:user-a')));
});
test('request identity overrides an older cookie and invalid headers never fall back', async () => {
  jar.set(api.ACCOUNT_COOKIE, 'valid-a'); authorization = 'Bearer valid-b';
  assert.equal(await api.accountId(), 'user-b');
  authorization = 'Bearer forged'; assert.equal(await api.accountId(), null);
  authorization = 'invalid'; assert.equal(await api.accountId(), null);
});
test('second account cannot claim existing webhook or broker mapping', async () => {
  for (const kind of ['webhook', 'fyers']) {
    await api.bindAccountConnection('user-a', kind, `connection-${kind}`);
    await assert.rejects(api.bindAccountConnection('user-b', kind, `connection-${kind}`), /another account/);
    assert.equal(await api.readAccountConnection('user-b', kind), null);
  }
});
test('concurrent cross-account claims have a single owner', async () => {
  const outcomes = await Promise.allSettled([api.bindAccountConnection('user-a', 'fyers', 'same-device'), api.bindAccountConnection('user-b', 'fyers', 'same-device')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
});
test('two devices cannot silently replace one account mapping concurrently', async () => {
  const outcomes = await Promise.allSettled([api.bindAccountConnection('user-a', 'fyers', 'device-one'), api.bindAccountConnection('user-a', 'fyers', 'device-two')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.ok(['device-one', 'device-two'].includes(await api.readAccountConnection('user-a', 'fyers')));
});
test('disconnect does not release ownership to another account', async () => {
  await api.bindAccountConnection('user-a', 'fyers', 'original-device');
  await api.unlinkAccountConnection('user-a', 'fyers');
  assert.equal(await api.readAccountConnection('user-a', 'fyers'), null);
  await assert.rejects(api.bindAccountConnection('user-b', 'fyers', 'original-device'), /another account/);
  await api.bindAccountConnection('user-a', 'fyers', 'original-device');
});
test('storage errors and modified ciphertext fail closed', async () => {
  await api.bindAccountConnection('user-a', 'webhook', 'private-test');
  const row = [...rows.values()].find(r => r.raw_payload.sealed);
  const b = Buffer.from(row.raw_payload.sealed, 'base64url'); b[30] ^= 1; row.raw_payload.sealed = b.toString('base64url');
  await assert.rejects(api.readAccountConnection('user-a', 'webhook'));
  unavailable = true; await assert.rejects(api.readAccountConnection('user-a', 'fyers'), /Unable to read/);
});
function route(relative) {
  const file = require('node:path').resolve(__dirname, '../app/api/' + relative + '/route.ts'), m = new Module(file, module);
  m.require = id => {
    if (id === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers }) } };
    if (id === 'next/headers') return { cookies: () => ({ set: (k,v,o) => { jar.set(k,v); cookieOptions.set(k,o); }, delete: k => jar.delete(k) }) };
    if (id.endsWith('/accountConnections')) return api;
    if (id.endsWith('/signalStore')) return { getServerSupabase: () => db };
    if (id.endsWith('/connection')) return { sameOrigin: request => request.headers.get('origin') === new URL(request.url).origin, legacyConnectionSecret: () => jar.get('legacy') || '' };
    return require(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
  return m.exports;
}
const sessionRoute = route('account/session'), linkRoute = route('algo/link-account');
const request = (path, body, origin = 'https://panel.test') => new Request('https://panel.test' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('session bridge rejects forged tokens and cross-origin requests, and clears logout', async () => {
  assert.equal((await sessionRoute.POST(request('/api/account/session', { accessToken: 'valid-a' }, 'https://evil.test'))).status, 403);
  assert.equal((await sessionRoute.POST(request('/api/account/session', { accessToken: 'forged', userId: 'user-a' }))).status, 401);
  assert.equal((await sessionRoute.POST(request('/api/account/session', { accessToken: 'valid-a' }))).status, 200);
  assert.equal(await api.accountId(), 'user-a');
  assert.equal(cookieOptions.get(api.ACCOUNT_COOKIE).httpOnly, true);
  await sessionRoute.POST(request('/api/account/session', { accessToken: null }));
  assert.equal(await api.accountId(), null);
});
test('linking requires original-device proof, explicit same-origin action and verified identity', async () => {
  assert.equal((await linkRoute.POST(request('/api/algo/link-account', {}))).status, 401);
  jar.set(api.ACCOUNT_COOKIE, 'valid-a');
  assert.equal((await linkRoute.POST(request('/api/algo/link-account', {}))).status, 409);
  jar.set('legacy', 'old-private-secret');
  assert.equal((await linkRoute.POST(request('/api/algo/link-account', {}, 'https://evil.test'))).status, 403);
  const linked = await linkRoute.POST(request('/api/algo/link-account', {}));
  assert.equal(linked.status, 200); assert.equal(JSON.stringify(linked).includes('old-private-secret'), false);
  jar.delete('legacy'); assert.equal((await linkRoute.GET()).body.linked, true);
  jar.set(api.ACCOUNT_COOKIE, 'valid-b'); assert.equal((await linkRoute.GET()).body.linked, false);
  jar.set('legacy', 'old-private-secret'); assert.equal((await linkRoute.POST(request('/api/algo/link-account', {}))).status, 409);
});
