const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const core=load('niftyLimitPaper'),{hashEmergencyAnswer,verifyEmergencyAnswers,validEmergencyAnswers}=load('emergencySecurity');
const at=n=>new Date(Date.parse('2026-10-30T04:00:00Z')+n*1000).toISOString();
const q=(n,bid=100,size=65)=>({id:'CE',side:'CE',strike:22500,expiry:'2026-11-03',lotSize:65,at:at(n),bid,ask:bid+1,bidSize:size,askSize:size});
function opened(){let s=core.newLimitState(at(-60),1,true,true);s=core.markLimitPaper(s,{at:at(0),spot:22500,chain:[]});s=core.receiveLimitSignal(s,{id:'buy',closedAt:at(0),receivedAt:at(1),action:'BUY',high:22510,low:22490,interval:1});return core.markLimitPaper(s,{at:at(2),spot:22511,chain:[q(2)]});}
test('emergency cancels setups, disarms entries, waits for a verified market paper exit',()=>{
 let s=core.requestNiftyEmergency(opened(),'kill-1',at(3));assert.equal(s.enabled,false);assert.equal(s.setup,null);assert.equal(s.status,'EMERGENCY_MARKET_EXIT_PENDING');assert.ok(s.position);
 const lastIndex=s.ticks.at(-1).at;
 s=core.markLimitPaper(s,{at:at(4),spot:22511,chain:[]});assert.ok(s.position);assert.equal(s.trades.length,0);assert.equal(s.ticks.at(-1).at,lastIndex);
 s=core.markLimitPaper(s,{at:at(5),spot:22511,chain:[q(5,90)]});assert.equal(s.position,null);assert.equal(s.trades[0].exit,90);assert.equal(s.trades[0].exitOrderType,'MARKET');assert.equal(s.trades[0].reason,'EMERGENCY_MARKET_EXIT');assert.equal(s.status,'EMERGENCY_STOPPED');assert.equal(s.enabled,false);assert.equal(s.nextLots,2);
 assert.deepEqual(core.requestNiftyEmergency(s,'kill-1',at(6)),s);
});
test('emergency overrides an unfilled normal limit and sweeps bids beyond four rupees',()=>{
 let s=opened();s.pendingExit={reason:'PREMIUM_SL',limit:96};s=core.requestNiftyEmergency(s,'kill',at(3));
 const quote={...q(4,90,10),depthAt:at(4),bids:[{price:90,quantity:10},{price:80,quantity:55}],asks:[{price:91,quantity:65}]};
 s=core.markLimitPaper(s,{at:at(4),spot:22511,chain:[quote]});assert.equal(s.position,null);assert.equal(s.trades[0].exit,(900+4400)/65);assert.equal(s.trades[0].exitLimit,0);
});
test('stale quotes and insufficient depth never produce a fabricated market fill',()=>{
 let s=core.requestNiftyEmergency(opened(),'kill',at(3));s=core.markLimitPaper(s,{at:at(10),spot:22511,chain:[q(2,90)]});assert.ok(s.position);
 s=core.markLimitPaper(s,{at:at(11),spot:22511,chain:[q(11,90,1)]});assert.ok(s.position);assert.equal(s.trades.length,0);assert.equal(s.status,'EMERGENCY_MARKET_EXIT_PENDING');
});
test('flat emergency stop does not create a trade or reset carried size',()=>{
 let s=core.newLimitState(at(0),3,false,true);s.nextLots=28;s=core.requestNiftyEmergency(s,'kill',at(1));assert.equal(s.nextLots,28);assert.equal(s.trades.length,0);assert.equal(s.status,'EMERGENCY_STOPPED');assert.equal(s.enabled,false);
});
test('lot progression exceeds twenty and is preserved on the next trading day',()=>{
 let s=opened();s.position.lots=28;s.nextLots=28;s=core.markLimitPaper(s,{at:at(3),spot:22511,chain:[q(3,79)]});assert.equal(s.nextLots,29);
 s=core.markLimitPaper(JSON.parse(JSON.stringify(s)),{at:'2026-11-02T04:00:00Z',spot:22500,chain:[]});assert.equal(s.nextLots,29);
});
test('HAMS recovery restores uncapped sizing from durable trades',()=>{
 const {hamsRecoveryView}=load('hamsHistory'),{emptyHamsState}=load('hamsFinalPaper');const state=emptyHamsState();state.rulesV2=core.newLimitState(at(0),3,false,true);
 const t={...opened().position,lots:27,exit:80,closedAt:at(3),reason:'PREMIUM_SL',pnl:-100,grossPnl:-90,costs:{total:10},exitLimit:76};
 const restored=hamsRecoveryView(state,[],[{id:'trade',type:'TRADE',at:at(3),value:t}]);assert.equal(restored.state.nextLots,28);assert.equal(restored.state.rulesV2.nextLots,28);
});
test('durable HAMS journal accepts sizes above twenty only for the new-rule engine',()=>{
 const {selectSnapshot}=require('../scripts/hams-journal.cjs');const state=load('hamsFinalPaper').emptyHamsState();state.nextLots=28;state.rulesV2=core.newLimitState(at(0),3,false,true);state.rulesV2.nextLots=28;
 const saved={owner:'fixture',state,decisions:[],savedAt:at(0)};assert.equal(selectSnapshot([saved],'fixture').state.nextLots,28);delete state.rulesV2;assert.throws(()=>selectSnapshot([saved],'fixture'),/INVALID_SAVED_STATE/);
});
test('security answers use salted hashes and both must match',async()=>{
 const a=['private phrase one','private phrase two'],stored=await Promise.all(a.map(hashEmergencyAnswer));assert.notEqual(stored[0].hash,(await hashEmergencyAnswer(a[0])).hash);assert.equal(await verifyEmergencyAnswers(a,stored),true);assert.equal(await verifyEmergencyAnswers([a[0],'incorrect answer'],stored),false);assert.equal(await verifyEmergencyAnswers([' PRIVATE PHRASE ONE ',a[1]],stored),true);assert.equal(validEmergencyAnswers(['short','short']),false);assert.equal(validEmergencyAnswers(['same answer','SAME ANSWER']),false);
});
