const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
test('cloud host loads private flat snapshots once, starts no workers by default, and preserves later state',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-host-test-')),secret='test-only-secret',owner=crypto.createHash('sha256').update(secret).digest('hex');
 const files=Object.fromEntries(['checkpoint.json','btc/checkpoint.json','hams-final/checkpoint.json'].map(name=>[name,{owner,savedAt:'2026-11-05T00:00:00Z',state:{enabled:name!=='btc/checkpoint.json',position:null,status:'WAITING_FOR_SIGNAL'}}]));
 const packed=zlib.gzipSync(JSON.stringify({owner,files})).toString('base64');
 const env={PATH:process.env.PATH,PORT:'31988',CLOUD_WORKER_DATA_DIR:directory,CLOUD_WORKER_WEBHOOK_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:'test-only',CLOUD_MIGRATION_ID:'test',CLOUD_MIGRATION_PARTS:'1',CLOUD_MIGRATION_0:packed};
 async function boot(){
  const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/cloud-worker-host.cjs')],{env,stdio:'ignore'});
  try{for(let i=0;i<40;i++){try{const data=await (await fetch('http://127.0.0.1:31988/health')).json();return {child,data};}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Host failed to start');}catch(e){child.kill();throw e;}
 }
 async function stop(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 const a=await boot();assert.equal(a.data.migrationLoaded,true);assert.equal(a.data.realOrdersEnabled,false);for(const w of Object.values(a.data.workers)){assert.equal(w.selected,false);assert.equal(w.processRunning,false);assert.equal(w.checkpoint.available,true);}await stop(a.child);
 const file=path.join(directory,'.paper-worker/btc/checkpoint.json'),state=JSON.parse(fs.readFileSync(file));state.savedAt='2026-11-05T01:00:00Z';fs.writeFileSync(file,JSON.stringify(state));
 const b=await boot();assert.equal(b.data.workers.BTC.checkpoint.savedAt,state.savedAt);await stop(b.child);
 assert.equal(fs.statSync(path.join(directory,'.paper-worker/config.json')).mode&0o777,0o600);
});
