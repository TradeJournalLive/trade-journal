"use client";
import { useEffect, useState } from "react";
import { accountFetch } from "../lib/accountFetch";
import { emptyHamsState, type HamsState } from "../lib/algo/hamsFinalPaper";
import { istDay, istTime } from "../lib/algo/reportDates";
import HistoryDatePicker from "./HistoryDatePicker";
import PaperLifetimeSummary from "./PaperLifetimeSummary";
type Snapshot = { state: HamsState; decisions: { id: string; receivedAt: string; status: string }[]; workerOnline: boolean; feedAt: string | null; workerStatus: string; mark: number | null };
const amount = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export default function HamsFinalPaper() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => istDay(new Date().toISOString()));
  useEffect(() => {
    let active = true, pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || !active) return; pending = true;
      try {
        const r = await accountFetch("/api/algo/hams-final", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const body = await r.json(); if (!r.ok) throw new Error(body.error);
        if (active) { setSnapshot(body); setError(""); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "HAMS unavailable."); }
      finally { pending = false; }
    };
    void refresh(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const state = snapshot?.state ?? emptyHamsState(), p = state.position;
  const fresh = snapshot?.feedAt && Date.now() - Date.parse(snapshot.feedAt) < 15000;
  const trades = state.trades.filter(t => !date || istDay(t.openedAt) === date);
  async function toggle() {
    setBusy(true);
    try { const r = await accountFetch("/api/algo/hams-final", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Switch failed."); } finally { setBusy(false); }
  }
  return <section className="algo-os-card">
    <div className="algo-card-head"><h3>NIFTY HAMS Final · 3 minutes</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="HAMS Final paper entries" checked={state.enabled} disabled={busy || !snapshot || (!state.enabled && !snapshot.workerOnline)} onChange={() => void toggle()} />{state.enabled ? "Entries armed" : "Entries off"}</label></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <p role="status" className={snapshot?.workerOnline && fresh ? "text-emerald-600" : "text-red-600"}>{snapshot?.workerOnline ? fresh ? "● Worker online · data receiving" : "● Worker online · market data stale/closed" : "● Worker offline"} · {snapshot?.workerStatus ?? "Loading"}</p>
    <PaperLifetimeSummary realized={`₹${amount(state.balance - 500000)} gross`} openPnl={p && snapshot?.mark != null && fresh ? `₹${amount((snapshot.mark - p.entry) * p.quantity)}` : p ? "Unavailable" : "₹0"} closedTrades={state.trades.length} />
    <dl className="algo-rule-list"><div><dt>Initial capital</dt><dd>₹5,00,000</dd></div><div><dt>Cash available</dt><dd>₹{amount(state.balance - (p ? p.entry * p.quantity : 0))}</dd></div><div><dt>Next size</dt><dd>{state.nextLots} lot(s) · maximum 20</dd></div><div><dt>Status</dt><dd>{state.status}</dd></div></dl>
    <details className="border-y py-3"><summary>Strategy rules</summary><dl className="algo-rule-list"><div><dt>Entry</dt><dd>Confirmed 3-minute signal · observed ask after receipt</dd></div><div><dt>Contract</dt><dd>Nearest expiry · 1 ITM · BUY → CE / SELL → PE</dd></div><div><dt>Stop</dt><dd>Completed signal-time option candle low − ₹5</dd></div><div><dt>Target</dt><dd>Entry + 3 × initial risk</dd></div><div><dt>Sizing</dt><dd>Double after SL, capped at 20; target resets to 1; other exits unchanged</dd></div><div><dt>Other exits</dt><dd>Opposite signal / 14:55 IST · no trailing stop</dd></div></dl></details>
    {p && <dl className="algo-rule-list"><div><dt>Open contract</dt><dd>{p.contract.id} · {p.lots} lots</dd></div><div><dt>Entry / stop / target</dt><dd>{amount(p.entry)} / {amount(p.stop)} / {amount(p.target)}</dd></div><div><dt>Capital used</dt><dd>₹{amount(p.entry * p.quantity)}</dd></div></dl>}
    <HistoryDatePicker label="Entry date · IST" value={date} onChange={setDate} allowAll />
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Date</th><th>Contract</th><th>Lots</th><th>Signal · IST</th><th>Received · IST</th><th>Entry · IST</th><th>Premium</th><th>Stop</th><th>Target</th><th>Capital</th><th>Exit date</th><th>Exit · IST</th><th>Exit premium</th><th>P&amp;L</th><th>Reason</th></tr></thead><tbody>{[...trades].reverse().map(t => <tr key={t.signalId}><td>{istDay(t.openedAt)}</td><td>{t.contract.id}</td><td>{t.lots}</td><td>{istTime(t.signalClosedAt)}</td><td>{istTime(t.receivedAt)}</td><td>{istTime(t.openedAt)}</td><td>{amount(t.entry)}</td><td>{amount(t.stop)}</td><td>{amount(t.target)}</td><td>{amount(t.entry*t.quantity)}</td><td>{istDay(t.closedAt)}</td><td>{istTime(t.closedAt)}</td><td>{amount(t.exit)}</td><td>{amount(t.pnl)}</td><td>{t.reason}</td></tr>)}{!trades.length && <tr><td colSpan={15}>No closed HAMS Final trades for this date.</td></tr>}</tbody></table></div>
    <h4 className="mt-4 font-semibold">Signal decisions</h4><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Received date</th><th>Received · IST</th><th>Signal ID</th><th>Decision</th></tr></thead><tbody>{[...(snapshot?.decisions ?? [])].filter(d => !date || istDay(d.receivedAt) === date).reverse().map(d => <tr key={d.id}><td>{istDay(d.receivedAt)}</td><td>{istTime(d.receivedAt)}</td><td>{d.id}</td><td>{d.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
  </section>;
}
