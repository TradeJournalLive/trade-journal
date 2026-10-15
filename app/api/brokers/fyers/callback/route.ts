import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { fyersCallback, fyersDevice, readFyers, writeFyers } from "../../../../lib/algo/fyersConnection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const destination = new URL("/dashboard/algo?section=fyers", fyersCallback());
  const finish = (status: string) => { destination.searchParams.set("fyers", status); const result = NextResponse.redirect(destination); result.headers.set("Cache-Control", "no-store"); result.headers.set("Referrer-Policy", "no-referrer"); return result; };
  try {
    const params = new URL(request.url).searchParams;
    const id = fyersDevice();
    const connection = await readFyers(id);
    const state = params.get("state") || "";
    const expected = connection?.state || "";
    if (!connection || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || !connection.stateExpires || connection.stateExpires < Date.now()) return finish("invalid_state");
    // Consume state before exchanging the code, so callbacks cannot be replayed.
    delete connection.state; delete connection.stateExpires;
    await writeFyers(id, connection);
    const code = params.get("auth_code");
    if (!code || code.length > 8192) return finish("cancelled");
    const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ grant_type: "authorization_code", appIdHash: createHash("sha256").update(`${connection.appId}:${connection.secret}`).digest("hex"), code })
    });
    const result = await response.json();
    if (!response.ok || result.s !== "ok" || typeof result.access_token !== "string") return finish("login_failed");
    await writeFyers(id, { appId: connection.appId, secret: connection.secret, accessToken: result.access_token });
    return finish("connected");
  } catch { return finish("connection_failed"); }
}
