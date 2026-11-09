const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldPublishSnapshot } = require('../scripts/btc-snapshot-policy.cjs');

test('steady idle BTC publishes one third as many snapshots at the existing scheduler cadence', () => {
  let last = NaN, writes = 0;
  for (let now = 0; now < 90000; now += 3000) {
    if (shouldPublishSnapshot({ ageMs: now - last })) { last = now; writes++; }
  }
  assert.equal(writes, 10);
});

test('active state, unsynced records, state changes and retries bypass idle throttling', () => {
  for (const flag of ['changed', 'active', 'unsynced', 'retrying']) {
    assert.equal(shouldPublishSnapshot({ ageMs: 3000, [flag]: true }), true);
  }
  assert.equal(shouldPublishSnapshot({ ageMs: 3000 }), false);
  assert.equal(shouldPublishSnapshot({ ageMs: NaN }), true);
  assert.equal(shouldPublishSnapshot({ ageMs: -1 }), true);
});
