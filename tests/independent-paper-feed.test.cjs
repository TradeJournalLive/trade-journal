const test=require('node:test'),assert=require('node:assert/strict');
const {quoteReader}=require('../scripts/independent-paper-feed.cjs');
const base=Date.parse('2026-11-20T04:00:00Z'),INDEX='NSE:NIFTY50-INDEX';
test('read-only feed uses fresh quotes, retains missing ATM placeholders and clears every cache on reconnect',()=>{
 let now=base;const ticks=[],contracts=[{id:'ATM',strike:25250,side:'CE',expiry:'2026-11-26',lotSize:65},{id:'OTHER',strike:25300,side:'CE',expiry:'2026-11-26',lotSize:65}];
 const r=quoteReader({contracts:()=>contracts,required:()=>['ATM'],onTick:t=>ticks.push(t),clock:()=>now});
 r.receive({symbol:'OTHER',exch_feed_time:base/1000,bid_price:99,ask_price:100,bid_size:1000,ask_size:1000});r.receive({symbol:INDEX,exch_feed_time:base/1000,ltp:25251});assert.equal(ticks.length,1);assert.equal(ticks[0].chain[0].id,'ATM');assert.equal(ticks[0].chain[0].bid,0);assert.equal(ticks[0].chain[1].bid,99);
 r.clear();now+=1000;r.receive({symbol:'ATM',exch_feed_time:now/1000,bid_price:99,ask_price:100,bid_size:1000,ask_size:1000});assert.equal(ticks.length,1);r.receive({symbol:INDEX,exch_feed_time:now/1000,ltp:25251});assert.equal(ticks.length,2);assert.equal(ticks[1].chain[1].bid,0);
 now+=6000;r.receive({symbol:INDEX,exch_feed_time:now/1000-6,ltp:25251});assert.equal(ticks.length,2);
});
