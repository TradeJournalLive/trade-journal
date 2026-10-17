"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { premiumCalculation } from "../lib/algo/premiumCalculator";
type Reference = { symbol: string; candle: { openedAt: string; closedAt: string; low: number; close: number }; lotSize: number | null };
type Snapshot = { symbol: string; ask: number | null; timestamp: number | string | null };
const references = new Map<string, { value: Reference; at: number; bucket: number }>();
const lotSizes = new Map<string, { value: number; at: number }>();
const n = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
export default function OptionPremiumCalculator({ contract = "", initialQuote }: { contract?: string; initialQuote?: Snapshot }) {
  const [symbol, setSymbol] = useState(contract), [mode, setMode] = useState("MARKET"), [entry, setEntry] = useState(""), [lots, setLots] = useState("1"), [size, setSize] = useState("");
  const [reference, setReference] = useState<Reference | null>(null), [ask, setAsk] = useState<number | null>(null), [quoteAt, setQuoteAt] = useState<string | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [autoSize, setAutoSize] = useState<number | null>(null);
  useEffect(() => { setSymbol(contract); }, [contract]);
  useEffect(() => {
    setReference(null); setAsk(null); setQuoteAt(null); setSize(""); setAutoSize(null); setError(""); setBusy(false);
    if (!/^NSE:[A-Z0-9]{4,55}(CE|PE)$/.test(symbol)) return;
    let stopped = false; const controller = new AbortController();
    const failed = (cause: unknown) => { if (!stopped) setError(previous => previous || (cause instanceof Error ? cause.message : "Unable to load premium data.")); };
    async function get(path: string) {
      const response = await fetch(`${path}?${new URLSearchParams({ symbol })}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
    }
    const cached = references.get(symbol), bucket = Math.floor(Date.now() / 300000);
    if (refresh === 0 && cached && cached.bucket === bucket && Date.now() - cached.at < 10000) setReference(cached.value);
    else {
      setBusy(true);
      void get("/api/brokers/fyers/premium-reference").then(data => {
        if (stopped) return;
        references.delete(symbol); references.set(symbol, { value: data, at: Date.now(), bucket });
        while (references.size > 64) references.delete(references.keys().next().value!);
        setReference(data);
      }).catch(failed).finally(() => { if (!stopped) setBusy(false); });
    }
    const cachedSize = lotSizes.get(symbol);
    if (cachedSize && Date.now() - cachedSize.at < 3600000) { setSize(String(cachedSize.value)); setAutoSize(cachedSize.value); }
    else void get("/api/brokers/fyers/contract-size").then(data => {
      if (stopped || !Number.isSafeInteger(data.lotSize) || data.lotSize <= 0) return;
      lotSizes.set(symbol, { value: data.lotSize, at: Date.now() });
      while (lotSizes.size > 256) lotSizes.delete(lotSizes.keys().next().value!);
      setAutoSize(data.lotSize); setSize(previous => previous || String(data.lotSize));
    }).catch(() => { /* Lot size can be confirmed manually without blocking candle levels. */ });
    const initialAt = Number(initialQuote?.timestamp) * 1000;
    if (refresh === 0 && initialQuote?.symbol === symbol && Number(initialQuote.ask) > 0 && Date.now() - initialAt >= 0 && Date.now() - initialAt <= 15000) {
      setAsk(initialQuote.ask); setQuoteAt(new Date(initialAt).toISOString());
    } else void fetch(`/api/brokers/fyers/quotes?${new URLSearchParams({ symbols: symbol })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const quote = data.quotes?.find((q: { symbol: string }) => q.symbol === symbol), price = Number(quote?.ask), stamp = Number(quote?.timestamp) * 1000;
      if (!stopped && quote?.status === "ok" && price > 0 && Number.isFinite(stamp)) { setAsk(price); setQuoteAt(new Date(stamp).toISOString()); }
    }).catch(failed);
    return () => { stopped = true; controller.abort(); };
  }, [symbol, refresh, initialQuote]);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const quoteFresh = quoteAt && clock - Date.parse(quoteAt) >= 0 && clock - Date.parse(quoteAt) <= 15000;
  const price = mode === "LIMIT" ? Number(entry) : quoteFresh ? ask ?? NaN : NaN;
  let result: ReturnType<typeof premiumCalculation> | null = null, validation = "";
  if (reference && Number.isFinite(price)) { try { result = premiumCalculation(reference.candle.close, reference.candle.low, price, Number(lots), Number(size)); } catch (cause) { validation = (cause as Error).message; } }
  return <section className="space-y-4 border-y border-slate-200 py-5" aria-label="Option premium calculator">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Option premium calculator</h2><span className="text-xs text-slate-500">BUY CE / PE · 5 min · Calculator only</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm sm:col-span-2">Option contract<input aria-label="Calculator contract" value={symbol} onChange={e => { setSymbol(e.target.value.trim().toUpperCase()); setEntry(""); }} placeholder="Select CE or PE from Options Chain" className="mt-1 block w-full rounded-md border p-2" /></label>
      <label className="text-sm">Entry type<select value={mode} onChange={e => setMode(e.target.value)} className="mt-1 block w-full rounded-md border bg-white p-2"><option value="MARKET">Market · ask estimate</option><option value="LIMIT">Limit · planned price</option></select></label>
      <label className="text-sm">{mode === "LIMIT" ? "Limit premium" : "Ask snapshot"}<input type="number" min="0" step="any" value={mode === "LIMIT" ? entry : ask ?? ""} readOnly={mode === "MARKET"} onChange={e => setEntry(e.target.value)} className="mt-1 block w-full rounded-md border p-2" /></label>
      <label className="text-sm">Lots<input type="number" min="1" step="1" value={lots} onChange={e => setLots(e.target.value)} className="mt-1 block w-full rounded-md border p-2" /></label>
      <label className="text-sm">Units per lot{!autoSize && " · confirm manually"}<input type="number" min="1" step="1" value={size} onChange={e => setSize(e.target.value)} className="mt-1 block w-full rounded-md border p-2" /></label>
      <button type="button" onClick={() => setRefresh(v => v + 1)} disabled={busy || !symbol} className="algo-action secondary self-end">{busy ? "Loading..." : "Refresh reference"}</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error} <Link href="/dashboard/algo?section=fyers" className="underline">FYERS connection</Link></p>}
    {reference && <><p className="text-xs text-slate-500">Reference close: {new Date(reference.candle.closedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · Close ₹{n(reference.candle.close)} · Low ₹{n(reference.candle.low)}{clock - Date.parse(reference.candle.closedAt) > 600000 ? " · Older reference candle" : ""}</p><div className="flex flex-wrap gap-6 text-sm"><b>SL ₹{n(reference.candle.low)}</b><b>Target ₹{n(reference.candle.close + 1.5 * (reference.candle.close - reference.candle.low))}</b></div></>}
    {mode === "MARKET" && reference && !quoteFresh && <p role="status" className="text-sm text-amber-700">No fresh executable ask snapshot. Refresh during market hours or enter a planned limit price.</p>}
    {validation && <p role="alert" className="text-sm text-amber-700">{validation}</p>}
    {result && <><dl className="grid gap-4 border-y py-4 sm:grid-cols-4">{[["Quantity", n(result.quantity)], ["Entry value", `₹${n(result.entryValue)}`], ["Risk at SL", `₹${n(result.riskAmount)}`], ["Reward at target", `₹${n(result.rewardAmount)}`]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-bold">{value}</dd></div>)}</dl><p className="text-sm">Entry-based R:R {result.actualRR === null ? "--" : `1:${n(result.actualRR)}`}{result.warning ? ` · ${result.warning}` : ""}</p></>}
    <p className="text-xs text-slate-500">Target = candle close + 1.5 × (close − low). Gross amounts exclude fees and slippage. Market price is an estimate, not a fill. No orders or protective stops are placed.</p>
  </section>;
}
