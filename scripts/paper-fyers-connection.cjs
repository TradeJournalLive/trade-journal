const errors = new Set([
  'PAPER_WORKER_ACCESS_DENIED', 'PAPER_WORKER_WEBHOOK_REQUIRED', 'LINK_WEBHOOK_TO_ACCOUNT_FIRST',
  'FYERS_LOGIN_REQUIRED', 'PAPER_WORKER_CONNECTION_UNAVAILABLE'
]);

async function paperFyersConnection(env, webhookSecret, request = fetch) {
  const { PAPER_WORKER_PANEL_ORIGIN: origin, PAPER_WORKER_ACCESS_KEY: key } = env;
  if (!origin && !key) return null;
  let url;
  try { url = new URL(origin); } catch { throw Error('INVALID_PAPER_WORKER_BRIDGE_CONFIGURATION'); }
  if (!/^[a-f0-9]{64}$/.test(key || '') || url.protocol !== 'https:' || url.origin !== origin) {
    throw Error('INVALID_PAPER_WORKER_BRIDGE_CONFIGURATION');
  }
  const response = await request(new URL('/api/brokers/fyers/paper-worker', url), {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${key}`, 'x-paper-webhook-secret': webhookSecret }
  }).catch(() => { throw Error('PAPER_WORKER_PANEL_UNREACHABLE'); });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw Error(errors.has(value?.code) ? value.code : 'PAPER_WORKER_CONNECTION_UNAVAILABLE');
  if (!/^[A-Za-z0-9]{5,76}-100$/.test(value?.appId || '') || typeof value?.accessToken !== 'string' || !value.accessToken) {
    throw Error('INVALID_PAPER_WORKER_CONNECTION');
  }
  return { appId: value.appId, accessToken: value.accessToken };
}

module.exports = { paperFyersConnection };
