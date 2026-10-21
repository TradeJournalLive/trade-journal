import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCOUNT_COOKIE } from "../../../lib/algo/accountConnections";
import { getServerSupabase } from "../../../lib/algo/signalStore";
import { sameOrigin } from "../../../lib/algo/connection";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Open the panel using its registered address and retry.", code: "ORIGIN_MISMATCH" }, { status: 403 });
  try {
    const { accessToken } = await request.json();
    if (accessToken === null) { cookies().delete(ACCOUNT_COOKIE); return NextResponse.json({ signedIn: false }); }
    if (typeof accessToken !== "string" || accessToken.length > 3800) return NextResponse.json({ error: "The sign-in session could not be saved securely. Please sign in again.", code: "SESSION_FORMAT" }, { status: 400 });
    const db = getServerSupabase();
    if (!db) return NextResponse.json({ error: "Account verification is not configured on the server.", code: "AUTH_CONFIGURATION" }, { status: 503 });
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user) {
      if (error && (!error.status || error.status >= 500)) return NextResponse.json({ error: "The sign-in verification service is temporarily unavailable. Please retry.", code: "AUTH_UNAVAILABLE" }, { status: 503 });
      cookies().delete(ACCOUNT_COOKIE);
      return NextResponse.json({ error: "Your sign-in session is no longer valid. Sign in again; saved broker connections are retained.", code: "SESSION_EXPIRED" }, { status: 401 });
    }
    cookies().set(ACCOUNT_COOKIE, accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
    return NextResponse.json({ signedIn: true, userId: data.user.id, email: data.user.email || "" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Account verification is temporarily unavailable. Please retry.", code: "AUTH_UNAVAILABLE" }, { status: 503 }); }
}
