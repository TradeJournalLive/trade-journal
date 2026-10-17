"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { chainWindow } from "../lib/algo/chainWindow";
import OptionPremiumCalculator from "./OptionPremiumCalculator";
type Leg = { symbol: string; side: "CE" | "PE"; strike: number; ltp: number | null; bid: number | null; ask: number | null; timestamp?: number | string | null; oi: number | null; volume: number | null; change: number | null };
type Chain = { contracts: Leg[]; underlying: { symbol: string; ltp: number | null }; expiries: { date: string; expiry: string | number }[]; checkedAt: string; strikeLimit: number };
const format = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "--";
export default function OptionsChain({ calculatorMode = false }: { calculatorMode?: boolean }) {
  const [symbol, setSymbol] = useState("NSE:NIFTY50-INDEX");
  const [expiry, setExpiry] = useState("");
  const [auto, setAuto] = useState(false);
  const [data, setData] = useState<Chain | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [selectedContract, setSelectedContract] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<{ symbol: string; ask: number | null; timestamp: number | string | null }>();
  const [clock, setClock] = useState(Date.now());
  const atmRef = useRef<HTMLTableRowElement>(null);
  const calculatorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selectedContract) calculatorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [selectedContract]);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout>;
    setData(null);
    async function load() {
      setBusy(true);
      try {
        const response = await fetch(`/api/brokers/fyers/chain?${new URLSearchParams({ symbol, expiry })}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!stopped) { setData(result); setError(""); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "Unable to load chain."); }
      finally { if (!stopped) { setBusy(false); if (auto) timer = setTimeout(() => void load(), 5000); } }
    }
    void load();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [symbol, expiry, auto, refresh]);
  useEffect(() => { setSelectedContract(""); setSelectedQuote(undefined); }, [symbol, expiry]);
  function selectPremium(leg: Leg) {
    setSelectedContract(leg.symbol);
    setSelectedQuote({ symbol: leg.symbol, ask: leg.ask, timestamp: leg.timestamp ?? null });
    if (selectedContract === leg.symbol) calculatorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rows = new Map<number, { ce?: Leg; pe?: Leg }>();
  for (const leg of data?.contracts ?? []) {
    const row = rows.get(leg.strike) || {};
    row[leg.side === "CE" ? "ce" : "pe"] = leg; rows.set(leg.strike, row);
  }
  const strikes = [...rows.keys()].sort((a, b) => a - b);
  const spot = data?.underlying.ltp;
  const window = chainWindow(strikes, spot);
  const atm = window.atm;
  const visibleStrikes = window.strikes.filter(strike => String(strike).includes(filter));
  const ist = new Date(clock + 330 * 60000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const outsideSession = [0, 6].includes(ist.getUTCDay()) || minute < 555 || minute >= 930;
  const stale = Boolean(error) || !data || clock - Date.parse(data.checkedAt) > 15000;
  const cells = (leg: Leg | undefined, call: boolean, itm: boolean) => {
    const titles = call ? ["oi", "volume", "bid", "ask", "change", "ltp"] as const : ["ltp", "change", "bid", "ask", "volume", "oi"] as const;
    return titles.map(field => <td key={field} style={{ background: itm ? "#eef4ff" : undefined, textAlign: "right", padding: "10px 12px", fontVariantNumeric: "tabular-nums", fontWeight: field === "ltp" ? 700 : 400, color: field === "change" && typeof leg?.change === "number" ? leg.change < 0 ? "#dc2626" : "#059669" : undefined }}>{field === "ltp" && leg ? <button type="button" title={`Calculate SL and target for ${leg.symbol}`} aria-label={`Calculate ${leg.symbol}`} aria-pressed={selectedContract === leg.symbol} onClick={() => selectPremium(leg)} className={selectedContract === leg.symbol ? "bg-blue-600 px-2 py-1 font-bold text-white" : "text-blue-700 underline decoration-dotted underline-offset-4"}>{format(leg.ltp)}</button> : format(leg?.[field])}</td>);
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
      <label className="text-sm">Underlying<select aria-label="Chain underlying" className="ml-2 rounded-lg border p-2" value={symbol} onChange={event => { setSymbol(event.target.value); setExpiry(""); }}><option value="NSE:NIFTY50-INDEX">NIFTY</option><option value="NSE:NIFTYBANK-INDEX">BANKNIFTY</option><option value="NSE:FINNIFTY-INDEX">FINNIFTY</option></select></label>
      <label className="text-sm">Expiry<select aria-label="Chain expiry" className="ml-2 rounded-lg border p-2" value={expiry} onChange={event => setExpiry(event.target.value)}><option value="">Nearest expiry</option>{data?.expiries.map(item => <option key={item.expiry} value={item.expiry}>{item.date}</option>)}</select></label>
      <label className="text-sm">Strike<input aria-label="Filter strike" className="ml-2 w-28 rounded-lg border p-2" value={filter} onChange={event => setFilter(event.target.value)} inputMode="numeric" /></label>
      <button type="button" title="Refresh option chain" className="algo-action secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>↻</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />Auto refresh</label>
      <button type="button" className="algo-action secondary" onClick={() => { setFilter(""); setTimeout(() => atmRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0); }} disabled={atm === null}>ATM {format(atm)}</button>
    </div>
    <div className="flex flex-wrap justify-between gap-3 text-sm"><b>Index {format(spot)} · ATM {format(atm)} · {window.strikes.length} strikes</b><span>10 ITM · ATM · 10 OTM</span><span>{outsideSession ? "Outside regular session · last available prices" : stale ? "Snapshot unavailable or stale" : "REST snapshot · not a live tick feed"}</span><span>{data ? `Fetched ${new Date(data.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : busy ? "Loading…" : "No snapshot"}</span></div>
    {error && <div role="alert" className="algo-alert-box"><b>Options chain unavailable</b><span>{error} <Link href="/dashboard/algo?section=fyers">FYERS connection</Link></span></div>}
    {selectedContract && <div ref={calculatorRef} className="scroll-mt-24"><OptionPremiumCalculator key={selectedContract} contract={selectedContract} initialQuote={selectedQuote} /></div>}
    {calculatorMode && <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><h2 className="font-semibold">Options chain</h2><span className="text-slate-500">{selectedContract || "No contract selected"}</span></div>}
    <div className="overflow-auto border border-slate-200 bg-white" style={{ maxHeight: "70vh", borderRadius: 6 }}><table className="algo-os-table" style={{ minWidth: 1100, width: "100%", borderCollapse: "separate", borderSpacing: 0 }}><thead className="sticky top-0 z-10 bg-white"><tr><th colSpan={6} style={{ textAlign: "center", background: "#f0fdf4", color: "#047857", padding: 12 }}>CALLS · CE</th><th style={{ background: "#e8edf7", textAlign: "center" }}>STRIKE</th><th colSpan={6} style={{ textAlign: "center", background: "#fff1f2", color: "#be123c", padding: 12 }}>PUTS · PE</th></tr><tr>{["OI", "Volume", "Bid", "Ask", "Change", "LTP", "Strike", "LTP", "Change", "Bid", "Ask", "Volume", "OI"].map((title, index) => <th key={index} style={{ textAlign: index === 6 ? "center" : "right", padding: "10px 12px", background: index === 6 ? "#e8edf7" : "#f8fafc" }}>{title}</th>)}</tr></thead><tbody>{visibleStrikes.map(strike => { const row = rows.get(strike)!; return <tr key={strike} ref={strike === atm ? atmRef : undefined}>{cells(row.ce, true, spot != null && strike < spot)}<td style={{ background: strike === atm ? "#2563eb" : "#f1f5f9", color: strike === atm ? "white" : "#172554", textAlign: "center", fontWeight: 700, padding: "10px 16px", whiteSpace: "nowrap", borderLeft: "1px solid #dbe3ef", borderRight: "1px solid #dbe3ef" }} title={[row.ce?.symbol, row.pe?.symbol].filter(Boolean).join(" / ")}>{format(strike)}{strike === atm ? " · ATM" : ""}</td>{cells(row.pe, false, spot != null && strike > spot)}</tr>; })}{!visibleStrikes.length && <tr><td colSpan={13}>{busy ? "Loading option chain…" : filter ? "No matching strike in the selected window." : "Index price or option contracts unavailable."}</td></tr>}</tbody></table></div>
    <div className="flex flex-wrap gap-4 text-xs text-slate-500"><span><span className="mr-1 inline-block h-3 w-3 border border-blue-100 bg-blue-50" />ITM</span><span>{window.strikes.length < 21 && data ? "Partial strike window returned by FYERS" : "21-strike ATM window"}</span></div>
  </div>;
}
