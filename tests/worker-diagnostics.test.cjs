const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkerDiagnostics}=require('../scripts/worker-diagnostics.cjs');
function fixture(){const rows=[];let t=0;const d=createWorkerDiagnostics({emit:r=>rows.push(r),context:()=>({workerId:'test',pid:1}),secrets:()=>['private-webhook','private-access-token'],clock:()=>t,mono:()=>t});return {d,rows,set:n=>t=n};}
test('first stopping task and original causal stack survive later generic errors',()=>{
 const f=fixture(),cause=Object.assign(new Error('database timeout'),{code:'ETIMEDOUT'}),error=new Error('LEASE_OR_STORAGE_LOST',{cause});
 f.d.stop('snapshot.publish',error);f.d.stop('main',new Error('HAMS_WORKER_STOPPED'));
 assert.equal(f.d.firstStop.operation,'snapshot.publish');assert.equal(f.d.firstStop.error.cause.code,'ETIMEDOUT');assert.match(f.d.firstStop.error.stack,/LEASE_OR_STORAGE_LOST/);assert.equal(f.rows.length,1);
});
test('logs redact known secrets, URL queries, bearer values and JWTs in nested causes',()=>{
 const f=fixture();f.d.failure('fetch',new Error('private-webhook https://example.test/data?token=private-access-token Bearer abc123',{cause:new Error('eyJabc.def.ghi')}));
 const text=JSON.stringify(f.rows);for(const value of ['private-webhook','private-access-token','?token=','abc123','eyJabc.def.ghi'])assert.equal(text.includes(value),false);assert.match(text,/REDACTED/);
});
test('task latency and outstanding task age distinguish network waiting from scheduler delay',async()=>{
 const f=fixture(),finish=f.d.begin('credentials.refresh');f.set(30000);f.d.sample({maxLoopLagMs:2,signalPollAgeMs:30000});
 const sample=f.rows[0];assert.equal(sample.active[0].operation,'credentials.refresh');assert.equal(sample.active[0].ageMs,30000);assert.equal(sample.maxLoopLagMs,2);
 finish();assert.equal(f.rows[1].type,'TASK_SLOW');assert.equal(f.rows[1].durationMs,30000);
 await assert.rejects(f.d.run('signal.poll',async()=>{throw Object.assign(new Error('aborted'),{code:'ABORT_ERR'});}));assert.equal(f.rows.at(-1).error.code,'ABORT_ERR');
});
test('failed diagnostics output cannot change a task return value or throw into execution',async()=>{
 const d=createWorkerDiagnostics({emit(){throw Error('disk full');}});assert.doesNotThrow(()=>d.stop('main',new Error('original')));assert.equal(await d.run('test',async()=>42),42);assert.throws(()=>d.sync('journal.save',()=>{throw Error('SQLITE_BUSY');}),/SQLITE_BUSY/);
});
