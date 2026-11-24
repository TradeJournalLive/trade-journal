"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accountFetch } from "../lib/accountFetch";
import { niftyFreshSessionAt, type NiftyPaperStatus } from "../lib/algo/niftyLossCycle";
import { istDay, istTime } from "../lib/algo/reportDates";
import NiftyEmergency from "./NiftyEmergency";
import dynamic from "next/dynamic";

const PaperRecoveryReview = dynamic(() => import("./PaperRecoveryReview"));
const PaperIncidentHistory = dynamic(() => import("./PaperIncidentHistory"));

const names = { current: "NIFTY Current", hams: "NIFTY HAMS Final" } as const;
type Strategy = keyof typeof names;
type Snapshot = { dashboard: NiftyPaperStatus | null; workerOnline: boolean; heartbeatAt: string | null };
type Trade = { id: string; openedAt: string; closedAt: string; contract: string; lots: number; entry: number; exit: number; pnl: number; charges: number; reason: string; reconstruction?: {fillVerified:false} | null };
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const display = (n: number | null | undefined) => n == null ? "—" : money.format(n);
const wording = (reason: string) => reason.toLowerCase().replaceAll("_", " ");

function marketHours() {
  const ist = new Date(Date.now() + 330 * 60000), minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && minute >= 557 && minute <= 890;
}

async function read(url: string, signal: AbortSignal) {
  const r = await accountFetch(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "Unable to load paper trading.");
  return body;
}

