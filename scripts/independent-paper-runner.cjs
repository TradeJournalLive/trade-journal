// Deliberately separate from cloud-worker-host.cjs. Never starts production workers.
const path=require('node:path'),crypto=require('node:crypto');
const {createIndependentPaperEngine}=require('./independent-paper-engine.cjs');
const {createIndependentPaperHttp}=require('./independent-paper-http.cjs');
function startIndependentPaperRunner(env=process.env){
  const {INDEPENDENT_PAPER_MODE:mode,INDEPENDENT_PAPER_DB:file,INDEPENDENT_PAPER_WEBHOOK_SECRET:webhookSecret,INDEPENDENT_PAPER_ADMIN_TOKEN:adminToken}=env;
  if(mode!=='SHADOW'||!file||!path.isAbsolute(file)||webhookSecret?.length<16||adminToken?.length<32)throw Error('EXPLICIT_PRIVATE_SHADOW_CONFIGURATION_REQUIRED');
  if(file.includes('/.paper-worker/')||file.endsWith('checkpoint.json'))throw Error('PRODUCTION_STORAGE_PATH_FORBIDDEN');
  if((env.INDEPENDENT_FYERS_APP_ID||env.INDEPENDENT_FYERS_TOKEN)&&(!env.INDEPENDENT_FYERS_APP_ID||!env.INDEPENDENT_FYERS_TOKEN||env.INDEPENDENT_SYNTHETIC_INPUT==='1'))throw Error('COMPLETE_READ_ONLY_FEED_CONFIGURATION_REQUIRED');
  const engine=createIndependentPaperEngine({file,owner:crypto.createHash('sha256').update(webhookSecret).digest('hex'),currentStrategyId:env.INDEPENDENT_CURRENT_STRATEGY_ID||'nifty_paper_feed_v1'});
  const server=createIndependentPaperHttp({engine,webhookSecret,adminToken,allowSynthetic:env.INDEPENDENT_SYNTHETIC_INPUT==='1'});
  let stopped=false,lastFailure=null;
  let feed;
  const recordFailure=value=>{lastFailure={at:new Date().toISOString(),...value};console.error(JSON.stringify({type:'INDEPENDENT_SHADOW_FAILURE',...lastFailure}));};
  if(env.INDEPENDENT_FYERS_APP_ID||env.INDEPENDENT_FYERS_TOKEN){
    const {startIndependentFeed}=require('./independent-paper-feed.cjs');
    const required=()=>[...new Set(['current','hams'].flatMap(s=>{const r=engine.read(s).state.rules;return [r.position?.contract.id,r.setup?.attempt?.contractId,r.setup?.prepared?.contractId].filter(Boolean);}))];
    feed=startIndependentFeed({appId:env.INDEPENDENT_FYERS_APP_ID,accessToken:env.INDEPENDENT_FYERS_TOKEN,directory:path.dirname(file),required,onTick:tick=>{if(!stopped)engine.tick(tick);},onError:recordFailure}).catch(error=>{recordFailure({step:'feed.start',code:error.code||'FYERS_FEED_START_FAILED'});return null;});
  }
  const timer=setInterval(()=>{if(stopped)return;try{engine.renew();engine.watchdog();}catch(error){stopped=true;lastFailure={at:new Date().toISOString(),code:error.code||'LOCAL_PERSISTENCE_FAILURE'};console.error(JSON.stringify({type:'INDEPENDENT_SHADOW_STOPPED',...lastFailure}));}},1000);
  timer.unref();server.listen(Number(env.PORT||3019),'127.0.0.1');
  async function close(){stopped=true;clearInterval(timer);(await feed)?.();await new Promise(resolve=>server.close(resolve));try{engine.close();}catch(error){if(error.code!=='LOCAL_WRITER_FENCED')throw error;}}
  return {server,engine,close,get lastFailure(){return lastFailure;}};
}
if(require.main===module){process.umask(0o077);const runner=startIndependentPaperRunner();process.once('SIGTERM',()=>{void runner.close();});process.once('SIGINT',()=>{void runner.close();});}
module.exports={startIndependentPaperRunner};
