import { createHash } from 'node:crypto';
export type PaperIncidentReport = {
  id:string;strategy:'current'|'hams';at:string;runId:string|null;signalId:string|null;
  category:string;step:string;boundary:string;providerFault:string;confidence:string;
  summary:string;tradeEffect:string;nextAction:string;evidence:Record<string,unknown>;missingEvidence:string[];
};
export function redactIncident(value:unknown,secrets:string[],depth=0):unknown {
  if(depth>10)return '[TRUNCATED]';
  if(typeof value==='string'){
    let text=value.slice(0,8000);for(const secret of secrets.filter(v=>v.length>=4))text=text.split(secret).join('[REDACTED]');
    return text.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[JWT]').replace(/https?:\/\/[^\s"'<>]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '[URL]';}});
  }
  if(Array.isArray(value))return value.slice(0,100).map(v=>redactIncident(v,secrets,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,/(secret|token|password|authorization|cookie|credential)/i.test(k)?'[REDACTED]':redactIncident(v,secrets,depth+1)]));
  return value;
}
export function legacyPaperIncident(strategy:'current'|'hams',value:Record<string,any>):PaperIncidentReport {
  if(value.report?.version===1&&value.report.strategy===strategy)return {...value.report,evidence:{...value.report.evidence,reviewedAt:value.acknowledgedAt||null,resultStatus:value.status||null,reconstruction:value.reconstruction||null}};
  const d=value.diagnostic,context=d?.context||{};
  return {id:'legacy:'+createHash('sha256').update(JSON.stringify([strategy,value.id,value.signalId,value.at])).digest('hex'),strategy,at:value.at,runId:d?.runId||null,signalId:value.signalId||null,
    category:'MONITORING_INTERRUPTION',step:'OWNERSHIP_OR_RECOVERY_REVIEW',boundary:'SEE_RECORDED_EVIDENCE',providerFault:'UNCONFIRMED',confidence:'LEGACY_RECORD_LIMITED_EVIDENCE',
    summary:value.reason||'Monitoring became unverified. The saved record does not establish the exact provider cause.',
    tradeEffect:value.acknowledgedAt?'This incident was reviewed. The original uncertain monitoring interval remains part of the audit history.':'The position or result requires review; no missing exit is assumed.',
    nextAction:'Inspect the recorded timeline and matching provider logs. A historical candle estimate is not a verified bid/depth fill.',
    evidence:{originalStatus:value.status,acknowledgedAt:value.acknowledgedAt||null,reconstruction:value.reconstruction||null,deadlineMs:d?.deadlineMs||null,confirmationAgeMs:context.leaseAgeMs??null,active:d?.active||[],last:d?.last||{},recent:d?.recent||[],resources:d?.resources||null},
    missingEvidence:d?[]:['No request snapshot was attached to this older incident. Do not infer a provider cause from the status alone.']};
}
