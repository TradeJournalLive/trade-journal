import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountId } from "../../../../lib/algo/accountConnections";
import { sheetsCallback, sheetsOAuth, SHEETS_SCOPE } from "../../../../lib/algo/googleSheets";
import { consumeSheetsState, openSheets, withSheetsLock, writeSheets } from "../../../../lib/algo/googleSheetsStore";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const finish = (status: string) => {
    const destination = new URL("/dashboard/algo?section=tradingview", sheetsCallback()); destination.searchParams.set("sheets", status);
    const response = NextResponse.redirect(destination); response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer"); return response;
  };
  try {
    const user = await accountId(), cookie = cookies().get("google_sheets_oauth")?.value;
    if (!user || !cookie) return finish("sign_in_again");
    const pending = openSheets<{ user: string; state: string; verifier: string; expires: number }>(cookie);
    const params = new URL(request.url).searchParams, state = params.get("state") || "";
    if (pending.user !== user || pending.expires < Date.now() || state.length !== pending.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) return finish("invalid_state");
    await consumeSheetsState(user, pending.state);
    cookies().set("google_sheets_oauth", "", { path: "/api/integrations/google-sheets", maxAge: 0 });
    const code = params.get("code"); if (params.get("error") || !code || code.length > 8192) return finish("cancelled");
    const oauth = sheetsOAuth();
    const { tokens } = await oauth.getToken({ code, codeVerifier: pending.verifier });
    if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(SHEETS_SCOPE)) return finish("permission_required");
    await withSheetsLock(user, async () => {
      // A newly selected Google account must never inherit the former account's sheet ID.
      await writeSheets(user, { refreshToken: tokens.refresh_token!, enabled: false });
    });
    return finish("connected");
  } catch { return finish("connection_failed"); }
}
