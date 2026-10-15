import { NextResponse } from "next/server";
import { listPersistedAlgoSignalEvents } from "../../../lib/algo/signalStore";
import { connectionSecret, saveConnection, clearConnection, sameOrigin } from "../../../lib/algo/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const secret = connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect your webhook once to load saved signals." }, { status: 401 });
  return history(secret);
}

async function history(secret: string) {
  const persisted = await listPersistedAlgoSignalEvents(secret, 100);
  if (!persisted.ok) return NextResponse.json({ error: persisted.reason }, { status: 503 });
  return NextResponse.json({ events: persisted.events, source: "supabase", connected: true });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  clearConnection();
  return NextResponse.json({ connected: false });
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
    if (sameOrigin(request)) saveConnection(secret);
    return NextResponse.json({ events: persisted.events, source: "supabase", connected: true });
  }

  return NextResponse.json({
    error: persisted.reason || "Saved signal history is temporarily unavailable."
  }, { status: 503 });
}
