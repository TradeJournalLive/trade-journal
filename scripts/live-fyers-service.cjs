'use strict';
const { createServer } = require('node:http');
const { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } = require('node:crypto');
const { mkdir, writeFile, rename, rm, readFile, lstat } = require('node:fs/promises');
const { join, isAbsolute } = require('node:path');
const { homedir } = require('node:os');
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

async function checkBroker(directory, key, appId, fetcher) {
  const data = await readFile(join(directory, 'fyers-live-token.enc'));
  if (data.length <= 28 || data.length > 16384) throw Error('INVALID_LIVE_TOKEN_FILE');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  const token = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  const checks = await Promise.all(['orders', 'positions'].map(async (name) => {
    try {
      const response = await fetcher('https://api-t1.fyers.in/api/v3/' + name, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: appId + ':' + token, Accept: 'application/json' }
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.s !== 'ok' || body.code !== 200)
        return [name, { error: 'FAILED (HTTP ' + response.status + (Number.isSafeInteger(body?.code) ? ', FYERS code ' + body.code : '') + ')' }];
      if (name === 'orders') {
        const rows = body.orderBook;
        if (!Array.isArray(rows) || rows.some(row => ![1, 2, 4, 5, 6, 7].includes(row?.status)))
          return [name, { error: 'UNVERIFIED (unexpected FYERS order status or payload)' }];
        return [name, { active: rows.filter(row => row.status === 4 || row.status === 6).length }];
      }
      const rows = body.netPositions;
      if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.netQty)))
        return [name, { error: 'UNVERIFIED (unexpected FYERS position payload)' }];
      return [name, { active: rows.filter(row => row.netQty !== 0).length }];
    } catch {
      return [name, { error: 'FAILED (broker request unavailable)' }];
    }
  }));
  return Object.fromEntries(checks);
}

async function acceptDiagnostic(req, dir, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return [503, 'Diagnostic webhook is disabled.'];
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return [415, 'JSON required.'];
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) return [413, 'Diagnostic payload too large.'];
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return [400, 'Invalid diagnostic payload.']; }
  const hash = value => createHash('sha256').update(value).digest();
  if (typeof body?.secret !== 'string' || !timingSafeEqual(hash(body.secret), hash(secret)))
    return [401, 'Diagnostic authentication failed.'];
  if (body.kind !== 'LIVE_DELIVERY_TEST' || typeof body.id !== 'string' || !/^diagnostic-[a-zA-Z0-9-]{1,64}$/.test(body.id) ||
      Object.keys(body).some(key => !['kind', 'id', 'secret'].includes(key)))
    return [400, 'Diagnostic payload only; trading signals are not accepted.'];
  const temp = join(dir, '.diagnostic-' + randomBytes(16).toString('hex'));
  try {
    await writeFile(temp, JSON.stringify({ id: body.id, receivedAt: new Date().toISOString() }),
      { mode: 0o600, flag: 'wx', flush: true });
    await rename(temp, join(dir, 'tradingview-diagnostic.json'));
  } finally { await rm(temp, { force: true }); }
  return [202, 'Diagnostic received. Order submission disabled.'];
}

async function createService(env, { fetcher = fetch } = {}) {
  const dir = env.LIVE_FYERS_DATA_DIR || join(homedir(), '.fyers-live-private');
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
  let brokerCheck;
  if (!env.LIVE_FYERS_DATA_DIR) await probeStorage(homedir());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const finish = (code, message) => { res.statusCode = code; res.end(message); };
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health' && req.method === 'GET') return finish(200, 'FYERS live connection service. Read-only connection check and diagnostic route ready. Order submission disabled.');
      if (url.pathname === '/live/tradingview/diagnostic' && req.method === 'POST') {
        try { return finish(...await acceptDiagnostic(req, dir, env.LIVE_TRADINGVIEW_TEST_SECRET)); }
        catch { return finish(503, 'Diagnostic could not be stored.'); }
      }
      if (!timingSafeEqual(digest(req.headers.authorization || ''), expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="FYERS Live"');
        return finish(401, 'Operator sign-in required.');
      }
      if (url.pathname === '/live/tradingview/receipt' && req.method === 'GET') {
        try { return finish(200, await readFile(join(dir, 'tradingview-diagnostic.json'), 'utf8')); }
        catch (error) {
          if (error.code === 'ENOENT') return finish(404, 'No diagnostic alert received yet.');
          throw error;
        }
      }
      if (url.pathname === '/live/fyers/check' && req.method === 'POST') {
        if (req.headers.origin !== origin) return finish(403, 'Origin rejected.');
        let result;
        try {
          brokerCheck ??= checkBroker(dir, key, env.LIVE_FYERS_APP_ID, fetcher).finally(() => { brokerCheck = undefined; });
          result = await brokerCheck;
        }
        catch { return finish(409, 'Saved session unavailable. Return to /live and reconnect FYERS.'); }
        const { orders, positions } = result;
        const verified = !orders.error && !positions.error;
        return finish(verified ? 200 : 502, [
          'Orders: ' + (orders.error || 'OK (' + orders.active + ' pending or in transit)'),
          'Positions: ' + (positions.error || 'OK (' + positions.active + ' open)'),
          'Account observation: ' + (!verified ? 'UNVERIFIED' : orders.active || positions.active ? 'ACTIVITY PRESENT' : 'FLAT; NO WORKING ORDERS'),
          'This check does not confirm stop protection or authorize entries.',
          'Order submission disabled.'
        ].join('\n'));
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
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; form-action 'self' https://api-t1.fyers.in");
        return finish(200, '<!doctype html><meta charset="utf-8"><title>FYERS Live Connection</title><h1>FYERS Live Connection</h1><form action="/live/fyers/connect" method="post"><button>Connect FYERS</button></form><form action="/live/fyers/check" method="post"><button>Check FYERS access</button></form>');
      }
      return finish(404, 'Not found.');
    } catch {
      return finish(400, 'Connection could not be completed. Start a new sign-in.');
    }
  });
}

async function probeStorage(home) {
  if (!isAbsolute(home) || home === '/' || home === '/tmp' || home.startsWith('/tmp/')) throw Error('INVALID_LIVE_HOME');
  const dir = join(home, '.fyers-live-private');
  await mkdir(dir, { mode: 0o700, recursive: true });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw Error('UNSAFE_LIVE_STORAGE');
  const marker = join(dir, 'storage-probe');
  try { await writeFile(marker, randomBytes(16).toString('hex'), { flag: 'wx', mode: 0o600, flush: true }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const value = await readFile(marker, 'utf8');
  if (!/^[a-f0-9]{32}$/.test(value)) throw Error('INVALID_STORAGE_MARKER');
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

if (require.main === module) {
  const randomBoot = randomBytes(8).toString('hex');
  const listen = server => server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
  if (!process.env.LIVE_FYERS_APP_ID) {
    probeStorage(homedir()).then(marker => listen(createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = req.method === 'GET' && req.url === '/health' ? 200 : 503;
      res.end(res.statusCode === 200 ? JSON.stringify({ orderSubmission: false, storageMarker: marker, boot: randomBoot, privateStorageDefault: true }) : 'Live FYERS is not configured.');
    }))).catch(() => { console.error('Live storage probe failed.'); process.exitCode = 1; });
  } else createService(process.env).then(listen).catch(() => {
    console.error('Live FYERS service could not start. Check private configuration.');
    process.exitCode = 1;
  });
}

module.exports = { createService };
