const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RibbonLocalPilot } = require('../scripts/ribbon-local-pilot.cjs');

test('Ribbon keeps an open position through restart and commits a fill during a reporting outage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ribbon-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ribbon.sqlite'), initial = { position: null };
  let worker = new RibbonLocalPilot(file, initial);
  const signal = { id: 'buy-1', strategyId: 'nifty_ribbon_test_3m_v1', action: 'BUY' };
  assert.equal(worker.receive(signal), true);
  worker.close();
  worker = new RibbonLocalPilot(file, initial);
  assert.equal(worker.receive(signal), false);
  assert.throws(() => worker.receive({ ...signal, action: 'SELL' }), /Conflicting/);
  assert.throws(() => worker.advance(0, () => { throw Error('interrupted'); }, { signal: true }), /interrupted/);
  const entered = worker.advance(0, (_, event) => ({
    state: { position: { id: event.id, entry: 100 } }, records: [{ id: 'entry:buy-1' }],
  }), { signal: true });
  assert.equal(entered.state.position.entry, 100);
  await assert.rejects(worker.flush(async () => { throw Error('Supabase unavailable'); }));
  worker.close();
  worker = new RibbonLocalPilot(file, initial);
  assert.deepEqual(worker.read(), entered);
  assert.throws(() => worker.advance(0, () => assert.fail()), /Stale Ribbon writer/);
  assert.equal(worker.advance(1, () => assert.fail(), { signal: true }), null);
  worker.advance(1, state => ({ state: { position: null }, records: [{ id: 'fill:' + state.position.id, exit: 80 }] }));
  const remote = new Map();
  await assert.rejects(worker.flush(async records => {
    for (const record of records) remote.set(record.id, record);
    throw Error('Response lost after commit');
  }));
  worker.close();
  worker = new RibbonLocalPilot(file, initial);
  assert.equal(await worker.flush(async records => {
    for (const record of records) assert.deepEqual(remote.get(record.id), record);
  }), 2);
  assert.equal(remote.size, 2);
  assert.equal(await worker.flush(async () => assert.fail()), 0);
  worker.close();
});
