"use client";
import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {accountFetch} from '../lib/accountFetch';
import {istDay,istTime} from '../lib/algo/reportDates';
import type {PaperIncidentReport} from '../lib/algo/paperIncidents';
export default function PaperIncidentHistory({strategy}:{strategy:'current'|'hams'}){
  const [open,setOpen]=useState(false),[reports,setReports]=useState<PaperIncidentReport[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function read(){if(active.current)return;const c=new AbortController();active.current=c;setBusy(true);setError('');try{const r=await accountFetch('/api/algo/incidents?strategy='+strategy,{cache:'no-store',signal:AbortSignal.any([c.signal,AbortSignal.timeout(12000)])}),body=await r.json();if(!r.ok)throw Error(body.error||'Incident reporting unavailable.');if(!c.signal.aborted)setReports(body.incidents);}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Incident reporting unavailable.');}finally{if(active.current===c){active.current=null;if(!c.signal.aborted)setBusy(false);}}}
  return <details className="border-y border-slate-200" open={open} onToggle={e=>{const next=e.currentTarget.open;setOpen(next);if(next&&!reports&&!busy&&!error)void read();}}>
    <summary className="cursor-pointer py-3 text-sm font-semibold">Incidents and interruptions</summary>
    {open&&<div className="space-y-3 pb-3"><div className="flex items-center justify-between gap-3 text-xs"><span>Latest 25 recorded incidents</span><button className="algo-action secondary inline-flex items-center gap-2" disabled={busy} onClick={()=>void read()}><RefreshCw size={14} aria-hidden="true"/>{busy?'Loading...':'Refresh incidents'}</button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {!busy&&!error&&reports?.length===0&&<p className="text-sm text-slate-600">No incident records are available for this strategy. This does not prove uninterrupted monitoring.</p>}
    {reports?.map(i=><article key={i.id} className="space-y-2 border-b border-slate-200 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{i.category.replaceAll('_',' ')}</h3><time>{istDay(i.at)} {istTime(i.at)} IST</time></div><p>{i.summary}</p><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Failed step</dt><dd>{i.step.replaceAll('_',' ')}</dd></div><div><dt className="text-xs text-slate-500">Responsible service</dt><dd>{i.providerFault==='UNCONFIRMED'?'Not established by the available evidence':i.providerFault}</dd></div><div><dt className="text-xs text-slate-500">Trade consequence</dt><dd>{i.tradeEffect}</dd></div><div><dt className="text-xs text-slate-500">Next action</dt><dd>{i.nextAction}</dd></div></dl>{i.missingEvidence.map((m,n)=><p key={n} className="border-l-2 border-amber-500 pl-3 text-xs text-amber-800">{m}</p>)}<details><summary className="cursor-pointer text-xs font-semibold">Technical evidence and incident ID</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-3 text-xs">{JSON.stringify({incidentId:i.id,runId:i.runId,signalId:i.signalId,boundary:i.boundary,confidence:i.confidence,evidence:i.evidence},null,2)}</pre></details></article>)}
    </div>}
  </details>;
}
