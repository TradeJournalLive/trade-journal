const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const {recoverySizing,newLimitState,optionCosts,markLimitPaper,receiveLimitSignal}=load('niftyLimitPaper');
const state=(balance=1000000,last=0,nextLots=1)=>({...newLimitState('2026-11-03T04:00:00Z',1,true,true),balance,nextLots,trades:last?[{pnl:last}]:[]});
test('loss sizing uses larger negative amount, never their sum',()=>{
 const r=recoverySizing(state(990000,-4000,2),100,65);assert.equal(r.lossToRecover,10000);assert.equal(r.recoveryLots,2);assert.equal(r.selectedLots,2);
 assert.equal(recoverySizing(state(999000,-10000),100,65).lossToRecover,10000);
});
test('last loss takes priority even with positive lifetime P&L, and positive last trade does not erase overall loss',()=>{
 assert.equal(recoverySizing(state(1010000,-9000),100,65).recoveryLots,2);
 assert.equal(recoverySizing(state(990000,1000),100,65).recoveryLots,2);
 const r=recoverySizing(state(1010000,1000,1),100,65);assert.equal(r.lossToRecover,0);assert.equal(r.selectedLots,1);
});
test('existing lots are a floor, not replaced by smaller recovery sizing',()=>{
 const r=recoverySizing(state(999000,-1000,6),100,65);assert.equal(r.recoveryLots,1);assert.equal(r.selectedLots,6);
});
test('net target includes total charges, rounds lots up and uses actual premium and contract size',()=>{
 const s=state(993500,-6500),r=recoverySizing(s,100,65);assert.equal(r.recoveryLots,2);
 const cheap=recoverySizing(state(990000,-10000),40,65);assert.equal(cheap.recoveryLots,4);
 const different=recoverySizing(state(993500,-6500),100,25);assert.equal(different.recoveryLots,3);
 assert.ok(r.estimatedTargetNet>=r.lossToRecover);assert.ok(100*65-optionCosts(100,200,65).total<r.lossToRecover);
});
test('limit range estimate is conservative and invalid inputs cannot produce orders',()=>{
 const s=state(950000,-50000,2),r=recoverySizing(s,95,65,104);assert.equal(r.selectedLots,9);
 for(const price of [95,98,100,102,104]){const q=r.selectedLots*65,target=Math.round((price+Math.min(100,price))*100)/100;assert.ok((target-price)*q-optionCosts(price,target,q).total>=r.lossToRecover);}
 assert.equal(recoverySizing(s,100,0),null);assert.equal(recoverySizing({...s,balance:NaN},100,65),null);assert.equal(recoverySizing(s,0.001,65),null);
});
const at=n=>new Date(Date.parse('2026-11-03T04:00:00Z')+n*1000).toISOString();
const quote=(n)=>({id:'CE',side:'CE',expiry:'2026-11-03',strike:22500,lotSize:65,at:at(n),bid:99,ask:100,bidSize:50000,askSize:50000});
for(const hams of [false,true])test(`${hams?'HAMS':'Current'} entry uses recovery floor and keeps sizing evidence through checkpoint roundtrip`,()=>{
 let s={...newLimitState(at(-60),hams?3:1,!hams,true),balance:950000,nextLots:2,trades:[{pnl:-50000}]};
 s=markLimitPaper(s,{at:at(0),spot:22500,chain:[]});
 s=receiveLimitSignal(s,{id:'recovery',action:'BUY',closedAt:at(0),receivedAt:at(1),high:22510,low:22490,interval:hams?3:1},at(1),20000);
 s=markLimitPaper(s,{at:at(2),spot:22511,chain:[quote(2)]},20000);
 assert.equal(s.position.lots,8);assert.equal(s.position.quantity,520);assert.equal(s.position.sizing.baseLots,2);assert.equal(s.position.sizing.lossToRecover,50000);assert.equal(s.position.orderType,'LIMIT');
 const recovered=JSON.parse(JSON.stringify(s));assert.deepEqual(recovered.position.sizing,s.position.sizing);assert.equal(recoverySizing(recovered,100,65).selectedLots,8);
});
test('unaffordable recovery size skips rather than shrinking lots or assuming a fill',()=>{
 let s={...newLimitState(at(-60),1,true,true),balance:1000,nextLots:2,trades:[{pnl:-999000}]};
 s=markLimitPaper(s,{at:at(0),spot:22500,chain:[]});s=receiveLimitSignal(s,{id:'cash',action:'BUY',closedAt:at(0),receivedAt:at(1),high:22510,low:22490,interval:1});
 s=markLimitPaper(s,{at:at(2),spot:22511,chain:[quote(2)]});assert.equal(s.position,null);assert.equal(s.status,'INSUFFICIENT_VIRTUAL_CAPITAL');assert.equal(s.nextLots,2);assert.equal(s.balance,1000);
});
test('same-tick opposite reversal sizes from the just-closed net trade, not stale P&L',()=>{
 let s=newLimitState(at(-60),1,true,true);s=markLimitPaper(s,{at:at(0),spot:22500,chain:[]});s=receiveLimitSignal(s,{id:'first',action:'BUY',closedAt:at(0),receivedAt:at(1),high:22510,low:22490,interval:1});s=markLimitPaper(s,{at:at(2),spot:22511,chain:[quote(2)]});
 s.balance=950000;s=markLimitPaper(s,{at:at(3),spot:22511,chain:[quote(3)]});s=receiveLimitSignal(s,{id:'reverse',action:'SELL',closedAt:at(3),receivedAt:at(3),high:22520,low:22500,interval:1});
 s=markLimitPaper(s,{at:at(4),spot:22499,chain:[quote(4),{...quote(4),id:'PE',side:'PE'}]});
 assert.equal(s.trades.length,1);assert.equal(s.position.contract.side,'PE');assert.ok(s.position.sizing.lossToRecover>50000);assert.equal(s.position.sizing.baseLots,2);assert.equal(s.position.lots,8);
});
test('HAMS durable recovery progresses from actual recovery-sized lots, not the old floor',()=>{
 let s={...newLimitState(at(-60),3,false,true),balance:950000,nextLots:2,trades:[]};
 s=markLimitPaper(s,{at:at(0),spot:22500,chain:[]});s=receiveLimitSignal(s,{id:'hams-recovery',action:'BUY',closedAt:at(0),receivedAt:at(1),high:22510,low:22490,interval:3});s=markLimitPaper(s,{at:at(2),spot:22511,chain:[quote(2)]});
 assert.equal(s.position.lots,8);s=markLimitPaper(s,{at:at(3),spot:22511,chain:[{...quote(3),bid:79,ask:80}]});
 const trade=s.trades[0];assert.equal(s.nextLots,9);
 const {hamsRecoveryView}=load('hamsHistory'),{emptyHamsState}=load('hamsFinalPaper');
 const restored=hamsRecoveryView({...emptyHamsState(),enabled:true,rulesV2:newLimitState(at(-60),3,false,true)},[],[{id:'trade',type:'TRADE',at:trade.closedAt,value:trade}]);
 assert.equal(restored.state.nextLots,9);assert.equal(restored.state.rulesV2.nextLots,9);assert.deepEqual(restored.state.trades[0].sizing,trade.sizing);
});
