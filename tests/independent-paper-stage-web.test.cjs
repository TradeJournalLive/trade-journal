const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createServer}=require('node:http');
const {createStageWeb,readFyersSession}=require('../scripts/independent-paper-stage-web.cjs');
test('staging password diagnostics distinguish missing and too-short configuration without exposing it',()=>{
 for(const [password,status] of [[undefined,'MISSING'],['short-private-value','TOO_SHORT'],['fixture-private-staging-password','READY']]){
  const web=createStageWeb({origin:'https://stage.example',password,sessionFile:'/nonexistent/stage-token',getEngine:()=>null});
  assert.equal(web.health().adminConfiguration,status);if(password)assert.equal(JSON.stringify(web.health()).includes(password),false);
 }
});
test('staging OAuth requires private login, origin/CSRF, one-use state and flat workers; token persists privately',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stage-oauth-')),file=path.join(dir,'fyers.json'),origin='https://stage.example',password='fixture-private-staging-password',accessToken='fixture-private-fyers-access-token';let exchange=0,enabled=false,feedReady=false;
 let checked=false;
 const engine={store:{probeHealth:()=>({count:checked?1:0,lastReceivedAt:null}),recentSignals:()=>[]},read:()=>({state:{rules:{enabled,position:null,setup:null,status:'DISABLED',balance:1000000,nextLots:1,decisions:[],trades:[]}}}),control(s,v){enabled=v.enabled;}};
 const web=createStageWeb({origin,password,appId:'fixture-app',appSecret:'fixture-app-secret',sessionFile:file,getEngine:()=>engine,getRuntime:()=>({runnerStatus:'RUNNING',feed:{configured:feedReady,ageMs:feedReady?1:null}}),signalConfigurationVerified:true,request:async(url,options)=>{exchange++;assert.equal(JSON.parse(options.body).code,'private-auth-code');return new Response(JSON.stringify({s:'ok',access_token:accessToken}),{status:200});}});
 const server=createServer((req,res)=>{void web.handle(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(route,body,cookie='',actualOrigin=origin)=>fetch(base+route,{method:'POST',redirect:'manual',headers:{origin:actualOrigin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 try{
 const loginPage=await fetch(base+'/stage');assert.equal(loginPage.status,401);assert.equal(loginPage.headers.get('referrer-policy'),'same-origin');
 assert.equal((await post('/stage/login',{password},'','https://evil.example')).status,403);
 assert.equal((await post('/stage/login',{password},'','null')).status,403);
 const login=await post('/stage/login',{password});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const dashboard=await fetch(base+'/stage',{headers:{cookie}});assert.equal(dashboard.headers.get('referrer-policy'),'same-origin');
 const page=await dashboard.text(),csrf=/name="csrf" value="([^"]+)"/.exec(page)[1];assert.equal(page.includes(password),false);
 assert.equal((await post('/stage/fyers/connect',{csrf:'wrong'},cookie)).status,403);
 assert.equal((await post('/stage/fyers/connect',{csrf},cookie,'null')).status,403);
 const connect=await post('/stage/fyers/connect',{csrf},cookie);assert.equal(connect.status,303);const auth=new URL(connect.headers.get('location'));assert.equal(auth.searchParams.get('redirect_uri'),origin+'/stage/fyers/callback');assert.equal(auth.toString().includes('fixture-app-secret'),false);
 const state=auth.searchParams.get('state'),invalidCallback=await fetch(base+'/stage/fyers/callback?state=wrong&auth_code=private-auth-code',{headers:{cookie}});assert.equal(invalidCallback.status,403);assert.equal(invalidCallback.headers.get('referrer-policy'),'no-referrer');assert.equal(exchange,0);
 const again=await post('/stage/fyers/connect',{csrf},cookie),state2=new URL(again.headers.get('location')).searchParams.get('state');assert.notEqual(state,state2);
 const result=await fetch(base+'/stage/fyers/callback?state='+state2+'&auth_code=private-auth-code',{headers:{cookie},redirect:'manual'});assert.equal(result.status,303);assert.equal(exchange,1);assert.equal(readFyersSession(file,'fixture-app').accessToken,accessToken);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.throws(()=>readFyersSession(file,'wrong-app'),/IDENTITY/);
 assert.equal((await fetch(base+'/stage/fyers/callback?state='+state2+'&auth_code=private-auth-code',{headers:{cookie}})).status,403);assert.equal(exchange,1);
 assert.equal((await post('/stage/control',{csrf,strategy:'current',enabled:'true'},cookie)).status,409);feedReady=true;
 assert.equal((await post('/stage/control',{csrf,strategy:'current',enabled:'true'},cookie)).status,409);checked=true;
 assert.equal((await post('/stage/control',{csrf,strategy:'current',enabled:'true'},cookie)).status,303);
 assert.equal((await post('/stage/fyers/connect',{csrf},cookie)).status,409);
 const privatePage=await (await fetch(base+'/stage',{headers:{cookie}})).text();assert.equal(privatePage.includes(accessToken),false);assert.equal(JSON.stringify(web.health()).includes(accessToken),false);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
