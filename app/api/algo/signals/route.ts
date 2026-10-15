import { NextResponse } from "next/server";
import { listAlgoEvents } from "../../../lib/algo/automation";
import { listPersistedAlgoSignalEvents } from "../../../lib/algo/signalStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ events: listAlgoEvents(), source: "memory" });
}

export async function POST(request: Request) {
  let body: { secret?: string } = {};
  try {
    body = (await request.json()) as { secret?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const secret = String(body.secret ?? "").trim();
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret is required to load saved signals." }, { status: 400 });
  }

  const persisted = await listPersistedAlgoSignalEvents(secret, 100);
  if (persisted.ok) {
    return NextResponse.json({ events: persisted.events, source: "supabase" });
  }

  return NextResponse.json({
    error: persisted.reason || "Saved signal history is temporarily unavailable."
  }, { status: 503 });
}
