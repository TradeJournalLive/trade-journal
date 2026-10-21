import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCOUNT_COOKIE } from "../../../lib/algo/accountConnections";
import { getServerSupabase } from "../../../lib/algo/signalStore";
import { sameOrigin } from "../../../lib/algo/connection";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const { accessToken } = await request.json();
    if (accessToken === null) { cookies().delete(ACCOUNT_COOKIE); return NextResponse.json({ signedIn: false }); }
    if (typeof accessToken !== "string" || accessToken.length > 3800) return NextResponse.json({ error: "Invalid session." }, { status: 400 });
    const { data, error } = await getServerSupabase()!.auth.getUser(accessToken);
    if (error || !data.user) { cookies().delete(ACCOUNT_COOKIE); return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
    cookies().set(ACCOUNT_COOKIE, accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
    return NextResponse.json({ signedIn: true, userId: data.user.id, email: data.user.email || "" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Unable to verify session." }, { status: 503 }); }
}
