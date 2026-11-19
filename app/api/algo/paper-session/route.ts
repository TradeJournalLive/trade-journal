import { NextResponse } from "next/server";
import { connectionSecret } from "../../../lib/algo/connection";
import { niftyFreshSessionAt, type NiftyPaperStatus } from "../../../lib/algo/niftyLossCycle";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import type { LimitTrade } from "../../../lib/algo/niftyLimitPaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers });
const table = "tradingview_signal_events";
type SessionTrade = Omit<LimitTrade, "sizing"> & { sizing?: { version: number } };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const strategy = params.get("strategy");
    if (strategy !== "current" && strategy !== "hams") return reply({ error: "Unknown paper strategy." }, 400);
    const secret = await connectionSecret();
    if (!secret) return reply({ error: "Connect TradingView first." }, 401);
    const db = getServerSupabase();
    if (!db) throw Error("Storage unavailable");
    const owner = hashWebhookSecret(secret);
    const worker = strategy === "current" ? "__nifty_paper_worker__" : "__hams_final_worker__";
    if (params.get("view") === "trades") {
      const base = db.from(table).select(strategy === "current" ? "trade:raw_payload->trade" : "trade:raw_payload->record->value").eq("secret_hash", owner);
      const trades = strategy === "current" ? base.eq("strategy_id", "__nifty_paper_trade__") : base.eq("strategy_id", worker).like("signal_id", "ledger:%").eq("raw_payload->record->>type", "TRADE");
      const { data, error } = await trades.gte("received_at", niftyFreshSessionAt).order("received_at", { ascending: false }).order("id", { ascending: false }).limit(50);
      if (error) throw Error("Trade history unavailable");
      const visible = ((data as unknown as { trade: SessionTrade | null }[] | null) ?? []).flatMap(({ trade: t }) =>
        t?.sizing?.version === 2 && Date.parse(t.openedAt) >= Date.parse(niftyFreshSessionAt) ? [{
          id: t.signalId, openedAt: t.openedAt, closedAt: t.closedAt, contract: t.contract.id, lots: t.lots,
          entry: t.entry, exit: t.exit, charges: t.costs.total, pnl: t.pnl, reason: t.reason, reconstruction: t.reconstruction ?? null
        }] : []);
      return reply({ trades: visible });
    }
    const { data, error } = await db.from(table).select("received_at,dashboard:raw_payload->dashboard").eq("secret_hash", owner).eq("strategy_id", worker).eq("signal_id", "state").maybeSingle();
    if (error) throw Error("Worker status unavailable");
    const dashboard = data?.dashboard as NiftyPaperStatus | null;
    const age = Date.now() - Date.parse(data?.received_at ?? "");
    const workerOnline = Boolean(dashboard && age >= 0 && age < 15000 && !dashboard.workerStatus.startsWith("STOPPED_"));
    return reply({ dashboard: dashboard ?? null, workerOnline, heartbeatAt: data?.received_at ?? null });
  } catch {
    return reply({ error: "Unable to load the paper session. Try refreshing." }, 503);
  }
}
