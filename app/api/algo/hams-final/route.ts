import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { emptyHamsState } from "../../../lib/algo/hamsFinalPaper";
import { loadHamsRecords, hamsRecoveryView } from "../../../lib/algo/hamsHistory";
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
    if(result.data && !raw?.state)throw Error("Invalid HAMS snapshot; durable history retained.");
    const records = await loadHamsRecords(db,hashWebhookSecret(secret));
    const recovery = hamsRecoveryView(raw?.state ?? emptyHamsState(),raw?.incidents ?? [],records);
    const decisions = new Map<string, {id:string;receivedAt:string;decidedAt?:string;status:string}>();
    for(const d of [...(raw?.decisions ?? []), ...records.filter(r=>r.type==="DECISION").map(r=>r.value)]) {
      const value=d as {id:string;receivedAt:string;decidedAt?:string;status:string};
      const old=decisions.get(value.id);
      if(value.id&&(!old||Date.parse(value.decidedAt||value.receivedAt)>=Date.parse(old.decidedAt||old.receivedAt)))decisions.set(value.id,value);
    }
    return NextResponse.json({ ...recovery, decisions:[...decisions.values()], workerOnline: Number.isFinite(age) && age >= 0 && age < 15000, heartbeatAt: result.data?.received_at ?? null, feedAt: raw?.feedAt ?? null, workerStatus: recovery.reviewRequired ? "RECOVERY_REVIEW_REQUIRED" : raw?.workerStatus ?? "NOT_STARTED", mark: raw?.mark ?? null }, { headers });
  } catch { return NextResponse.json({ error: "Unable to load HAMS Final." }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const secret = await connectionSecret();
    if (!secret) return NextResponse.json({ error: "Connect TradingView first." }, { status: 401, headers });
    const body = await request.json();
    const recoveryAck=body.action==="acknowledgeRecovery"&&body.excludeUnverified===true;
    if (!recoveryAck && typeof body.enabled !== "boolean") return NextResponse.json({ error: "Invalid entry switch." }, { status: 400, headers });
    const db = getServerSupabase(); if (!db) throw new Error("Storage unavailable.");
    if (body.enabled || recoveryAck) {
      const r = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__hams_final_worker__").eq("signal_id", "state").maybeSingle();
      const age = Date.now() - Date.parse(r.data?.received_at || "");
      if(body.enabled&&r.data?.raw_payload?.state?.rulesV2?.emergency?.pending)return NextResponse.json({error:"Emergency exit is pending. Wait for a verified closure before re-arming."},{status:409,headers});
      if (r.error || !(age >= 0 && age < 15000) || (!recoveryAck && r.data?.raw_payload?.workerStatus !== "READY")) return NextResponse.json({ error: "HAMS worker must be online. Review any unresolved recovery incident before arming entries." }, { status: 409, headers });
    }
    const id = randomUUID(), at = new Date().toISOString();
    const r = await db.from("tradingview_signal_events").insert({ secret_hash: hashWebhookSecret(secret), strategy_id: "__hams_final_control__", signal_id: id, symbol: "NIFTY", action: "EXIT", received_at: at, signal_timestamp: at, status: "VALIDATED", accepted: false, execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", signal: {}, decision: {}, raw_payload: recoveryAck ? {acknowledgeRecovery:true} : { enabled: body.enabled } });
    if (r.error) throw new Error("Save failed.");
    return NextResponse.json({ saved: true }, { headers });
  } catch { return NextResponse.json({ error: "Unable to update HAMS entries." }, { status: 503, headers }); }
}
