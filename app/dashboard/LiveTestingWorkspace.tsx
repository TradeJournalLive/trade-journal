"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Download, FlaskConical, LockKeyhole, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { accountFetch } from "../lib/accountFetch";
import type { NiftyPaperStatus } from "../lib/algo/niftyLossCycle";
import { buildRehearsalPlan, liveRehearsalMode, runRehearsalChecks, type LiveTestStrategy, type RehearsalDraft, type RehearsalMarket } from "../lib/algo/liveRehearsal";

const names = { current: "NIFTY Current", hams: "NIFTY HAMS Final" };
const money = (n: number | null) => n === null || !Number.isFinite(n) ? "--" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const time = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const initialDraft = (): RehearsalDraft => ({ symbol: "", recoveryLoss: 0, limit: 0, stop: 0, target: 0, maxLots: 1, maxCapital: 20000, dailyLossLimit: 2500, dayNet: 0, estimatedCharges: 0, maxSpread: 2, maxSlippage: 2 });
type Worker = { dashboard: NiftyPaperStatus | null; workerOnline: boolean; heartbeatAt: string | null };
type Readiness = { at: string; quoteOK: boolean; quoteError: string; workers: Partial<Record<LiveTestStrategy, Worker>>; errors: Partial<Record<LiveTestStrategy, string>> };
type TestResults = ReturnType<typeof runRehearsalChecks>;
const fieldClass = "mt-1.5 block h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600";

async function read(url: string, signal: AbortSignal) {
  const response = await accountFetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || `Read failed (${response.status}).`);
  return body;
}
function StateIcon({ ok }: { ok: boolean | null }) {
  const Icon = ok === null ? Circle : ok ? CheckCircle2 : XCircle;
  return <Icon size={16} aria-hidden="true" className={`shrink-0 ${ok === null ? "text-slate-400" : ok ? "text-emerald-600" : "text-amber-700"}`} />;
}

