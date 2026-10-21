const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), path = require('node:path');
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative), copy = new Module(filename, module);
  copy.require = id => id in mocks ? mocks[id] : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return copy.exports;
}
function database() {
  const rows = new Map();
  const from = () => {
    let op = 'read', value, filters = [];
    const q = { select() { return q; }, maybeSingle() { return q; }, eq(k,v) { filters.push([k,v]); return q; }, insert(v) { op = 'insert'; value = v; return q; }, upsert(v) { op = 'upsert'; value = v; return q; }, update(v) { op = 'update'; value = v; return q; },
      then(resolve,reject) { return Promise.resolve().then(() => {
        const key = r => `${r.secret_hash}:${r.strategy_id}:${r.signal_id}`;
        if (op === 'insert' || op === 'upsert') { const k = key(value); if (op === 'insert' && rows.has(k)) return { error: { code: '23505' } }; rows.set(k, structuredClone(value)); return { error: null }; }
        const found = [...rows.values()].filter(r => filters.every(([k,v]) => (k === 'raw_payload->>lease' ? r.raw_payload.lease : r[k]) === v));
        if (op === 'update') { for (const r of found) Object.assign(r, structuredClone(value)); return { data: found, error: null }; }
        return { data: found[0] || null, error: null };
      }).then(resolve,reject); }
    }; return q;
  };
  return { from, rows };
}
test('Sheets credentials are encrypted, owner-isolated, and tampering fails closed', async () => {
  process.env.ALGO_CONNECTION_ENCRYPTION_KEY = 'sheets-test-only';
  const db = database(), api = load('app/lib/algo/googleSheetsStore.ts', { './signalStore': { getServerSupabase: () => db } });
  await api.writeSheets('a', { refreshToken: 'private-refresh', enabled: false });
  assert.equal((await api.readSheets('a')).refreshToken, 'private-refresh');
  assert.equal(await api.readSheets('b'), null);
  assert.equal(JSON.stringify([...db.rows.values()]).includes('private-refresh'), false);
  const row = [...db.rows.values()][0]; row.raw_payload.sealed = row.raw_payload.sealed.slice(0, 12) + 'xxxx' + row.raw_payload.sealed.slice(16);
  await assert.rejects(api.readSheets('a'));
});
test('database lease excludes concurrent writers, releases on failure, and OAuth states are single-use', async () => {
  process.env.ALGO_CONNECTION_ENCRYPTION_KEY = 'sheets-test-only';
  const db = database(), api = load('app/lib/algo/googleSheetsStore.ts', { './signalStore': { getServerSupabase: () => db } });
  let release, entered;
  const active = new Promise(r => entered = r);
  const first = api.withSheetsLock('a', async () => { entered(); await new Promise(r => release = r); });
  await active;
  await assert.rejects(api.withSheetsLock('a', async () => {}), /busy/);
  await api.withSheetsLock('b', async () => {});
  release(); await first;
  await assert.rejects(api.withSheetsLock('a', async () => { throw new Error('test'); }), /test/);
  await api.withSheetsLock('a', async () => {});
  await api.consumeSheetsState('a', 'one');
  await assert.rejects(api.consumeSheetsState('a', 'one'), /already used/);
});
function reporting() {
  const connections = new Map(), googleCalls = [], rows = [{ receivedAt: '2026-10-21T05:00:00Z', signal: { id: '=IMPORTDATA("bad")', strategyId: 's', timestamp: '2026-10-21T04:59:00Z', symbol: 'NSE:NIFTY', action: 'BUY', price: 100, timeframe: '1', status: 'VALIDATED' }, decision: { accepted: true, stage: 'SIGNAL_RECEIVED', reasons: [] } }];
  let fails = false;
  class OAuth2Client { setCredentials() {} async getAccessToken() { return { token: 'test-access' }; } }
  const api = load('app/lib/algo/googleSheets.ts', {
    'google-auth-library': { OAuth2Client },
    './accountConnections': { readAccountConnection: async user => user === 'a' ? 'secret-a' : null, webhookAccountOwner: async secret => secret === 'secret-a' ? 'a' : null },
    './signalStore': { listPersistedAlgoSignalEvents: async secret => { assert.equal(secret, 'secret-a'); return { ok: true, events: rows }; } },
    './googleSheetsStore': { readSheets: async u => structuredClone(connections.get(u) || null), writeSheets: async (u,v) => connections.set(u, structuredClone(v)), withSheetsLock: async (u, f) => f() }
  });
  const oldFetch = global.fetch;
  global.fetch = async (url, options) => { googleCalls.push({ url, options, body: JSON.parse(options.body) }); if (fails) return { ok: false }; return { ok: true, json: async () => url === 'https://sheets.googleapis.com/v4/spreadsheets' ? { spreadsheetId: 'private-sheet' } : {} }; };
  process.env.GOOGLE_SHEETS_CLIENT_ID = 'test-id'; process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'test-secret';
  return { api, connections, googleCalls, fail: () => fails = true, restore: () => global.fetch = oldFetch };
}
test('create is private, explicit and idempotent; sync writes RAW instrument ranges without credentials', async () => {
  const r = reporting();
  try {
    r.connections.set('a', { refreshToken: 'private-refresh', enabled: false });
    await r.api.createSignalSheet('a'); await r.api.createSignalSheet('a');
    assert.equal(r.googleCalls.filter(c => c.url === 'https://sheets.googleapis.com/v4/spreadsheets').length, 1);
    assert.equal(r.googleCalls.some(c => c.url.includes('permissions')), false);
    const values = r.googleCalls.find(c => c.url.endsWith('values:batchUpdate'));
    assert.equal(values.body.valueInputOption, 'RAW');
    assert.ok(values.body.data.some(d => d.range === "'NIFTY'!A1"));
    assert.ok(values.body.data[0].values.some(row => row.includes('=IMPORTDATA("bad")')));
    assert.equal(JSON.stringify(values.body).includes('private-refresh'), false);
    assert.equal(r.connections.get('a').signalCount, 1);
    await assert.rejects(r.api.createSignalSheet('b'), /Connect Google/);
  } finally { r.restore(); }
});
test('paused or unknown owner never reports; failed background reporting does not reject webhook delivery', async () => {
  const r = reporting();
  try {
    r.connections.set('a', { refreshToken: 'refresh', sheetId: 's', enabled: false });
    await r.api.syncWebhookSheet('secret-a'); await r.api.syncWebhookSheet('other-secret');
    assert.equal(r.googleCalls.length, 0);
    r.connections.set('a', { refreshToken: 'refresh', sheetId: 's', enabled: true }); r.fail();
    await r.api.syncWebhookSheet('secret-a');
    assert.match(r.connections.get('a').error, /request failed/);
    assert.equal(r.connections.get('a').lastSyncedAt, undefined);
  } finally { r.restore(); }
});
test('uncertain Google create result is not automatically retried into duplicate sheets', async () => {
  const r = reporting();
  try {
    r.connections.set('a', { refreshToken: 'refresh', enabled: false }); r.fail();
    await assert.rejects(r.api.createSignalSheet('a'), /request failed/);
    assert.equal(r.connections.get('a').creationPending, true);
    await assert.rejects(r.api.createSignalSheet('a'), /earlier sheet creation/);
    assert.equal(r.googleCalls.length, 1);
  } finally { r.restore(); }
});

