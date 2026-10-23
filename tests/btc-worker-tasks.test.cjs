const test = require('node:test'), assert = require('node:assert/strict');
const { startTask, createTickAudit } = require('../scripts/btc-worker-tasks.cjs');
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function clock() { const queue = []; return { setTimeout: fn => { queue.push(fn); return fn; }, clearTimeout: fn => { const i = queue.indexOf(fn); if (i >= 0) queue.splice(i, 1); }, fire: () => queue.shift()?.(), queue }; }
test('a blocked ledger does not block heartbeats or signal polling, and no task overlaps itself', async () => {
  const h = clock(), l = clock(), p = clock(); let beats = 0, polls = 0, ledgerRuns = 0, finish;
  const stopLedger = startTask({ name: 'ledger', intervalMs: 1, clock: l, task: async () => { ledgerRuns++; await new Promise(r => { finish = r; }); }, onError: () => assert.fail() });
  const stopHeartbeat = startTask({ name: 'heartbeat', intervalMs: 1, clock: h, task: async () => { beats++; }, onError: () => assert.fail() });
  const stopPoll = startTask({ name: 'signals', intervalMs: 1, clock: p, task: async () => { polls++; }, onError: () => assert.fail() });
  await flush(); h.fire(); p.fire(); await flush();
  assert.equal(beats, 2); assert.equal(polls, 2); assert.equal(ledgerRuns, 1); assert.equal(l.queue.length, 0);
  stopLedger(); finish(); stopHeartbeat(); stopPoll(); await flush();
  assert.equal(l.queue.length, 0);
});
test('temporary request failure schedules retry rather than stopping the task', async () => {
  const c = clock(); let calls = 0; const errors = [];
  const stop = startTask({ name: 'signals', intervalMs: 1, clock: c, task: async () => { if (++calls === 1) throw Error('DB_TIMEOUT'); }, onError: (name, e) => errors.push([name, e.message]) });
  await flush(); assert.equal(c.queue.length, 1); c.fire(); await flush(); stop();
  assert.equal(calls, 2); assert.deepEqual(errors, [['signals', 'DB_TIMEOUT']]);
});
test('tick audit aggregates all extrema and cross-second gaps instead of synchronous per-frame logs', () => {
  const rows = [], audit = createTickAudit((kind, data) => rows.push({ kind, data }));
  audit.add({ timestamp: '2026-10-23T05:00:00.100Z', price: 100 });
  audit.add({ timestamp: '2026-10-23T05:00:00.200Z', price: 102 });
  audit.add({ timestamp: '2026-10-23T05:00:00.300Z', price: 99 });
  audit.add({ timestamp: '2026-10-23T05:00:02.000Z', price: 101 }); audit.flush();
  assert.equal(rows.length, 2); assert.equal(rows[0].data.low, 99); assert.equal(rows[0].data.high, 102); assert.equal(rows[0].data.updates, 3); assert.equal(rows[1].data.maxGapMs, 1700);
});
