const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const core=load('niftyLimitPaper'),hams=load('hamsLimitAdapter'),{emptyHamsState}=load('hamsFinalPaper');
const at=n=>new Date(Date.parse('2026-10-30T04:00:00Z')+n*1000).toISOString();
const q=(side,t,ask=100,size=20000)=>({id:side,side,expiry:'2026-11-03',strike:22500,lotSize:65,at:at(t),bid:ask-1,ask,bidSize:size,askSize:size});
const sig=(action='BUY',received=17)=>({id:'grace-'+action,action,closedAt:at(0),receivedAt:at(received),high:22510,low:22490,interval:3});
function initial(){return {...emptyHamsState(),enabled:true,balance:1000000,rulesV2:core.newLimitState(at(-60),3,false,true)};}
function tick(s,t,spot=22511,ask=100,size=20000){return hams.markHamsLimit(s,{at:at(t),spot,chain:[q('CE',t,ask,size),q('PE',t,ask,size)]});}
function history(action='BUY',end=18,skip=()=>false){let s=initial();for(let n=-1;n<=end;n++){if(skip(n))continue;s=tick(s,n,n<2?22500:action==='BUY'?22511:22489);}return s;}
for(const action of ['BUY','SELL'])test(`HAMS late ${action} fills current premium inside grace, not historical breakout price`,()=>{
 let s=hams.receiveHamsLimit(history(action),sig(action),at(18));assert.equal(s.status,'BREAKOUT_GRACE_ACTIVE');assert.equal(s.position,null);assert.equal(s.rulesV2.setup.breakoutAt,at(2));assert.equal(s.rulesV2.setup.breakoutDeadline,at(22));
 s=tick(s,18.1,action==='BUY'?22511:22489,120);assert.equal(s.position.entry,120);assert.equal(s.position.openedAt,at(18.1));assert.equal(s.position.orderType,'LIMIT');assert.equal(s.position.entryLimit,124);assert.equal(s.position.stop,100);assert.equal(s.position.target,220);assert.equal(s.position.contract.side,action==='BUY'?'CE':'PE');assert.equal(s.position.breakoutTimePrecision,'SECOND_BUCKET');
});
test('older-than-20-second breakout and processing delayed beyond the deadline are rejected',()=>{
 for(const received of [17,22]){const s=hams.receiveHamsLimit(history('BUY',23),sig('BUY',received),at(23));assert.equal(s.position,null);assert.equal(s.rulesV2.setup,null);assert.equal(s.status,'MISSED_BREAKOUT');assert.match(s.rulesV2.decisions.at(-1).reason,/20-second/);}
});
test('20-second deadline includes its boundary and never expands to accommodate depth waiting',()=>{
 let s=hams.receiveHamsLimit(history('BUY',21),sig('BUY',21),at(21.9));s=tick(s,22,22511);assert.ok(s.position);
 s=hams.receiveHamsLimit(history('BUY',21),sig('BUY',21),at(21.2));s=tick(s,21.3,22511,100,1);assert.equal(s.status,'WAITING_FOR_ENTRY_DEPTH');s=tick(s,22.001,22511,100);assert.equal(s.position,null);assert.equal(s.status,'BREAKOUT_GRACE_EXPIRED');
});
test('compacted first-break bucket uses its start so late bucket timestamps cannot extend grace',()=>{
 let s=history('BUY',22);s.rulesV2.ticks=s.rulesV2.ticks.map(t=>t.at===at(2)?{...t,at:at(2.999)}:t);
 s=hams.receiveHamsLimit(s,sig('BUY',22),at(22.5));assert.equal(s.status,'MISSED_BREAKOUT');
});
test('missing baseline, delivery-period observation gaps and stale latest index block late entry',()=>{
 for(const s of [history('BUY',18,n=>n===-1),history('BUY',18,n=>n>=5&&n<=12),history('BUY',10)]){
  const result=hams.receiveHamsLimit(s,sig(),at(18));assert.equal(result.status,'UNVERIFIABLE_BREAKOUT_HISTORY');assert.equal(result.position,null);
 }
});
test('recorded reversal, including a later recross, cannot restart the first-break grace timer',()=>{
 let s=history();s=tick(s,18.1,22500);assert.equal(hams.receiveHamsLimit(s,sig(),at(18.2)).status,'BREAKOUT_REVERSED');
 s=tick(s,19,22511);assert.equal(hams.receiveHamsLimit(s,sig(),at(19.1)).status,'BREAKOUT_REVERSED');
});
test('deadline survives JSON checkpoint restart and duplicate signals do not recreate an entry',()=>{
 let s=hams.receiveHamsLimit(history(),sig(),at(18));s=JSON.parse(JSON.stringify(s));s=tick(s,22.1,22511);assert.equal(s.status,'BREAKOUT_GRACE_EXPIRED');assert.equal(s.position,null);s=hams.receiveHamsLimit(s,sig(),at(22.2));assert.equal(s.rulesV2.setup,null);
});
test('an older triggered checkpoint without a grace timestamp cannot bypass the twenty-second rule',()=>{
 const s=history();s.rulesV2.setup={...sig(),triggered:true};const result=tick(s,19,22511);assert.equal(result.position,null);assert.equal(result.rulesV2.setup,null);assert.equal(result.status,'UNVERIFIABLE_BREAKOUT_HISTORY');
});
test('HAMS still waits ten candles for a future breakout; grace begins at the breakout, not signal close',()=>{
 let s=tick(initial(),0,22500);s=hams.receiveHamsLimit(s,sig('BUY',1),at(1));assert.equal(s.status,'WAITING_FOR_INDEX_BREAK');s=tick(s,99,22500);s=tick(s,100,22511);assert.ok(s.position);assert.equal(s.position.breakoutAt,at(100));assert.equal(s.position.breakoutDeadline,at(120));assert.equal(s.position.breakoutTimePrecision,'OBSERVED_TICK');
});
test('HAMS late entry still requires full observed limit depth, session and ten-candle eligibility',()=>{
 let s=hams.receiveHamsLimit(history(),sig(),at(18));s=tick(s,18.1,22511,100,1);s=tick(s,19.7,22511,100,1);assert.equal(s.position,null);assert.equal(s.status,'ENTRY_LIMIT_UNFILLED');
 s=hams.receiveHamsLimit(history(),{...sig(),closedAt:at(-1801)},at(18));assert.equal(s.status,'SETUP_EXPIRED');
});
test('current NIFTY keeps strict missed-breakout behavior even with the identical fresh history',()=>{
 const s=history().rulesV2;s.interval=1;s.rangeFilter=true;const result=core.receiveLimitSignal(s,{...sig(),interval:1},at(18));assert.equal(result.status,'MISSED_BREAKOUT');assert.equal(result.setup,null);
});
test('HAMS can wait for a fresh premium inside grace without resetting its deadline',()=>{
 let s=hams.receiveHamsLimit(history(),sig(),at(18));s=hams.markHamsLimit(s,{at:at(18.1),spot:22511,chain:[]});assert.equal(s.status,'WAITING_FOR_FRESH_ATM_QUOTE');assert.equal(s.rulesV2.setup.breakoutDeadline,at(22));s=tick(s,19,22511,125);assert.equal(s.position.entry,125);
});
test('a reversal before the grace fill cannot close an existing opposite position',()=>{
 let s=history('SELL');const p={contract:q('CE',18),signalId:'held',signalClosedAt:at(-30),receivedAt:at(-29),openedAt:at(-28),entry:100,stop:80,target:200,quantity:65,lots:1,ruleVersion:2,orderType:'LIMIT',entryLimit:104};s.position=p;s.rulesV2.position=p;
 s=hams.receiveHamsLimit(s,sig('SELL'),at(18));s=tick(s,18.1,22500);assert.equal(s.position.signalId,'held');assert.equal(s.trades.length,0);assert.equal(s.rulesV2.setup,null);
});
