const test = require('node:test');
const assert = require('node:assert/strict');
const { makeQuoteReader } = require('../scripts/ribbon-staging-feed.cjs');

test('staging uses fresh index and option quotes and discards pre-reconnect prices', () => {
  let now = 100000;
  const ticks = [];
  const feed = makeQuoteReader([{ id: 'CE' }], tick => ticks.push(tick), () => now);
  const index = { symbol: 'NSE:NIFTY50-INDEX', ltp: 22500, exch_feed_time: 100 };
  const option = { symbol: 'CE', bid_price: 99, ask_price: 100, bid_size: 65, ask_size: 65, exch_feed_time: 100 };
  feed.receive({ ...index, exch_feed_time: 94 });
  feed.receive(option);
  assert.equal(ticks.length, 0);
  feed.receive(index);
  assert.equal(ticks.at(-1).chain[0].ask, 100);
  now += 6000;
  feed.receive({ ...index, exch_feed_time: 106 });
  assert.deepEqual(ticks.at(-1).chain, []);
  feed.clear();
  const count = ticks.length;
  feed.receive({ ...option, exch_feed_time: 106 });
  assert.equal(ticks.length, count);
});
