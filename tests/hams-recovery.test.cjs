const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm'),Module=require('node:module'),ts=require('typescript');
const {HamsJournal,selectSnapshot,flushHamsRecords,confirmHamsPublish}=require('../scripts/hams-journal.cjs');
function load(name){const file=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(file,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const {emptyHamsState}=load('hamsFinalPaper'),{hamsRecoveryView,loadHamsRecords}=load('hamsHistory');
const owner='test-owner',at='2026-10-29T03:51:05.000Z';
const position={signalId:'s1',signalClosedAt:'2026-10-29T03:51:00.000Z',receivedAt:at,openedAt:at,entry:100,stop:85,target:145,lots:1,quantity:65,contract:{id:'testCE',side:'CE',strike:22500,expiry:'2026-11-03',lotSize:65}};
const snapshot=()=>({owner,savedAt:at,state:{...emptyHamsState(),enabled:true,status:'OPEN',position},decisions:[],incidents:[],lastControl:{id:'on',at,enabled:true}});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hams-journal-')),journal=new HamsJournal(dir,owner);return {dir,journal,close(){this.journal.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('uninitialized save cannot replace a prior checkpoint; atomic open record survives reopen',()=>{
 const f=fixture();try{const file=path.join(f.dir,'checkpoint.json');fs.writeFileSync(file,'original');assert.throws(()=>f.journal.save(snapshot()),/NOT_INITIALIZED/);assert.equal(fs.readFileSync(file,'utf8'),'original');
 f.journal.initialize(snapshot());const saved=f.journal.save(snapshot());assert.equal(saved.revision,1);assert.equal(f.journal.pending()[0].record.type,'ENTRY');
 f.journal.close();f.journal=new HamsJournal(f.dir,owner);assert.equal(f.journal.read().state.position.entry,100);assert.equal(f.journal.read().state.enabled,true);assert.equal(f.journal.pending()[0].record.value.signalId,'s1');
 }finally{f.close();}
});
test('history, positions and entry switches cannot silently reset',()=>{
 const f=fixture();try{f.journal.initialize(snapshot());f.journal.save(snapshot());const empty={...snapshot(),state:{...emptyHamsState(),enabled:true}};
 assert.throws(()=>f.journal.save(empty),/POSITION_DISAPPEARANCE/);
 assert.throws(()=>f.journal.save({...snapshot(),state:{...snapshot().state,enabled:false}}),/SWITCH_CHANGE_WITHOUT_CONTROL/);
 const t={...position,exit:85,closedAt:'2026-10-29T03:52:00.000Z',reason:'SL',pnl:-975};
 const closed={...snapshot(),state:{...snapshot().state,position:null,trades:[t],balance:499025,nextLots:2}};f.journal.save(closed);
 assert.throws(()=>f.journal.save(empty),/HISTORY_REGRESSION/);assert.equal(f.journal.read().state.nextLots,2);
 const paused={...closed,state:{...closed.state,enabled:false},lastControl:{id:'off',at:t.closedAt,enabled:false}};f.journal.save(paused);assert.equal(f.journal.read().state.enabled,false);
 }finally{f.close();}
});
test('lost cloud acknowledgement retries an immutable record without duplication',async()=>{
 const f=fixture();try{f.journal.initialize(snapshot());f.journal.save(snapshot());const remote=new Map();let fail=true;
 const transport=async rows=>{for(const row of rows)remote.set(row.id,row.record);if(fail){fail=false;throw Error('lost acknowledgement');}};
 await assert.rejects(flushHamsRecords(f.journal,transport));assert.ok(f.journal.pending().length);await flushHamsRecords(f.journal,transport);assert.equal(f.journal.pending().length,0);assert.equal(remote.size,2);
 }finally{f.close();}
});
test('abrupt process death retains the entry and armed switch in SQLite',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hams-crash-'));
 try{const moduleFile=path.resolve(__dirname,'../scripts/hams-journal.cjs');const code=`const {HamsJournal}=require(${JSON.stringify(moduleFile)});const j=new HamsJournal(${JSON.stringify(dir)},${JSON.stringify(owner)});const s=${JSON.stringify(snapshot())};j.initialize(s);j.save(s);process.kill(process.pid,'SIGKILL');`;
 const child=cp.spawnSync(process.execPath,['-e',code]);assert.equal(child.signal,'SIGKILL');const j=new HamsJournal(dir,owner);try{assert.equal(j.read().state.position.signalId,'s1');assert.equal(j.read().state.enabled,true);}finally{j.close();}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('snapshot selection rejects an empty newer state rather than erase an open trade',()=>{
 const before=snapshot(),after={...snapshot(),savedAt:'2026-10-29T04:00:00Z',state:emptyHamsState()};assert.throws(()=>selectSnapshot([before,after],owner),/POSITION_DISAPPEARANCE/);
 assert.throws(()=>selectSnapshot([{...before,owner:'another-user'}],owner),/INVALID_SAVED_STATE/);
});
test('durable trade history wins over empty snapshots; unknown legacy entries never fabricate P&L',()=>{
 const t={...position,exit:145,closedAt:'2026-10-29T04:00:00Z',reason:'TARGET_3R',pnl:2925};
 const record={id:'trade',type:'TRADE',at:t.closedAt,value:t};
 const view=hamsRecoveryView(emptyHamsState(),[],[record]);assert.equal(view.state.trades.length,1);assert.equal(view.state.balance,502925);assert.equal(view.state.nextLots,1);
 const incident={id:'legacy',signalId:'lost',at,status:'ENTRY_RECORD_LOST',reason:'Unknown exit'};
 const lost=hamsRecoveryView(emptyHamsState(),[incident],[]);assert.equal(lost.reviewRequired,true);assert.equal(lost.state.trades.length,0);assert.equal(lost.state.balance,500000);assert.equal(lost.state.status,'RECOVERY_REVIEW_REQUIRED');
 const preserved=hamsRecoveryView(emptyHamsState(),[],[{id:'entry',type:'ENTRY',at,value:position}]);assert.equal(preserved.state.position.signalId,'s1');assert.equal(preserved.reviewRequired,true);
});
test('review acknowledgement preserves evidence and does not create an exit or reset lot size',()=>{
 const f=fixture();try{f.journal.initialize(snapshot());f.journal.save(snapshot());const incident={id:'review',signalId:'s1',position,at,status:'EXCLUDED_UNVERIFIED',reason:'Interrupted',acknowledgedAt:'2026-10-29T04:00:00Z'};
 const saved=f.journal.save({...snapshot(),state:{...snapshot().state,position:null},incidents:[incident]});assert.equal(saved.state.position,null);assert.equal(saved.state.trades.length,0);assert.equal(saved.state.enabled,true);
 const view=hamsRecoveryView(saved.state,[incident],[{id:'entry',type:'ENTRY',at,value:position}]);assert.equal(view.state.position,null);assert.equal(view.reviewRequired,false);assert.equal(view.incidents.length,1);
 }finally{f.close();}
});
test('HAMS cloud ledger pagination is account-scoped and fails without partial success',async()=>{
 const filters=[];const db={from(){const q={select(){return q},eq(k,v){filters.push([k,v]);return q},like(k,v){filters.push([k,v]);return q},order(){return q},range(){return Promise.resolve({error:{message:'offline'}})}};return q;}};
 await assert.rejects(loadHamsRecords(db,'owner-a'),/durable history unavailable/);assert.ok(filters.some(([k,v])=>k==='secret_hash'&&v==='owner-a'));assert.ok(filters.some(([k,v])=>k==='strategy_id'&&v==='__hams_final_worker__'));
});
test('worker startup database failure cannot save the default state',async()=>{
 const writes=[],exits=[],source=fs.readFileSync(path.resolve(__dirname,'../scripts/hams-final-worker.cjs'),'utf8');
 const realFs=fs;const fakeFs={...fs,mkdirSync(){},readFileSync(file,...args){return String(file).endsWith('config.json')?JSON.stringify({webhookSecret:'test-secret'}):realFs.readFileSync(file,...args)},writeFileSync(){writes.push('write')},renameSync(){writes.push('rename')}};
 const db={from(){const q={select(){return q},eq(){return q},maybeSingle(){return Promise.resolve({error:{message:'offline'}})}};return q;}};
 const fakeProcess={env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'},argv:[],cwd:()=>process.cwd(),on(){},exit(code){exits.push(code)}};
 const req=id=>id==='node:fs'?fakeFs:id==='@next/env'?{loadEnvConfig(){}}:id==='@supabase/supabase-js'?{createClient:()=>db}:id==='fyers-api-v3'?{}:id==='./nifty-depth.cjs'?{readDepth(){}}:id==='./hams-journal.cjs'?{HamsJournal:class{read(){return null}save(){writes.push('journal-save')}},selectSnapshot,flushHamsRecords}:require(id);
 vm.runInNewContext(source,{require:req,process:fakeProcess,module:{},__dirname:path.resolve(__dirname,'../scripts'),console:{log(){},error(){}},Buffer,structuredClone,AbortSignal,setTimeout});
 await new Promise(r=>setImmediate(r));assert.deepEqual(writes,[]);assert.deepEqual(exits,[1]);
});
test('a lost heartbeat response is accepted only after exact owner/timestamp read-back',async()=>{
 const failed={error:{message:'timeout'}},success={data:{received_at:at,raw_payload:{workerId:'ours'}}};
 await confirmHamsPublish(failed,async()=>success,'ours',at);
 await assert.rejects(confirmHamsPublish(failed,async()=>({...success,data:{...success.data,raw_payload:{workerId:'other'}}}),'ours',at),/STORAGE_LOST/);
 await assert.rejects(confirmHamsPublish(failed,async()=>({error:{}}),'ours',at),/STORAGE_LOST/);
 await assert.rejects(confirmHamsPublish(failed,async()=>({...success,data:{...success.data,received_at:'2026-10-29T04:00:00Z'}}),'ours',at),/STORAGE_LOST/);
});
