"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { accountFetch } from "../lib/accountFetch";
import { istDay, istTime } from "../lib/algo/reportDates";

type Review = {position:{signalId:string;openedAt:string;contract:{id:string};entry:number;stop:number;target:number;quantity:number};incident:{at:string;reason:string};checkedAt:string;review:{status:string;reason:string|null;windowStart?:string;windowEnd?:string;exitEstimate:number|null;chargesEstimate:number|null;netEstimate:number|null;note:string};candles:{at:string;open:number;high:number;low:number;close:number;volume:number}[];oppositeSignals:string[]};
const money=(n:number|null)=>n===null?"--":new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(n);
const stamp=(at:string)=>`${istDay(at)} ${istTime(at)} IST`;
export default function PaperRecoveryReview({strategy}:{strategy:"current"|"hams"}) {
  const [value,setValue]=useState<Review|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);
  const [queued,setQueued]=useState(false);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function check(){
    if(active.current)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setError("");
    try{
      const response=await accountFetch(`/api/algo/recovery-review?strategy=${strategy}`,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
      const result=await response.json();if(!response.ok)throw Error(result.error||"Historical review unavailable.");
      if(!controller.signal.aborted)setValue(result);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Historical review unavailable.");}
    finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  async function apply(){
    if(!value||busy||queued||!window.confirm(`Apply ${money(value.review.netEstimate)} as an estimated paper result after charges? This is not a verified bid/depth fill. Entries will remain off until reviewed.`))return;
    setBusy(true);setError("");
    try{
      const response=await accountFetch(`/api/algo/recovery-review?strategy=${strategy}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acceptCandleEstimate:true,signalId:value.position.signalId,openedAt:value.position.openedAt,expectedNet:value.review.netEstimate}),signal:AbortSignal.timeout(30000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||"Correction unavailable.");setQueued(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"Correction unavailable.");}
    finally{setBusy(false);}
  }
  return <div className="space-y-3 border-y border-amber-200 py-3 text-sm" aria-label="Paper recovery evidence">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Recovery evidence</h3><button type="button" disabled={busy} onClick={()=>void check()} className="algo-action secondary inline-flex items-center gap-2"><RefreshCw size={15} aria-hidden="true" />{busy?"Checking FYERS...":"Review FYERS history"}</button></div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {queued?<p role="status" className="text-amber-800">Correction queued, not yet confirmed closed. Refresh the worker status before re-arming entries.</p>:value?.review.status==="CANDLE_RECONSTRUCTION_AVAILABLE"&&value.review.reason==="TIME_EXIT"&&<button type="button" disabled={busy} onClick={()=>void apply()} className="algo-action secondary">Apply estimated paper exit</button>}
    {value&&<><dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Monitoring paused</dt><dd>{stamp(value.incident.at)}</dd></div><div><dt className="text-xs text-slate-500">Historical finding</dt><dd>{value.review.status.replaceAll("_"," ")}</dd></div><div><dt className="text-xs text-slate-500">Possible exit</dt><dd>{value.review.reason?.replaceAll("_"," ")??"Unverified"}{value.review.windowStart?` · ${stamp(value.review.windowStart)}`:""}</dd></div><div><dt className="text-xs text-slate-500">Estimated net after charges · not verified</dt><dd className="font-semibold">{money(value.review.netEstimate)}</dd></div></dl><p className="border-l-2 border-amber-500 pl-3 text-xs text-amber-900">{value.review.note} No position, P&amp;L or recovery balance has been changed.</p><details><summary className="cursor-pointer text-xs font-semibold">FYERS one-minute candles · {value.candles.length}</summary><div className="mt-2 overflow-x-auto"><table className="algo-os-table"><thead><tr><th>Time · IST</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody>{value.candles.map(c=><tr key={c.at}><td>{istTime(c.at)}</td><td>{c.open}</td><td>{c.high}</td><td>{c.low}</td><td>{c.close}</td><td>{c.volume}</td></tr>)}</tbody></table></div></details></>}
  </div>;
}
