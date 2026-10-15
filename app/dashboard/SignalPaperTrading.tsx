"use client";

import { useCallback, useEffect, useState } from "react";
import { markets, type PaperBook, type PaperMarket, type paperValuation } from "../lib/algo/paperEngine";

type LivePaperBook = PaperBook & { valuation: ReturnType<typeof paperValuation> };

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function SignalPaperTrading() {
  const [market, setMarket] = useState<PaperMarket>("BTC");
  const [books, setBooks] = useState<Record<PaperMarket, LivePaperBook> | null>(null);
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

  async function toggle(nextCandle?: boolean) {
    if (!books || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, enabled: nextCandle === undefined ? !books[market].enabled : books[market].enabled, ...(nextCandle !== undefined ? { nextCandle, slippage: 0 } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change switch."); }
    finally { setBusy(false); }
  }
  async function saveSlippage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!books || busy) return;
    const slippage = Number(new FormData(event.currentTarget).get("slippage"));
    if (!Number.isFinite(slippage) || slippage < 0) return;
    setBusy(true);
    try {
      const response = await fetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, enabled: books[market].enabled, slippage }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save slippage."); }
    finally { setBusy(false); }
  }
  const book = books?.[market];
  const trades = (book?.trades ?? []).filter(trade => !book?.symbol || trade.symbol === book.symbol);
  const wins = trades.filter(trade => trade.points > 0).length;
  const points = trades.reduce((total, trade) => total + trade.points, 0);
  const gross = trades.reduce((total, trade) => total + trade.grossPoints, 0);
  const slippageCost = trades.reduce((total, trade) => total + trade.slippagePoints, 0);
  const position = book?.position;
  const valuation = book?.valuation;
  const pnl = (value: number | null | undefined) => value == null ? "--" : `${value > 0 ? "+" : ""}${number(value)}`;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div role="tablist" aria-label="Paper markets" className="flex gap-2">{markets.map(item => <button key={item} type="button" role="tab" aria-selected={market === item} onClick={() => setMarket(item)} className={`algo-action ${market === item ? "primary" : "secondary"}`}>{item === "GOLD" ? "Gold" : item === "NIFTY" ? "NIFTY Index" : "Bitcoin"}</button>)}</div>
      <div className="flex items-center gap-3"><span className="text-sm font-bold">{market} paper trading</span><input aria-label={`${market} paper trading`} type="checkbox" role="switch" checked={book?.enabled ?? false} disabled={!books || busy} onChange={() => void toggle()} className="h-5 w-5 accent-emerald-600" /><span className="text-sm font-bold">{book?.enabled ? "On" : "Off"}</span></div>
    </div>
    {error && <div role="alert" className="algo-alert-box"><b>Paper trading</b><span>{error}</span></div>}
    <div className="algo-os-grid three">
      <div className="algo-os-card metric"><span>Open trade P&amp;L · points</span><strong className={(valuation?.unrealized ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}>{pnl(valuation?.unrealized)}</strong><p>{position ? `${position.symbol} · ${position.side} · Entry ${number(position.entry)}` : "No open trade"}</p></div>
      <div className="algo-os-card metric"><span>Booked P&amp;L · points</span><strong>{pnl(valuation?.realized)}</strong><p>Completed paper trades</p></div>
      <div className="algo-os-card metric"><span>Total P&amp;L · points</span><strong>{pnl(valuation?.total)}</strong><p>Booked + open mark-to-market · fees excluded</p></div>
    </div>
    {position && <div className="algo-alert-box"><b>{error ? "Price unavailable" : valuation?.stale ? "Stale price" : "Latest received price"}</b><span>{valuation?.mark ? `${valuation.mark.symbol} · ${number(valuation.mark.price)} · ${valuation.mark.source} · ${time(valuation.mark.timestamp)}` : "Waiting for a matching-feed price"}. Not a continuous live quote feed.</span></div>}
    <div className="flex flex-wrap items-center gap-3"><label className="text-sm font-bold"><input type="checkbox" checked={book?.nextCandle ?? false} disabled={!books || busy} onChange={event => void toggle(event.target.checked)} className="mr-2" />Next-candle open execution</label><span className="text-xs text-slate-500">{book?.nextCandle ? "Verified candle-open feed required" : "Legacy signal-price execution"}</span></div>
    {book?.pending && <div role="status" className="algo-alert-box"><b>Awaiting next candle open</b><span>{book.pending.action} · {book.pending.symbol} · Signal {number(book.pending.signalPrice)} · Expected candle {time(book.pending.openTime)}</span></div>}
    <form onSubmit={saveSlippage} className="flex flex-wrap items-end gap-3 border-b border-slate-200 pb-4">
      <div className="mr-auto text-sm"><b>{book?.symbol || "Signal price feed"}</b><p className="text-xs text-slate-500">Slippage is assumed per fill in price points, not measured broker slippage. Spread and fees are excluded.</p></div>
      <label className="text-xs font-bold">Slippage per fill<input key={`${market}-${book?.slippage}`} name="slippage" aria-label="Slippage per fill" type="number" min="0" max="100000" step="0.01" defaultValue={book?.slippage ?? 0} className="mt-1 block h-9 w-28 rounded-lg border border-slate-200 px-2" /></label>
      <button type="submit" disabled={!books || busy} className="algo-action secondary">Save assumption</button>
    </form>
    <div className="algo-os-grid three">
      <div className="algo-os-card metric"><span>Closed trades</span><strong>{trades.length}</strong><p>{wins} wins · {trades.length - wins} other results</p></div>
      <div className="algo-os-card metric"><span>Net points after slippage</span><strong className={points < 0 ? "text-red-600" : "text-emerald-600"}>{number(points)}</strong><p>Gross {number(gross)} · modeled slippage {number(slippageCost)}</p></div>
      <div className="algo-os-card metric"><span>Win rate</span><strong>{trades.length ? `${number(wins / trades.length * 100)}%` : "--"}</strong><p>{market === "BTC" ? "24-hour session" : market === "NIFTY" ? "Session ends 15:15 IST" : "Signal-based session"}</p></div>
    </div>
    {Boolean(book?.unresolvedPositions?.length) && <div className="algo-alert-box"><b>Earlier feed positions retained</b><span>{book?.unresolvedPositions.map(item => `${item.symbol} ${item.side} at ${number(item.entry)}`).join("; ")}. These remain unresolved and are excluded from results for this feed.</span></div>}
    <div className="algo-os-card"><div className="algo-card-head"><h3>Open position</h3><span className="algo-pill pending">PAPER</span></div>{position ? <div className="algo-rule-list"><div><span>{position.symbol}</span><b>{position.side}</b></div><div><span>Entry</span><b>{number(position.entry)}</b></div><div><span>Opened</span><b>{time(position.openedAt)}</b></div><div><span>Last signal price</span><b>{book?.lastPrice == null ? "--" : number(book.lastPrice)}</b></div></div> : <div className="algo-empty-state">{book?.enabled ? "Waiting for the next signal." : "Paper trading is off."}</div>}{book?.pendingSessionClose && <div role="alert" className="algo-alert-box"><b>Session exit pending</b><span>No closing price was received at 15:15 IST. This position is excluded from closed-trade results until a verified exit price is available.</span></div>}</div>
    <div className="algo-os-card"><div className="algo-card-head"><h3>Trade results</h3><span className="text-xs text-slate-500">{book?.lastSignalAt ? `Last signal ${time(book.lastSignalAt)}` : "No signal yet"}</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Symbol</th><th>Side</th><th>Entry time</th><th>Entry</th><th>Exit time</th><th>Exit</th><th>Points</th><th>Exit reason</th></tr></thead><tbody>{trades.length ? [...trades].reverse().map(trade => <tr key={trade.id}><td>{trade.symbol}</td><td>{trade.side}</td><td>{time(trade.openedAt)}</td><td>{number(trade.entry)}</td><td>{time(trade.closedAt)}</td><td>{number(trade.exit)}</td><td className={trade.points < 0 ? "text-red-600" : "text-emerald-600"}>{number(trade.points)}</td><td>{trade.reason}</td></tr>) : <tr><td colSpan={8}>No completed trades.</td></tr>}</tbody></table></div></div>
  </div>;
}
