const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {IndependentPaperStore}=require('../scripts/independent-paper-store.cjs');
const {load}=require('../scripts/independent-paper-engine.cjs');
const at=Date.parse('2026-11-20T04:00:00Z');
test('a hard process exit before COMMIT cannot consume a signal or publish a partial result',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-crash-')),file=path.join(dir,'shadow.sqlite');let store=new IndependentPaperStore(file,'fixture',{clock:()=>at});store.initialize('current',{rules:load('niftyLimitPaper').newLimitState(new Date(at).toISOString(),1,true,false)});store.receive('current',{id:'one',receivedAt:new Date(at).toISOString()});store.close();
 const script=`const {IndependentPaperStore}=require(${JSON.stringify(path.resolve(__dirname,'../scripts/independent-paper-store.cjs'))});const s=new IndependentPaperStore(${JSON.stringify(file)},'fixture',{clock:()=>${at}}),token=s.claim('child'),exec=s.db.exec.bind(s.db);s.db.exec=sql=>{if(sql==='COMMIT')process.exit(9);return exec(sql);};s.advance('current',token,state=>({state:{...state,rules:{...state.rules,balance:123}},records:[{id:'partial',kind:'DECISION',value:{}}]}),{signal:true});`;
 const child=spawnSync(process.execPath,['-e',script],{timeout:5000,encoding:'utf8'});assert.equal(child.status,9,child.stderr);store=new IndependentPaperStore(file,'fixture',{clock:()=>at+16000});assert.equal(store.read('current').revision,0);assert.equal(store.read('current').state.rules.balance,1000000);assert.equal(store.health().pendingSignals,1);assert.equal(store.pending().length,0);assert.ok(store.claim('replacement'));store.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('genuine SQLite capacity exhaustion preserves the original error and never acknowledges the failed receipt',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-full-')),file=path.join(dir,'shadow.sqlite'),store=new IndependentPaperStore(file,'fixture');
 const pages=store.db.prepare('PRAGMA page_count').get().page_count;store.db.exec('PRAGMA max_page_count='+pages);let acknowledged=0,cause;
 for(let i=0;i<100;i++){try{store.receive('current',{id:'large-'+i,receivedAt:new Date(at).toISOString(),fixture:'x'.repeat(12000)});acknowledged++;}catch(error){cause=error;break;}}
 assert.ok(cause);assert.match(cause.message,/full/i);assert.equal(store.health().pendingSignals,acknowledged);store.close();fs.rmSync(dir,{recursive:true,force:true});
});
