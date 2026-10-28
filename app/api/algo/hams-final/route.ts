import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { emptyHamsState } from "../../../lib/algo/hamsFinalPaper";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
export async function GET() {
  try {
    const secret = await connectionSecret();
    if (!secret) return NextResponse.json({ error: "Connect TradingView first." }, { status: 401, headers });
    const db = getServerSupabase(); if (!db) throw new Error("Storage unavailable.");
    const result = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__hams_final_worker__").eq("signal_id", "state").maybeSingle();
    if (result.error) throw new Error("HAMS history unavailable.");
    const raw = result.data?.raw_payload, age = Date.now() - Date.parse(result.data?.received_at || "");
    return NextResponse.json({ state: raw?.state ?? emptyHamsState(), decisions: raw?.decisions ?? [], workerOnline: Number.isFinite(age) && age >= 0 && age < 15000, heartbeatAt: result.data?.received_at ?? null, feedAt: raw?.feedAt ?? null, workerStatus: raw?.workerStatus ?? "NOT_STARTED", mark: raw?.mark ?? null }, { headers });
  } catch { return NextResponse.json({ error: "Unable to load HAMS Final." }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const secret = await connectionSecret();
    if (!secret) return NextResponse.json({ error: "Connect TradingView first." }, { status: 401, headers });
    const body = await request.json();
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Invalid entry switch." }, { status: 400, headers });
    const db = getServerSupabase(); if (!db) throw new Error("Storage unavailable.");
    if (body.enabled) {
      const r = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__hams_final_worker__").eq("signal_id", "state").maybeSingle();
      const age = Date.now() - Date.parse(r.data?.received_at || "");
      if (r.error || !(age >= 0 && age < 15000) || r.data?.raw_payload?.workerStatus !== "READY") return NextResponse.json({ error: "Start the HAMS worker with a working FYERS session first." }, { status: 409, headers });
    }
    const id = randomUUID(), at = new Date().toISOString();
    const r = await db.from("tradingview_signal_events").insert({ secret_hash: hashWebhookSecret(secret), strategy_id: "__hams_final_control__", signal_id: id, symbol: "NIFTY", action: "EXIT", received_at: at, signal_timestamp: at, status: "VALIDATED", accepted: false, execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", signal: {}, decision: {}, raw_payload: { enabled: body.enabled } });
    if (r.error) throw new Error("Save failed.");
    return NextResponse.json({ saved: true }, { headers });
  } catch { return NextResponse.json({ error: "Unable to update HAMS entries." }, { status: 503, headers }); }
}
