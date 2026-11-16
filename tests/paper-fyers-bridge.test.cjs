const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { paperFyersConnection } = require('../scripts/paper-fyers-connection.cjs');

test('worker retrieves only its linked FYERS session and denies unauthorized requests', async () => {
  const filename = path.resolve(__dirname, '../app/api/brokers/fyers/paper-worker/route.ts');
  const mock = new Module(filename, module);
  let lookups = 0;
  mock.require = id => {
    if (id === 'next/server') return { NextResponse: Response };
    if (id.endsWith('/accountConnections')) return {
      async webhookAccountOwner(secret) { lookups++; return secret === 'fixture-webhook' ? 'owner' : null; },
      async readAccountConnection(owner, kind) { assert.equal(owner, 'owner'); assert.equal(kind, 'fyers'); return 'device'; }
    };
    if (id.endsWith('/fyersConnection')) return {
      async readFyers(device) { assert.equal(device, 'device'); return { appId: 'fixture-100', accessToken: 'fixture-token', secret: 'must-not-leave-panel' }; }
    };
    return require(id);
  };
  mock._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  const key = 'a'.repeat(64);
  const env = { PAPER_WORKER_PANEL_ORIGIN: 'https://panel.example.test', PAPER_WORKER_ACCESS_KEY: key };
  const request = async (url, init) => {
    assert.equal(url.href, 'https://panel.example.test/api/brokers/fyers/paper-worker');
    assert.equal(init.redirect, 'error');
    return mock.exports.POST(new Request(url, init));
  };
  const previous = process.env.PAPER_WORKER_ACCESS_KEY_HASH;
  try {
    delete process.env.PAPER_WORKER_ACCESS_KEY_HASH;
    await assert.rejects(paperFyersConnection(env, 'fixture-webhook', request), /PAPER_WORKER_CONNECTION_UNAVAILABLE/);
    process.env.PAPER_WORKER_ACCESS_KEY_HASH = createHash('sha256').update(key).digest('hex');
    await assert.rejects(paperFyersConnection({ ...env, PAPER_WORKER_ACCESS_KEY: 'b'.repeat(64) }, 'fixture-webhook', request), /PAPER_WORKER_ACCESS_DENIED/);
    assert.equal(lookups, 0);
    await assert.rejects(paperFyersConnection(env, 'other-webhook', request), /LINK_WEBHOOK_TO_ACCOUNT_FIRST/);
    let returned;
    assert.deepEqual(await paperFyersConnection(env, 'fixture-webhook', async (...args) => {
      const response = await request(...args);
      assert.match(response.headers.get('cache-control'), /no-store/);
      returned = await response.clone().json();
      return response;
    }), { appId: 'fixture-100', accessToken: 'fixture-token' });
    assert.deepEqual(Object.keys(returned).sort(), ['accessToken', 'appId']);
  } finally {
    if (previous === undefined) delete process.env.PAPER_WORKER_ACCESS_KEY_HASH;
    else process.env.PAPER_WORKER_ACCESS_KEY_HASH = previous;
  }
});

test('worker refuses unsafe or partially configured handoff targets', async () => {
  const rejected = () => assert.fail('credentials must not be sent');
  assert.equal(await paperFyersConnection({}, 'secret', rejected), null);
  for (const origin of ['http://panel.example.test', 'https://panel.example.test/path', 'https://user@panel.example.test']) {
    await assert.rejects(paperFyersConnection({ PAPER_WORKER_PANEL_ORIGIN: origin, PAPER_WORKER_ACCESS_KEY: 'a'.repeat(64) }, 'secret', rejected), /INVALID_PAPER_WORKER_BRIDGE_CONFIGURATION/);
  }
  await assert.rejects(paperFyersConnection({ PAPER_WORKER_PANEL_ORIGIN: 'https://panel.example.test' }, 'secret', rejected), /INVALID_PAPER_WORKER_BRIDGE_CONFIGURATION/);
});
