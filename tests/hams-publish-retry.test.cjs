const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileHamsPublish}=require('../scripts/hams-journal.cjs');
const at='2026-11-03T08:00:10.000Z',old='2026-11-03T08:00:00.000Z';
const timeout={error:{message:'TimeoutError',code:'23'}};
test('HAMS accepts successful writes and independently confirmed lost acknowledgements',async()=>{
 assert.deepEqual(await reconcileHamsPublish({data:[{id:1}]},()=>{throw Error('not needed')},'ours',at),{committed:true,lease:at});
 assert.deepEqual(await reconcileHamsPublish(timeout,async()=>({data:{worker_id:'ours',received_at:at}}),'ours',at),{committed:true,lease:at});
});
test('old same-owner snapshot is retryable and never fabricates a fresh lease',async()=>{
 const r=await reconcileHamsPublish(timeout,async()=>({data:{worker_id:'ours',received_at:old}}),'ours',at);
 assert.deepEqual(r,{committed:false,lease:old});assert.notEqual(r.lease,at);
});
test('database timeout and absent snapshot are unverified ownership, not proof of a competing worker',async()=>{
 for(const read of [async()=>({error:{code:'ETIMEDOUT',message:'timeout'}}),async()=>{throw Error('connection reset')},async()=>({data:null}),async()=>({data:{received_at:old}})])
 await assert.rejects(reconcileHamsPublish(timeout,read,'ours',at),e=>e.code==='HAMS_STORAGE_RETRY');
});
test('confirmed different owner remains fatal, including after a write timeout',async()=>{
 await assert.rejects(reconcileHamsPublish(timeout,async()=>({data:{worker_id:'other',received_at:at}}),'ours',at),e=>e.code==='HAMS_OWNERSHIP_LOST');
});
test('invalid or future observed timestamps cannot renew execution ownership',async()=>{
 for(const received_at of ['not-a-date','2026-11-03T08:00:11Z'])await assert.rejects(reconcileHamsPublish(timeout,async()=>({data:{worker_id:'ours',received_at}}),'ours',at),e=>e.code==='HAMS_STORAGE_RETRY');
});
