import { NextResponse } from "next/server";
import { fyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const connection = await readFyers(fyersDevice());
    if (!connection?.accessToken) return NextResponse.json({ error: "Sign in to FYERS first." }, { status: 401, headers });
    const symbols = new URL(request.url).searchParams.get("symbols") || "NSE:NIFTY50-INDEX";
    if (symbols.split(",").length > 5 || !symbols.split(",").every(symbol => /^NSE:[A-Z0-9&_-]{1,60}$/.test(symbol))) return NextResponse.json({ error: "Up to five NSE symbols are allowed." }, { status: 400, headers });
    const url = new URL("https://api-t1.fyers.in/data/quotes"); url.searchParams.set("symbols", symbols);
    const response = await fetch(url, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.s !== "ok") return NextResponse.json({ error: "FYERS quote test failed. Check session expiry and market-data permissions." }, { status: 502, headers });
    const quotes = (Array.isArray(data.d) ? data.d : []).map((row: { n?: string; s?: string; v?: Record<string, unknown> }) => ({ symbol: row.n, status: row.s, ltp: row.v?.lp ?? null, bid: row.v?.bid ?? null, ask: row.v?.ask ?? null, timestamp: row.v?.tt ?? null }));
    return NextResponse.json({ quotes, checkedAt: new Date().toISOString(), mode: "DATA_ONLY", streaming: false }, { headers });
  } catch { return NextResponse.json({ error: "FYERS quote service unavailable." }, { status: 503, headers }); }
}
