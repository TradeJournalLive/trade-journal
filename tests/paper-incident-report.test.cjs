const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkerDiagnostics}=require('../scripts/worker-diagnostics.cjs');
const {incidentReport,observedRequest,flushIncidentReports}=require('../scripts/paper-incident-report.cjs');
test('a pending HTTP request is identifiable at the pause, with no query secrets',async()=>{
 const rows=[];let clock=0,release;const diagnostics=createWorkerDiagnostics({emit:r=>rows.push(r),clock:()=>clock,mono:()=>clock,context:()=>({leaseAgeMs:10001,openPosition:true})});
 const task=observedRequest(diagnostics,'SUPABASE','supabase.http','https://fixture.invalid/rest/v1/events?secret=private',{method:'PATCH'},()=>new Promise(resolve=>{release=resolve;}));clock=10001;
 const snapshot=diagnostics.incident();assert.equal(snapshot.active[0].request.service,'SUPABASE');assert.equal(snapshot.active[0].request.method,'PATCH');assert.equal(snapshot.active[0].ageMs,10001);assert.equal(JSON.stringify(snapshot).includes('private'),false);
 release(new Response('{}',{headers:{'sb-request-id':'request-123'}}));await task;
 assert.equal(diagnostics.incident().last['supabase.http'].request.requestId,'request-123');assert.equal(diagnostics.incident().last['supabase.http'].request.status,200);
});
test('request failures retain exact boundary without falsely assigning provider blame',async()=>{
 const d=createWorkerDiagnostics({emit(){},secrets:()=>['secret-token']});await assert.rejects(observedRequest(d,'VERCEL_PANEL','panel.credentials.http','https://fixture.invalid/api/brokers/fyers/paper-worker',{},async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('connect timeout secret-token'),{code:'ETIMEDOUT'})});}));
 const report=incidentReport('current',{id:'test',signalId:'one',at:new Date().toISOString(),position:{},diagnostic:d.incident()});assert.equal(report.providerFault,'UNCONFIRMED');assert.equal(report.evidence.recent[0].request.service,'VERCEL_PANEL');assert.equal(report.evidence.recent[0].causeCode,'ETIMEDOUT');assert.equal(JSON.stringify(report).includes('secret-token'),false);
});
test('HTTP rejections include returned status and request ID, not response bodies or auth headers',async()=>{
 const d=createWorkerDiagnostics({emit(){}});await observedRequest(d,'FYERS','fyers.http','https://fixture.invalid/data/history?symbol=x',{headers:{Authorization:'secret'}},async()=>new Response('private body',{status:401,headers:{'x-request-id':'fyers-123'}}));const snapshot=d.incident();const error=snapshot.recent[0];assert.equal(error.error.code,'HTTP_401');assert.equal(error.request.requestId,'fyers-123');assert.equal(JSON.stringify(snapshot).includes('private body'),false);assert.equal(JSON.stringify(snapshot).includes('Authorization'),false);
});
test('old incidents stay explicitly incomplete and reporting is idempotent and retryable',async()=>{
 const legacy=incidentReport('hams',{id:'old',at:new Date().toISOString()});assert.equal(legacy.missingEvidence.length,1);assert.equal(legacy.evidence.confirmationAgeMs,null);
 const done=new Set(),incident={at:legacy.at,report:legacy};let fail=true,calls=0;const db={from(){return {upsert(rows,options){calls++;assert.equal(options.ignoreDuplicates,true);assert.equal(rows[0].strategy_id,'__paper_incident__');return {error:fail?{message:'unavailable'}:null};}};}};
 await assert.rejects(flushIncidentReports(db,'owned','hams',[incident],done));assert.equal(done.size,0);fail=false;await flushIncidentReports(db,'owned','hams',[incident],done);assert.equal(done.size,1);await flushIncidentReports(db,'owned','hams',[incident],done);assert.equal(calls,2);
});
