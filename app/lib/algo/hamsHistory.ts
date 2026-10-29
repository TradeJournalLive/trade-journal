import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyHamsState, nextHamsLots, type HamsState, type HamsPosition, type HamsTrade } from "./hamsFinalPaper";
export type HamsIncident = { id: string; signalId: string; at: string; status: string; reason: string; position?: HamsPosition; acknowledgedAt?: string };
export type HamsRecord = { id: string; type: string; at: string; value: unknown };
const key = (t: HamsPosition) => `${t.signalId}:${t.openedAt}`;
export async function loadHamsRecords(db: SupabaseClient, owner: string): Promise<HamsRecord[]> {
  const records: HamsRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db.from("tradingview_signal_events").select("raw_payload").eq("secret_hash", owner).eq("strategy_id", "__hams_final_worker__")
      .like("signal_id", "ledger:%").order("received_at").order("signal_id").range(offset, offset + 999);
    if (r.error) throw Error("HAMS durable history unavailable.");
    for (const row of r.data || []) if (row.raw_payload?.record) records.push(row.raw_payload.record as HamsRecord);
    if (!r.data || r.data.length < 1000) return records;
  }
}
export function hamsRecoveryView(saved: HamsState | null, storedIncidents: HamsIncident[], records: HamsRecord[]) {
  const state = structuredClone(saved ?? emptyHamsState());
  const trades = new Map(state.trades.map(t => [key(t), t]));
  const entries = new Map<string, HamsPosition>();
  const incidents = new Map(storedIncidents.map(i => [i.id, i]));
  for (const record of records) {
    if (record.type === "ENTRY") { const p = record.value as HamsPosition; if (p?.signalId && p.openedAt && p.entry > 0) entries.set(key(p), p); }
    if (record.type === "TRADE") { const t = record.value as HamsTrade; if (t?.signalId && t.openedAt && t.closedAt && Number.isFinite(t.pnl)) trades.set(key(t), t); }
    if (record.type === "INCIDENT") {
      const i = record.value as HamsIncident, previous = incidents.get(i?.id);
      if (i?.id && (!previous || Date.parse(i.acknowledgedAt || i.at) >= Date.parse(previous.acknowledgedAt || previous.at))) incidents.set(i.id, i);
    }
  }
  const excluded = new Set([...incidents.values()].filter(i => i.acknowledgedAt).map(i => i.signalId));
  state.trades = [...trades.values()].sort((a,b) => a.closedAt.localeCompare(b.closedAt));
  state.balance = state.rulesV2 ? state.rulesV2.balance : 500000 + state.trades.reduce((sum,t) => sum + t.pnl, 0);
  const lastTrade = state.trades.at(-1), savedLastTrade = saved?.trades.at(-1);
  if (lastTrade && (!savedLastTrade || lastTrade.closedAt > savedLastTrade.closedAt)) state.nextLots = nextHamsLots(lastTrade.lots, lastTrade.reason);
  if (state.position && (trades.has(key(state.position)) || excluded.has(state.position.signalId))) state.position = null;
  const unresolved = [...entries.values()].filter(p => !trades.has(key(p)) && !excluded.has(p.signalId));
  if (!state.position && unresolved.length) {
    state.position = unresolved.at(-1)!;
    const p = state.position;
    const id = `ledger-entry:${key(p)}`;
    if (!incidents.has(id)) incidents.set(id,{id,signalId:p.signalId,at:p.openedAt,status:"ENTRY_AWAITING_RECONCILIATION",position:p,reason:"The entry is preserved in the durable ledger but the latest worker snapshot has not reconciled it. No exit or P&L is assumed."});
  }
  const reviewRequired = [...incidents.values()].some(i => !i.acknowledgedAt);
  if (reviewRequired) state.status = "RECOVERY_REVIEW_REQUIRED";
  else if(!state.position && ["OPEN","EXIT_AWAITING_QUOTE","EXIT_AWAITING_DEPTH"].includes(state.status)) state.status=state.enabled?"WAITING_FOR_SIGNAL":"DISABLED";
  return { state, incidents:[...incidents.values()], reviewRequired };
}
