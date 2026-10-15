"use client";

import { useCallback, useEffect, useState } from "react";
import { markets, type PaperBook, type PaperMarket } from "../lib/algo/paperEngine";

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function SignalPaperTrading() {
  const [market, setMarket] = useState<PaperMarket>("BTC");
  const [books, setBooks] = useState<Record<PaperMarket, PaperBook> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/algo/paper", { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books);
      setError("");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Unable to load paper trades.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);

  async function toggle() {
    if (!books || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, enabled: !books[market].enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change switch."); }
    finally { setBusy(false); }
  }
  const book = books?.[market];
  const trades = book?.trades ?? [];
  const wins = trades.filter(trade => trade.points > 0).length;
  const points = trades.reduce((total, trade) => total + trade.points, 0);
  const position = book?.position;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div role="tablist" aria-label="Paper markets" className="flex gap-2">{markets.map(item => <button key={item} type="button" role="tab" aria-selected={market === item} onClick={() => setMarket(item)} className={`algo-action ${market === item ? "primary" : "secondary"}`}>{item === "GOLD" ? "Gold" : item === "NIFTY" ? "NIFTY Index" : "Bitcoin"}</button>)}</div>
      <div className="flex items-center gap-3"><span className="text-sm font-bold">{market} paper trading</span><input aria-label={`${market} paper trading`} type="checkbox" role="switch" checked={book?.enabled ?? false} disabled={!books || busy} onChange={() => void toggle()} className="h-5 w-5 accent-emerald-600" /><span className="text-sm font-bold">{book?.enabled ? "On" : "Off"}</span></div>
    </div>
    {error && <div role="alert" className="algo-alert-box"><b>Paper trading</b><span>{error}</span></div>}
    <div className="algo-os-grid three">
      <div className="algo-os-card metric"><span>Closed trades</span><strong>{trades.length}</strong><p>{wins} wins · {trades.length - wins} other results</p></div>
      <div className="algo-os-card metric"><span>Realized points</span><strong className={points < 0 ? "text-red-600" : "text-emerald-600"}>{number(points)}</strong><p>One unit · gross · costs excluded</p></div>
      <div className="algo-os-card metric"><span>Win rate</span><strong>{trades.length ? `${number(wins / trades.length * 100)}%` : "--"}</strong><p>{market === "BTC" ? "24-hour session" : market === "NIFTY" ? "Session ends 15:15 IST" : "Signal-based session"}</p></div>
    </div>
    <div className="algo-os-card"><div className="algo-card-head"><h3>Open position</h3><span className="algo-pill pending">PAPER</span></div>{position ? <div className="algo-rule-list"><div><span>{position.symbol}</span><b>{position.side}</b></div><div><span>Entry</span><b>{number(position.entry)}</b></div><div><span>Opened</span><b>{time(position.openedAt)}</b></div><div><span>Last signal price</span><b>{book?.lastPrice == null ? "--" : number(book.lastPrice)}</b></div></div> : <div className="algo-empty-state">{book?.enabled ? "Waiting for the next signal." : "Paper trading is off."}</div>}{book?.pendingSessionClose && <div role="alert" className="algo-alert-box"><b>Session exit pending</b><span>No closing price was received at 15:15 IST. This position is excluded from closed-trade results until a verified exit price is available.</span></div>}</div>
    <div className="algo-os-card"><div className="algo-card-head"><h3>Trade results</h3><span className="text-xs text-slate-500">{book?.lastSignalAt ? `Last signal ${time(book.lastSignalAt)}` : "No signal yet"}</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Symbol</th><th>Side</th><th>Entry time</th><th>Entry</th><th>Exit time</th><th>Exit</th><th>Points</th><th>Exit reason</th></tr></thead><tbody>{trades.length ? [...trades].reverse().map(trade => <tr key={trade.id}><td>{trade.symbol}</td><td>{trade.side}</td><td>{time(trade.openedAt)}</td><td>{number(trade.entry)}</td><td>{time(trade.closedAt)}</td><td>{number(trade.exit)}</td><td className={trade.points < 0 ? "text-red-600" : "text-emerald-600"}>{number(trade.points)}</td><td>{trade.reason}</td></tr>) : <tr><td colSpan={8}>No completed trades.</td></tr>}</tbody></table></div></div>
  </div>;
}
