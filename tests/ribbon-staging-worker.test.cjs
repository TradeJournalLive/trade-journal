const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRibbonStage } = require('../scripts/ribbon-staging-worker.cjs');

test('Ribbon rules preserve a real simulated limit entry and stop during a reporting outage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ribbon-stage-'));
  const db = path.join(dir, 'ribbon.sqlite');
  const at = n => new Date(Date.parse('2026-11-11T04:00:00Z') + n * 1000).toISOString();
  let stage = createRibbonStage(db, at(-60));
  t.after(() => { stage.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const tick = (n, spot, bid = 99, ask = 100) => stage.tick({
    at: at(n), spot,
    chain: [{ id: 'CE', side: 'CE', strike: 22500, expiry: '2026-11-17', lotSize: 65, at: at(n), bid, ask, bidSize: 5000, askSize: 5000 }],
  });
  tick(0, 22500);
  const signal = { id: 'test-buy', strategyId: 'nifty_ribbon_test_3m_v1', symbol: 'NSE:NIFTY', interval: 3, action: 'BUY', high: 22510, low: 22490, closedAt: at(0), receivedAt: at(1) };
  assert.equal(stage.receive(signal), true);
  assert.equal(stage.process(at(1)).state.status, 'WAITING_FOR_INDEX_BREAK');
  const opened = tick(2, 22511).state.position;
  assert.equal(opened.entry, 100);
  assert.equal(opened.stop, 80);
  await assert.rejects(stage.flush(async () => { throw Error('Reporting unavailable'); }));
  stage.close();
  stage = createRibbonStage(db, at(3));
  assert.deepEqual(stage.read().state.position, opened);
  assert.equal(stage.receive(signal), false);
  assert.equal(stage.process(at(3)), null);
  const closed = tick(4, 22511, 79, 80).state;
  assert.equal(closed.position, null);
  assert.equal(closed.trades.length, 1);
  assert.equal(closed.trades[0].reason, 'PREMIUM_SL');
  const remote = new Map();
  const write = async records => { for (const record of records) remote.set(record.id, record); };
  await assert.rejects(stage.flush(async records => { await write(records); throw Error('Response lost'); }));
  await stage.flush(write);
  assert.equal([...remote.values()].filter(r => r.kind === 'ENTRY').length, 1);
  assert.equal([...remote.values()].filter(r => r.kind === 'EXIT').length, 1);
  assert.equal(await stage.flush(async () => assert.fail()), 0);
});
