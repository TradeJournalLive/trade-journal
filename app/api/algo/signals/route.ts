import { NextResponse } from "next/server";
import { listPersistedAlgoSignalEvents } from "../../../lib/algo/signalStore";
import { connectionSecret, saveConnection, clearConnection, sameOrigin } from "../../../lib/algo/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

export async function GET(request: Request) {
  const secret = await connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect your webhook once to load saved signals." }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") || undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  return history(secret, date);
}

async function history(secret: string, date?: string) {
  const persisted = await listPersistedAlgoSignalEvents(secret, 100, date);
  if (!persisted.ok) return NextResponse.json({ error: persisted.reason }, { status: 503 });
  return NextResponse.json({ events: persisted.events, source: "supabase", connected: true }, { headers: privateHeaders });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  await clearConnection();
  return NextResponse.json({ connected: false });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
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

  try { await saveConnection(secret); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to link connection." }, { status: 403 }); }
  const persisted = await listPersistedAlgoSignalEvents(secret, 100);
  if (persisted.ok) {
    return NextResponse.json({ events: persisted.events, source: "supabase", connected: true }, { headers: privateHeaders });
  }

  return NextResponse.json({
    error: persisted.reason || "Saved signal history is temporarily unavailable."
  }, { status: 503 });
}
