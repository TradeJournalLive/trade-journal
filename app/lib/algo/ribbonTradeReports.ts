import { getServerSupabase, hashWebhookSecret } from "./signalStore";
import { hamsRecoveryView, loadHamsRecords } from "./ribbonHistory";
import type { ReportTrade } from "./tradeReports";

export async function loadRibbonTradeReports(secret: string): Promise<ReportTrade[]> {
  const db = getServerSupabase();
  if (!db) throw new Error("HAMS report storage unavailable. Previous sheet data retained.");
  const owner = hashWebhookSecret(secret);
  const result = await db.from("tradingview_signal_events").select("raw_payload")
    .eq("secret_hash", owner).eq("strategy_id", "__nifty_ribbon_worker__").eq("signal_id", "state").maybeSingle();
  if (result.error) throw new Error("HAMS report unavailable. Previous sheet data retained.");
  const raw = result.data?.raw_payload;
  if (raw && !raw.state) throw new Error("Invalid HAMS report snapshot.");
  const records = await loadHamsRecords(db, owner, true);
  const { state, incidents } = hamsRecoveryView(raw?.state ?? null, raw?.incidents ?? [], records);
  const trades: ReportTrade[] = state.trades.map(t => ({
    id: `ribbon:${t.signalId}:${t.openedAt}`, market: "NIFTY Ribbon", engine: "Ribbon Test",
    symbol: t.contract.id, side: t.contract.side, status: "CLOSED", signalId: t.signalId,
    signalAt: t.signalClosedAt, receivedAt: t.receivedAt, openedAt: t.openedAt, closedAt: t.closedAt,
    entry: t.entry, exit: t.exit, quantity: t.quantity, lots: t.lots, capital: t.entry * t.quantity,
    currency: "INR", pnl: t.grossPnl ?? t.pnl, recordedPnl: t.grossPnl ?? t.pnl,
    stop: t.stop, target: t.target, reason: t.reason, quality: "Recorded"
  }));
  const p = state.position;
  if (p) trades.push({
    id: `ribbon:${p.signalId}:${p.openedAt}`, market: "NIFTY Ribbon", engine: "Ribbon Test",
    symbol: p.contract.id, side: p.contract.side, status: "OPEN", signalId: p.signalId,
    signalAt: p.signalClosedAt, receivedAt: p.receivedAt, openedAt: p.openedAt,
    entry: p.entry, quantity: p.quantity, lots: p.lots, capital: p.entry * p.quantity,
    currency: "INR", stop: p.stop, target: p.target,
    quality: incidents.some(i => i.signalId === p.signalId && !i.acknowledgedAt) ? "Unverified - awaiting reconciliation" : "Recorded"
  });
  return trades.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}
