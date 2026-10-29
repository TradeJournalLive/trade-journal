const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const file=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(file,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const {isolateHamsSignal}=load('hamsSignal');
test('HAMS strips legacy triggers and LIVE flags while retaining its own candle',()=>{
  const p={strategyId:'nifty_hams_final_3m_v1',symbol:'NSE:NIFTY',timeframe:'3',action:'BUY',automation:{mode:'LIVE',enabled:true},metadata:{niftyPaper:{},btcPaper:{},paperBarOpen:true,hamsFinalPaper:{kind:'SIGNAL',high:'200',low:'190',barOpen:'2026-10-28T04:27:00Z'}}};
  const r=isolateHamsSignal(p);assert.equal(r.automation.enabled,false);assert.equal(r.automation.mode,'PAPER');
  assert.equal(r.metadata.niftyPaper,undefined);assert.equal(r.metadata.btcPaper,undefined);assert.equal(r.metadata.paperBarOpen,undefined);
  assert.equal(r.metadata.hamsFinalPaper.closedAt,'2026-10-28T04:30:00.000Z');assert.equal(p.automation.mode,'LIVE');
  assert.throws(()=>isolateHamsSignal({...p,timeframe:'1'}));
});
test('existing signals are unchanged and foreign strategies cannot submit HAMS data',()=>{
  const p={strategyId:'nifty_breakout_options_v1',metadata:{niftyPaper:{kind:'SIGNAL'}}};assert.equal(isolateHamsSignal(p),p);
  assert.throws(()=>isolateHamsSignal({...p,metadata:{hamsFinalPaper:{}}}));
});
function route(secret='account-a',origin=true){
  const filters=[], file=path.resolve(__dirname,'../app/api/algo/hams-final/route.ts'),m=new Module(file,module);
  const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){return {data:null,error:null};},async insert(){return {error:null};}};
  m.require=id=>id==='next/server'?{NextResponse:{json:(body,init={})=>({body,status:init.status||200,headers:init.headers})}}:id.endsWith('/connection')?{connectionSecret:async()=>secret,sameOrigin:()=>origin}:id.endsWith('/signalStore')?{getServerSupabase:()=>({from:()=>query}),hashWebhookSecret:s=>`hash:${s}`}:id.endsWith('/hamsHistory')?{...load('hamsHistory'),loadHamsRecords:async()=>[]}:id.endsWith('/hamsFinalPaper')?load('hamsFinalPaper'):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return {api:m.exports,filters};
}
test('HAMS API denies signed-out users and scopes books to the verified account',async()=>{
  assert.equal((await route(null).api.GET()).status,401);
  const a=route(),r=await a.api.GET();assert.equal(r.status,200);assert.equal(r.body.state.balance,500000);
  assert.ok(a.filters.some(([k,v])=>k==='secret_hash'&&v==='hash:account-a'));assert.equal(r.headers['Cache-Control'],'private, no-store');
  const b=route('account-b');await b.api.GET();assert.ok(b.filters.some(([k,v])=>k==='secret_hash'&&v==='hash:account-b'));
});
test('HAMS switch enforces origin, boolean validation and active worker requirement',async()=>{
  const req=enabled=>new Request('https://panel.test/api/algo/hams-final',{method:'POST',body:JSON.stringify({enabled})});
  assert.equal((await route('a',false).api.POST(req(true))).status,403);
  assert.equal((await route().api.POST(req('yes'))).status,400);
  assert.equal((await route().api.POST(req(true))).status,409);
  assert.equal((await route().api.POST(req(false))).status,200);
});
