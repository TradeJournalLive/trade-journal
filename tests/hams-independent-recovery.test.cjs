const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recoverForFreshSignal}=require('../scripts/hams-independent-recovery.cjs');
const at='2026-11-05T06:00:00Z';
const fixture=()=>({state:{enabled:true,balance:999000,nextLots:4,position:{signalId:'old'},trades:[],rulesV2:{position:{signalId:'old'},setup:{},balance:999000,nextLots:4}},incidents:[{signalId:'old',at:'2026-11-05T05:00:00Z',position:{signalId:'old'}}],decisions:[{id:'old',status:'ENTERED'}]});
test('fresh signal isolates interrupted position without realizing P&L or changing sizing',()=>{
 const original=fixture(),r=recoverForFreshSignal(original,{id:'new',receivedAt:at},at);
 assert.equal(r.state.position,null);assert.equal(r.state.rulesV2.position,null);assert.equal(r.state.rulesV2.setup,null);
 assert.equal(r.state.balance,999000);assert.equal(r.state.nextLots,4);assert.deepEqual(r.state.trades,[]);
 assert.equal(r.decisions[0].status,'EXCLUDED_UNVERIFIED');assert.equal(r.incidents[0].resumedBySignalId,'new');
 assert.equal(original.state.position.signalId,'old');assert.equal(r.incidents[0].position.signalId,'old');
});
test('old, duplicate and invalid-timestamp signals cannot release review',()=>{
 for(const signal of [{id:'old',receivedAt:at},{id:'new',receivedAt:'2026-11-05T04:00:00Z'},{id:'new',receivedAt:'bad'}])assert.equal(recoverForFreshSignal(fixture(),signal,at),null);
});
test('unrelated active position is never removed',()=>{const s=fixture();s.state.position.signalId='other';assert.equal(recoverForFreshSignal(s,{id:'new',receivedAt:at},at),null);});
test('disabled entries stay disabled',()=>{const s=fixture();s.state.enabled=false;const r=recoverForFreshSignal(s,{id:'new',receivedAt:at},at);assert.equal(r.state.status,'DISABLED');assert.equal(r.state.enabled,false);});
