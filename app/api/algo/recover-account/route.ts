import { NextResponse } from "next/server";
import { accountId, bindAccountConnection } from "../../../lib/algo/accountConnections";
import { sameOrigin } from "../../../lib/algo/connection";
import { listPersistedAlgoSignalEvents } from "../../../lib/algo/signalStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });

  const user = await accountId();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { secret?: unknown };
  try {
    body = await request.json() as { secret?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!secret || secret.length > 2048) {
    return NextResponse.json({ error: "Enter the existing TradingView webhook secret." }, { status: 400 });
  }

  const history = await listPersistedAlgoSignalEvents(secret, 1);
  if (!history.ok) return NextResponse.json({ error: "Unable to verify saved TradingView history." }, { status: 503 });
  if (!history.events.length) {
    return NextResponse.json({ error: "No saved TradingView signals match this secret. Use the regular connection flow for a new setup." }, { status: 404 });
  }

  try {
    await bindAccountConnection(user, "webhook", secret);
    return NextResponse.json({ linked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to recover this setup." }, { status: 409 });
  }
}
