const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
function endpoint({authenticated=true,position=null,incidents=[]}={}) {
 const f=path.resolve(__dirname,'../app/api/algo/recovery-review/route.ts'),m=new Module(f,module),calls=[];
 const db={from(){const q=Object.fromEntries(['select','eq','gte','lte','order'].map(k=>[k,(...a)=>{calls.push([k,...a]);return q;}]));q.maybeSingle=()=>({data:{position,incidents,received_at:new Date().toISOString()}});q.limit=()=>({data:[]});return q;}};
 m.require=id=>{
  if(id==='next/server')return {NextResponse:Response};
  if(id.endsWith('/connection'))return {connectionSecret:()=>authenticated?'test-secret':null};
  if(id.endsWith('/signalStore'))return {getServerSupabase:()=>db,hashWebhookSecret:()=> 'owned-fixture'};
  if(id.endsWith('/fyersConnection'))return {fyersDevice:()=>{throw Error('Unexpected FYERS credential read');}};
  if(id.endsWith('/paperRecoveryReview'))return {};
  return require(id);
 };
 m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,f);
 return {calls,get:strategy=>m.exports.GET(new Request('https://fixture.invalid/api/algo/recovery-review?strategy='+strategy)),source:fs.readFileSync(f,'utf8')};
}
test('recovery history rejects unknown strategies and unauthenticated users before database access',async()=>{for(const strategy of ['btc','ribbon','other']){const x=endpoint();assert.equal((await x.get(strategy)).status,400);assert.equal(x.calls.length,0);}const x=endpoint({authenticated:false});assert.equal((await x.get('current')).status,401);assert.equal(x.calls.length,0);});
test('history stays owner-scoped and cannot resolve or mutate an absent position',async()=>{for(const strategy of ['current','hams']){const x=endpoint(),r=await x.get(strategy);assert.equal(r.status,409);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(x.calls.some(c=>c[0]==='eq'&&c[1]==='secret_hash'&&c[2]==='owned-fixture'));assert.ok(x.calls.some(c=>c[0]==='eq'&&c[1]==='signal_id'&&c[2]==='state'));assert.doesNotMatch(x.source,/export async function (POST|PUT|DELETE)|\.update\(|\.upsert\(|\.insert\(|placeOrder/);}});
