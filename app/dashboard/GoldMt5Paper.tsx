"use client";
import { useState } from "react";
import { accountFetch } from "../lib/accountFetch";
import type { goldView } from "../lib/algo/goldPaperEngine";
import { istDay, istTime, onTradeDate } from "../lib/algo/reportDates";
export type GoldBook = ReturnType<typeof goldView> & { workerOnline: boolean };
const n = (v: number | null | undefined) => v == null ? "--" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
export default function GoldMt5Paper({ book, tradeDate, onSaved }: { book?: GoldBook | null; tradeDate: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function toggle() {
    setBusy(true); setError("");
    try {
      const r = await accountFetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: "GOLD", enabled: false, goldBreakoutEnabled: !book?.enabled }) });
      const result = await r.json(); if (!r.ok) throw Error(result.error); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save gold switch."); } finally { setBusy(false); }
  }
  const fresh = book?.workerOnline && !book.stale, p = book?.position;
  const trades = onTradeDate(book?.trades || [], tradeDate);
  return <section className="algo-os-card">
    <div className="algo-card-head"><h3>Vantage XAUUSD · MT5 paper</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="Gold MT5 paper entries" checked={book?.enabled ?? false} disabled={busy || (!book?.enabled && !fresh)} onChange={() => void toggle()} />{book?.enabled ? "Entries armed" : "Entries off"}</label></div>
    <p className="text-xs text-slate-500">0.03 lots · 1-minute breakout · 3R target · SL to entry at 2R · no 15-minute trail · gross USD before fees and swaps</p>
    <div role="status" className="algo-alert-box"><b>{fresh ? "GREEN · Vantage quotes receiving" : "RED · Gold feed needs attention"}</b><span>{book?.status || "Waiting for GoldPriceBridge on the MT5 XAUUSD chart."}</span></div>
    <p className="text-xs text-slate-500">Simulated fills use observed bid/ask. Liquidity and real execution are not broker-confirmed. Pausing entries does not close an existing paper position.</p>
    {error && <p role="alert">{error}</p>}
    <dl className="algo-rule-list"><div><dt>Bid / ask</dt><dd>{n(book?.quote?.bid)} / {n(book?.quote?.ask)}</dd></div><div><dt>Contract size · units per lot</dt><dd>{n(book?.quote?.contractSize)}</dd></div><div><dt>Booked / open P&amp;L · USD</dt><dd>{n(book?.realized)} / {n(book?.unrealized)}</dd></div></dl>
    {p && <dl className="algo-rule-list"><div><dt>Position</dt><dd>{p.side} · {p.lots} lots · {n(p.units)} units</dd></div><div><dt>Entry / time IST</dt><dd>{n(p.entry)} / {istTime(p.openedAt)}</dd></div><div><dt>SL / target</dt><dd>{n(p.stop)} / {n(p.target)}</dd></div><div><dt>Capital · margin USD</dt><dd>{n(p.margin)}</dd></div>{p.unverified && <div><dt>Quality</dt><dd>Monitoring interrupted · excluded from verified P&amp;L</dd></div>}</dl>}
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Entry date</th><th>Side</th><th>Lots</th><th>Signal · IST</th><th>Received · IST</th><th>Entry · IST</th><th>Entry price</th><th>Margin USD</th><th>Exit date</th><th>Exit · IST</th><th>Exit price</th><th>Gross USD</th><th>Reason</th></tr></thead><tbody>{[...trades].reverse().map(t => <tr key={`${t.id}:${t.openedAt}`}><td>{istDay(t.openedAt)}</td><td>{t.side}</td><td>{t.lots}</td><td>{istTime(t.signalClosedAt)}</td><td>{istTime(t.signalReceivedAt)}</td><td>{istTime(t.openedAt)}</td><td>{n(t.entry)}</td><td>{n(t.margin)}</td><td>{istDay(t.closedAt)}</td><td>{istTime(t.closedAt)}</td><td>{n(t.exit)}</td><td>{t.unverified ? "Excluded" : n(t.pnl)}</td><td>{t.reason}</td></tr>)}{!trades.length && <tr><td colSpan={13}>No completed MT5 gold paper trades for this entry date.</td></tr>}</tbody></table></div>
  </section>;
}
