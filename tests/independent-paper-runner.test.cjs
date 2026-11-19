const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startIndependentPaperRunner}=require('../scripts/independent-paper-runner.cjs');
test('the standalone runner is shadow-only and exposes a stopped state after local persistence failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-runner-')),secret='fixture-secret-webhook',token='fixture-private-admin-token-length-32',errors=[],previous=console.error;
 assert.throws(()=>startIndependentPaperRunner({INDEPENDENT_PAPER_MODE:'LIVE'}),/SHADOW/);
 const runner=startIndependentPaperRunner({INDEPENDENT_PAPER_MODE:'SHADOW',INDEPENDENT_PAPER_DB:path.join(dir,'shadow.sqlite'),INDEPENDENT_PAPER_WEBHOOK_SECRET:secret,INDEPENDENT_PAPER_ADMIN_TOKEN:token,INDEPENDENT_SYNTHETIC_INPUT:'1',PORT:'0'});
 if(!runner.server.listening)await new Promise(resolve=>runner.server.once('listening',resolve));const url='http://127.0.0.1:'+runner.server.address().port;
 try{
 let health=await (await fetch(url+'/health')).json();assert.equal(health.mode,'SHADOW');assert.equal(health.realOrdersEnabled,false);assert.equal(health.runnerStatus,'RUNNING');
 console.error=value=>errors.push(String(value));runner.engine.renew=()=>{throw Object.assign(new Error('disk full '+secret),{code:'ERR_SQLITE_ERROR'});};await new Promise(resolve=>setTimeout(resolve,1150));health=await (await fetch(url+'/health')).json();assert.equal(health.runnerStatus,'EXECUTION_STOPPED');assert.equal(health.lastFailure.code,'ERR_SQLITE_ERROR');assert.equal(JSON.stringify(health).includes(secret),false);assert.equal(errors.some(e=>e.includes(secret)),false);
 const control=await fetch(url+'/control',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({strategy:'current',enabled:true,id:'unsafe-rearm'})});assert.equal(control.status,503);
 }finally{console.error=previous;await runner.close();fs.rmSync(dir,{recursive:true,force:true});}
});
