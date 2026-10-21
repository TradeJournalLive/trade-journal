import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CodeChallengeMethod } from "google-auth-library";
import { accountId } from "../../../lib/algo/accountConnections";
import { sameOrigin } from "../../../lib/algo/connection";
import { createSignalSheet, sheetsConfigured, sheetsOAuth, SHEETS_SCOPE, syncSignalSheet } from "../../../lib/algo/googleSheets";
import { readSheets, sealSheets, withSheetsLock, writeSheets } from "../../../lib/algo/googleSheetsStore";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
export async function GET() {
  try {
    const user = await accountId(); if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
    const c = await readSheets(user);
    return NextResponse.json({ configured: sheetsConfigured(), connected: Boolean(c), enabled: c?.enabled ?? false, url: c?.sheetId ? `https://docs.google.com/spreadsheets/d/${c.sheetId}/edit` : null, lastSyncedAt: c?.lastSyncedAt, signalCount: c?.signalCount ?? 0, tradeCount: c?.tradeCount ?? 0, error: c?.error }, { headers });
  } catch { return NextResponse.json({ error: "Unable to read Sheets connection." }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  try {
    const user = await accountId(); if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
    const { action } = await request.json();
    if (action === "connect") {
      const oauth = sheetsOAuth(), pkce = await oauth.generateCodeVerifierAsync(), state = randomBytes(32).toString("hex");
      cookies().set("google_sheets_oauth", sealSheets({ user, state, verifier: pkce.codeVerifier, expires: Date.now() + 600000 }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/google-sheets", maxAge: 600 });
      const url = oauth.generateAuthUrl({ scope: [SHEETS_SCOPE], access_type: "offline", prompt: "consent", state, code_challenge: pkce.codeChallenge, code_challenge_method: CodeChallengeMethod.S256, include_granted_scopes: false });
      return NextResponse.json({ url }, { headers });
    }
    if (action === "create") await createSignalSheet(user);
    else if (action === "sync") await syncSignalSheet(user);
    else if (action === "pause" || action === "resume" || action === "disconnect") await withSheetsLock(user, async () => {
      const connection = await readSheets(user);
      if (action === "disconnect") { await writeSheets(user, null); return; }
      if (!connection) throw new Error("Connect Google first.");
      connection.enabled = action === "resume"; await writeSheets(user, connection);
    });
    else return NextResponse.json({ error: "Invalid action." }, { status: 400, headers });
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets action failed." }, { status: 400, headers }); }
}