function routes() {
  let user = 'a'; const jar = new Map(), cookieOptions = new Map(), records = new Map(), used = new Set();
  const sheets = { sheetsConfigured: () => true, SHEETS_SCOPE: 'https://www.googleapis.com/auth/drive.file', sheetsCallback: () => 'https://panel.test/api/integrations/google-sheets/callback', createSignalSheet: async () => {}, syncSignalSheet: async () => {}, sheetsOAuth: () => ({ generateCodeVerifierAsync: async () => ({ codeVerifier: 'private-verifier', codeChallenge: 'challenge' }), generateAuthUrl: opts => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(opts), getToken: async opts => { assert.equal(opts.codeVerifier, 'private-verifier'); return { tokens: { refresh_token: 'private-refresh', scope: sheets.SHEETS_SCOPE } }; } }) };
  const storage = { readSheets: async u => records.get(u) || null, writeSheets: async (u,v) => records.set(u, v), sealSheets: obj => JSON.stringify(obj), openSheets: JSON.parse, withSheetsLock: async (u,f) => f(), consumeSheetsState: async (u,state) => { const key = u + state; if (used.has(key)) throw new Error('replay'); used.add(key); } };
  const mocks = { 'next/server': { NextResponse: { json: (body, opts) => Response.json(body, opts), redirect: url => new Response(null, { status: 307, headers: { Location: String(url) } }) } }, 'next/headers': { cookies: () => ({ get: k => jar.has(k) ? { value: jar.get(k) } : undefined, set: (k,v,opts) => { jar.set(k,v); cookieOptions.set(k,opts); } }) }, 'google-auth-library': { CodeChallengeMethod: { S256: 'S256' } } };
  const main = load('app/api/integrations/google-sheets/route.ts', { ...mocks, '../../../lib/algo/accountConnections': { accountId: async () => user }, '../../../lib/algo/connection': { sameOrigin: req => req.headers.get('origin') === 'https://panel.test' }, '../../../lib/algo/googleSheets': sheets, '../../../lib/algo/googleSheetsStore': storage });
  const callback = load('app/api/integrations/google-sheets/callback/route.ts', { ...mocks, '../../../../lib/algo/accountConnections': { accountId: async () => user }, '../../../../lib/algo/googleSheets': sheets, '../../../../lib/algo/googleSheetsStore': storage });
  const post = action => main.POST(new Request('https://panel.test/api/integrations/google-sheets', { method: 'POST', headers: { origin: 'https://panel.test' }, body: JSON.stringify({ action }) }));
  return { main, callback, post, jar, records, cookieOptions, setUser: value => user = value };
}
test('Sheets routes reject anonymous/cross-origin calls and never expose saved credentials', async () => {
  const r = routes(); r.setUser(null); assert.equal((await r.main.GET()).status, 401);
  assert.equal((await r.post('connect')).status, 401);
  r.setUser('a');
  assert.equal((await r.main.POST(new Request('https://panel.test/api/integrations/google-sheets', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status, 403);
  r.records.set('a', { refreshToken: 'do-not-expose', enabled: true, sheetId: 'a-sheet' });
  const response = await r.main.GET(); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.text()).includes('do-not-expose'), false);
  r.setUser('b'); assert.equal((await (await r.main.GET()).json()).connected, false);
});
test('OAuth requires exact account, state, unexpired cookie and PKCE; callbacks cannot replay', async () => {
  const r = routes();
  const start = await (await r.post('connect')).json(), url = new URL(start.url);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(r.cookieOptions.get('google_sheets_oauth').httpOnly, true);
  const cookie = r.jar.get('google_sheets_oauth');
  const callbackUrl = 'https://panel.test/api/integrations/google-sheets/callback?code=code&state=' + url.searchParams.get('state');
  r.setUser('b'); assert.match((await r.callback.GET(new Request(callbackUrl))).headers.get('location'), /invalid_state/);
  assert.equal(r.records.size, 0);
  r.setUser('a'); const expired = JSON.parse(cookie); expired.expires = 1; r.jar.set('google_sheets_oauth', JSON.stringify(expired));
  assert.match((await r.callback.GET(new Request(callbackUrl))).headers.get('location'), /invalid_state/);
  r.jar.set('google_sheets_oauth', cookie);
  assert.match((await r.callback.GET(new Request(callbackUrl))).headers.get('location'), /sheets=connected/);
  assert.equal(r.records.get('a').refreshToken, 'private-refresh'); assert.equal(r.records.get('a').sheetId, undefined);
  r.jar.set('google_sheets_oauth', cookie);
  assert.match((await r.callback.GET(new Request(callbackUrl))).headers.get('location'), /connection_failed/);
});
