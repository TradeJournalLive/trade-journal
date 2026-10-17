"use client";
import { useState } from "react";
import type { btcView } from "../lib/algo/btcPaperEngine";
export type BtcDeltaBook = ReturnType<typeof btcView> & { workerOnline: boolean; workerStatus: string; trial: { startedAt: string; endsAt: string } };
const n = (v: number | null | undefined) => v == null ? "--" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const t = (v: string | null | undefined) => v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--";
export default function BtcDeltaPaper({ book, legacyEnabled, onSaved }: { book?: BtcDeltaBook | null; legacyEnabled: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function toggle() {
    setBusy(true); setError("");
    try { const r = await fetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: "BTC", enabled: legacyEnabled, btcBreakoutEnabled: !book?.enabled }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to change BTC switch."); }
    finally { setBusy(false); }
  }
  const p = book?.position;
  return <section className="algo-os-card">
    <div className="algo-card-head"><h3>Delta India · BTCUSD perpetual</h3><label className="flex items-center gap-2 text-sm"><input aria-label="Delta BTC paper entries" role="switch" type="checkbox" checked={book?.enabled ?? false} disabled={busy || !book || (!book.enabled && (!book.workerOnline || book.stale))} onChange={() => void toggle()} />{book?.enabled ? "Entries armed" : "Entries off"}</label></div>
    {error && <p role="alert">{error}</p>}
    <div role="status" className="algo-alert-box"><b>{book?.workerOnline ? book.stale ? "Worker online · quotes stale" : "Worker online · fresh Delta data" : "Delta worker offline"}</b><span>{book?.status || "Not started"}</span></div>
    <p className="text-xs text-slate-500">PAPER · 1 BTC fixed · 100× margin assumption · 24/7 · Last quote {t(book?.lastTickAt)}</p>
    <div className="grid gap-4 border-y border-slate-200 py-4 sm:grid-cols-3">{[["Realized · USD gross", n(book?.realized)], ["Open P&L · USD gross", n(book?.unrealized)], ["Closed trades", book?.tradeCount ?? 0]].map(([label, value]) => <div key={label} className="space-y-2"><span className="block text-xs text-slate-500">{label}</span><strong className="block text-xl">{value}</strong></div>)}</div>
    <details className="border-b border-slate-200 py-3"><summary className="cursor-pointer text-sm font-semibold">Strategy rules</summary><dl className="algo-rule-list"><div><dt>Entry</dt><dd>Confirmed 1m high/low cross · valid 10 candles · no range filter</dd></div><div><dt>Stop / target</dt><dd>Opposite end of signal candle · 1.5R from actual fill</dd></div><div><dt>Other exits</dt><dd>Previous completed 15m low/high · opposite signal · estimated isolated-margin breach</dd></div></dl></details>
    <p className="text-xs text-slate-500">Gross USD before fees and funding. Liquidation is an isolated-margin estimate, not an actual broker liquidation price.</p>
    {p && <div className="algo-rule-list"><div><span>Position</span><b>{p.side} · {p.quantityBtc} BTC</b></div><div><span>Signal close / received</span><b>{t(p.signalClosedAt)} / {t(p.signalReceivedAt)}</b></div><div><span>Signal close price / breakout</span><b>{n(p.signalPrice)} / {n(p.trigger)}</b></div><div><span>Actual simulated entry / time</span><b>{n(p.entry)} / {t(p.openedAt)}</b></div><div><span>Entry difference vs breakout</span><b>{n(p.entryDifference)} USD</b></div><div><span>Stop / target</span><b>{n(p.stop)} / {n(p.target)}</b></div><div><span>Initial margin / estimated liquidation</span><b>{n(p.initialMargin)} / {n(p.estimatedLiquidation)}</b></div></div>}
    {book?.pendingExit && <p role="alert">Exit pending: {book.pendingExit}</p>}
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Side</th><th>Signal close</th><th>Breakout</th><th>Entry time</th><th>Fill</th><th>Entry difference</th><th>Exit time</th><th>Exit fill</th><th>Exit difference</th><th>Gross USD</th><th>Reason</th></tr></thead><tbody>{book?.trades.length ? [...book.trades].reverse().map(v => <tr key={`${v.id}-${v.openedAt}`}><td>{v.side}</td><td>{t(v.signalClosedAt)}</td><td>{n(v.trigger)}</td><td>{t(v.openedAt)}</td><td>{n(v.entry)}</td><td>{n(v.entryDifference)}</td><td>{t(v.closedAt)}</td><td>{n(v.exit)}</td><td>{n(v.exitDifference)}</td><td>{n(v.pnl)}</td><td>{v.reason}</td></tr>) : <tr><td colSpan={11}>No completed Delta BTC paper trades.</td></tr>}</tbody></table></div>
  </section>;
}
