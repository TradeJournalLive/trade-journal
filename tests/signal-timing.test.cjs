const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function load(name){const file=path.resolve(__dirname,`../app/lib/algo/${name}.ts`),m=new Module(file,module);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const {captureDeliveryTiming,signalTiming,timingTime,timingDuration}=load('signalTiming');
const close='2026-10-30T09:15:00.000Z',fire='2026-10-30T09:15:02Z',arrive='2026-10-30T09:15:17.697Z',validate='2026-10-30T09:15:17.710Z';
function event(fired=fire){return {receivedAt:arrive,signal:{timestamp:fire,metadata:{hamsFinalPaper:{kind:'SIGNAL',closedAt:close},deliveryTiming:captureDeliveryTiming(fired,arrive,validate)}},execution:{at:'2026-10-30T09:15:18.392Z'}};}
test('explicit alert fire distinguishes confirmation, pre-handler delivery, validation and worker decision',()=>{
 const result=signalTiming(event());assert.equal(result.closeToFireMs,2000);assert.equal(result.fireToArrivalMs,15697);assert.equal(result.validationMs,13);assert.equal(result.arrivalToDecisionMs,695);assert.equal(result.closedAt,close);assert.equal(result.status,'TV_REPORTED_SECONDS_PRECISION');assert.equal(timingTime(arrive),'14:45:17.697');assert.equal(timingDuration(result.fireToArrivalMs),'15.697 s');
});
test('missing, invalid, unresolved and legacy timestamps never invent fire times or delays',()=>{
 for(const fired of [null,'{{timenow}}','not a date',7]){const t=signalTiming(event(fired));assert.equal(t.firedAt,null);assert.equal(t.fireToArrivalMs,null);assert.equal(t.status,'INVALID_FIRE_TIME');}
 const e=event();e.signal.metadata.deliveryTiming=captureDeliveryTiming(undefined,arrive,validate);assert.equal(signalTiming(e).fireToArrivalMs,null);
 delete e.signal.metadata.deliveryTiming;e.signal.timestamp='2026-10-30T09:12:00Z';const t=signalTiming(e);assert.equal(t.firedAt,null);assert.equal(t.legacyTimestampAt,'2026-10-30T09:12:00.000Z');assert.equal(t.status,'LEGACY_TIMESTAMP_NOT_VERIFIED');
});
test('negative clock ordering is visible and not silently clamped to zero',()=>{
 const t=signalTiming(event('2026-10-30T09:15:19Z'));assert.equal(t.status,'CLOCK_ORDER_MISMATCH');assert.equal(t.fireToArrivalMs,null);assert.equal(t.closeToFireMs,null);
 assert.equal(signalTiming(event('2026-10-30T09:14:59Z')).status,'CLOCK_ORDER_MISMATCH');
});
test('source candle time remains distinct from reported fire time across all supported markets',()=>{
 for(const key of ['hamsFinalPaper','niftyPaper','btcPaper']){const e=event();e.signal.metadata[key]={kind:'SIGNAL',closedAt:close};assert.equal(signalTiming(e).closedAt,close);}
 assert.equal(timingTime(null),'--');assert.equal(timingDuration(null),'--');
});
function route(){
 const file=path.resolve(__dirname,'../app/api/v1/webhooks/tradingview/route.ts'),m=new Module(file,module),saved=[];
 m.require=id=>id==='next/server'?{NextResponse:{json:(body,init={})=>({body,status:init.status||200})}}:id==='@vercel/functions'?{waitUntil(){}}:id.endsWith('/automation')?{evaluateAlgoSignal:()=>({accepted:true,executionMode:'PAPER',stage:'READY_FOR_PAPER',reasons:['ready'],checks:[]}),recordAlgoEvent(){}}:id.endsWith('/signalStore')?{hashWebhookSecret:s=>s,persistAlgoSignalEvent:async v=>{saved.push(v);return {ok:true};}}:id.endsWith('/googleSheets')?{syncWebhookSheet:()=>Promise.resolve()}:id.endsWith('/trackingSignals')?{isolateTrackingSignal:p=>p}:id.endsWith('/hamsSignal')?{isolateHamsSignal:p=>p}:id.endsWith('/niftySignal')?{niftySignalCandle:p=>p}:id.endsWith('/signalTiming')?load('signalTiming'):require(id);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
 // The real handler's first timestamp is asserted structurally and against request-body timing below.
 return {api:m.exports,saved};
}
test('webhook records server-owned timing before durable persistence without changing action or candle',async()=>{
 const f=route(),at=new Date().toISOString(),payload={secret:'fixture-secret',strategyId:'nifty_breakout_options_v1',signalId:'timing-test',symbol:'NSE:NIFTY',action:'BUY',timestamp:at,alertFiredAt:at,timeframe:'1',metadata:{niftyPaper:{kind:'SIGNAL',high:23000,low:22980,closedAt:at},deliveryTiming:{serverArrivedAt:'forged',alertFiredAt:'forged'}}};
 const previous=process.env.TRADINGVIEW_WEBHOOK_SECRET,hmac=process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;delete process.env.TRADINGVIEW_WEBHOOK_SECRET;delete process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;
 try{const result=await f.api.POST(new Request('https://panel.test/api/v1/webhooks/tradingview',{method:'POST',body:JSON.stringify(payload)}));assert.equal(result.status,202);assert.equal(f.saved.length,1);const saved=f.saved[0].event;assert.equal(saved.receivedAt,saved.signal.metadata.deliveryTiming.serverArrivedAt);assert.equal(saved.signal.metadata.deliveryTiming.alertFiredAt,at);assert.equal(saved.signal.action,'BUY');assert.deepEqual(saved.signal.metadata.niftyPaper,payload.metadata.niftyPaper);assert.notEqual(saved.receivedAt,'forged');}
 finally{if(previous===undefined)delete process.env.TRADINGVIEW_WEBHOOK_SECRET;else process.env.TRADINGVIEW_WEBHOOK_SECRET=previous;if(hmac===undefined)delete process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;else process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET=hmac;}
 const source=fs.readFileSync(path.resolve(__dirname,'../app/api/v1/webhooks/tradingview/route.ts'),'utf8');assert.ok(source.indexOf('const receivedAt = Date.now()')<source.indexOf('rawBody = await request.text()'));
});
test('Timing tab renders reported times without substituting legacy timestamps',()=>{
 const file=path.resolve(__dirname,'../app/dashboard/SignalExecutionTable.tsx'),m=new Module(file,module),React=require('react');
 m.require=id=>id==='react'?{...React,useState:()=>['timing',()=>{}]}:id==='../lib/algo/signalTiming'?load('signalTiming'):id==='../lib/algo/reportDates'?{istDay:()=> '2026-10-30',istTime:()=> '',signalTime:()=> ''}:require(id);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
 const e=event();e.signal={...e.signal,id:'test',action:'SELL',symbol:'NSE:NIFTY',status:'VALIDATED'};e.decision={reasons:[]};
 const html=require('react-dom/server').renderToStaticMarkup(React.createElement(m.exports.default,{events:[e]}));assert.match(html,/15\.697 s/);assert.match(html,/14:45:02\.000/);assert.match(html,/TV REPORTED SECONDS PRECISION/);assert.match(html,/including any pre-handler platform startup/);
});
