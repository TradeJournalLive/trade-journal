const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function route(relative) {
  const file = path.resolve(__dirname, '..', relative), copy = new Module(file, module);
  copy.require = id => id === 'crypto' ? require(id)
    : id === 'next/server' ? { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
    : id.endsWith('/connection') ? { sameOrigin: () => true, connectionSecret: async () => 'test-owner' }
    : id.endsWith('/paperEngine') ? { markets: ['BTC', 'NIFTY', 'GOLD'] }
    : id.endsWith('/trackingSignals') ? { isolateTrackingSignal: value => value }
    : id.endsWith('/hamsSignal') ? { isolateHamsSignal: value => value }
    : {};
  copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
  return copy.exports;
}
test('retired Gold controls cannot re-arm entries through the API', async () => {
  const api = route('app/api/algo/paper/route.ts');
  for (const body of [{ market: 'GOLD', enabled: true }, { market: 'BTC', enabled: false, goldBreakoutEnabled: true }]) {
    const result = await api.POST(new Request('https://panel.test/api/algo/paper', { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(result.status, 410);
  }
});
test('Gold webhook rejection occurs before persistence or execution', async () => {
  const oldSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET, oldHmac = process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;
  delete process.env.TRADINGVIEW_WEBHOOK_SECRET; delete process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;
  try {
    const api = route('app/api/v1/webhooks/tradingview/route.ts');
    const result = await api.POST(new Request('https://panel.test/api/v1/webhooks/tradingview', { method: 'POST', body: JSON.stringify({ secret: 'test-owner', strategyId: 'gold_vantage_tracking_v1', signalId: 'gold-test', symbol: 'VANTAGE:XAUUSD', action: 'BUY', timestamp: new Date().toISOString() }) }));
    assert.equal(result.status, 410);
  } finally {
    if (oldSecret === undefined) delete process.env.TRADINGVIEW_WEBHOOK_SECRET; else process.env.TRADINGVIEW_WEBHOOK_SECRET = oldSecret;
    if (oldHmac === undefined) delete process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET; else process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET = oldHmac;
  }
});
test('Gold UI and worker dependencies are removed; retired launcher cannot start', () => {
  const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
  assert.doesNotMatch(read('app/dashboard/SignalPaperTrading.tsx'), /GoldMt5Paper/);
  assert.doesNotMatch(read('app/dashboard/AlgoTradingPanel.tsx'), /\["GOLD", "Gold"\]/);
  assert.doesNotMatch(read('app/lib/algo/paperHistory.ts'), /goldView|goldWorker|goldLedger/);
  const worker = require('node:child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/gold-mt5-paper-worker.cjs')], { encoding: 'utf8' });
  assert.equal(worker.status, 0);
  assert.match(worker.stderr, /GOLD_MODULE_REMOVED/);
});
