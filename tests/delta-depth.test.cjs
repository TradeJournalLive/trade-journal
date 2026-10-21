const test = require('node:test'), assert = require('node:assert/strict');
const { crc32 } = require('node:zlib');
const { createDeltaDepth } = require('../scripts/delta-depth.cjs');
const checksum = (a,b) => crc32(Buffer.from(`${a.map(r=>r.join(':')).join(',')}|${b.map(r=>r.join(':')).join(',')}`));
const asks = [['80102.0','400'],['80103.0','600']], bids = [['80101.0','500'],['80100.0','700']];
const frame = (overrides={}) => ({ type:'ob_updates',sy:'BTCUSD',action:'snapshot',seq:100,ts:1792195200000000,a:asks,b:bids,cs:checksum(asks,bids),...overrides });
test('Delta depth validates raw-string checksum and converts contracts to BTC',()=>{
  const book=createDeltaDepth(.001);assert.equal(book.accept(frame()),true);
  assert.deepEqual(book.snapshot().asks,[{price:80102,quantityBtc:.4},{price:80103,quantityBtc:.6}]);
  const a=[['80102.0','200'],['80103.0','600']];
  book.accept(frame({action:'update',seq:101,a:[['80102.0','200']],b:[],cs:checksum(a,bids)}));
  assert.equal(book.snapshot().asks[0].quantityBtc,.2);
});
test('Delta gap or checksum error clears depth until a verified snapshot arrives',()=>{
  const book=createDeltaDepth(.001);book.accept(frame());
  assert.throws(()=>book.accept(frame({action:'update',seq:102})),/SEQUENCE_GAP/);assert.equal(book.snapshot(),undefined);
  assert.throws(()=>book.accept(frame({cs:0})),/CHECKSUM/);assert.equal(book.snapshot(),undefined);
  book.accept(frame());book.reset();assert.equal(book.snapshot(),undefined);
  assert.throws(()=>book.accept(frame({action:'update',seq:101})),/SEQUENCE_GAP/);
});
test('Delta zero-size updates remove levels and invalid sizes cannot become liquidity',()=>{
  const book=createDeltaDepth(.001);book.accept(frame());
  book.accept(frame({action:'update',seq:101,a:[['80102.0','0']],b:[],cs:checksum([asks[1]],bids)}));
  assert.equal(book.snapshot().asks.length,1);
  assert.throws(()=>book.accept(frame({a:[['80102.0','-1']]})),/INVALID/);
});
