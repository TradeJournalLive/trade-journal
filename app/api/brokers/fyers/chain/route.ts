import { NextResponse } from "next/server";
import { fyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const connection = await readFyers(fyersDevice());
    if (!connection?.accessToken) return NextResponse.json({ error: "Sign in to FYERS first." }, { status: 401, headers });
    const url = new URL("https://api-t1.fyers.in/data/options-chain-v3");
    url.search = new URLSearchParams({ symbol: "NSE:NIFTY50-INDEX", strikecount: "2", timestamp: "" }).toString();
    const response = await fetch(url, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.s !== "ok") return NextResponse.json({ error: "FYERS option-chain request failed. Verify data permissions and session validity." }, { status: 502, headers });
    const chain = Array.isArray(result.data?.optionsChain) ? result.data.optionsChain : [];
    const contracts = chain.map((item: Record<string, unknown>) => ({ symbol: item.symbol, side: item.option_type, strike: item.strike_price, ltp: item.ltp, bid: item.bid, ask: item.ask, timestamp: item.ltt ?? item.tt ?? null }));
    return NextResponse.json({ contracts, expiries: result.data?.expiryData ?? [], checkedAt: new Date().toISOString(), streaming: false }, { headers });
  } catch { return NextResponse.json({ error: "FYERS option-chain service unavailable." }, { status: 503, headers }); }
}
