const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function fixture(){
 const file=path.resolve(__dirname,'../app/lib/algo/historyReads.ts'),m=new Module(file,module);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 const rows=[{id:1,secret_hash:'a',received_at:new Date().toISOString(),raw_payload:{value:1}},{id:2,secret_hash:'b',received_at:new Date().toISOString(),raw_payload:{value:2}}],calls=[];
 let fail=false;
 const db={from(){let head=false,range=null;const filters=[];const q={select(_,o){head=!!o?.head;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gt(k,v){filters.push(r=>BigInt(r[k])>BigInt(v));return q;},or(){filters.push(()=>true);return q;},order(){return q;},range(a,b){range=[a,b];return q;},then(resolve,reject){calls.push({head,range});const found=rows.filter(r=>filters.every(f=>f(r)));return Promise.resolve(fail&&!head?{error:{message:'offline'}}:{count:found.length,data:head?null:structuredClone(range?found.slice(range[0],range[1]+1):found),error:null}).then(resolve,reject);}};return q;}};
 return {rows,calls,read:(owner='a',mutable)=>m.exports.readHistory(db,owner,'test',q=>q,mutable),fail(v){fail=v;}};
}
test('unchanged immutable history checks count without downloading rows; owners stay isolated',async()=>{
 const f=fixture(),first=await f.read();first[0].raw_payload.value=999;
 assert.equal((await f.read())[0].raw_payload.value,1);
 assert.equal(f.calls.filter(c=>!c.head).length,1);
 assert.deepEqual((await f.read('b')).map(r=>r.id),[2]);
});
test('new rows incrementally merge and late lower-ID commits reconcile completely',async()=>{
 const f=fixture();await f.read();f.rows.push({id:4,secret_hash:'a'});assert.deepEqual((await f.read()).map(r=>r.id).sort(),[1,4]);
 f.rows.push({id:3,secret_hash:'a'});assert.deepEqual((await f.read()).map(r=>r.id).sort(),[1,3,4]);
});
test('failed fetch never commits partial history or reports stale success',async()=>{
 const f=fixture();await f.read();f.rows.push({id:3,secret_hash:'a'});f.fail(true);await assert.rejects(f.read(),/complete history page/);
 f.fail(false);assert.equal((await f.read()).length,2);
});
test('mutable history refreshes updates even when row count stays unchanged',async()=>{
 const f=fixture();await f.read('a','received_at');f.rows[0].raw_payload.value=3;
 assert.equal((await f.read('a','received_at'))[0].raw_payload.value,3);
 assert.equal(f.calls.filter(c=>!c.head).length,2);
});
test('reporting HAMS projection retains balances, positions and unsynced trades without changing recovery state',()=>{
 const {hamsPublicView}=require('../scripts/hams-public-view.cjs');
 const raw={state:{balance:1000000,position:{id:'open'},trades:[{id:'pending'}],seen:['a'],rulesV2:{ticks:Array(1000).fill({price:10}),seen:['b'],decisions:['c']}},incidents:[{id:'incident'}],decisions:[{id:'decision'}],workerStatus:'READY'};
 const before=structuredClone(raw),view=hamsPublicView(raw);
 assert.deepEqual(raw,before);assert.deepEqual(view.state.position,raw.state.position);assert.deepEqual(view.state.trades,raw.state.trades);assert.equal(view.state.balance,raw.state.balance);
 assert.deepEqual(view.state.rulesV2.ticks,[]);assert.ok(JSON.stringify(view).length<JSON.stringify(raw).length/10);
});