function SessionHistory({ strategy }: { strategy: Strategy }) {
  const [open, setOpen] = useState(false), [trades, setTrades] = useState<Trade[] | null>(null), [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!open || trades || error) return;
    const controller = new AbortController();
    void read(`/api/algo/paper-session?strategy=${strategy}&view=trades`, controller.signal)
      .then(body => { if (!controller.signal.aborted) setTrades(body.trades.map((t:Trade)=>({...t,reason:t.reconstruction?"RECONSTRUCTED_ESTIMATE_"+t.reason:t.reason}))); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [strategy, open, generation, trades, error]);
  return <details className="border-y border-slate-200" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer py-3 text-sm font-semibold">Closed trades</summary>
    {open && <div className="space-y-2 pb-3">
      <div className="flex justify-between gap-3 text-xs text-slate-600"><span>Latest 50 · from {istDay(niftyFreshSessionAt)}</span><button type="button" className="underline" disabled={!trades && !error} onClick={() => { setError(""); setTrades(null); setGeneration(n=>n+1); }}>Refresh trades</button></div>
      {trades?.some(t=>t.reconstruction)&&<p className="text-xs text-amber-800">Includes user-approved candle-reconstructed estimates, not verified bid/depth fills.</p>}
      {error ? <p role="alert">{error}</p> : !trades ? <p role="status">Loading trades…</p> : !trades.length ? <p className="text-sm text-slate-600">No closed trades in this session yet.</p> :
        <div className="overflow-x-auto"><table className="algo-os-table"><thead><tr><th>Contract</th><th>Lots</th><th>Entry · IST</th><th>Exit · IST</th><th>Entry price</th><th>Exit price</th><th>Charges</th><th>Net P&amp;L</th><th>Exit reason</th></tr></thead><tbody>{trades.map(t=><tr key={`${t.id}:${t.openedAt}`}><td>{t.contract}</td><td>{t.lots}</td><td>{istDay(t.openedAt)} {istTime(t.openedAt)}</td><td>{istDay(t.closedAt)} {istTime(t.closedAt)}</td><td>{display(t.entry)}</td><td>{display(t.exit)}</td><td>{display(t.charges)}</td><td>{display(t.pnl)}</td><td>{wording(t.reason)}</td></tr>)}</tbody></table></div>}
    </div>}
  </details>;
}

function StrategySession({ strategy }: { strategy: Strategy }) {
  const [value, setValue] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null), lastRead = useRef(0), stillOpen = useRef(false);
  const disabledUntil = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (active.current || (!force && Date.now() - lastRead.current < 5000)) return;
    const controller = new AbortController(); active.current = controller; lastRead.current = Date.now();
    try {
      const snapshot: Snapshot = await read(`/api/algo/paper-session?strategy=${strategy}`, controller.signal);
      if (!controller.signal.aborted) { stillOpen.current = Boolean(snapshot.dashboard?.position); setValue(snapshot); setError(""); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Worker status unavailable."); }
    finally { if (active.current === controller) active.current = null; }
  }, [strategy]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    visible();
    const timer = window.setInterval(() => { if (marketHours() || stillOpen.current) visible(); }, 30000);
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    return () => { active.current?.abort(); active.current = null; lastRead.current = 0; clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [refresh]);

  const d = value?.dashboard, p = d?.position;
  const fresh = Boolean(d?.feedAt && Date.now() - Date.parse(d.feedAt) >= 0 && Date.now() - Date.parse(d.feedAt) < 15000);
  async function post(body: Record<string, unknown>) {
    if (busy || Date.now() < disabledUntil.current) return;
    setBusy(true);
    try {
      const r = await accountFetch(strategy === "current" ? "/api/algo/paper" : "/api/algo/hams-final", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await r.json(); if (!r.ok) throw Error(result.error || "Could not save the change.");
      disabledUntil.current = Date.now() + 6000;
      await new Promise(resolve => setTimeout(resolve, 6000));
      await refresh(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the change."); }
    finally { setBusy(false); }
  }
  const status = !value ? "Checking worker…" : !value.workerOnline ? "Worker offline" : d?.reviewRequired ? "Worker online · position monitoring paused" : d?.workerStatus === "OWNERSHIP_UNCONFIRMED" ? "Worker online · ownership unconfirmed" : fresh ? "Worker online · live data" : "Worker online · awaiting live data";
  return <section className="space-y-4" aria-label={names[strategy]}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{names[strategy]}</h2><p className="text-sm text-slate-600">{strategy === "current" ? "1-minute" : "3-minute"} signals · Paper only</p></div>
      <div className="flex flex-wrap items-center gap-4"><button type="button" className="algo-action secondary" onClick={() => void refresh(true)}>Refresh</button><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" role="switch" aria-label={`${names[strategy]} paper entries`} checked={d?.enabled ?? false} disabled={!d || busy || (!d.enabled && (!value?.workerOnline || (strategy === "hams" && d.reviewRequired)))} onChange={() => void post(strategy === "current" ? { market: "NIFTY", niftyOptionsEnabled: !d?.enabled, statusOnly: true } : { enabled: !d?.enabled })} />{busy ? "Updating…" : d?.enabled ? "Entries armed" : "Entries off"}</label></div>
    </div>
    <div role="status" className="flex flex-wrap items-center gap-2 border-y border-slate-200 py-2.5 text-sm"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${d?.reviewRequired || d?.workerStatus === "OWNERSHIP_UNCONFIRMED" ? "bg-amber-500" : value?.workerOnline ? "bg-emerald-600" : "bg-slate-400"}`} /><strong>{status}</strong>{value?.workerOnline === false && d && <span className="text-slate-600">· {wording(d.workerStatus)}</span>}</div>
    {d?.workerStatus === "SIGNAL_STORAGE_RETRY" && <p role="alert" className="text-sm text-amber-700">Signal database read failed; retrying. New alerts may be delayed.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {d?.hasReconstructedResults&&<p className="text-xs text-amber-800">Balances and recovery calculations include approved reconstructed paper estimates.</p>}
    {d?.pendingExit && <p role="alert" className="text-sm text-red-700">Exit awaiting verified quote · {wording(d.pendingExit)}</p>}
    {d?.reviewRequired && <div role="alert" className="flex flex-wrap items-center gap-3 border-l-2 border-amber-500 pl-3 text-sm"><strong>Unverified position needs review</strong>{strategy === "hams" && <button type="button" className="algo-action secondary" disabled={busy || !value?.workerOnline} onClick={() => { if(window.confirm("Exclude the unverified result and keep its audit record?")) void post({ action: "acknowledgeRecovery", excludeUnverified: true }); }}>Exclude and continue</button>}</div>}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3 xl:grid-cols-6">
      <div><dt className="text-xs text-slate-600">Next entry</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{d?.lots == null ? "—" : `${d.lots} ${d.lots === 1 ? "lot" : "lots"}`}</dd></div>
      <div><dt className="text-xs text-slate-600">Loss left to recover</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{display(d?.cycle?.loss)}</dd></div>
      <div><dt className="text-xs text-slate-600">Session net P&amp;L</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${(d?.cycle?.net ?? 0) < 0 ? "text-red-700" : (d?.cycle?.net ?? 0) > 0 ? "text-emerald-700" : ""}`}>{display(d?.cycle?.net)}</dd></div>
      <div><dt className="text-xs text-slate-600">Available paper cash</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{display(d?.cash)}</dd></div>
      <div><dt className="text-xs text-slate-600" title={`Since ${istDay(niftyFreshSessionAt)}; losses before a target plus entry premium. Non-target profits do not reduce this measure.`}>Max capital required</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{display(d?.maxCapitalRequired)}</dd></div>
      <div><dt className="text-xs text-slate-600" title="Profitable verified closed trades after charges / all verified closed trades in the paper session.">Win rate</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{d?.winRate?.closed ? `${(100 * d.winRate.wins / d.winRate.closed).toFixed(1)}%` : "—"}</dd></div>
    </dl>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-sm"><h3 className="font-semibold">Open position</h3>{!p && <span className="text-slate-600">{d ? "No open position" : "Awaiting worker status"}</span>}
      {p && <div className="w-full space-y-1"><p className="font-medium">{p.contract} · {p.lots} lots · {p.quantity} qty{p.lateEntry ? " · Entered late" : ""}</p><p className="flex flex-wrap gap-x-4 text-xs text-slate-600"><span>Entry {display(p.entry)}</span><span>Stop {display(p.stop)}</span><span>Target {display(p.target)}</span><span>Capital {display(p.entry*p.quantity)}</span><span>Open P&amp;L {display(fresh && !d?.reviewRequired && p.mark != null ? (p.mark-p.entry)*p.quantity : null)}</span></p></div>}
    </div>
    {d?.reviewRequired && <PaperRecoveryReview strategy={strategy} />}
    <SessionHistory strategy={strategy} />
    <PaperIncidentHistory strategy={strategy} />
  </section>;
}

export default function NiftyPaperWorkspace() {
  const [strategy, setStrategy] = useState<Strategy>("current");
  return <div className="space-y-4">
    <div role="tablist" aria-label="Paper strategies" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">{(Object.keys(names) as Strategy[]).map(name => <button key={name} type="button" role="tab" aria-selected={strategy === name} className={`algo-action ${strategy === name ? "primary" : "secondary"}`} onClick={() => setStrategy(name)}>{names[name]}</button>)}</div>
    <StrategySession key={strategy} strategy={strategy} />
    <NiftyEmergency />
  </div>;
}
