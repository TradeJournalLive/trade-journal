const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function errorCode(error){return error?.code||error?.cause?.code||error?.name||'UNKNOWN';}
function incidentReport(strategy,incident){
  const d=incident.diagnostic,context=d?.context||{},recent=d?.recent||[];
  const id=hash([strategy,incident.id||incident.signalId,incident.at].join(':'));
  const symptoms=recent.map(r=>({at:r.at,operation:r.operation,code:String(errorCode(r.error)),message:String(r.error?.message||'').slice(0,1000),causeCode:String(r.error?.cause?.code||''),request:r.request||null,error:r.error||null}));
  return {version:1,id,strategy,at:incident.at,runId:d?.runId||null,signalId:incident.signalId||null,
    category:'OWNERSHIP_CONFIRMATION_OVERDUE',step:'EXECUTION_OWNERSHIP_CHECK',boundary:'CLOUDWAYS_WORKER_TO_SUPABASE_ACK',providerFault:'UNCONFIRMED',confidence:'FAILURE_BOUNDARY_CONFIRMED_PROVIDER_UNCONFIRMED',
    summary:'The worker did not have an ownership confirmation newer than the 10-second deadline.',
    tradeEffect:incident.position?'Position retained. Later SL, target and exit outcomes were not assumed.':'See the original incident; no missing trade result is assumed.',
    nextAction:'Match the worker request times and request IDs with Cloudways and Supabase logs. Review any unobserved price interval before assigning a trade result.',
    evidence:{capturedAt:d?.capturedAt||null,deadlineMs:d?.deadlineMs||10000,confirmationAgeMs:context.leaseAgeMs??null,feedAt:context.feedAt??null,feedAgeMs:context.feedAgeMs??null,positionOpen:context.openPosition??Boolean(incident.position),active:d?.active||[],last:d?.last||{},recent:symptoms.slice(-12),resources:d?.resources||null},
    missingEvidence:d?[]:['This older incident has no attached request snapshot. Its exact provider cause cannot be recovered from this record alone.']};
}
async function observedRequest(diagnostics,service,operation,url,init={},request=fetch){
  const target=new URL(url?.url||url),requestMeta={service,method:init.method||url?.method||'GET',origin:target.origin,path:target.pathname};
  return diagnostics.run(operation,async()=>{
    const response=await request(url,init);
    const requestId=response.headers?.get?.('sb-request-id')||response.headers?.get?.('x-request-id')||response.headers?.get?.('cf-ray')||null;
    requestMeta.status=response.status;requestMeta.requestId=requestId;
    if(!response.ok)diagnostics.failure(operation,Object.assign(new Error('HTTP '+response.status),{code:'HTTP_'+response.status}),{request:{...requestMeta,status:response.status,requestId}});
    return response;
  },{request:requestMeta});
}
async function flushIncidentReports(db,owner,strategy,incidents,done){
  const pending=incidents.filter(i=>i.report&&!done.has(i.report.id));if(!pending.length)return;
  const rows=pending.map(i=>({secret_hash:owner,strategy_id:'__paper_incident__',signal_id:strategy+':'+i.report.id,symbol:'NIFTY',action:'EXIT',received_at:i.at,signal_timestamp:i.at,status:'VALIDATED',accepted:false,execution_mode:'PAPER',stage:'SIGNAL_RECEIVED',signal:{},decision:{},raw_payload:{incident:i.report}}));
  const result=await db.from('tradingview_signal_events').upsert(rows,{onConflict:'secret_hash,strategy_id,signal_id',ignoreDuplicates:true});
  if(result.error)throw Object.assign(new Error('INCIDENT_REPORTING_RETRY',{cause:result.error}),{code:'INCIDENT_REPORTING_RETRY'});
  for(const i of pending)done.add(i.report.id);
}
module.exports={incidentReport,observedRequest,flushIncidentReports};
