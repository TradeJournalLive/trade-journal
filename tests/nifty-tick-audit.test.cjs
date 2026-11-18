const test = require('node:test'), assert = require('node:assert/strict');
const { createTickAudit } = require('../scripts/nifty-tick-audit.cjs');
function fixture(extra = {}) {
  let clock = Date.parse('2026-11-18T04:00:00Z');
  const writes = [], warnings = [], io = { readdirSync: () => [], statSync: () => ({ size: 0 }), appendFileSync: (...args) => writes.push(args), ...extra.io };
  const record = createTickAudit({ directory: '/fixture', io, clock: () => clock, onDisabled: value => warnings.push(value), ...extra, ...(extra.io ? { io } : {}) });
  return { record, writes, warnings, time: n => { clock += n; } };
}
const tick = { timestamp: '2026-11-18T04:00:00Z', price: 25200, contracts: [{ id: 'CE', timestamp: '2026-11-18T04:00:00Z', bid: 99, ask: 100, bidSize: 650, askSize: 650 }, { id: 'PE', bid: 200, ask: 201 }] };
test('optional market diagnostics sample once per second and omit the full chain', () => {
  const f = fixture(); for (let n = 0; n < 1000; n++) f.record(tick, 'CE');
  assert.equal(f.writes.length, 1); const row = JSON.parse(f.writes[0][1]);
  assert.equal(row.data.option.id, 'CE'); assert.equal(row.data.contracts, undefined); assert.equal(row.data.spot, 25200);
  assert.equal(f.writes[0][2].mode, 0o600); f.time(1000); f.record(tick); assert.equal(f.writes.length, 2);
});
test('a full disk disables only optional logs and does not throw or repeatedly retry', () => {
  const f = fixture({ io: { appendFileSync() { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); } } });
  assert.doesNotThrow(() => f.record(tick)); f.time(1000); f.record(tick);
  assert.equal(f.warnings.length, 1); assert.equal(f.warnings[0].code, 'ENOSPC');
});
test('existing optional-log sizes count toward a hard budget without deleting or truncating any file', () => {
  const f = fixture({ maxBytes: 100, io: { readdirSync: () => ['market-ticks-2026-11-17.jsonl', '2026-11-18.jsonl', 'checkpoint.json'], statSync: () => ({ size: 100 }) } });
  f.record(tick); assert.equal(f.writes.length, 0); assert.equal(f.warnings[0].reason, 'OPTIONAL_TICK_AUDIT_BUDGET_REACHED');
});
test('daily diagnostic budget is enforced independently of the total limit', () => {
  const f = fixture({ dailyBytes: 1 }); f.record(tick); assert.equal(f.writes.length, 0); assert.equal(f.warnings.length, 1);
});
