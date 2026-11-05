/* PAPER workers only. This host never imports broker order APIs. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Outside the Git deployment tree so a checkout cannot remove execution state.
const storage=process.env.CLOUD_WORKER_DATA_DIR||path.resolve(root,'../worker-private-storage');
const directory=path.join(storage,'.paper-worker');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const secret=process.env.CLOUD_WORKER_WEBHOOK_SECRET;
if(!secret||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('MISSING_PRIVATE_WORKER_CONFIGURATION');
const owner=crypto.createHash('sha256').update(secret).digest('hex');
const migrationId=process.env.CLOUD_MIGRATION_ID;
const migrationFile=path.join(directory,'cloud-migration.json');
const allowed=['checkpoint.json','btc/checkpoint.json','hams-final/checkpoint.json'];
if(migrationId&&!fs.existsSync(migrationFile)){
  const count=Number(process.env.CLOUD_MIGRATION_PARTS);
  if(!Number.isInteger(count)||count<1||count>100)throw Error('INVALID_MIGRATION_PARTS');
  let packed='';for(let i=0;i<count;i++){const part=process.env[`CLOUD_MIGRATION_${i}`];if(!part)throw Error('MISSING_MIGRATION_PART');packed+=part;}
  const bundle=JSON.parse(zlib.gunzipSync(Buffer.from(packed,'base64')).toString());
  if(bundle.owner!==owner)throw Error('MIGRATION_OWNER_MISMATCH');
  for(const name of allowed){
    const state=bundle.files[name];
    if(!state||state.owner!==owner)throw Error('INVALID_MIGRATION_STATE');
    if(state.state?.position||state.checkpoint?.position||state.checkpoint?.rulesV2?.position)throw Error('MIGRATION_REQUIRES_FLAT_POSITION');
    const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    if(fs.existsSync(file))throw Error('MIGRATION_WOULD_OVERWRITE_STATE');
    fs.writeFileSync(file,JSON.stringify(state),{mode:0o600});
  }
  fs.writeFileSync(migrationFile,JSON.stringify({id:migrationId,at:new Date().toISOString()}),{mode:0o600});
}
fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({webhookSecret:secret,fyersAppId:process.env.PAPER_FYERS_APP_ID}),{mode:0o600});
const definitions={NIFTY:'nifty-paper-worker.cjs',HAMS:'hams-final-worker.cjs',BTC:'btc-delta-paper-worker.cjs'};
const active=new Set((process.env.CLOUD_WORKERS_ENABLED||'').split(',').filter(Boolean));
for(const name of active)if(!definitions[name])throw Error('INVALID_WORKER_SELECTION');
const children=new Map(),timers=new Set(),exits=new Map();let stopping=false;
function stoppedReason(name){
  const file=path.join(directory,`cloud-${name.toLowerCase()}.log`);
  try{const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,8192));fs.readSync(fd,b,0,b.length,Math.max(0,size-b.length));fs.closeSync(fd);const matches=[...b.toString().matchAll(/(?:stopped: |"message":")([A-Z][A-Z_]+)(?:"|\s|$)/g)];return matches.at(-1)?.[1]||null;}catch{return null;}
}
function launch(name){
  if(stopping)return;
  const log=fs.openSync(path.join(directory,`cloud-${name.toLowerCase()}.log`),'a',0o600);
  const child=spawn(process.execPath,[path.join(__dirname,definitions[name])],{cwd:storage,env:process.env,stdio:['ignore',log,log]});
  fs.closeSync(log);children.set(name,child);
  child.once('error',()=>{});
  child.once('exit',(code,signal)=>{exits.set(name,{code,signal,at:new Date().toISOString()});children.delete(name);if(!stopping){const timer=setTimeout(()=>{timers.delete(timer);launch(name);},30000);timers.add(timer);}});
}
for(const name of active)launch(name);
const started=Date.now();
function stateInfo(name){
  const file=path.join(directory,name==='BTC'?'btc/checkpoint.json':name==='HAMS'?'hams-final/checkpoint.json':'checkpoint.json');
  try{const x=JSON.parse(fs.readFileSync(file));const s=x.state||x.checkpoint?.rulesV2||{};return {available:true,savedAt:x.savedAt,status:s.status,entriesEnabled:s.enabled,positionOpen:!!s.position};}catch{return {available:false};}
}
const server=http.createServer((req,res)=>{
  if(req.url!=='/'&&req.url!=='/health'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({mode:'PAPER_WORKER_HOST',realOrdersEnabled:false,uptimeSeconds:Math.floor((Date.now()-started)/1000),migrationLoaded:fs.existsSync(migrationFile),workers:Object.fromEntries(Object.keys(definitions).map(n=>[n,{selected:active.has(n),processRunning:!!children.get(n),lastExit:exits.get(n)||null,lastRecordedStop:stoppedReason(n),checkpoint:stateInfo(n)}]))}));
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0');
function stop(){if(stopping)return;stopping=true;for(const timer of timers)clearTimeout(timer);for(const child of children.values())child.kill('SIGTERM');server.close();const timer=setInterval(()=>{if(!children.size){clearInterval(timer);process.exit(0);}},100);setTimeout(()=>{for(const child of children.values())child.kill('SIGKILL');process.exit(0);},10000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
