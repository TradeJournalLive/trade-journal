import { NextResponse } from "next/server";
import { fyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const connection = await readFyers(await fyersDevice());
    if (!connection?.accessToken) return NextResponse.json({ error: "Sign in to FYERS first." }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const symbol = params.get("symbol") || "NSE:NIFTY50-INDEX";
    const expiry = params.get("expiry") || "";
    if (!["NSE:NIFTY50-INDEX", "NSE:NIFTYBANK-INDEX", "NSE:FINNIFTY-INDEX"].includes(symbol) || (expiry && !/^\d{10}$/.test(expiry))) return NextResponse.json({ error: "Invalid underlying or expiry." }, { status: 400, headers });
    const url = new URL("https://api-t1.fyers.in/data/options-chain-v3");
    url.search = new URLSearchParams({ symbol, strikecount: "50", timestamp: expiry }).toString();
    const response = await fetch(url, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.s !== "ok") return NextResponse.json({ error: "FYERS option-chain request failed. Verify data permissions and session validity." }, { status: 502, headers });
    const chain = Array.isArray(result.data?.optionsChain) ? result.data.optionsChain : [];
    const contracts = chain.filter((item: Record<string, unknown>) => item.option_type === "CE" || item.option_type === "PE").map((item: Record<string, unknown>) => ({ symbol: item.symbol, side: item.option_type, strike: item.strike_price, ltp: item.ltp, bid: item.bid, ask: item.ask, oi: item.oi ?? null, oiChange: item.oich ?? null, volume: item.volume ?? null, change: item.ltpch ?? null, timestamp: item.ltt ?? item.tt ?? null }));
    const underlying = chain.find((item: Record<string, unknown>) => item.symbol === symbol);
    return NextResponse.json({ contracts, underlying: { symbol, ltp: underlying?.ltp ?? null }, expiries: result.data?.expiryData ?? [], selectedExpiry: expiry, strikeLimit: 50, checkedAt: new Date().toISOString(), streaming: false }, { headers });
  } catch { return NextResponse.json({ error: "FYERS option-chain service unavailable." }, { status: 503, headers }); }
}
