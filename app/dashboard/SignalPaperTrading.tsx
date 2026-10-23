"use client";
import { accountFetch } from "../lib/accountFetch";

import { useCallback, useEffect, useRef, useState } from "react";
import { markets, type PaperMarket } from "../lib/algo/paperEngine";
import { niftyRules } from "../lib/algo/niftyRules";
import BtcDeltaPaper, { type BtcDeltaBook } from "./BtcDeltaPaper";
import type { loadPaperBooks } from "../lib/algo/paperHistory";
import { istDay, istTime, onTradeDate } from "../lib/algo/reportDates";
import HistoryDatePicker from "./HistoryDatePicker";
import GoogleSheetsConnection from "./GoogleSheetsConnection";
import GoldMt5Paper from "./GoldMt5Paper";
import PaperLifetimeSummary from "./PaperLifetimeSummary";

type LivePaperBook = Awaited<ReturnType<typeof loadPaperBooks>>[string];

const number = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function SignalPaperTrading() {
  const [market, setMarket] = useState<PaperMarket>("NIFTY");
  const [tradeDate, setTradeDate] = useState(() => istDay(new Date().toISOString()));
  const [books, setBooks] = useState<Record<PaperMarket, LivePaperBook> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const requestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const id = ++requestId.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    setRefreshing(true);
    try {
      const response = await accountFetch("/api/algo/paper", { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (id === requestId.current) { setBooks(result.books); setError(""); }
    } catch (cause) {
      if (id === requestId.current && (timedOut || !controller.signal.aborted)) setError(timedOut ? "Paper status refresh timed out." : cause instanceof Error ? cause.message : "Unable to load paper trades.");
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (id === requestId.current) { activeRequest.current = null; setRefreshing(false); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const visible = () => { if (document.visibilityState === "visible") void refresh(controller.signal); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !activeRequest.current) visible(); }, 5000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); activeRequest.current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  async function toggle(nextCandle?: boolean) {
    if (!books || busy) return;
    setBusy(true);
    try {
      const response = await accountFetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, enabled: nextCandle === undefined ? !books[market].enabled : books[market].enabled, ...(nextCandle !== undefined ? { nextCandle, slippage: 0 } : {}) }) });
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
      const response = await accountFetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market, enabled: books[market].enabled, slippage }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save slippage."); }
    finally { setBusy(false); }
  }
  async function toggleOptions() {
    if (!books || busy) return;
    setBusy(true);
    try {
      const response = await accountFetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: "NIFTY", enabled: books.NIFTY.enabled, niftyOptionsEnabled: !books.NIFTY.options?.enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBooks(result.books); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change options switch."); }
    finally { setBusy(false); }
  }
  const book = books?.[market];
  const trades = onTradeDate((book?.trades ?? []).filter(trade => !book?.symbol || trade.symbol === book.symbol), tradeDate);
  const optionTrades = onTradeDate(book?.options?.trades ?? [], tradeDate);
  const wins = trades.filter(trade => trade.points > 0).length;
  const points = trades.reduce((total, trade) => total + trade.points, 0);
  const gross = trades.reduce((total, trade) => total + trade.grossPoints, 0);
  const slippageCost = trades.reduce((total, trade) => total + trade.slippagePoints, 0);
  const position = book?.position;
  const valuation = book?.valuation;
  const pnl = (value: number | null | undefined) => value == null ? "--" : `${value > 0 ? "+" : ""}${number(value)}`;
  return <div className="space-y-4">
    <GoogleSheetsConnection />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div role="tablist" aria-label="Paper markets" className="flex gap-2">{markets.map(item => <button key={item} type="button" role="tab" aria-selected={market === item} onClick={() => setMarket(item)} className={`algo-action ${market === item ? "primary" : "secondary"}`}>{item === "GOLD" ? "Gold" : item === "NIFTY" ? "NIFTY Index" : "Bitcoin"}</button>)}</div>
      <HistoryDatePicker label="Trade entry date · IST" value={tradeDate} onChange={setTradeDate} allowAll />
    </div>
    {error && <div role="alert" className="algo-alert-box"><b>Paper trading</b><span>{error}</span></div>}
    {market === "BTC" && <BtcDeltaPaper tradeDate={tradeDate} refreshing={refreshing} book={book?.delta as BtcDeltaBook | null | undefined} legacyEnabled={book?.enabled ?? false} onSaved={() => void refresh()} />}
    {market === "GOLD" && <GoldMt5Paper book={book?.mt5} tradeDate={tradeDate} onSaved={() => void refresh()} />}
    {market === "NIFTY" && <section className="algo-os-card">
      <div className="algo-card-head"><h3>NIFTY options breakout · 1 minute</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="NIFTY options paper entries" checked={book?.options?.enabled ?? false} disabled={!books || busy || (!book?.options?.enabled && !book?.options?.workerOnline)} onChange={() => void toggleOptions()} />{book?.options?.enabled ? "Entries armed" : "Entries off"}</label></div>
      <p className="text-xs text-slate-500">{book?.options?.trial ? `Trial ${time(book.options.trial.startedAt)} to ${time(book.options.trial.endsAt)}` : "Trial not started"} · Simulated fills only · Gross P&amp;L before fees</p>
      <p className="text-xs text-slate-500">Last index tick: {book?.options?.lastTickAt ? time(book.options.lastTickAt) : "--"}</p>
      <div role="status" className="algo-alert-box"><b>{book?.options?.workerOnline ? book.options.stale ? "Worker online · waiting for fresh market data" : "Worker online · fresh data" : "Options worker offline"}</b><span>{book?.options?.trial?.workerStatus ?? "Continuous FYERS worker has not connected."}</span></div>
      <PaperLifetimeSummary realized={`${pnl(book?.options?.realized)} INR gross`} openPnl={`${pnl(book?.options?.unrealized)} INR gross`} closedTrades={book?.options?.tradeCount} />
      <div className="algo-rule-list"><div><span>Engine status</span><b>{book?.options?.status ?? "Loading"}</b></div><div><span>Market feed</span><b>{book?.options?.stale === false ? "Receiving" : "Missing or stale"}</b></div><div><span>Next size</span><b>{book?.options?.size.lots ?? 1} lots</b></div></div>
      <details className="border-y border-slate-200 py-3"><summary className="cursor-pointer text-sm font-semibold">Strategy rules</summary><dl className="algo-rule-list">
        <div><dt>Entry</dt><dd>Index crosses signal high → CE; signal low → PE</dd></div>
        <div><dt>Contract</dt><dd>{niftyRules.selection} · nearest expiry</dd></div>
        <div><dt>Validity</dt><dd>Next 10 candles · signal range ≤35 points</dd></div>
        <div><dt>Premium stop</dt><dd>min(20 points, 20% of entry premium)</dd></div>
        <div><dt>Index trail</dt><dd>CE: previous completed 15m low · PE: previous completed 15m high</dd></div>
        <div><dt>Last signal</dt><dd>14:55 IST · inclusive</dd></div>
        <div><dt>Exit</dt><dd>Opposite signal or 15:15 IST</dd></div>
        <div><dt>Size</dt><dd>Start 1 lot · +1 after SL or two consecutive other losses · no size reset or cap</dd></div>
        <div><dt>Entry fill</dt><dd>Available ask depth · maximum ₹4 above initial ask · average fill price</dd></div>
        <div><dt>Targets · new entries</dt><dd>1 lot: 2× entry · 2 lots: 1 at 2×, 1 at 2.5× · larger: rounded 80% / 20%</dd></div>
      </dl></details>
      {book?.options?.position && <div className="algo-rule-list"><div><span>Open contract</span><b>{book.options.position.contract.id}</b></div><div><span>Capital used · INR premium</span><b>{number(book.options.position.entry * book.options.position.quantity)}</b></div><div><span>Remaining lots / quantity</span><b>{book.options.position.lots} / {book.options.position.quantity}</b></div><div><span>Average entry / current bid</span><b>{number(book.options.position.entry)} / {book.options.mark == null ? "--" : number(book.options.mark)}</b></div><div><span>Premium stop</span><b>{number(book.options.position.entry - (book.options.stopDistance ?? 0))}</b></div><div><span>Targets</span><b>{book.options.position.targets ? book.options.position.targets.map(t => `${t.quantity / book.options.position!.contract.lotSize} lot(s) @ ${number(t.price)}${t.filled ? " · filled" : ""}`).join(" / ") : number(book.options.position.entry + 1.5 * (book.options.stopDistance ?? 0))}</b></div>{book.options.position.entryFill && <div><span>Initial ask / slippage per unit</span><b>{number(book.options.position.entryFill.initialAsk)} / {number(book.options.position.entryFill.slippage)}</b></div>}<div><span>Booked partial P&amp;L · INR</span><b>{pnl(book.options.position.realizedPnl ?? 0)}</b></div></div>}
      {book?.options?.pendingExit && <div role="alert" className="algo-alert-box"><b>Exit awaiting verified quote</b><span>{book.options.pendingExit}</span></div>}
      <div className="flex flex-wrap gap-4 py-3 text-sm"><span>{optionTrades.length} closed trades · {tradeDate || "All dates"}</span><span>Selected gross INR: {pnl(optionTrades.reduce((sum, trade) => sum + trade.pnl, 0))}</span></div>
      <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Entry date</th><th>Contract</th><th>Lots</th><th>Received time · IST</th><th>Signal time · IST</th><th>Entry time · IST</th><th>Entry ask</th><th>Capital used · INR</th><th>Exit date</th><th>Exit time · IST</th><th>Exit bid</th><th>Gross INR</th><th>Reason</th></tr></thead><tbody>{optionTrades.length ? [...optionTrades].reverse().map(trade => <tr key={`${trade.signalId}-${trade.openedAt}`}><td>{istDay(trade.openedAt)}</td><td>{trade.contract.id}</td><td>{trade.lots}</td><td>{istTime(trade.signalReceivedAt) || "--"}</td><td>{istTime(trade.signalClosedAt) || "--"}</td><td>{istTime(trade.openedAt)}</td><td>{number(trade.entry)}</td><td>{number(trade.entry * trade.quantity)}</td><td>{istDay(trade.closedAt)}</td><td>{istTime(trade.closedAt)}</td><td>{number(trade.exit)}</td><td>{pnl(trade.pnl)}</td><td>{trade.reason}</td></tr>) : <tr><td colSpan={13}>No completed options paper trades for this entry date.</td></tr>}</tbody></table></div>
    </section>}
    <details key={market} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-500">Previous signal-price test &amp; history</summary><div className="mt-4 space-y-4">
    <label className="flex items-center gap-3 text-sm"><input aria-label={`${market} paper trading`} type="checkbox" role="switch" checked={book?.enabled ?? false} disabled={!books || busy} onChange={() => void toggle()} />{market === "GOLD" ? "Gold test entries" : "Legacy test entries"} · {book?.enabled ? "On" : "Off"}</label>
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
    <div className="algo-os-card"><div className="algo-card-head"><h3>Open position</h3><span className="algo-pill pending">PAPER</span></div>{position ? <div className="algo-rule-list"><div><span>{position.symbol}</span><b>{position.side}</b></div><div><span>Entry</span><b>{number(position.entry)}</b></div><div><span>Capital used</span><b>Not recorded · price-only test</b></div><div><span>Opened</span><b>{time(position.openedAt)}</b></div><div><span>Last signal price</span><b>{book?.lastPrice == null ? "--" : number(book.lastPrice)}</b></div></div> : <div className="algo-empty-state">{book?.enabled ? "Waiting for the next signal." : "Paper trading is off."}</div>}{book?.pendingSessionClose && <div role="alert" className="algo-alert-box"><b>Session exit pending</b><span>No closing price was received at 15:15 IST. This position is excluded from closed-trade results until a verified exit price is available.</span></div>}</div>
    <div className="algo-os-card"><div className="algo-card-head"><h3>Trade results · {tradeDate || "All dates"}</h3><span className="text-xs text-slate-500">{book?.lastSignalAt ? `Last signal ${time(book.lastSignalAt)}` : "No signal yet"}</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Entry date</th><th>Symbol</th><th>Side</th><th>Received time · IST</th><th>Signal time · IST</th><th>Entry time · IST</th><th>Entry</th><th>Capital used</th><th>Exit date</th><th>Exit time · IST</th><th>Exit</th><th>Points</th><th>Exit reason</th></tr></thead><tbody>{trades.length ? [...trades].reverse().map(trade => <tr key={trade.id}><td>{istDay(trade.openedAt)}</td><td>{trade.symbol}</td><td>{trade.side}</td><td>{istTime(trade.signalReceivedAt) || "--"}</td><td>{istTime(trade.signalClosedAt) || "--"}</td><td>{istTime(trade.openedAt)}</td><td>{number(trade.entry)}</td><td title="Quantity and margin are not recorded for this signal-price test">Not recorded</td><td>{istDay(trade.closedAt)}</td><td>{istTime(trade.closedAt)}</td><td>{number(trade.exit)}</td><td className={trade.points < 0 ? "text-red-600" : "text-emerald-600"}>{number(trade.points)}</td><td>{trade.reason}</td></tr>) : <tr><td colSpan={13}>No completed trades for this entry date.</td></tr>}</tbody></table></div></div>
    </div></details>
  </div>;
}
