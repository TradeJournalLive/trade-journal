const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module'), path = require('node:path');
function fixture(failPage = false, pending = false) {
  const btc = { id: 'btc-one', signalReceivedAt: '2026-10-21T05:00:01Z', signalClosedAt: '2026-10-21T05:00:00Z', openedAt: '2026-10-21T05:00:02Z', pnl: 10 };
  const rows = Array.from({ length: 1005 }, (_, n) => ({ secret_hash: 'owner-a', strategy_id: '__nifty_paper_trade__', received_at: '2026-10-21T05:00:00Z', signal_id: String(n), raw_payload: { trade: { signalId: `s-${n}`, indexSymbol: 'NSE:NIFTY', openedAt: '2026-10-21T05:00:00Z', pnl: n } } }));
  rows.push({ secret_hash: 'owner-b', strategy_id: '__nifty_paper_trade__', raw_payload: { trade: { signalId: 'not-yours' } } });
  rows.push({ secret_hash: 'owner-a', strategy_id: '__btc_delta_trade__', raw_payload: { trade: btc } });
  rows.push({ secret_hash: 'owner-a', strategy_id: '__btc_delta_decision__', received_at: '2026-10-21T05:00:01Z', signal_id: 'decision', raw_payload: { decision: { id: 'btc-one', receivedAt: '2026-10-21T05:00:01Z', decidedAt: '2026-10-21T05:00:02Z', status: 'PARTIALLY_FILLED', filledBtc: .4, canceledBtc: .6 } } });
  rows.push({ secret_hash: 'owner-b', strategy_id: '__btc_delta_decision__', raw_payload: { decision: { id: 'private-other-owner' } } });
  rows.push({ secret_hash: 'owner-a', strategy_id: '__btc_delta_worker__', signal_id: 'state', received_at: new Date().toISOString(), raw_payload: { saved: { state: { trades: pending ? [btc, { ...btc, id: 'pending-outbox', pnl: 7 }] : [] } }, workerStatus: 'RECEIVING_DELTA_BTCUSD' } });
  rows.push({ secret_hash: 'owner-a', strategy_id: '__paper_control__', signal_id: 'delete', received_at: '2026-10-21T06:00:00Z', signal: { id: 'delete', metadata: {} }, raw_payload: { paperControl: { deleteTrade: `${btc.id}:${btc.openedAt}` } } });
  const ranges = [];
  rows.push({ secret_hash: 'owner-a', strategy_id: '__gold_mt5_worker__', signal_id: 'state', received_at: new Date().toISOString(), raw_payload: { state: { enabled: true, trades: [] } } });
  rows.push({ secret_hash: 'owner-a', strategy_id: '__gold_mt5_trade__', received_at: '2026-10-22T16:00:00Z', signal_id: 'gold', raw_payload: { trade: { id: 'gold-own', pnl: 30 } } });
  rows.push({ secret_hash: 'owner-b', strategy_id: '__gold_mt5_trade__', raw_payload: { trade: { id: 'gold-private', pnl: 100 } } });
  function from() {
    const filters = []; let single = false, range = null;
    const q = { select() { return q; }, eq(k,v) { filters.push(r => r[k] === v); return q; }, neq(k,v) { filters.push(r => r[k] !== v); return q; }, order() { return q; }, maybeSingle() { single = true; return q; }, range(a,b) { range = [a,b]; ranges.push(range); return q; }, then(resolve,reject) { return Promise.resolve().then(() => {
      if (failPage && range?.[0] === 1000) return { error: { message: 'offline' } };
      const found = rows.filter(r => filters.every(f => f(r)));
      return { data: single ? found[0] || null : range ? found.slice(range[0], range[1]+1) : found, error: null };
    }).then(resolve,reject); } }; return q;
  }
  const filename = path.resolve(__dirname, '../app/lib/algo/paperHistory.ts'), copy = new Module(filename, module);
  copy.require = id => id === './goldPaperEngine' ? { goldView: s => ({ ...s, realized: s.trades.reduce((sum,t) => sum + t.pnl, 0) }) } : id === './signalStore' ? { getServerSupabase: () => ({ from }), hashWebhookSecret: s => s } : id === './reportDates' ? { tradeSignalTimes: () => ({ signalReceivedAt: undefined, signalClosedAt: undefined }) } : id === './paperEngine' ? { markets: ['NIFTY','BTC','GOLD'], buildPaperBooks: () => Object.fromEntries(['NIFTY','BTC','GOLD'].map(m => [m,{ trades: [], position: null }])), paperValuation: () => ({ realized: 0 }) } : id === './niftyPaperEngine' ? { buildNiftyOptionsPaper: () => ({ checkpoint: {}, trades: [], position: null, realized: 0 }) } : id === './btcPaperEngine' ? { btcView: () => ({ realized: 10, tradeCount: 1 }) } : require(id);
  copy._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return { api: copy.exports, ranges };
}
test('shared paper history loads every ledger page, isolates owners and preserves deletion exclusion', async () => {
  const f = fixture(), books = await f.api.loadPaperBooks('owner-a');
  assert.equal(books.NIFTY.options.trades.length, 1005);
  assert.equal(books.NIFTY.options.trades.some(t => t.signalId === 'not-yours'), false);
  assert.ok(f.ranges.some(([a,b]) => a === 1000 && b === 1999));
  assert.equal(books.BTC.delta.trades.length, 0);
  assert.equal(books.BTC.delta.realized, 0);
  assert.equal(books.BTC.delta.tradeCount, 0);
  assert.equal(books.BTC.delta.decisions.length, 1);
  assert.equal(books.BTC.delta.decisions[0].status, 'PARTIALLY_FILLED');
  assert.equal(books.BTC.delta.decisions[0].filledBtc, .4);
  assert.equal(books.GOLD.mt5.realized, 30);
  assert.deepEqual(books.GOLD.mt5.trades.map(t => t.id), ['gold-own']);
});
test('ledger pagination failure never presents a truncated successful history', async () => {
  await assert.rejects(fixture(true).api.loadPaperBooks('owner-a'), /complete paper trade ledger/);
});
test('BTC snapshot outbox remains visible before ledger sync without duplicating persisted trades', async () => {
  const books = await fixture(false, true).api.loadPaperBooks('owner-a');
  assert.deepEqual(books.BTC.delta.trades.map(t => t.id), ['pending-outbox']);
  assert.equal(books.BTC.delta.trades[0].pnl, 7);
  assert.equal(books.BTC.delta.realized, 0); // Deleted ledger trade is subtracted exactly once.
});
