// Staging only: synthetic or read-only market data; no order API.
const { mkdirSync, readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const Module = require('node:module');
const { createServer } = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const ts = require('typescript');
const { RibbonLocalPilot } = require('./ribbon-local-pilot.cjs');

const file = resolve(__dirname, '../app/lib/algo/niftyLimitPaper.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { newLimitState, receiveLimitSignal, markLimitPaper } = compiled.exports;

function createRibbonStage(file, startAt) {
  const store = new RibbonLocalPilot(file, newLimitState(startAt, 3, false, true));
  function records(before, after) {
    const records = after.decisions.filter(d => !before.decisions.some(p => JSON.stringify(p) === JSON.stringify(d)))
      .map(d => ({ id: `decision:${d.id}:${d.status}:${d.decidedAt}`, kind: 'DECISION', value: d }));
    if (after.position && after.position.signalId !== before.position?.signalId) {
      records.push({ id: `entry:${after.position.signalId}`, kind: 'ENTRY', value: after.position });
    }
    for (const trade of after.trades.slice(before.trades.length)) {
      records.push({ id: `exit:${trade.signalId}:${trade.openedAt}`, kind: 'EXIT', value: trade });
    }
    return { state: after, records };
  }
  return {
    receive(signal) {
      if (!['BUY', 'SELL'].includes(signal.action) || signal.symbol !== 'NSE:NIFTY' || signal.interval !== 3 ||
        !Number.isFinite(Date.parse(signal.closedAt)) || !Number.isFinite(Date.parse(signal.receivedAt)) ||
        Date.parse(signal.closedAt) > Date.parse(signal.receivedAt) ||
        !Number.isFinite(signal.high) || !Number.isFinite(signal.low) || signal.low <= 0 || signal.high < signal.low) {
        throw Error('Invalid staging signal');
      }
      const { id, strategyId, symbol, interval, action, high, low, closedAt, receivedAt } = signal;
      return store.receive({ id, strategyId, symbol, interval, action, high, low, closedAt, receivedAt });
    },
    process(at) {
      return store.advance(store.read().revision, (state, signal) =>
        records(state, receiveLimitSignal(state, signal, at, 20000, true)), { signal: true });
    },
    tick(tick) {
      return store.advance(store.read().revision, state =>
        records(state, markLimitPaper(state, tick, 20000, true)));
    },
    read: () => store.read(),
    flush: transport => store.flush(transport),
    close: () => store.close(),
  };
}

if (require.main === module) {
  const { RIBBON_STAGE_DB, RIBBON_STAGE_TOKEN, PORT = '3000' } = process.env;
  if (!RIBBON_STAGE_DB || !RIBBON_STAGE_TOKEN || RIBBON_STAGE_TOKEN.length < 32) throw Error('Missing staging configuration');
  process.umask(0o077);
  mkdirSync(dirname(RIBBON_STAGE_DB), { recursive: true, mode: 0o700 });
  const stage = createRibbonStage(RIBBON_STAGE_DB, new Date().toISOString());
  const liveFeed = Boolean(process.env.RIBBON_STAGE_FYERS_APP_ID || process.env.RIBBON_STAGE_FYERS_TOKEN);
  let stopFeed;
  if (liveFeed) {
    const { RIBBON_STAGE_FYERS_APP_ID: appId, RIBBON_STAGE_FYERS_TOKEN: accessToken } = process.env;
    if (!appId || !accessToken) throw Error('Missing staging FYERS configuration');
    if (stage.read().state.position) throw Error('Staging feed-gap review required before resuming open position');
    const { startFyersStageFeed } = require('./ribbon-staging-feed.cjs');
    stopFeed = startFyersStageFeed({ appId, accessToken, directory: dirname(RIBBON_STAGE_DB), onTick(tick) {
      stage.tick(tick);
      for (let i = 0; i < 10 && stage.process(tick.at); i++);
    } }).catch(() => { console.error('Ribbon staging FYERS feed could not start'); return null; });
  }
  let reportingTimer, reporting;
  if (process.env.RIBBON_STAGE_SUPABASE_URL) {
    const { createStageTransport } = require('./ribbon-staging-reporting.cjs');
    const transport = createStageTransport({
      url: process.env.RIBBON_STAGE_SUPABASE_URL,
      key: process.env.RIBBON_STAGE_SUPABASE_KEY,
      instance: process.env.RIBBON_STAGE_INSTANCE,
    });
    reportingTimer = setInterval(() => {
      if (reporting) return;
      reporting = stage.flush(transport).catch(() => console.warn('Ribbon staging reporting will retry'))
        .finally(() => { reporting = null; });
    }, 5000);
    reportingTimer.unref();
  }
  const token = Buffer.from(`Bearer ${RIBBON_STAGE_TOKEN}`);
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) return send(401, { error: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/state') return send(200, stage.read());
    if (req.method !== 'POST' || !['/signal', '/tick', '/process'].includes(req.url)) return send(404, {});
    if (liveFeed && req.url !== '/signal') return send(409, { error: 'Synthetic input disabled in feed mode' });
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return send(413, { error: 'Payload too large' });
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === '/signal') return send(202, { stored: stage.receive(input) });
      if (req.url === '/tick') return send(200, stage.tick(input));
      return send(200, stage.process(input.at));
    } catch { return send(400, { error: 'Staging request rejected' }); }
  });
  server.listen(Number(PORT));
  process.once('SIGTERM', () => {
    clearInterval(reportingTimer);
    server.close(async () => { (await stopFeed)?.(); await reporting; stage.close(); });
  });
}

module.exports = { createRibbonStage };
