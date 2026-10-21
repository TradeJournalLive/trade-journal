const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');

function store(rows, failPage = -1) {
  const filters = [], ranges = [];
  const query = {
    select() { return this; }, eq(k, v) { filters.push(['eq', k, v]); return this; },
    neq(k, v) { filters.push(['neq', k, v]); return this; }, order() { return this; },
    gte(k, v) { filters.push(['gte', k, v]); return this; },
    lt(k, v) { filters.push(['lt', k, v]); return this; },
    async range(a, b) { ranges.push([a, b]); return ranges.length === failPage ? { error: { message: 'offline' } } : { data: rows.slice(a, b + 1) }; }
  };
  const filename = path.resolve(__dirname, '../app/lib/algo/signalStore.ts');
  const copy = new Module(filename, module);
  copy.require = id => id === '@supabase/supabase-js' ? { createClient: () => ({ from: () => query }) } : require(id);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  copy._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return { api: copy.exports, filters, ranges };
}
test('selected IST day loads all pages, scoped to the owner secret', async () => {
  const rows = Array.from({ length: 2105 }, (_, id) => ({ received_at: '2026-10-20T19:00:00Z', signal: { id }, decision: {} }));
  const { api, filters, ranges } = store(rows);
  const result = await api.listPersistedAlgoSignalEvents('owner-a', 100, '2026-10-21');
  assert.equal(result.events.length, 2105);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(filters.some(f => f[0] === 'eq' && f[1] === 'secret_hash' && f[2] === api.hashWebhookSecret('owner-a')));
  assert.ok(filters.some(f => f[0] === 'gte' && f[2] === '2026-10-20T18:30:00.000Z'));
  assert.ok(filters.some(f => f[0] === 'lt' && f[2] === '2026-10-21T18:30:00.000Z'));
  assert.ok(filters.some(f => f[0] === 'neq' && f[2] === '__btc_delta_decision__'));
});
test('invalid calendar dates fail and a failed page never returns partial history', async () => {
  const { api, ranges } = store([]);
  assert.equal((await api.listPersistedAlgoSignalEvents('a', 100, '2026-02-30')).ok, false);
  assert.equal(ranges.length, 0);
  const failing = store(Array.from({ length: 1100 }, () => ({})), 2);
  const result = await failing.api.listPersistedAlgoSignalEvents('a', 100, '2026-10-21');
  assert.equal(result.ok, false);
  assert.deepEqual(result.events, []);
});
