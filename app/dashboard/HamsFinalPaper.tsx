"use client";
import { useEffect, useState } from "react";
import { accountFetch } from "../lib/accountFetch";
import { emptyHamsState, type HamsState } from "../lib/algo/hamsFinalPaper";
import { istDay, istTime } from "../lib/algo/reportDates";
import HistoryDatePicker from "./HistoryDatePicker";
import PaperLifetimeSummary from "./PaperLifetimeSummary";
import PaperAccountSummary from "./PaperAccountSummary";
import { paperCapital } from "../lib/algo/paperCapital";
import type { HamsIncident } from "../lib/algo/hamsHistory";
type Snapshot = { state: HamsState; incidents?: HamsIncident[]; reviewRequired?: boolean; decisions: { id: string; receivedAt: string; status: string }[]; workerOnline: boolean; feedAt: string | null; workerStatus: string; mark: number | null };
const amount = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export default function HamsFinalPaper() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => istDay(new Date().toISOString()));
  useEffect(() => {
    let active = true, pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || !active) return; pending = true;
      try {
        const r = await accountFetch("/api/algo/hams-final", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const body = await r.json(); if (!r.ok) throw new Error(body.error);
        if (active) { setSnapshot(body); setError(""); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "HAMS unavailable."); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const state = snapshot?.state ?? emptyHamsState(), p = state.position;
  const fresh = snapshot?.feedAt && Date.now() - Date.parse(snapshot.feedAt) < 15000;
  const capital=paperCapital(snapshot?{initial:state.rulesV2?1000000:500000,balance:state.balance,position:p,mark:snapshot.mark,fresh:Boolean(fresh&&snapshot.workerOnline),verified:!snapshot.reviewRequired}:null);
  const trades = state.trades.filter(t => !date || istDay(t.openedAt) === date);
  async function toggle() {
    setBusy(true);
    try { const r = await accountFetch("/api/algo/hams-final", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Switch failed."); } finally { setBusy(false); }
  }
  async function acknowledgeRecovery() {
    if(!window.confirm("Keep the unverified trade evidence, exclude its unknown result from P&L, and continue HAMS from the last verified balance and lot size? No historical entry or exit price will be invented."))return;
    setBusy(true);
    try{const r=await accountFetch("/api/algo/hams-final",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"acknowledgeRecovery",excludeUnverified:true})});const b=await r.json();if(!r.ok)throw Error(b.error);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Recovery acknowledgement failed.");}finally{setBusy(false);}
  }
  return <section className="algo-os-card paper-workspace">
    <div className="algo-card-head"><h3>NIFTY HAMS Final · 3 minutes</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="HAMS Final paper entries" checked={state.enabled} disabled={busy || !snapshot || (!state.enabled && !snapshot.workerOnline)} onChange={() => void toggle()} />{state.enabled ? "Entries armed" : "Entries off"}</label></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {snapshot?.reviewRequired && <div role="alert" className="algo-alert-box"><b>HAMS recovery review required</b><span>Entries are blocked while an earlier trade is unverified. The entry switch has not been turned off. Unknown results are excluded from verified P&amp;L.</span><button className="algo-action secondary" type="button" disabled={busy||!snapshot.workerOnline} onClick={()=>void acknowledgeRecovery()}>Exclude unverified result and continue</button></div>}
    <p role="status" className={snapshot?.workerOnline && fresh && !snapshot.reviewRequired ? "text-emerald-600" : "text-red-600"}>{snapshot?.workerOnline ? fresh ? "● Worker online · data receiving" : "● Worker online · market data stale/closed" : "● Worker offline"} · {snapshot?.workerStatus ?? "Loading"}</p>
    <PaperAccountSummary capital={capital} />
    <dl className="paper-operations"><div><dt>Next order</dt><dd>{state.nextLots} lot(s) · no lot cap</dd></div><div><dt>Execution</dt><dd>Limit · emergency market exit</dd></div><div><dt>Session · IST</dt><dd>09:17–14:50</dd></div><div><dt>Status</dt><dd>{state.status.replaceAll("_"," ")}</dd></div></dl>
    <dl className="paper-account-breakdown"><div><dt>HAMS entry grace</dt><dd>Up to 20 seconds from first verified breakout · current premium · limit only</dd></div></dl>
    <details className="paper-history-totals"><summary>Lifetime results · all rule versions</summary><PaperLifetimeSummary realized={`₹${amount(state.trades.reduce((sum,t)=>sum+t.pnl,0))} · new net / legacy gross`} openPnl={capital.openPnl===null?"Unavailable":`₹${amount(capital.openPnl)}`} closedTrades={state.trades.length} /></details>
    <details className="border-y py-3"><summary>Strategy rules · limit orders</summary><dl className="algo-rule-list"><div><dt>Entry</dt><dd>3-minute signal high → CE / low → PE · next 10 candles</dd></div><div><dt>Contract</dt><dd>ATM · nearest weekly expiry · no 35-point filter</dd></div><div><dt>Stop</dt><dd>Entry − min(20 points, 25% of entry)</dd></div><div><dt>Target</dt><dd>Entry + min(100 points, 100% of entry)</dd></div><div><dt>Sizing</dt><dd>Start 1; +1 after loss; no lot cap or daily reset; profitable trade and positive cumulative net resets to 1</dd></div><div><dt>Session</dt><dd>09:17–14:50 IST · no trailing stop</dd></div><div><dt>Reversal</dt><dd>Opposite breakout · confirm exit fill before opposite entry</dd></div><div><dt>Limits</dt><dd>Initial ask + ₹4 / initial bid − ₹4 · market exits only through the verified emergency control</dd></div></dl></details>
    {p && <dl className="algo-rule-list"><div><dt>Open contract</dt><dd>{p.contract.id} · {p.lots} lots</dd></div><div><dt>Entry / stop / target</dt><dd>{amount(p.entry)} / {amount(p.stop)} / {amount(p.target)}</dd></div><div><dt>Capital used</dt><dd>₹{amount(p.entry * p.quantity)}</dd></div></dl>}
    <HistoryDatePicker label="Entry date · IST" value={date} onChange={setDate} allowAll />
    {!!snapshot?.incidents?.length && <><h4 className="mt-4 font-semibold">Unverified trade evidence</h4><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Date</th><th>Time · IST</th><th>Signal ID</th><th>Status</th><th>Details</th></tr></thead><tbody>{snapshot.incidents.filter(i=>!date||istDay(i.at)===date).map(i=><tr key={i.id}><td>{istDay(i.at)}</td><td>{istTime(i.at)}</td><td>{i.signalId}</td><td>{i.status.replaceAll("_"," ")}</td><td>{i.reason}</td></tr>)}</tbody></table></div></>}
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Date</th><th>Contract</th><th>Lots</th><th>Signal · IST</th><th>Received · IST</th><th>Entry · IST</th><th>Premium</th><th>Stop</th><th>Target</th><th>Capital</th><th>Exit date</th><th>Exit · IST</th><th>Exit premium</th><th>P&amp;L</th><th>Reason</th></tr></thead><tbody>{[...trades].reverse().map(t => <tr key={t.signalId}><td>{istDay(t.openedAt)}</td><td>{t.contract.id}</td><td>{t.lots}</td><td>{istTime(t.signalClosedAt)}</td><td>{istTime(t.receivedAt)}</td><td>{istTime(t.openedAt)}</td><td>{amount(t.entry)}</td><td>{amount(t.stop)}</td><td>{amount(t.target)}</td><td>{amount(t.entry*t.quantity)}</td><td>{istDay(t.closedAt)}</td><td>{istTime(t.closedAt)}</td><td>{amount(t.exit)}</td><td>{amount(t.pnl)}</td><td>{t.reason}</td></tr>)}{!trades.length && <tr><td colSpan={15}>No closed HAMS Final trades for this date.</td></tr>}</tbody></table></div>
    <h4 className="mt-4 font-semibold">Signal decisions</h4><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Received date</th><th>Received · IST</th><th>Signal ID</th><th>Decision</th></tr></thead><tbody>{[...(snapshot?.decisions ?? [])].filter(d => !date || istDay(d.receivedAt) === date).reverse().map(d => <tr key={d.id}><td>{istDay(d.receivedAt)}</td><td>{istTime(d.receivedAt)}</td><td>{d.id}</td><td>{d.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
  </section>;
}
