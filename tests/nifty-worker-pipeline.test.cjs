const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),base=Date.parse('2026-10-30T04:00:00Z'),at=n=>new Date(base+n*1000).toISOString();
function load(name){const f=path.join(root,'app/lib/algo',name+'.ts'),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
function worker(kind){
 const hams=kind==='hams',file=path.join(root,'scripts',hams?'hams-final-worker.cjs':'nifty-paper-worker.cjs'),realRequire=Module.createRequire(file);
 let clock=base,rows=[],writeResult,readResult,lastWrite,pollResult;const audit=[],ranges=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const db={from(){let writing=false,single=false;const q={update(value){writing=true;lastWrite=value;return q;},upsert(){writing=true;return q;},maybeSingle(){single=true;return q;},select(){return q;},eq(){return q;},neq(){return q;},or(){return q;},in(){return q;},gte(){return q;},lte(){return q;},range(a,b){ranges.push([a,b]);return q;},order(){return q;},limit(){return q;},then(resolve,reject){const result=writing?writeResult:single?readResult:pollResult;return Promise.resolve().then(()=>typeof result==='function'?result(lastWrite):result??{data:rows,error:null}).then(resolve,reject);}};return q;}};
 const io={...fs,mkdirSync(){},existsSync(f){return String(f).endsWith('config.json')||fs.existsSync(f);},readFileSync(f,...args){return String(f).endsWith('config.json')?JSON.stringify({webhookSecret:'fixture-secret',fyersAppId:'fixture-app'}):fs.readFileSync(f,...args);},appendFileSync(f,data){audit.push(JSON.parse(data));},writeFileSync(){},renameSync(){},openSync(){return 1;},fsyncSync(){},closeSync(){}};
 const context=vm.createContext({require(id){if(id==='node:fs')return io;if(id==='@next/env')return {loadEnvConfig(){}};if(id==='@supabase/supabase-js')return {createClient:()=>db};if(id==='fyers-api-v3')return {fyersDataSocket:{}};return realRequire(id);},module,__dirname:path.dirname(file),process:{cwd:()=>root,env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'},argv:[],on(){},exit(){throw Error('Unexpected worker exit');}},Date:Clock,console:{log(){},error(){}},Buffer,URL,AbortSignal,structuredClone,setTimeout,clearTimeout,fetch(){throw Error('Unexpected external request');}});
 let source=fs.readFileSync(file,'utf8').replace(/main\(\)\.catch\([\s\S]*$/,'');
 source+=hams?`\nglobalThis.harness={start(s,contracts){state=s;master=contracts;initialized=true;claimed=true;ack=Date.now();status='READY';let saved;journal={save(v){saved={...v,revision:1};return saved;},read(){return saved;}};},send:onMessage,poll,publish,startRefresh,configureRefresh(fn){connection={accessToken:'original'};credentials=fn;api=async()=>({data:{optionsChain:[]}});socket={isConnected:()=>true,subscribe(){}};},get:()=>({state,decisions,incidents,status,stopped,refreshing,owned:owned(),executionAllowed:executionAllowed(),ack,publishFailures,publishRetryAt}),pulse:tryEntry,heartbeat(){ack=Date.now();}};`:`\nglobalThis.harness={start(s,contracts){state={checkpoint:s,startedAt:new Date(Date.now()).toISOString(),endsAt:'2026-12-01T00:00:00Z'};master=contracts;advance([]);},send:marketTick,poll,get:()=>({state:book.checkpoint,decisions:book.checkpoint.decisions,status})};`;
 if(!hams) source+=`\nglobalThis.harness.boot=()=>{connect=async()=>{throw Error('REACHED_FEED');};return main();};globalThis.harness.lease=()=>lease;Object.assign(globalThis.harness,{startPoll,startPublish,startLedgerFlush,publish,guardOwnership,quarantine(at){quarantineInterruptedPosition(state,at);},paperStatus:()=>paperStatus(state),setLease(at){lease=at;},storage:()=>({failed,polling,publishing,pollFailures,publishFailures,feedAt,pollOffset,outer:state})});`;
 vm.runInContext(source,context,{filename:file});
 return {...context.harness,setTime(n){clock=base+n*1000;},setRows(v){rows=v;},setPollResult(v){pollResult=v;},setPublishResults(write,read){writeResult=write;readResult=read;},audit,ranges};
}
test('NIFTY starts after legacy trial expiry and preserves the existing entries switch',async()=>{
 for(const enabled of [false,true]){
  const w=worker('nifty'),rulesV2=load('niftyLimitPaper').newLimitState(at(-3600),1,true,enabled);
  let saved;
  w.setPublishResults(value=>{saved=value;return {data:[{id:1}]};},{data:{received_at:at(-60),raw_payload:{state:{startedAt:at(-3600),endsAt:at(-300),checkpoint:{rulesV2,enabled,trades:[]}}}}});
  await assert.rejects(w.boot(),/REACHED_FEED/);
  assert.equal(saved.raw_payload.book.trial.startedAt,at(-3600));
  assert.equal(saved.raw_payload.book.trial.endsAt,null);
  assert.equal(saved.raw_payload.state.checkpoint.enabled,enabled);
 }
});
test('NIFTY distinguishes a rejected lease write from a changed lease without assuming ownership',async()=>{
 for(const [write,reason] of [[{error:{code:'fixture'}},/WORKER_LEASE_WRITE_FAILED/],[{data:[]},/WORKER_LEASE_CHANGED_DURING_STARTUP/]]){
  const w=worker('nifty');
  w.setPublishResults(write,{data:{received_at:at(-60),raw_payload:{state:{startedAt:at(-3600)}}}});
  await assert.rejects(w.boot(),reason);
  assert.ok(!w.lease());
 }
});
const contracts=['CE','PE'].map(side=>({id:side,side,strike:22500,expiry:'2026-11-03',lotSize:65}));
test('HAMS slow 30-second credential refresh does not block snapshot renewals or signal polls and stays single-flight',async()=>{
 const w=worker('hams'),v=load('niftyLimitPaper').newLimitState(at(-60),3,false,true);
 w.start({...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000},contracts);
 let release,calls=0;w.configureRefresh(()=>{calls++;return new Promise(resolve=>{release=resolve;});});w.setPublishResults({data:[{id:1}],error:null});
 w.startRefresh();w.startRefresh();assert.equal(calls,1);assert.equal(w.get().refreshing,true);
 prime(w);w.setTime(1);await w.publish();
 const signal={id:'during-refresh',strategyId:'nifty_hams_final_3m_v1',symbol:'NSE:NIFTY',action:'BUY',timeframe:'3',metadata:{hamsFinalPaper:{kind:'SIGNAL',closedAt:at(0),high:22510,low:22490}}};
 w.setRows([{id:'refresh-row',strategy_id:signal.strategyId,received_at:at(1),signal,raw_payload:{automation:{mode:'PAPER'}}}]);await w.poll();price(w,2,'NSE:NIFTY50-INDEX',{ltp:22511});assert.equal(w.get().state.position.entry,100);
 price(w,3,'CE',{bid_price:79,ask_price:80,bid_size:5000,ask_size:5000});assert.equal(w.get().state.position,null);assert.equal(w.get().state.trades[0].reason,'PREMIUM_SL');
 for(const n of [5,10,15,20,25,30]){w.setTime(n);await w.publish();await w.poll();assert.equal(w.get().owned,true);assert.equal(w.get().stopped,false);}
 release({accessToken:'original'});await new Promise(r=>setImmediate(r));assert.equal(w.get().refreshing,false);assert.equal(w.get().stopped,false);
});
test('HAMS transient snapshot timeout keeps process alive, pauses on stale ownership, and resumes only after confirmed write',async()=>{
 const w=worker('hams'),v=load('niftyLimitPaper').newLimitState(at(-60),3,false,true);
 w.start({...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000},contracts);
 w.setPublishResults({error:{message:'timeout'}},{error:{message:'timeout'}});w.setTime(3);await w.publish();assert.equal(w.get().stopped,false);assert.equal(w.get().publishFailures,1);assert.equal(w.get().ack,base);
 w.setTime(12);assert.equal(w.get().owned,false);assert.equal(w.get().state.enabled,true);
 w.setPublishResults({data:[{id:1}],error:null});w.setTime(13);await w.publish();assert.equal(w.get().owned,true);assert.equal(w.get().publishFailures,0);assert.equal(w.get().state.enabled,true);
});
test('HAMS open trade cannot silently resume verified execution after ownership expires',async()=>{
 const w=worker('hams'),v=load('niftyLimitPaper').newLimitState(at(-60),3,false,true);
 w.start({...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000},contracts);prime(w);
 const signal={id:'lease-open',strategyId:'nifty_hams_final_3m_v1',symbol:'NSE:NIFTY',action:'BUY',timeframe:'3',metadata:{hamsFinalPaper:{kind:'SIGNAL',closedAt:at(0),high:22510,low:22490}}};
 w.setTime(1);w.setRows([{id:'lease-row',strategy_id:signal.strategyId,received_at:at(1),signal,raw_payload:{automation:{mode:'PAPER'}}}]);await w.poll();price(w,2,'NSE:NIFTY50-INDEX',{ltp:22511});assert.equal(w.get().state.position.entry,100);
 price(w,12,'NSE:NIFTY50-INDEX',{ltp:22511});assert.equal(w.get().incidents.length,1);assert.equal(w.get().executionAllowed,false);assert.equal(w.get().state.trades.length,0);assert.equal(w.get().stopped,false);
 w.setPublishResults({data:[{id:1}],error:null});w.setTime(13);await w.publish();assert.equal(w.get().owned,true);assert.equal(w.get().executionAllowed,false);assert.equal(w.get().state.position.entry,100);assert.equal(w.get().state.trades.length,0);
});
function price(w,n,symbol,values){w.setTime(n);w.send({symbol,exch_feed_time:(base+n*1000)/1000,...values});}
function prime(w){for(const c of contracts)price(w,0,c.id,{bid_price:99,ask_price:100,bid_size:5000,ask_size:5000});price(w,0,'NSE:NIFTY50-INDEX',{ltp:22500});}
for(const kind of ['nifty','hams'])test(`${kind} actual worker: saved receipt → processing → index breakout → observed ATM limit fill`,async()=>{
 const w=worker(kind),{newLimitState}=load('niftyLimitPaper'),hams=kind==='hams';
 const v=newLimitState(at(-60),hams?3:1,!hams,true);
 w.start(hams?{...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000}:{rulesV2:v,enabled:true,trades:[]},contracts);
 prime(w);price(w,2.5,'NSE:NIFTY50-INDEX',{ltp:22500});
 const metadata={[hams?'hamsFinalPaper':'niftyPaper']:{kind:'SIGNAL',closedAt:at(0),high:22510,low:22490}};
 const sig={id:'pipeline-'+kind,strategyId:hams?'nifty_hams_final_3m_v1':'nifty',symbol:'NSE:NIFTY',action:'BUY',timeframe:hams?'3':'1',metadata};
 w.setRows([{id:'db-row',strategy_id:sig.strategyId,received_at:at(2),signal:sig,raw_payload:{automation:{mode:'PAPER'}}}]);w.setTime(3);await w.poll();
 assert.equal(w.get().state.rulesV2.setup.id,sig.id);assert.equal(w.get().decisions.at(-1).status,'WAITING_FOR_INDEX_BREAK');assert.equal(w.get().decisions.at(-1).decidedAt,at(3));
 price(w,4,'NSE:NIFTY50-INDEX',{ltp:22511});const p=w.get().state.position;assert.equal(p.contract.id,'CE');assert.equal(p.orderType,'LIMIT');assert.equal(p.entry,100);assert.equal(p.lots,1);assert.equal(p.stop,80);assert.equal(p.target,200);assert.notEqual(w.get().status,'PROCESSING_ERROR');
 await w.poll();assert.equal(w.get().state.position.openedAt,p.openedAt);
 price(w,5,'CE',{bid_price:79,ask_price:80,bid_size:5000,ask_size:5000});assert.equal(w.get().state.position,null);assert.equal(w.get().state.trades.at(-1).reason,'PREMIUM_SL');assert.equal(w.get().state.rulesV2.nextLots,2);
});
test('HAMS ignores unrelated contract messages for rule evaluation but still records real index ticks',()=>{
 const w=worker('hams'),v=load('niftyLimitPaper').newLimitState(at(-60),3,false,true);w.start({...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000},contracts);prime(w);
 price(w,1,'NSE:NIFTY50-INDEX',{ltp:22500});const before=w.get().state.rulesV2.ticks.at(-1).at;
 for(let i=0;i<50;i++)price(w,2,'UNRELATED'+i,{bid_price:10,ask_price:11,bid_size:100,ask_size:100});
 assert.equal(w.get().state.rulesV2.ticks.at(-1).at,before);
 price(w,3,'NSE:NIFTY50-INDEX',{ltp:22501});assert.equal(w.get().state.rulesV2.ticks.at(-1).price,22501);
});
for(const kind of ['nifty','hams'])test(`${kind} actual worker consumes verified emergency command and records market paper exit`,async()=>{
 const w=worker(kind),hams=kind==='hams',core=load('niftyLimitPaper');let v=core.newLimitState(at(-60),hams?3:1,!hams,true);
 v.position={contract:{...contracts[0],at:at(0),bid:99,ask:100,bidSize:5000,askSize:5000},signalId:'existing',signalClosedAt:at(-3),receivedAt:at(-2),openedAt:at(-1),entry:100,stop:80,target:200,quantity:65,lots:1,ruleVersion:2,orderType:'LIMIT',entryLimit:104};
 w.start(hams?{...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,position:v.position,balance:1000000}:{rulesV2:v,enabled:true,trades:[]},contracts);prime(w);
 w.setRows([{id:'kill-row',strategy_id:hams?'__hams_final_control__':'__paper_control__',received_at:at(1),signal:{metadata:{}},raw_payload:hams?{enabled:false,emergencyId:'kill'}:{paperControl:{market:'NIFTY',enabled:false,niftyOptionsEnabled:false,emergencyId:'kill'}}}]);w.setTime(1);await w.poll();assert.equal(w.get().state.enabled,false);assert.ok(w.get().state.position);
 // Emergency premium exits remain possible even if the index feed stops updating.
 price(w,7,'CE',{bid_price:90,ask_price:91,bid_size:5000,ask_size:5000});assert.equal(w.get().state.position,null);assert.equal(w.get().state.trades.at(-1).exitOrderType,'MARKET');assert.equal(w.get().state.trades.at(-1).reason,'EMERGENCY_MARKET_EXIT');assert.notEqual(w.get().status,'PROCESSING_ERROR');
});
for(const kind of ['nifty','hams'])test(`${kind} actual worker permits verified late breakout within twenty seconds`,async()=>{
 const w=worker(kind),hams=kind==='hams',v=load('niftyLimitPaper').newLimitState(at(-60),hams?3:1,!hams,true);
 w.start(hams?{...load('hamsFinalPaper').emptyHamsState(),enabled:true,rulesV2:v,balance:1000000}:{rulesV2:v,enabled:true,trades:[]},contracts);
 price(w,-1,'NSE:NIFTY50-INDEX',{ltp:22500});prime(w);
 for(let n=0;n<=18;n++){w.setTime(n);if(hams)w.heartbeat();price(w,n,'NSE:NIFTY50-INDEX',{ltp:n<2?22500:22511});}
 const signal={id:'late-'+kind,strategyId:hams?'nifty_hams_final_3m_v1':'nifty',symbol:'NSE:NIFTY',action:'BUY',timeframe:hams?'3':'1',metadata:{[hams?'hamsFinalPaper':'niftyPaper']:{kind:'SIGNAL',closedAt:at(0),high:22510,low:22490}}};
 w.setRows([{id:'late-row',strategy_id:signal.strategyId,received_at:at(17),signal,raw_payload:{automation:{mode:'PAPER'}}}]);w.setTime(18);await w.poll();
 assert.equal(w.get().state.rulesV2.setup.breakoutDeadline,at(hams?1800:600));price(w,18.1,'CE',{bid_price:119,ask_price:120,bid_size:5000,ask_size:5000});if(hams)w.pulse();else price(w,18.1,'NSE:NIFTY50-INDEX',{ltp:22511});const position=hams?w.get().state.position:w.get().state.rulesV2.position;assert.equal(position.entry,120);assert.equal(position.openedAt,at(18.1));assert.equal(position.orderType,'LIMIT');assert.equal(position.lateEntry,true);
});
for(const reversed of [false,true])test(`current NIFTY ${reversed?'accepts verified recrossed':'accepts older verified'} late breakouts`,async()=>{
 const w=worker('nifty'),v=load('niftyLimitPaper').newLimitState(at(-60),1,true,true);
 w.start({rulesV2:v,enabled:true,trades:[]},contracts);price(w,-1,'NSE:NIFTY50-INDEX',{ltp:22500});prime(w);
 const processed=reversed?18:24;
 for(let n=0;n<=processed;n++)price(w,n,'NSE:NIFTY50-INDEX',{ltp:n<2||reversed&&n===10?22500:22511});
 const signal={id:'guard-'+reversed,strategyId:'nifty',symbol:'NSE:NIFTY',action:'BUY',timeframe:'1',metadata:{niftyPaper:{kind:'SIGNAL',closedAt:at(0),high:22510,low:22490}}};
 w.setRows([{id:'guard-row',strategy_id:'nifty',received_at:at(processed-1),signal,raw_payload:{automation:{mode:'PAPER'}}}]);w.setTime(processed);await w.poll();
 assert.equal(w.get().state.rulesV2.position,null);assert.equal(w.get().state.rulesV2.setup.lateEntry,true);assert.equal(w.get().decisions.at(-1).status,'LATE_ENTRY_PENDING');
});

function openCurrent() {
 const w=worker('nifty'),v=load('niftyLimitPaper').newLimitState(at(-60),1,true,true);
 v.position={contract:{...contracts[0],at:at(0),bid:99,ask:100,bidSize:5000,askSize:5000},signalId:'storage-open',signalClosedAt:at(-3),receivedAt:at(-2),openedAt:at(-1),entry:100,stop:80,target:200,quantity:65,lots:1,ruleVersion:2,orderType:'LIMIT',entryLimit:104};
 w.start({rulesV2:v,enabled:true,trades:[]},contracts);w.setLease(at(0));prime(w);return w;
}
test('NIFTY retries a rejected signal read without restarting, changing the trade, or losing the underlying error',async()=>{
 const w=openCurrent();w.setTime(1);w.setPollResult({error:{code:'57014',message:'canceling statement due to statement timeout'}});
 await w.startPoll();assert.equal(w.storage().failed,false);assert.equal(w.storage().pollFailures,1);
 assert.equal(w.get().state.position.signalId,'storage-open');assert.equal(w.storage().outer.recoveryIncidents,undefined);
 const diagnostic=w.audit.find(e=>e.data?.type==='TASK_FAILED').data;
 assert.equal(diagnostic.operation,'supabase.signal.poll');assert.equal(diagnostic.error.cause.code,'57014');
 w.setTime(1.5);await w.startPoll();assert.equal(w.ranges.length,1);
 w.setTime(2);w.setPollResult({data:[],error:null});await w.startPoll();assert.equal(w.storage().pollFailures,0);
 price(w,3,'CE',{bid_price:79,ask_price:80,bid_size:5000,ask_size:5000});assert.equal(w.get().state.trades.length,1);assert.equal(w.get().state.trades[0].reason,'PREMIUM_SL');
});
test('NIFTY hanging signal read is single-flight and cannot block heartbeat or fresh-quote stop processing',async()=>{
 const w=openCurrent();let release,calls=0;w.setPollResult(()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 w.setTime(1);const task=w.startPoll();await new Promise(r=>setImmediate(r));w.startPoll();assert.equal(calls,1);
 price(w,3,'NSE:NIFTY50-INDEX',{ltp:22500});price(w,3,'CE',{bid_price:99,ask_price:100,bid_size:5000,ask_size:5000});
 price(w,5,'NSE:NIFTY50-INDEX',{ltp:22500});price(w,5,'CE',{bid_price:99,ask_price:100,bid_size:5000,ask_size:5000});
 w.setPublishResults({data:[{id:'state'}],error:null});w.setTime(5);await w.startPublish();assert.equal(w.lease(),at(5));
 price(w,7,'NSE:NIFTY50-INDEX',{ltp:22500});price(w,7.1,'CE',{bid_price:79,ask_price:80,bid_size:5000,ask_size:5000});
 assert.equal(w.get().state.position,null);assert.equal(w.get().state.trades.length,1);assert.equal(w.storage().outer.recoveryIncidents,undefined);
 release({data:[],error:null});await task;assert.equal(w.get().state.trades.length,1);assert.equal(w.storage().failed,false);
});
test('NIFTY pages a full signal result instead of treating 1000 rows as a crash',async()=>{
 const w=worker('nifty');w.start({rulesV2:load('niftyLimitPaper').newLimitState(at(-60),1,true,true),enabled:true,trades:[]},contracts);
 w.setRows(Array.from({length:1000},(_,i)=>({id:'page-'+i,received_at:at(0),signal:{metadata:{}},raw_payload:{}})));
 await w.poll();assert.equal(w.storage().pollOffset,1000);w.setRows([]);await w.poll();
 assert.deepEqual(w.ranges,[[0,999],[1000,1999]]);assert.equal(w.storage().pollOffset,0);assert.equal(w.storage().failed,false);
});
test('NIFTY reconciles a lost heartbeat response without replacing ownership or restarting',async()=>{
 const w=openCurrent();w.setTime(5);
 w.setPublishResults({error:{message:'response lost'}},value=>({data:{received_at:at(5),worker_id:value.raw_payload.workerId},error:null}));
 await w.startPublish();assert.equal(w.lease(),at(5));assert.equal(w.storage().publishFailures,0);assert.equal(w.storage().failed,false);
});
test('NIFTY cannot continue verified trade processing after a prolonged ownership gap',async()=>{
 const w=openCurrent();w.setTime(11);w.guardOwnership();assert.equal(w.storage().outer.recoveryIncidents.length,1);
 price(w,11,'NSE:NIFTY50-INDEX',{ltp:22500});price(w,11,'CE',{bid_price:70,ask_price:71,bid_size:5000,ask_size:5000});
 assert.ok(w.get().state.position);assert.equal(w.get().state.trades.length,0);
 w.setPublishResults({data:[{id:'state'}],error:null});w.setTime(12);await w.startPublish();
 assert.equal(w.lease(),at(12));price(w,13,'CE',{bid_price:70,ask_price:71,bid_size:5000,ask_size:5000});
 const dashboard=w.paperStatus();assert.equal(dashboard.workerStatus,'RECOVERY_REVIEW_REQUIRED');assert.equal(dashboard.reviewRequired,true);assert.equal(dashboard.position.mark,null);assert.equal(dashboard.feedAt,at(13));
 assert.equal(w.get().state.trades.length,0);
});
test('NIFTY stops on confirmed ownership transfer and does not process another fill',async()=>{
 const w=openCurrent();w.setTime(5);w.setPublishResults({data:[],error:null},{data:{received_at:at(4),worker_id:'another-worker'},error:null});
 await w.startPublish();assert.equal(w.storage().failed,true);price(w,6,'CE',{bid_price:70,ask_price:71,bid_size:5000,ask_size:5000});assert.equal(w.get().state.trades.length,0);
});
for(const alreadyBroken of [false,true])test(`NIFTY records index history during review and accepts the first ${alreadyBroken?'verified late breakout':'future breakout'}`,async()=>{
 const w=openCurrent();w.quarantine(at(0));
 for(let n=1;n<=13;n++){
  w.setLease(at(n));price(w,n,'NSE:NIFTY50-INDEX',{ltp:alreadyBroken&&n>10?22511:22500});
  price(w,n+.1,'CE',{bid_price:70,ask_price:71,bid_size:5000,ask_size:5000});
 }
 assert.equal(w.get().state.trades.length,0);assert.equal(w.get().state.position.signalId,'storage-open');
 const before=w.storage().outer.checkpoint.rulesV2;assert.equal(before.ticks.at(-1).at,at(13.1));assert.equal(before.position.stop,80);assert.equal(before.balance,1000000);
 const sig={id:'after-review',strategyId:'nifty',symbol:'NSE:NIFTY',action:'BUY',timeframe:'1',metadata:{niftyPaper:{kind:'SIGNAL',closedAt:at(10),high:22510,low:22490}}};
 w.setTime(13.2);w.setRows([{id:'after-review-row',received_at:at(13),signal:sig,raw_payload:{automation:{mode:'PAPER'}}}]);await w.poll();
 assert.equal(w.storage().outer.recoveryIncidents[0].status,'EXCLUDED_UNVERIFIED');assert.equal(w.get().decisions.at(-1).status,alreadyBroken?'LATE_ENTRY_PENDING':'WAITING_FOR_INDEX_BREAK');
 price(w,14,'CE',{bid_price:99,ask_price:100,bid_size:5000,ask_size:5000});price(w,14.1,'NSE:NIFTY50-INDEX',{ltp:22511});
 assert.equal(w.get().state.position.signalId,'after-review');assert.equal(w.get().state.position.entry,100);assert.equal(w.get().state.trades.length,0);
});
test('NIFTY still rejects the first independent signal if no fresh prices actually arrived during review',async()=>{
 const w=openCurrent();w.quarantine(at(0));w.setLease(at(13));w.setTime(13);
 const signal={id:'real-feed-gap',strategyId:'nifty',symbol:'NSE:NIFTY',action:'BUY',timeframe:'1',metadata:{niftyPaper:{kind:'SIGNAL',closedAt:at(10),high:22510,low:22490}}};
 w.setRows([{id:'real-gap-row',received_at:at(13),signal,raw_payload:{automation:{mode:'PAPER'}}}]);await w.poll();
 assert.equal(w.get().decisions.at(-1).status,'UNVERIFIABLE_BREAKOUT_HISTORY');assert.equal(w.get().state.position,null);assert.equal(w.get().state.trades.length,0);
});
