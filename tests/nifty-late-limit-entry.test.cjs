const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const f=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(f,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);return m.exports;}
const core=load('niftyLimitPaper'),hams=load('hamsLimitAdapter'),current=load('niftyLimitAdapter'),{emptyHamsState}=load('hamsFinalPaper');
const at=n=>new Date(Date.parse('2026-11-05T04:00:00Z')+n*1000).toISOString();
const quote=(side,t,ask=130,asks)=>({id:side,side,strike:22500,expiry:'2026-11-09',lotSize:65,at:at(t),timestamp:at(t),bid:ask-1,ask,bidSize:10000,askSize:10000,...(asks?{asks,depthAt:at(t)}:{})});
function state(interval,action='BUY'){const s=core.newLimitState(at(-60),interval,interval===1,true);s.nextLots=2;for(let n=-1;n<=30;n++)s.ticks.push({at:at(n),price:n<2?22500:action==='BUY'?22511:22489});return s;}
const signal=(interval,action='BUY')=>({id:`late-${interval}-${action}`,action,closedAt:at(0),receivedAt:at(29),high:22510,low:22490,interval});
function receive(interval,sig=signal(interval),s=state(interval,sig.action)){
 if(interval===3)return hams.receiveHamsLimit({...emptyHamsState(),enabled:true,balance:s.balance,rulesV2:s},sig,at(30)).rulesV2;
 const e={receivedAt:sig.receivedAt,signal:{id:sig.id,symbol:'NSE:NIFTY',action:sig.action,timeframe:'1',metadata:{niftyPaper:{kind:'SIGNAL',closedAt:sig.closedAt,high:sig.high,low:sig.low}}},raw:{automation:{mode:'PAPER'}}};
 return current.buildNiftyLimitPaper([e],at(30),{enabled:true,trades:[],rulesV2:s}).checkpoint.rulesV2;
}
for(const interval of [1,3])for(const action of ['BUY','SELL'])test(`${interval}m ${action} late breakout fills current premium, only within ask +4`,()=>{
 let s=receive(interval,signal(interval,action));assert.equal(s.setup.lateEntry,true);assert.equal(s.position,null);
 const side=action==='BUY'?'CE':'PE';s=core.markLimitPaper(s,{at:at(30.1),spot:action==='BUY'?22511:22489,chain:[quote(side,30.1,130,[{price:130,quantity:65},{price:134,quantity:65}])]},20000,true);
 assert.equal(s.position.entry,132);assert.equal(s.position.entryLimit,134);assert.equal(s.position.orderType,'LIMIT');assert.equal(s.position.stop,112);assert.equal(s.position.target,232);assert.equal(s.position.lateEntry,true);assert.match(s.decisions.at(-1).reason,/\(Entered late\)/);
});
test('late limit never chases a moving ask or fabricates missing depth',()=>{
 let s=receive(1);s=core.markLimitPaper(s,{at:at(30.1),spot:22511,chain:[quote('CE',30.1,130,[{price:130,quantity:65},{price:135,quantity:65}])]},20000,true);assert.equal(s.position,null);assert.equal(s.setup.attempt.reference,130);
 s=core.markLimitPaper(s,{at:at(31.7),spot:22511,chain:[quote('CE',31.7,135,[{price:135,quantity:130}])]},20000,true);assert.equal(s.position,null);assert.equal(s.setup,null);assert.equal(s.status,'ENTRY_LIMIT_UNFILLED');
});
test('normal breakout still anchors the same ask +4 limit without a late label',()=>{
 let s=state(1);s.ticks=s.ticks.map(t=>({...t,price:22500}));s=receive(1,signal(1),s);assert.equal(s.setup.triggered,undefined);
 s=core.markLimitPaper(s,{at:at(31),spot:22511,chain:[quote('CE',31,100)]},20000,true);assert.equal(s.position.entryLimit,104);assert.equal(s.position.lateEntry,undefined);
});
test('expiry, stale quotes, unknown history and reversal remain guarded',()=>{
 let s=receive(1);s=core.markLimitPaper(s,{at:at(600),spot:22511,chain:[quote('CE',600)]},20000,true);assert.equal(s.position,null);assert.equal(s.status,'SETUP_EXPIRED');
 s=receive(3);s=core.markLimitPaper(s,{at:at(30.1),spot:22511,chain:[quote('CE',20)]},20000,true);assert.equal(s.position,null);
 const unknown=state(1);unknown.ticks=unknown.ticks.filter(t=>Date.parse(t.at)>=Date.parse(at(0)));assert.equal(receive(1,signal(1),unknown).status,'UNVERIFIABLE_BREAKOUT_HISTORY');
 s=receive(3);s=core.markLimitPaper(s,{at:at(30.1),spot:22500,chain:[quote('CE',30.1)]},20000,true);assert.equal(s.position,null);assert.equal(s.setup,null);
});
