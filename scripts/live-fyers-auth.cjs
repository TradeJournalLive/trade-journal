'use strict';
const { createHash, randomBytes } = require('node:crypto');

const base = 'https://api-t1.fyers.in/api/v3/';
const stateTtl = 5 * 60 * 1000;

// Standalone live-only OAuth core. The host must supply an authenticated
// operator session ID and store the returned token in its private vault.
function createLiveFyersAuth({ appId, secret, redirectUrl, fetcher = fetch, now = Date.now }) {
  const callback = new URL(redirectUrl);
  if (!appId?.endsWith('-200') || !secret || callback.protocol !== 'https:' ||
      callback.pathname !== '/live/fyers/callback' || callback.search || callback.hash ||
      callback.username || callback.password) throw Error('INVALID_LIVE_FYERS_CONFIG');
  const pending = new Map();
  const appIdHash = createHash('sha256').update(`${appId}:${secret}`).digest('hex');
  return {
    begin(sessionId) {
      if (!sessionId) throw Error('LIVE_OPERATOR_SESSION_REQUIRED');
      const at = now();
      for (const [key, request] of pending) if (request.expires <= at) pending.delete(key);
      if (pending.size >= 100 && !pending.has(sessionId)) throw Error('LIVE_AUTH_BUSY');
      const state = randomBytes(32).toString('hex');
      pending.set(sessionId, { state, expires: at + stateTtl });
      const url = new URL('generate-authcode', base);
      url.search = new URLSearchParams({ client_id: appId, redirect_uri: callback.href, response_type: 'code', state });
      return url.href;
    },
    async exchange(sessionId, state, code) {
      const request = pending.get(sessionId);
      if (!request || request.expires <= now() || request.state !== state ||
          typeof code !== 'string' || !code || code.length > 8192) throw Error('INVALID_LIVE_AUTH_CALLBACK');
      pending.delete(sessionId);
      try {
        const response = await fetcher(new URL('validate-authcode', base), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ grant_type: 'authorization_code', appIdHash, code })
        });
        if (!response.ok) throw Error();
        const result = await response.json();
        if (result.s !== 'ok' || typeof result.access_token !== 'string' || !result.access_token) throw Error();
        return { accessToken: result.access_token };
      } catch {
        throw Error('LIVE_FYERS_TOKEN_EXCHANGE_FAILED');
      }
    }
  };
}

module.exports = { createLiveFyersAuth };