export default function LiveTestingWorkspace() {
  const [tab, setTab] = useState<"readiness" | "rehearsal" | "tests">("readiness");
  const [strategy, setStrategy] = useState<LiveTestStrategy>("current");
  const [drafts, setDrafts] = useState<Record<LiveTestStrategy, RehearsalDraft>>({ current: initialDraft(), hams: initialDraft() });
  const [markets, setMarkets] = useState<Partial<Record<LiveTestStrategy, RehearsalMarket>>>({});
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [results, setResults] = useState<{ at: string; rows: TestResults } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const draft = drafts[strategy], market = markets[strategy] ?? null;
  const plan = useMemo(() => buildRehearsalPlan(draft, market, now), [draft, market, now]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!market) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 5100);
    return () => window.clearTimeout(timer);
  }, [market]);
  function change(key: keyof RehearsalDraft, value: string) {
    setError(""); setNow(Date.now());
    setDrafts(all => ({ ...all, [strategy]: { ...all[strategy], [key]: key === "symbol" ? value.trim().toUpperCase() : value.trim() === "" ? NaN : Number(value) } }));
    if (key === "symbol") setMarkets(all => { const next = { ...all }; delete next[strategy]; return next; });
  }
  async function task(action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try { await action(AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Check unavailable."); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted) { setBusy(false); setNow(Date.now()); } } }
  }
  async function inspect() {
    await task(async signal => {
      const value: Readiness = { at: new Date().toISOString(), quoteOK: false, quoteError: "", workers: {}, errors: {} };
      try {
        const body = await read("/api/brokers/fyers/quotes?symbols=NSE:NIFTY50-INDEX", signal);
        value.quoteOK = Array.isArray(body.quotes) && body.quotes.some((q: { symbol?: string; status?: string; ltp?: number }) => q.symbol === "NSE:NIFTY50-INDEX" && q.status === "ok" && typeof q.ltp === "number" && Number.isFinite(q.ltp) && q.ltp > 0);
        if (!value.quoteOK) value.quoteError = "No valid index quote returned.";
      } catch (cause) { value.quoteError = cause instanceof Error ? cause.message : "FYERS check unavailable."; }
      for (const id of ["current", "hams"] as const) {
        try { value.workers[id] = await read(`/api/algo/paper-session?strategy=${id}`, signal); }
        catch (cause) { value.errors[id] = cause instanceof Error ? cause.message : "Worker check unavailable."; }
      }
      signal.throwIfAborted(); setReadiness(value);
    });
  }
  async function loadMarket() {
    const selected = strategy, symbol = draft.symbol;
    if (!/^NSE:NIFTY[A-Z0-9]+(?:CE|PE)$/.test(symbol)) { setError("Enter an exact FYERS NIFTY CE or PE contract symbol."); return; }
    setMarkets(all => { const next = { ...all }; delete next[selected]; return next; });
    await task(async signal => {
      const size = await read(`/api/brokers/fyers/contract-size?${new URLSearchParams({ symbol })}`, signal);
      if (size.symbol !== symbol || !Number.isSafeInteger(size.lotSize) || size.lotSize <= 0) throw Error("This contract was not found in the FYERS contract master.");
      const body = await read(`/api/brokers/fyers/quotes?${new URLSearchParams({ symbols: symbol })}`, signal);
      const quote = Array.isArray(body.quotes) ? body.quotes.find((q: { symbol?: string }) => q.symbol === symbol) : null;
      if (!quote || quote.status !== "ok") throw Error("FYERS did not return a valid quote for this contract.");
      if (!signal.aborted) setMarkets(all => ({ ...all, [selected]: { symbol, lotSize: size.lotSize, status: quote.status, bid: typeof quote.bid === "number" ? quote.bid : null, ask: typeof quote.ask === "number" ? quote.ask : null, timestamp: quote.timestamp ?? null } }));
    });
  }
  function download() {
    const result = buildRehearsalPlan(draft, market, Date.now());
    const blob = new Blob([JSON.stringify({ broker: "FYERS", strategy, generatedAt: new Date().toISOString(), mode: liveRehearsalMode, realOrdersEnabled: false, draft, market, result }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `fyers-${strategy}-rehearsal.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function numeric(key: Exclude<keyof RehearsalDraft, "symbol">, label: string, options: { min?: number; step?: string } = {}) {
    return <label className="min-w-0 text-xs font-medium text-slate-600" key={key}>{label}<input type="number" aria-label={label} value={Number.isNaN(draft[key]) ? "" : draft[key]} min={options.min} step={options.step ?? "0.01"} onChange={e => change(key, e.target.value)} className={fieldClass} /></label>;
  }
  const gaps = [
    ["Broker order permissions & static IP", "Not verified"],
    ["Actual funds & margin", "Not queried"],
    ["Broker-side SL / target protection", "Not verified"],
    ["Duplicate orders & partial fills", "Integration test pending"],
    ["Worker restart & price-gap recovery", "Integration test pending"],
    ["Reporting outage & durable order journal", "Integration test pending"],
    ["Live rollout approval", "Not granted"]
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status"><span className="flex items-center gap-2 font-semibold"><LockKeyhole size={17} aria-hidden="true" />Real orders locked</span><span>FYERS · Rehearsal only</span></div>
    <div role="tablist" aria-label="Live testing views" className="flex flex-wrap gap-1 border-b border-slate-200">{([["readiness", "Readiness"], ["rehearsal", "Order rehearsal"], ["tests", "Test results"]] as const).map(([id, label]) => <button type="button" role="tab" id={`live-tab-${id}`} aria-controls={`live-panel-${id}`} aria-selected={tab === id} key={id} onClick={() => { setTab(id); setError(""); setNow(Date.now()); }} className={`min-h-11 border-b-2 px-3 text-sm font-semibold ${tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{label}</button>)}</div>
    {error && <p role="alert" className="border-l-2 border-red-600 pl-3 text-sm text-red-800">{error}</p>}
    <section role="tabpanel" id={`live-panel-${tab}`} aria-labelledby={`live-tab-${tab}`} className="space-y-5">
      {tab === "readiness" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Connection snapshot</h2><p className="mt-1 text-xs text-slate-500">{readiness ? `Checked ${time(readiness.at)} IST` : "Not checked"}</p></div><button type="button" className="algo-action secondary inline-flex items-center gap-2" onClick={() => void inspect()} disabled={busy}><RefreshCw size={16} aria-hidden="true" />{busy ? "Checking..." : "Check connections"}</button></div>
        <dl className="divide-y divide-slate-200 border-y border-slate-200 text-sm"><div className="flex flex-wrap items-center justify-between gap-2 py-3"><dt className="font-medium">FYERS quote access</dt><dd className="flex items-center gap-2"><StateIcon ok={readiness ? readiness.quoteOK : null} />{!readiness ? "Not checked" : readiness.quoteOK ? "Responding · snapshot only" : readiness.quoteError}</dd></div>{(["current", "hams"] as const).map(id => { const w = readiness?.workers[id], d = w?.dashboard; return <div className="flex flex-wrap justify-between gap-2 py-3" key={id}><dt className="font-medium">{names[id]} paper worker</dt><dd className="flex max-w-full flex-wrap items-center gap-2 text-right"><StateIcon ok={!readiness ? null : Boolean(w?.workerOnline && d && !d.reviewRequired && !d.pendingExit && d.workerStatus !== "OWNERSHIP_UNCONFIRMED")} />{!readiness ? "Not checked" : readiness.errors[id] || (!w?.workerOnline ? "Offline / unverified" : d?.reviewRequired ? "Recovery review" : d?.pendingExit ? "Exit pending" : d?.workerStatus === "OWNERSHIP_UNCONFIRMED" ? "Ownership unconfirmed" : d?.position ? "Running · position open" : "Running · flat")}</dd></div>; })}</dl>
        <div><h2 className="text-lg font-semibold">Live execution gates</h2><div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">{gaps.map(([label, state]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{label}</span><span className="flex items-center gap-2 text-slate-600"><Circle size={14} aria-hidden="true" />{state}</span></div>)}</div></div>
      </>}
      {tab === "rehearsal" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Manual order plan</h2><p className="mt-1 text-xs text-slate-500">BUY · LIMIT · Intraday · Unsaved draft</p></div><label className="text-xs text-slate-600">Strategy<select aria-label="Rehearsal strategy" value={strategy} onChange={e => { setStrategy(e.target.value as LiveTestStrategy); setError(""); setNow(Date.now()); }} className={fieldClass}>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 basis-64 text-xs font-medium text-slate-600">FYERS option symbol<input aria-label="FYERS option symbol" spellCheck={false} autoComplete="off" value={draft.symbol} onChange={e => change("symbol", e.target.value)} className={fieldClass} placeholder="NSE:NIFTY...CE or PE" /></label><button type="button" onClick={() => void loadMarket()} disabled={busy || !draft.symbol} className="algo-action secondary inline-flex items-center gap-2"><RefreshCw size={16} aria-hidden="true" />{busy ? "Loading..." : "Load snapshot"}</button></div>
        <div className="grid grid-cols-2 gap-3 border-y border-slate-200 py-3 text-sm sm:grid-cols-4">{[["Contract lot size", market?.lotSize ?? "--"], ["Bid", money(market?.bid ?? null)], ["Ask", money(market?.ask ?? null)], ["Source", market ? "FYERS snapshot" : "Not loaded"]].map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p></div>)}</div>
        <fieldset><legend className="text-sm font-semibold">Entry and protection plan</legend><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{numeric("limit", "Buy limit (INR)", { min: 0 })}{numeric("stop", "Stop (INR)", { min: 0 })}{numeric("target", "Target (INR)", { min: 0 })}{numeric("recoveryLoss", "Recovery loss after charges (INR)", { min: 0 })}{numeric("dayNet", "Today's net P&L (INR)")}{numeric("estimatedCharges", "Estimated round-trip charges (INR)", { min: 0 })}</div></fieldset>
        <fieldset className="border-t border-slate-200 pt-4"><legend className="pr-3 text-sm font-semibold">Draft risk limits</legend><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">{numeric("maxLots", "Maximum lots", { min: 1, step: "1" })}{numeric("maxCapital", "Capital allowance (INR)", { min: 0 })}{numeric("dailyLossLimit", "Daily loss allowance (INR)", { min: 0 })}{numeric("maxSpread", "Maximum spread (INR)", { min: 0 })}{numeric("maxSlippage", "Limit slippage allowance (INR)", { min: 0 })}</div></fieldset>
        <div className="border-y border-slate-200 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><StateIcon ok={plan.valid} />{plan.valid ? "Draft checks pass" : "Draft blocked"}</h3><button type="button" onClick={download} className="algo-action secondary inline-flex items-center gap-2"><Download size={16} aria-hidden="true" />Export draft</button></div><dl className="mt-4 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">{[["Sheet size", plan.lots === null ? "--" : `${plan.lots} ${plan.lots === 1 ? "lot" : "lots"}`], ["Quantity", plan.quantity ?? "--"], ["Capital + charges", money(plan.capital)], ["Planned stop loss + charges", money(plan.plannedLoss)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{value}</dd></div>)}</dl><p className="mt-3 flex items-center gap-2 text-xs text-amber-800"><LockKeyhole size={14} aria-hidden="true" />No broker order or protective order has been submitted.</p></div>
        <details className="border-b border-slate-200 pb-3"><summary className="cursor-pointer text-sm font-semibold">Validation details · {plan.checks.filter(c => c.ok).length}/{plan.checks.length}</summary><ul className="mt-3 divide-y divide-slate-200">{plan.checks.map(c => <li key={c.code} className="flex gap-2 py-2 text-sm"><StateIcon ok={c.ok} /><div><p className="font-medium">{c.label}</p><p className="mt-0.5 text-xs text-slate-600">{c.detail}</p></div></li>)}</ul></details>
      </>}
      {tab === "tests" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Local validation tests</h2><p className="mt-1 text-xs text-slate-500">Synthetic fixtures · {results ? time(results.at) + " IST" : "Not run"}</p></div><button type="button" className="algo-action primary inline-flex items-center gap-2" onClick={() => setResults({ at: new Date().toISOString(), rows: runRehearsalChecks() })}><Play size={16} aria-hidden="true" />Run checks</button></div>
        {!results ? <div className="flex items-center gap-3 border-y border-slate-200 py-8 text-sm text-slate-600"><FlaskConical size={20} aria-hidden="true" />No validation run recorded.</div> : <><p role="status" className="text-sm font-semibold">{results.rows.filter(r => r.passed).length}/{results.rows.length} checks passed · Live integration not certified</p><ul className="divide-y divide-slate-200 border-y border-slate-200">{results.rows.map(r => <li key={r.name} className="flex items-start gap-3 py-3 text-sm"><StateIcon ok={r.passed} /><div><p className="font-medium">{r.name} · {r.passed ? "Passed" : "Failed"}</p><p className="mt-1 text-xs text-slate-600">{r.detail}</p></div></li>)}</ul></>}
        <div className="flex items-start gap-2 border-l-2 border-amber-500 pl-3 text-sm text-amber-900"><ShieldAlert size={18} className="shrink-0" aria-hidden="true" /><p>Broker fills, funds, protection and restart recovery remain unverified.</p></div>
      </>}
    </section>
  </div>;
}
