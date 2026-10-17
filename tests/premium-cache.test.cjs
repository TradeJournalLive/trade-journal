const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const file = require('node:path').resolve(__dirname, '../app/lib/algo/premiumCache.ts'), copy = new Module(file, module);
copy._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { createPremiumCache } = copy.exports;
test('concurrent identical requests share one upstream call and revisits use cache', async () => {
  const get = createPremiumCache(1000); let count = 0, release;
  const load = () => { count++; return new Promise(resolve => { release = resolve; }); };
  const first = get('owner:contract:bucket', load), second = get('owner:contract:bucket', load);
  assert.equal(count, 1); release(42);
  assert.equal(await first, 42); assert.equal(await second, 42);
  assert.equal(await get('owner:contract:bucket', () => { throw Error('unnecessary fetch'); }), 42);
});
test('owner, contract and candle-boundary keys remain isolated; expiry reloads', async () => {
  const get = createPremiumCache(1000); let count = 0;
  const load = async () => ++count;
  assert.equal(await get('a:CE:1', load), 1);
  assert.equal(await get('b:CE:1', load), 2);
  assert.equal(await get('a:PE:1', load), 3);
  assert.equal(await get('a:CE:2', load), 4);
  assert.equal(await get('a:CE:1', load, Date.now() + 2000), 5);
});
test('failed fetches are retried and cache size remains bounded', async () => {
  const get = createPremiumCache(1000, 1);
  await assert.rejects(get('a', async () => { throw Error('feed unavailable'); }));
  assert.equal(await get('a', async () => 1), 1);
  await get('b', async () => 2);
  assert.equal(await get('a', async () => 3), 3);
});
