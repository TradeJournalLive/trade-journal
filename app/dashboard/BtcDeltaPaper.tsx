"use client";
import { useEffect, useState } from "react";
import type { btcView } from "../lib/algo/btcPaperEngine";
export type BtcDeltaBook = ReturnType<typeof btcView> & { workerOnline: boolean; workerStatus: string; trial: { startedAt: string; endsAt: string } };
const n = (v: number | null | undefined) => v == null ? "--" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const t = (v: string | null | undefined) => v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--";
export default function BtcDeltaPaper({ book, legacyEnabled, onSaved }: { book?: BtcDeltaBook | null; legacyEnabled: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  async function control(action: { stopAndClose?: true; deleteTrade?: string }) {
    if (!window.confirm(action.stopAndClose ? "Pause BTC paper entries and close the open paper position at the next verified executable quote? Keep the Mac awake until closure is confirmed." : "Delete this paper trade from displayed history and performance? An audit record will be retained.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/algo/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: "BTC", enabled: legacyEnabled, ...action }) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error);
      setNotice(action.stopAndClose ? "Stop & Close requested. Keep the Mac awake until no open position remains and entries show off." : "Trade deleted from history and performance. Audit retained."); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save paper control."); }
    finally { setBusy(false); }
  }
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const quoteAge = now - Date.parse(book?.lastTickAt || "");
  const feedFresh = Number.isFinite(quoteAge) && quoteAge >= -1000 && quoteAge <= 15000;
  const normalStatuses = ["OPEN", "WAITING_FOR_SIGNAL", "WAITING_FOR_BREAKOUT", "MISSED_BREAKOUT", "MISSED_BREAKOUT_UNFILLED", "SETUP_EXPIRED"];
  const issue = !book ? "BTC status unavailable" : !book.workerOnline ? "Worker offline or heartbeat missing" : !feedFresh || book.stale ? "Delta prices are stale" : book.workerStatus !== "RECEIVING_DELTA_BTCUSD" ? `Worker: ${book.workerStatus}` : !book.enabled ? "Paper entries are switched off" : !normalStatuses.includes(book.status) ? `Engine: ${book.status}` : null;
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
    <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy || !book?.workerOnline} onClick={() => void control({ stopAndClose: true })} className="algo-action danger">Stop &amp; Close paper positions</button><span className="text-xs text-slate-500">Keep the Mac awake until closure is confirmed.</span></div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {p?.monitoringGap && <p role="alert" className="font-bold text-red-700">Monitoring interrupted. This position is excluded from verified performance; closure awaits an executable quote.</p>}
    <div role="status" aria-live="polite" className={`flex flex-wrap items-center gap-3 border-l-4 px-4 py-3 ${issue ? "border-red-600 bg-red-50 text-red-900" : "border-emerald-600 bg-emerald-50 text-emerald-900"}`}>
      <span aria-hidden="true" className={`h-4 w-4 shrink-0 rounded-full ${issue ? "bg-red-600" : "bg-emerald-600"}`} />
      <div><b>{issue ? "RED · BTC needs attention" : "GREEN · BTC engine ready"}</b><p className="text-sm">{issue || (p ? "Position open · monitoring exits" : book?.setup ? "Signal received · waiting for breakout" : "Prices fresh · entries armed · waiting for a signal")}</p></div>
    </div>
    <p className="text-xs text-slate-500">Last TradingView signal: {t(book?.lastSignalAt)}. Engine health does not verify the TradingView alert is enabled.</p>
    <p className="text-xs text-slate-500">PAPER · 1 BTC fixed · 100× margin assumption · 24/7 · Last quote {t(book?.lastTickAt)}</p>
    <div className="grid gap-4 border-y border-slate-200 py-4 sm:grid-cols-3">{[["Realized · USD gross", n(book?.realized)], ["Open P&L · USD gross", n(book?.unrealized)], ["Closed trades", book?.tradeCount ?? 0]].map(([label, value]) => <div key={label} className="space-y-2"><span className="block text-xs text-slate-500">{label}</span><strong className="block text-xl">{value}</strong></div>)}</div>
    <details className="border-b border-slate-200 py-3"><summary className="cursor-pointer text-sm font-semibold">Strategy rules</summary><dl className="algo-rule-list"><div><dt>Entry</dt><dd>Confirmed 1m high/low cross · valid 10 candles · no range filter</dd></div><div><dt>Stop / target</dt><dd>Signal candle stop · at +2R move stop to entry · target 3R</dd></div><div><dt>Other exits</dt><dd>Opposite signal · estimated isolated-margin breach</dd></div></dl></details>
    <p className="text-xs text-slate-500">Gross USD before fees and funding. Liquidation is an isolated-margin estimate, not an actual broker liquidation price.</p>
    {p && <div className="algo-rule-list"><div><span>Position</span><b>{p.side} · {p.quantityBtc} BTC</b></div><div><span>Signal close / received</span><b>{t(p.signalClosedAt)} / {t(p.signalReceivedAt)}</b></div><div><span>Signal close price / breakout</span><b>{n(p.signalPrice)} / {n(p.trigger)}</b></div><div><span>Actual simulated entry / time</span><b>{n(p.entry)} / {t(p.openedAt)}</b></div><div><span>Entry difference vs breakout</span><b>{n(p.entryDifference)} USD</b></div><div><span>Stop / target</span><b>{n(p.stop)} / {n(p.target)}</b></div><div><span>Capital used · USD margin / estimated liquidation</span><b>{n(p.initialMargin)} / {n(p.estimatedLiquidation)}</b></div></div>}
    {book?.pendingExit && <p role="alert">Exit pending: {book.pendingExit}</p>}
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Side</th><th>Signal close</th><th>Breakout</th><th>Entry time</th><th>Fill</th><th>Capital used · USD margin</th><th>Position value · USD</th><th>Entry difference</th><th>Exit time</th><th>Exit fill</th><th>Exit difference</th><th>Gross USD</th><th>Reason</th><th>Quality</th><th>Action</th></tr></thead><tbody>{book?.trades.length ? [...book.trades].reverse().map(v => <tr key={`${v.id}-${v.openedAt}`}><td>{v.side}</td><td>{t(v.signalClosedAt)}</td><td>{n(v.trigger)}</td><td>{t(v.openedAt)}</td><td>{n(v.entry)}</td><td>{n(v.initialMargin)}</td><td>{n(v.entry * v.quantityBtc)}</td><td>{n(v.entryDifference)}</td><td>{t(v.closedAt)}</td><td>{n(v.exit)}</td><td>{n(v.exitDifference)}</td><td>{v.monitoringGap ? "Excluded" : n(v.pnl)}</td><td>{v.reason}</td><td>{v.monitoringGap ? "Monitoring interrupted · unverified" : "Recorded"}</td><td><button type="button" disabled={busy} className="algo-action secondary" aria-label={`Delete paper trade opened ${t(v.openedAt)}`} onClick={() => void control({ deleteTrade: `${v.id}:${v.openedAt}` })}>Delete</button></td></tr>) : <tr><td colSpan={15}>No completed Delta BTC paper trades.</td></tr>}</tbody></table></div>
  </section>;
}
