import { NextResponse } from "next/server";
import { accountId, bindAccountConnection, readAccountConnection } from "../../../../lib/algo/accountConnections";
import { legacyFyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
import { sameOrigin } from "../../../../lib/algo/connection";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await accountId();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ linked: Boolean(await readAccountConnection(user, "fyers")), canLink: Boolean(legacyFyersDevice()) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const user = await accountId();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const id = legacyFyersDevice();
    if (!id || !await readFyers(id)) return NextResponse.json({ error: "Use the original device with the saved FYERS connection." }, { status: 409 });
    await bindAccountConnection(user, "fyers", id);
    return NextResponse.json({ linked: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Unable to link connection." }, { status: 409 }); }
}
