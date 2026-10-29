const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const {newLimitState,markLimitPaper,receiveLimitSignal,limitFill,optionCosts}=load('niftyLimitPaper');
const at=n=>new Date(Date.parse('2026-10-29T04:00:00Z')+n*1000).toISOString();
const quote=(side,t,bid=99,ask=100,size=5000)=>({id:side,side,expiry:'2026-11-03',strike:22500,lotSize:65,at:at(t),bid,ask,bidSize:size,askSize:size});
const tick=(s,t,spot=22500,bid=99,ask=100)=>markLimitPaper(s,{at:at(t),spot,chain:[quote('CE',t,bid,ask),quote('PE',t,bid,ask)]});
const signal=(action='BUY',id='buy',t=1,interval=1,high=22510,low=22490)=>({id,action,receivedAt:at(t),closedAt:at(0),high,low,interval});
function ready(interval=1,filter=true){return tick(newLimitState(at(-60),interval,filter,true),0);}
function opened(){return tick(receiveLimitSignal(ready(),signal()),2,22511);}
test('ATM limit breakout entry, new premium stop/target and ten-lakh capital',()=>{
 const s=opened();assert.equal(s.position.contract.id,'CE');assert.equal(s.position.entry,100);assert.equal(s.position.stop,80);assert.equal(s.position.target,200);assert.equal(s.position.orderType,'LIMIT');assert.equal(s.position.entryLimit,104);assert.equal(s.balance,1000000);
});
test('sell requires index low break, not the signal receipt',()=>{let s=receiveLimitSignal(ready(),signal('SELL'));assert.equal(s.position,null);s=tick(s,2,22489);assert.equal(s.position.contract.side,'PE');});
test('25 percent stop and 100 percent target apply to cheap premiums',()=>{const s=tick(receiveLimitSignal(ready(),signal()),2,22511,39,40);assert.equal(s.position.stop,30);assert.equal(s.position.target,80);});
test('35-point filter only applies to current NIFTY; HAMS uses 3-minute breakout',()=>{
 let s=receiveLimitSignal(ready(),signal('BUY','large',1,1,22530,22490));assert.equal(s.status,'CANDLE_RANGE_EXCEEDED');
 s=receiveLimitSignal(ready(3,false),signal('BUY','large',1,3,22530,22490));s=tick(s,2,22531);assert.equal(s.position.contract.side,'CE');
});
test('no completed 15-minute candle gate; 09:17 is allowed, 14:50 blocked',()=>{
 const start='2026-10-29T03:47:00Z',before='2026-10-29T03:46:59Z';let s=newLimitState(before,1,true,true);s=markLimitPaper(s,{at:start,spot:22500,chain:[]});
 s=receiveLimitSignal(s,{...signal(),closedAt:start,receivedAt:start});assert.equal(s.status,'WAITING_FOR_INDEX_BREAK');
 s=receiveLimitSignal(s,{...signal('BUY','late'),closedAt:'2026-10-29T09:20:00Z',receivedAt:'2026-10-29T09:20:01Z'});assert.equal(s.status,'SETUP_EXPIRED');
});
test('breakout validity ends after ten signal-timeframe candles',()=>{
 for(const interval of [1,3]){let s=receiveLimitSignal(ready(interval,false),signal('BUY','s',1,interval));s=tick(s,interval*600,22511);assert.equal(s.position,null);assert.equal(s.status,'SETUP_EXPIRED');}
});
test('already broken before delivery and missing history never become late entries',()=>{
 let s=tick(ready(),1,22511);s=receiveLimitSignal(s,signal('BUY','late',2));assert.equal(s.status,'MISSED_BREAKOUT');
 s=receiveLimitSignal(newLimitState(at(-1),1,true,true),signal());assert.equal(s.status,'UNVERIFIABLE_BREAKOUT_HISTORY');
});
test('opposite signal alone does not exit; opposite breakout closes then reverses at updated size',()=>{
 let s=tick(opened(),3,22511);s=receiveLimitSignal(s,{...signal('SELL','reverse',3),closedAt:at(3),high:22520,low:22500});assert.equal(s.pendingExit,null);assert.equal(s.position.contract.side,'CE');
 s=tick(s,4,22499,99,100);assert.equal(s.trades.length,1);assert.equal(s.trades[0].reason,'OPPOSITE_BREAKOUT');assert.equal(s.position.contract.side,'PE');assert.equal(s.position.lots,2);assert.ok(s.trades[0].costs.total>40);
});
test('unfilled exit cannot open opposite side or re-anchor beyond original bid minus four',()=>{
 let s=tick(opened(),3,22511);s=receiveLimitSignal(s,{...signal('SELL','reverse',3),closedAt:at(3),high:22520,low:22500});
 s=markLimitPaper(s,{at:at(4),spot:22499,chain:[quote('CE',4,99,100,1),quote('PE',4)]});assert.equal(s.status,'EXIT_LIMIT_UNFILLED');assert.equal(s.position.contract.side,'CE');assert.equal(s.pendingExit.limit,95);
 s=tick(s,5,22498,90,91);assert.equal(s.position.contract.side,'CE');assert.equal(s.trades.length,0);assert.equal(s.pendingExit.limit,95);
});
test('stop exits use observed bounded bid depth; losses increment, profitable cumulative net resets',()=>{
 let s=tick(opened(),3,22512,79,80);assert.equal(s.position,null);assert.equal(s.trades[0].reason,'PREMIUM_SL');assert.equal(s.nextLots,2);
 s=opened();s=tick(s,3,22512,200,201);assert.equal(s.trades[0].reason,'PREMIUM_TARGET');assert.equal(s.nextLots,1);assert.ok(s.trades[0].pnl<s.trades[0].grossPnl);
 s=opened();s.position.lots=20;s.nextLots=20;s=tick(s,3,22512,79,80);assert.equal(s.nextLots,20);
 s=opened();s.balance=999000;s=tick(s,3,22512,101,102);s.pendingExit={reason:'OPPOSITE_BREAKOUT',limit:97};s=tick(s,4,22512,101,102);assert.equal(s.nextLots,2);
});
test('time exit at 14:50, no market fallback',()=>{const s=markLimitPaper(opened(),{at:'2026-10-29T09:20:00Z',spot:22500,chain:[{...quote('CE',0),at:'2026-10-29T09:20:00Z'}]});assert.equal(s.trades[0].reason,'TIME_EXIT');assert.equal(s.position,null);});
test('no trailing stop changes despite favorable index or premium moves',()=>{const s=tick(opened(),3,22600,150,151);assert.equal(s.position.stop,80);});
test('limit depth never invents missing quantity or crosses a specified price cap',()=>{
 const q={...quote('CE',2),depthAt:at(2),asks:[{price:100,quantity:30},{price:104,quantity:35}],bids:[{price:99,quantity:30},{price:95,quantity:35}]};
 assert.ok(limitFill(q,65,'BUY',104,at(2)));assert.equal(limitFill(q,65,'BUY',103,at(2)),null);assert.ok(limitFill(q,65,'SELL',95,at(2)));assert.equal(limitFill(q,65,'SELL',96,at(2)),null);
});
test('cost calculation includes sell STT, buy stamp duty, brokerage and taxable fees',()=>{const c=optionCosts(100,200,65);assert.equal(c.brokerage,40);assert.equal(c.stt,19.5);assert.equal(c.stamp,0.195);assert.ok(c.gst>7.2);});
test('current NIFTY adapter preserves legacy accounting and does not double-count v2 results across heartbeats',()=>{
 const {buildNiftyLimitPaper}=load('niftyLimitAdapter');
 const s=tick(opened(),3,22512,200,201);
 const cp={enabled:true,rulesV2:s,trades:[],realizedBase:123,tradeCountBase:4};
 const first=buildNiftyLimitPaper([],at(4),cp),again=buildNiftyLimitPaper([],at(5),first.checkpoint);
 assert.equal(first.realized,123+s.trades[0].pnl);assert.equal(again.realized,first.realized);assert.equal(again.tradeCount,5);assert.equal(again.balance,s.balance);
 assert.throws(()=>buildNiftyLimitPaper([],at(4),{position:{id:'old'}}),/FLAT_POSITION/);
});
test('HAMS adapter uses independent 3-minute unlimited-range state, retains legacy trades and toggle semantics',()=>{
 const {initializeHamsLimits,receiveHamsLimit,markHamsLimit}=load('hamsLimitAdapter');const {emptyHamsState,setHamsEnabled}=load('hamsFinalPaper');
 const legacy={signalId:'old',pnl:5};let s=initializeHamsLimits({...emptyHamsState(),enabled:true,trades:[legacy]},at(-60));
 s=markHamsLimit(s,{at:at(0),spot:22500,chain:[quote('CE',0),quote('PE',0)]});
 s=receiveHamsLimit(s,signal('BUY','hams',1,3,22530,22490));
 const paused=setHamsEnabled(s,false);assert.equal(paused.rulesV2.setup,null);
 s=markHamsLimit(s,{at:at(2),spot:22531,chain:[quote('CE',2),quote('PE',2)]});assert.equal(s.position.contract.id,'CE');assert.equal(s.rulesV2.interval,3);assert.equal(s.balance,1000000);assert.equal(s.trades[0].signalId,'old');
});
test('duplicate signal and pre-upgrade alerts cannot create new positions',()=>{const s=opened();assert.equal(receiveLimitSignal(s,signal()).trades.length,0);const late=receiveLimitSignal(ready(),{...signal(),closedAt:at(-120)});assert.equal(late.position,null);assert.equal(late.status,'SETUP_EXPIRED');});
test('HAMS durable v2 ledger restores net capital and lot progression ahead of an older heartbeat',()=>{
 const {hamsRecoveryView}=load('hamsHistory'),{emptyHamsState}=load('hamsFinalPaper');const v=tick(opened(),3,22512,79,80),trade=v.trades[0];
 const saved={...emptyHamsState(),rulesV2:newLimitState(at(-60),3,false,true),enabled:true,balance:1000000};
 const view=hamsRecoveryView(saved,[],[{id:'closed',type:'TRADE',at:trade.closedAt,value:trade}]);
 assert.equal(view.state.balance,1000000+trade.pnl);assert.equal(view.state.nextLots,2);assert.equal(view.state.rulesV2.trades.length,1);assert.equal(view.state.rulesV2.balance,view.state.balance);
});
