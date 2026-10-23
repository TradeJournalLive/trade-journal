const test = require('node:test'), assert = require('node:assert/strict');
const { retryablePoll, canRetryPublish, feedNeedsReconnect } = require('../scripts/btc-worker-health.cjs');
const { reconcileHeartbeat } = require('../scripts/btc-worker-health.cjs');
test('lost heartbeat response reconciles only this worker and exact attempted timestamp', () => {
  const row = { raw_payload: { workerId: 'ours' }, received_at: '2026-10-23T05:37:15.000+00:00' };
  const at = '2026-10-23T05:37:15.000Z', old = '2026-10-23T05:37:11.000Z';
  assert.equal(reconcileHeartbeat(row, 'ours', at, old), 'COMMITTED');
  assert.equal(reconcileHeartbeat(row, 'ours', [at, '2026-10-23T05:37:19Z'], old), 'COMMITTED');
  assert.equal(reconcileHeartbeat({ ...row, received_at: old }, 'ours', at, old), 'UNCHANGED');
  assert.equal(reconcileHeartbeat(row, 'other', at, old), 'LOST');
  assert.equal(reconcileHeartbeat(null, 'ours', at, old), 'LOST');
  assert.equal(reconcileHeartbeat({ ...row, received_at: '2026-10-23T05:37:16Z' }, 'ours', at, old), 'LOST');
});
test('temporary polling failures retry, backlog failures do not', () => {
  assert.equal(retryablePoll(new Error('BTC_SIGNAL_STORAGE_UNAVAILABLE')), true);
  assert.equal(retryablePoll(new Error('BTC_SIGNAL_BACKLOG_OR_STORAGE_ERROR')), false);
});
test('publication retries are bounded by lease and never retry a failed ownership comparison', () => {
  const lease = new Date(100000).toISOString();
  assert.equal(canRetryPublish(new Error('BTC_LEDGER_UNAVAILABLE'), lease, 109999), true);
  assert.equal(canRetryPublish(new Error('BTC_LEDGER_UNAVAILABLE'), lease, 110000), false);
  assert.equal(canRetryPublish(new Error('BTC_LEASE_OR_STORAGE_LOST'), lease, 100001), false);
});
test('feed watchdog reconnects stale, closed and stuck connecting sockets', () => {
  const base = { readyState: 1, openState: 1, connectingState: 0, connectedAt: 100000, lastFrame: 105000, quoteAt: new Date(105000).toISOString() };
  assert.equal(feedNeedsReconnect(base, 109000), false);
  assert.equal(feedNeedsReconnect(base, 110001), true);
  assert.equal(feedNeedsReconnect({ ...base, readyState: 3 }, 105001), true);
  assert.equal(feedNeedsReconnect({ ...base, readyState: 0 }, 110001), true);
  assert.equal(feedNeedsReconnect({ ...base, quoteAt: undefined, lastFrame: 100000 }, 110001), true);
});
