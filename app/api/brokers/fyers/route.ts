import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { sameOrigin } from "../../../lib/algo/connection";
import { fyersDevice, fyersCallback, readFyers, writeFyers, clearFyersDevice } from "../../../lib/algo/fyersConnection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const connection = await readFyers(fyersDevice());
    return NextResponse.json({ configured: Boolean(connection), authenticated: Boolean(connection?.accessToken), callback: fyersCallback(), mode: "DATA_ONLY" }, { headers });
  } catch { return NextResponse.json({ error: "Unable to load FYERS connection." }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const body = await request.json();
    let connection = await readFyers(fyersDevice());
    if (body.appId !== undefined || body.secret !== undefined) {
      if (connection && body.replaceCredentials !== true) return NextResponse.json({ error: "Saved credentials cannot be replaced during sign-in. Disconnect before configuring another app." }, { status: 400 });
      if (typeof body.appId !== "string" || !/^[A-Za-z0-9]{5,76}-100$/.test(body.appId) || typeof body.secret !== "string" || !body.secret.trim() || body.secret.length > 512) return NextResponse.json({ error: "A FYERS App ID ending in -100 and its Secret ID are required." }, { status: 400 });
      connection = { appId: body.appId, secret: body.secret.trim() };
    }
    if (!connection) return NextResponse.json({ error: "Configure the non-trading app first." }, { status: 400 });
    connection.state = randomBytes(32).toString("hex");
    connection.stateExpires = Date.now() + 10 * 60000;
    await writeFyers(fyersDevice(true), connection);
    const url = new URL("https://api-t1.fyers.in/api/v3/generate-authcode");
    url.search = new URLSearchParams({ client_id: connection.appId, redirect_uri: fyersCallback(), response_type: "code", state: connection.state }).toString();
    return NextResponse.json({ url: url.toString() }, { headers });
  } catch { return NextResponse.json({ error: "Unable to save FYERS connection." }, { status: 503, headers }); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try { const id = fyersDevice(); if (id) await writeFyers(id, null); return NextResponse.json({ disconnected: true }, { headers }); }
  catch { return NextResponse.json({ error: "Unable to disconnect FYERS." }, { status: 503, headers }); }
  finally { clearFyersDevice(); }
}
