const {performance}=require('node:perf_hooks');
const {randomUUID}=require('node:crypto');
function createWorkerDiagnostics({emit,context=()=>({}),secrets=()=>[],clock=Date.now,mono=()=>performance.now()}){
  const active=new Map(),counts={},latency={},last={},recent=[],started=clock(),runId=randomUUID();let sequence=0,firstStop=null;
  function clean(value){
    let text=String(value??'').slice(0,12000);
    for(const secret of secrets().filter(v=>typeof v==='string'&&v.length>=4))text=text.split(secret).join('[REDACTED]');
    return text.replace(/https?:\/\/[^\s"'<>]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[URL]';}})
      .replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[JWT]');
  }
  function errorInfo(error,depth=0){if(depth>3)return {message:'Cause depth exceeded'};return {name:clean(error?.name||'Error'),code:clean(error?.code??''),message:clean(error?.message??error),stack:error?.stack?clean(error.stack):undefined,...(error?.details?{details:clean(error.details)}:{}),...(error?.hint?{hint:clean(error.hint)}:{}),...(error?.cause?{cause:errorInfo(error.cause,depth+1)}:{})};}
  function write(type,details={}){const record={at:new Date(clock()).toISOString(),runId,type,...context(),...details};if(['ERROR','TASK_FAILED','STOP_REQUESTED'].includes(type)){recent.push(record);if(recent.length>12)recent.shift();}try{emit(record);}catch{/* Diagnostics must not stop the execution engine. */}}
  function incident(){return {version:1,runId,capturedAt:new Date(clock()).toISOString(),boundary:'CLOUDWAYS_WORKER_TO_SUPABASE_ACK',providerFault:'UNCONFIRMED',deadlineMs:10000,context:context(),last:structuredClone(last),active:[...active.values()].map(t=>({...t,ageMs:clock()-t.at})),recent:structuredClone(recent),resources:{rss:process.memoryUsage().rss,cpu:process.cpuUsage()}};}
  function begin(operation,meta={}){
    const id=++sequence,start=mono(),at=clock();active.set(id,{operation,at});last[operation]={startedAt:new Date(at).toISOString()};
    return error=>{const durationMs=Math.round((mono()-start)*100)/100;active.delete(id);counts[operation]=(counts[operation]||0)+1;latency[operation]=Math.max(latency[operation]||0,durationMs);last[operation]={...last[operation],finishedAt:new Date(clock()).toISOString(),durationMs,failed:Boolean(error)};
      if(error||durationMs>=1000)write(error?'TASK_FAILED':'TASK_SLOW',{operation,durationMs,...meta,...(error?{error:errorInfo(error)}:{})});};
  }
  async function run(operation,fn,meta){const finish=begin(operation,meta);try{const result=await fn();finish();return result;}catch(error){finish(error);throw error;}}
  function sync(operation,fn){const finish=begin(operation);try{const result=fn();finish();return result;}catch(error){finish(error);throw error;}}
  function failure(operation,error){write('ERROR',{operation,error:errorInfo(error)});}
  function stop(operation,error){if(!firstStop){firstStop={at:new Date(clock()).toISOString(),operation,error:errorInfo(error)};write('STOP_REQUESTED',firstStop);}return firstStop;}
  function sample(extra={}){write('HEALTH_SAMPLE',{uptimeMs:clock()-started,counts:{...counts},maxTaskMs:{...latency},last:{...last},active:[...active.values()].map(t=>({...t,ageMs:clock()-t.at})),firstStop,...extra});}
  return {begin,run,sync,failure,stop,sample,write,errorInfo,incident,get firstStop(){return firstStop;}};
}
module.exports={createWorkerDiagnostics};
