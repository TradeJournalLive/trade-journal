const test = require('node:test');
const assert = require('node:assert/strict');
const { readDepth, withDepth } = require('../scripts/nifty-depth.cjs');
test('FYERS five-level depth uses quantities and receipt timestamps, no invented levels', () => {
  const at = '2026-10-21T05:38:04Z';
  const depth = readDepth({ type: 'dp', symbol: 'option', ask_price1: 130, ask_size1: 65, ask_price2: 132, ask_size2: 130, bid_price1: 129, bid_size1: 65 }, at);
  assert.deepEqual(depth.asks, [{ price: 130, quantity: 65 }, { price: 132, quantity: 130 }]);
  const quote = { ask: 130, bid: 129 };
  assert.equal(withDepth(quote, depth, at).asks.length, 2);
  assert.equal(withDepth({ ...quote, ask: 131 }, depth, at).asks, undefined);
  assert.equal(withDepth(quote, depth, '2026-10-21T05:38:10Z').asks, undefined);
  assert.equal(readDepth({ type: 'sf' }, at), null);
});
