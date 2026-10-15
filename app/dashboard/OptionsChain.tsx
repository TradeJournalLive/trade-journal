"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
type Leg = { symbol: string; side: "CE" | "PE"; strike: number; ltp: number | null; bid: number | null; ask: number | null; oi: number | null; volume: number | null; change: number | null };
type Chain = { contracts: Leg[]; underlying: { symbol: string; ltp: number | null }; expiries: { date: string; expiry: string | number }[]; checkedAt: string; strikeLimit: number };
const format = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "--";
export default function OptionsChain() {
  const [symbol, setSymbol] = useState("NSE:NIFTY50-INDEX");
  const [expiry, setExpiry] = useState("");
  const [auto, setAuto] = useState(false);
  const [data, setData] = useState<Chain | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [clock, setClock] = useState(Date.now());
  const atmRef = useRef<HTMLTableRowElement>(null);
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
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rows = new Map<number, { ce?: Leg; pe?: Leg }>();
  for (const leg of data?.contracts ?? []) {
    const row = rows.get(leg.strike) || {};
    row[leg.side === "CE" ? "ce" : "pe"] = leg; rows.set(leg.strike, row);
  }
  const strikes = [...rows.keys()].sort((a, b) => a - b);
  const spot = data?.underlying.ltp;
  const atm = spot == null ? null : strikes.reduce<number | null>((best, strike) => best === null || Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best, null);
  const ist = new Date(clock + 330 * 60000);
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const outsideSession = [0, 6].includes(ist.getUTCDay()) || minute < 555 || minute >= 930;
  const stale = Boolean(error) || !data || clock - Date.parse(data.checkedAt) > 15000;
  const cells = (leg?: Leg) => <><td>{format(leg?.oi)}</td><td>{format(leg?.volume)}</td><td>{format(leg?.bid)}</td><td>{format(leg?.ltp)}</td><td>{format(leg?.ask)}</td><td>{format(leg?.change)}</td></>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
      <label className="text-sm">Underlying<select aria-label="Chain underlying" className="ml-2 rounded-lg border p-2" value={symbol} onChange={event => { setSymbol(event.target.value); setExpiry(""); }}><option value="NSE:NIFTY50-INDEX">NIFTY</option><option value="NSE:NIFTYBANK-INDEX">BANKNIFTY</option><option value="NSE:FINNIFTY-INDEX">FINNIFTY</option></select></label>
      <label className="text-sm">Expiry<select aria-label="Chain expiry" className="ml-2 rounded-lg border p-2" value={expiry} onChange={event => setExpiry(event.target.value)}><option value="">Nearest expiry</option>{data?.expiries.map(item => <option key={item.expiry} value={item.expiry}>{item.date}</option>)}</select></label>
      <label className="text-sm">Strike<input aria-label="Filter strike" className="ml-2 w-28 rounded-lg border p-2" value={filter} onChange={event => setFilter(event.target.value)} inputMode="numeric" /></label>
      <button type="button" title="Refresh option chain" className="algo-action secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>↻</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} />Auto refresh</label>
      <button type="button" className="algo-action secondary" onClick={() => { setFilter(""); setTimeout(() => atmRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0); }} disabled={atm === null}>ATM {format(atm)}</button>
    </div>
    <div className="flex flex-wrap justify-between gap-3 text-sm"><b>Index {format(spot)} · {strikes.length} strikes</b><span>{outsideSession ? "Outside regular session · last available prices" : stale ? "Snapshot unavailable or stale" : "REST snapshot · not a live tick feed"}</span><span>{data ? `Fetched ${new Date(data.checkedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : busy ? "Loading…" : "No snapshot"}</span></div>
    {error && <div role="alert" className="algo-alert-box"><b>Options chain unavailable</b><span>{error} <Link href="/dashboard/algo?section=fyers">FYERS connection</Link></span></div>}
    <div className="overflow-auto border border-slate-200 bg-white" style={{ maxHeight: "70vh" }}><table className="algo-os-table" style={{ minWidth: 1050, width: "100%" }}><thead className="sticky top-0 z-10 bg-white"><tr><th colSpan={6} className="text-emerald-700">CALLS · CE</th><th>Strike</th><th colSpan={6} className="text-red-600">PUTS · PE</th></tr><tr>{["OI", "Volume", "Bid", "LTP", "Ask", "Change", "Strike", "OI", "Volume", "Bid", "LTP", "Ask", "Change"].map((title, index) => <th key={index}>{title}</th>)}</tr></thead><tbody>{strikes.filter(strike => String(strike).includes(filter)).map(strike => { const row = rows.get(strike)!; return <tr key={strike} ref={strike === atm ? atmRef : undefined} className={strike === atm ? "bg-blue-50" : ""}>{cells(row.ce)}<td className="border-x border-slate-200 font-bold" title={[row.ce?.symbol, row.pe?.symbol].filter(Boolean).join(" / ")}>{format(strike)}{strike === atm ? " · ATM" : ""}</td>{cells(row.pe)}</tr>; })}{!strikes.length && <tr><td colSpan={13}>{busy ? "Loading option chain…" : "No option contracts returned."}</td></tr>}</tbody></table></div>
    <div className="text-xs text-slate-500">FYERS maximum strike window requested (50). All returned CE/PE contracts are displayed; this may not include every exchange-listed strike. Missing fields are shown as --. Prices are not order fills.</div>
  </div>;
}
