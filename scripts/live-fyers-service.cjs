'use strict';
const { createServer } = require('node:http');
const { randomBytes, createCipheriv, createHash, timingSafeEqual } = require('node:crypto');
const { mkdir, writeFile, rename, rm } = require('node:fs/promises');
const { join, isAbsolute } = require('node:path');
const { createLiveFyersAuth } = require('./live-fyers-auth.cjs');

async function storeToken(directory, key, token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const temp = join(directory, '.token-' + randomBytes(16).toString('hex'));
  try {
    await writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600, flag: 'wx', flush: true });
    await rename(temp, join(directory, 'fyers-live-token.enc'));
  } finally {
    await rm(temp, { force: true });
  }
}

async function createService(env, { fetcher } = {}) {
  const dir = env.LIVE_FYERS_DATA_DIR;
  const password = env.LIVE_OPERATOR_PASSWORD;
  if (!dir || !isAbsolute(dir) || !password || password.length < 24 ||
      !/^[0-9a-f]{64}$/i.test(env.LIVE_TOKEN_KEY ?? '')) throw Error('INVALID_LIVE_SERVICE_CONFIG');
  const key = Buffer.from(env.LIVE_TOKEN_KEY, 'hex');
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest('Basic ' + Buffer.from('operator:' + password).toString('base64'));
  const auth = createLiveFyersAuth({
    appId: env.LIVE_FYERS_APP_ID, secret: env.LIVE_FYERS_SECRET,
    redirectUrl: env.LIVE_FYERS_REDIRECT_URL, fetcher
  });
  const origin = new URL(env.LIVE_FYERS_REDIRECT_URL).origin;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const finish = (code, message) => { res.statusCode = code; res.end(message); };
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health' && req.method === 'GET') return finish(200, 'FYERS live connection service. Order submission disabled.');
      if (!timingSafeEqual(digest(req.headers.authorization || ''), expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="FYERS Live"');
        return finish(401, 'Operator sign-in required.');
      }
      if (url.pathname === '/live/fyers/connect' && req.method === 'POST') {
        if (req.headers.origin !== origin) return finish(403, 'Origin rejected.');
        const session = randomBytes(32).toString('hex');
        res.setHeader('Set-Cookie', `__Host-live-fyers=${session}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`);
        res.setHeader('Location', auth.begin(session));
        return finish(303, 'Continue to FYERS.');
      }
      if (url.pathname === '/live/fyers/callback' && req.method === 'GET') {
        const session = /(?:^|;\s*)__Host-live-fyers=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        const { accessToken } = await auth.exchange(session, url.searchParams.get('state'), url.searchParams.get('auth_code'));
        await storeToken(dir, key, accessToken);
        res.setHeader('Set-Cookie', '__Host-live-fyers=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
        return finish(200, 'Live FYERS token saved. Order submission remains disabled.');
      }
      if (url.pathname === '/live' && req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; form-action 'self' https://api-t1.fyers.in");
        return finish(200, '<!doctype html><meta charset="utf-8"><title>FYERS Live Connection</title><h1>FYERS Live Connection</h1><form action="/live/fyers/connect" method="post"><button>Connect FYERS</button></form>');
      }
      return finish(404, 'Not found.');
    } catch {
      return finish(400, 'Connection could not be completed. Start a new sign-in.');
    }
  });
}

if (require.main === module) {
  const listen = server => server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  if (!process.env.LIVE_FYERS_APP_ID) {
    listen(createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = req.method === 'GET' && req.url === '/health' ? 200 : 503;
      res.end('Live FYERS is not configured. Order submission disabled.');
    }));
  } else createService(process.env).then(listen).catch(() => {
    console.error('Live FYERS service could not start. Check private configuration.');
    process.exitCode = 1;
  });
}

module.exports = { createService };
