const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {independentSelftest}=require('./independent-paper-selftest.cjs');
const {startIndependentPaperRunner}=require('./independent-paper-runner.cjs');

function stageConfiguration(env){
  const token=env.RIBBON_STAGE_TOKEN;
  if(typeof token!=='string'||token.length<16)throw Error('EXISTING_PRIVATE_STAGING_TOKEN_REQUIRED');
  const home=path.resolve(env.HOME||os.homedir()),realHome=fs.realpathSync(home);
  if(['/tmp','/private/tmp','/var/tmp'].some(p=>realHome===p||realHome.startsWith(p+'/')))throw Error('PERSISTENT_HOME_REQUIRED');
  const directory=path.join(realHome,'worker-private-storage','independent-shadow');
  const derive=label=>crypto.createHmac('sha256',token).update('independent-shadow:'+label).digest('hex');
  return {...env,INDEPENDENT_PAPER_MODE:'SHADOW',INDEPENDENT_PAPER_DB:path.join(directory,'shadow.sqlite'),INDEPENDENT_PAPER_ADMIN_TOKEN:derive('admin'),INDEPENDENT_PAPER_WEBHOOK_SECRET:derive('webhook'),INDEPENDENT_SYNTHETIC_INPUT:'0'};
}
async function startCloudwaysStage(env=process.env){
  process.umask(0o077);
  const config=stageConfiguration(env),directory=path.dirname(config.INDEPENDENT_PAPER_DB);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const disk=fs.statfsSync(directory),free=Number(disk.bavail)*Number(disk.bsize);
  if(free<1024**3)throw Error('STAGING_REQUIRES_ONE_GIB_FREE');
  const selftest=await independentSelftest(directory);
  const marker=path.join(directory,'installation.json');
  const previous=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):null;
  const installation={id:previous?.id||crypto.randomUUID(),boots:(previous?.boots||0)+1};
  fs.writeFileSync(marker+'.tmp',JSON.stringify(installation),{mode:0o600});fs.renameSync(marker+'.tmp',marker);
  config.stageHealth=()=>({phase:config.INDEPENDENT_FYERS_APP_ID&&config.INDEPENDENT_FYERS_TOKEN?'FEED_CONFIGURATION_PRESENT':'AWAITING_FYERS_CONFIGURATION',isolated:true,productionStateImported:false,reportingDestination:'NOT_CONFIGURED',installationId:installation.id,bootCount:installation.boots,storageSurvivedPriorBoot:Boolean(previous),freeBytes:Number(fs.statfsSync(directory).bavail)*Number(fs.statfsSync(directory).bsize),selftest});
  const runner=startIndependentPaperRunner(config);
  if(runner.engine.store.db.prepare('PRAGMA quick_check').get().quick_check!=='ok'){await runner.close();throw Error('STAGING_DATABASE_INTEGRITY_FAILED');}
  console.log(JSON.stringify({event:'INDEPENDENT_SHADOW_STAGE_STARTED',mode:'SHADOW',realOrdersEnabled:false,selftest}));
  return runner;
}
if(require.main===module)startCloudwaysStage().then(runner=>{process.once('SIGTERM',()=>{void runner.close();});process.once('SIGINT',()=>{void runner.close();});}).catch(error=>{console.error(JSON.stringify({event:'INDEPENDENT_STAGE_START_FAILED',code:error.code||'STARTUP_FAILED',message:error.message}));process.exitCode=1;});
module.exports={stageConfiguration,startCloudwaysStage};
