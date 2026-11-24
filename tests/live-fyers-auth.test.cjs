'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLiveFyersAuth } = require('../scripts/live-fyers-auth.cjs');
const config = { appId: 'fake-200', secret: 'test-secret', redirectUrl: 'https://live.example.test/live/fyers/callback' };

test('callback is session-bound and consumed before exchange', async () => {
  let calls = 0;
  const auth = createLiveFyersAuth({ ...config, fetcher: async (url, options) => {
    calls++;
    assert.equal(url.pathname, '/api/v3/validate-authcode');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).code, 'fake-code');
    return { ok: true, json: async () => ({ s: 'ok', access_token: 'fake-token' }) };
  } });
  const url = new URL(auth.begin('operator'));
  const state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUrl);
  await assert.rejects(auth.exchange('other', state, 'fake-code'), /INVALID_LIVE_AUTH/);
  assert.deepEqual(await auth.exchange('operator', state, 'fake-code'), { accessToken: 'fake-token' });
  await assert.rejects(auth.exchange('operator', state, 'fake-code'), /INVALID_LIVE_AUTH/);
  assert.equal(calls, 1);
});

test('rejects paper callback and expired live state without contacting broker', async () => {
  assert.throws(() => createLiveFyersAuth({ ...config, redirectUrl: 'https://paper.example.test/api/brokers/fyers/callback' }), /INVALID_LIVE_FYERS_CONFIG/);
  let at = 0;
  const auth = createLiveFyersAuth({ ...config, now: () => at, fetcher: () => assert.fail('unexpected network call') });
  const state = new URL(auth.begin('operator')).searchParams.get('state');
  at = 300001;
  await assert.rejects(auth.exchange('operator', state, 'fake-code'), /INVALID_LIVE_AUTH/);
});
