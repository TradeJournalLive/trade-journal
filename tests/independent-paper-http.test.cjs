const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createIndependentPaperEngine}=require('../scripts/independent-paper-engine.cjs');
const {createIndependentPaperHttp}=require('../scripts/independent-paper-http.cjs');
const at='2026-11-20T04:00:00.000Z',webhookSecret='fixture-webhook-secret',adminToken='fixture-private-admin-token-32-characters';
test('direct HTTP receipts are durable, authenticated, bounded and unambiguously shadow-only',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'independent-http-')),file=path.join(dir,'shadow.sqlite'),engine=createIndependentPaperEngine({file,owner:'fixture-owner',clock:()=>Date.parse(at)}),server=createIndependentPaperHttp({engine,webhookSecret,adminToken,allowSynthetic:false});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+server.address().port;
 const payload={secret:webhookSecret,strategyId:'nifty_paper_feed_v1',signalId:'receipt-one',symbol:'NSE:NIFTY',timeframe:'1',action:'BUY',metadata:{niftyPaper:{kind:'SIGNAL',closedAt:at,high:25260,low:25250}}};
 const post=(route,body,auth)=>fetch(root+route,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+adminToken}:{})},body:JSON.stringify(body)});
 try{
 assert.equal((await fetch(root+'/state/current')).status,401);
 assert.equal((await post('/api/v1/webhooks/tradingview',{...payload,secret:'wrong'})).status,401);
 let r=await post('/api/v1/webhooks/tradingview',payload);assert.equal(r.status,202);const receipt=await r.json();assert.equal(receipt.stored,true);assert.equal(receipt.executionComplete,false);assert.equal(receipt.mode,'SHADOW');
 assert.equal((await (await post('/api/v1/webhooks/tradingview',payload)).json()).duplicate,true);
 assert.equal((await post('/api/v1/webhooks/tradingview',{...payload,action:'SELL'})).status,409);
 assert.equal((await post('/api/v1/webhooks/tradingview',{...payload,signalId:'x'.repeat(20000)})).status,413);
 assert.equal((await post('/tick',{},true)).status,403);
 assert.equal(engine.health().pendingSignals,1);assert.equal(engine.read('current').state.rules.enabled,false);
 engine.store.receive=()=>{throw Object.assign(new Error('disk full'),{code:'SQLITE_FULL'});};assert.equal((await post('/api/v1/webhooks/tradingview',{...payload,signalId:'not-stored'})).status,503);
 }finally{await new Promise(resolve=>server.close(resolve));engine.close();fs.rmSync(dir,{recursive:true,force:true});}
});
