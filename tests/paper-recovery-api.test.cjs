const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function endpoint({authenticated=true,position=null,incidents=[],reviewable=false}={}) {
 const f=path.resolve(__dirname,'../app/api/algo/recovery-review/route.ts'),m=new Module(f,module),calls=[];
 const db={from(){const q=Object.fromEntries(['select','eq','gte','lte','order'].map(k=>[k,(...a)=>{calls.push([k,...a]);return q;}]));q.maybeSingle=()=>({data:{position,incidents,received_at:new Date().toISOString()}});q.limit=()=>({data:[]});q.upsert=(...args)=>{calls.push(['upsert',...args]);return {error:null};};return q;}};
 m.require=id=>{
  if(id==='next/server')return {NextResponse:Response};
  if(id.endsWith('/connection'))return {connectionSecret:()=>authenticated?'test-secret':null,sameOrigin:r=>r.headers.get('origin')==='https://fixture.invalid'};
  if(id.endsWith('/signalStore'))return {getServerSupabase:()=>db,hashWebhookSecret:()=> 'owned-fixture'};
  if(id.endsWith('/fyersConnection'))return {fyersDevice:()=>{if(!reviewable)throw Error('Unexpected FYERS credential read');return 'fixture-device';},readFyers:()=>({appId:'fixture',accessToken:'fixture-token'})};
  if(id.endsWith('/paperRecoveryReview'))return {recoverySessionEnd:()=> '2026-11-19T09:20:00.000Z',normalizeRecoveryCandles:()=>[],reviewRecoveryCandles:()=>({status:'CANDLE_RECONSTRUCTION_AVAILABLE',reason:'TIME_EXIT',exitEstimate:213.35,grossEstimate:10929.75,windowStart:'2026-11-19T09:20:00.000Z',windowEnd:'2026-11-19T09:21:00.000Z'})};
  if(id.endsWith('/niftyLimitPaper'))return {optionCosts:()=>({total:148.59})};
  if(id.endsWith('/paperReconciliation'))return {reconstructionId:()=> 'reconstruction:fixture',reconstructionHash:()=> 'a'.repeat(64),signReconstruction:(payload,key)=>{assert.ok(key);return {payload,signature:'fixture-signature'};}};
  return require(id);
 };
 m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,f);
 return {calls,get:strategy=>m.exports.GET(new Request('https://fixture.invalid/api/algo/recovery-review?strategy='+strategy)),post:(body,origin='https://fixture.invalid')=>m.exports.POST(new Request('https://fixture.invalid/api/algo/recovery-review?strategy=current',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})),source:fs.readFileSync(f,'utf8')};
}
test('recovery history rejects unknown strategies and unauthenticated users before database access',async()=>{for(const strategy of ['btc','ribbon','other']){const x=endpoint();assert.equal((await x.get(strategy)).status,400);assert.equal(x.calls.length,0);}const x=endpoint({authenticated:false});assert.equal((await x.get('current')).status,401);assert.equal(x.calls.length,0);});
test('history stays owner-scoped and cannot resolve or mutate an absent position',async()=>{for(const strategy of ['current','hams']){const x=endpoint(),r=await x.get(strategy);assert.equal(r.status,409);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(x.calls.some(c=>c[0]==='eq'&&c[1]==='secret_hash'&&c[2]==='owned-fixture'));assert.ok(x.calls.some(c=>c[0]==='eq'&&c[1]==='signal_id'&&c[2]==='state'));assert.doesNotMatch(x.source.split('export async function POST')[0],/\.update\(|\.upsert\(|\.insert\(|placeOrder/);}});
test('corrections require same origin and explicit approval; absent positions cannot queue',async()=>{const x=endpoint();assert.equal((await x.post({acceptCandleEstimate:true},'https://other.invalid')).status,403);assert.equal((await x.post({})).status,400);assert.equal(x.calls.length,0);assert.equal((await x.post({acceptCandleEstimate:true})).status,409);});
test('approved POST recomputes evidence and queues one owner-bound paper control, never a snapshot write',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.ALGO_CONNECTION_ENCRYPTION_KEY;
 global.fetch=async()=>Response.json({s:'ok',candles:[]});process.env.ALGO_CONNECTION_ENCRYPTION_KEY='test-key-only';
 try{
 const position={signalId:'fixture',openedAt:new Date(Date.now()-3600000).toISOString(),contract:{id:'NSE:NIFTY26NOV25350CE',side:'CE'},entry:157.3,quantity:195},x=endpoint({position,incidents:[{at:new Date(Date.now()-1800000).toISOString(),signalId:'fixture'}],reviewable:true});
 const body={acceptCandleEstimate:true,signalId:position.signalId,openedAt:position.openedAt,expectedNet:10781.16};
 assert.equal((await x.post({...body,expectedNet:100})).status,409);assert.equal(x.calls.filter(c=>c[0]==='upsert').length,0);
 const response=await x.post(body);assert.equal(response.status,200);assert.equal((await response.json()).queued,true);
 const [entry]=x.calls.filter(c=>c[0]==='upsert');assert.equal(entry[1].secret_hash,'owned-fixture');assert.equal(entry[1].strategy_id,'__paper_control__');assert.equal(entry[1].raw_payload.paperControl.niftyOptionsEnabled,false);assert.equal(entry[1].raw_payload.paperControl.reconstruction.payload.fillVerified,false);assert.equal(entry[2].ignoreDuplicates,true);
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.ALGO_CONNECTION_ENCRYPTION_KEY;else process.env.ALGO_CONNECTION_ENCRYPTION_KEY=oldKey;}
});
