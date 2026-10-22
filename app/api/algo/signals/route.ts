import { NextResponse } from "next/server";
import { listPersistedAlgoSignalEvents } from "../../../lib/algo/signalStore";
import { connectionSecret, saveConnection, clearConnection, sameOrigin } from "../../../lib/algo/connection";
import { addSignalExecutions } from "../../../lib/algo/signalExecution";

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
  try {
    const events = await addSignalExecutions(secret, persisted.events);
    return NextResponse.json({ events, source: "supabase", connected: true }, { headers: privateHeaders });
  } catch {
    const events = persisted.events.map(event => ({ ...event, execution: { status: "UNAVAILABLE", reason: "Execution history could not be loaded. Retry; no outcome has been assumed.", source: "Unavailable" } }));
    return NextResponse.json({ events, source: "supabase", connected: true, warning: "Execution reasons are temporarily unavailable." }, { headers: privateHeaders });
  }
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
  return history(secret);
}
