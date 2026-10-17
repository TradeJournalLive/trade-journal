import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createPremiumCache } from "../../../../lib/algo/premiumCache";
import { fyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
import { completedPremiumCandle } from "../../../../lib/algo/premiumCalculator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cachedCandle = createPremiumCache<NonNullable<ReturnType<typeof completedPremiumCandle>>>(10000);
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const symbol = new URL(request.url).searchParams.get("symbol") || "";
    if (!/^NSE:[A-Z0-9]{4,55}(CE|PE)$/.test(symbol)) return NextResponse.json({ error: "Select an NSE option contract." }, { status: 400, headers });
    const connection = await readFyers(fyersDevice());
    if (!connection?.accessToken) return NextResponse.json({ error: "Sign in to FYERS to load option candles." }, { status: 401, headers });
    const end = Math.floor(Date.now() / 1000);
    const url = new URL("https://api-t1.fyers.in/data/history");
    url.search = new URLSearchParams({ symbol, resolution: "5", date_format: "0", range_from: String(end - 7 * 86400), range_to: String(end - 60), cont_flag: "1" }).toString();
    const owner = createHash("sha256").update(connection.accessToken).digest("hex");
    const candle = await cachedCandle(`${owner}:${symbol}:${Math.floor(end / 300)}`, async () => {
      const response = await fetch(url, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok || body.s !== "ok") throw new Error("FYERS candle request failed. Check your data session and permissions.");
      const value = completedPremiumCandle(Array.isArray(body.candles) ? body.candles : [], Date.now());
      if (!value) throw new Error("No completed 5-minute candle available for this contract.");
      return value;
    });
    return NextResponse.json({ symbol, candle, lotSize: null, checkedAt: new Date().toISOString() }, { headers });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Premium data unavailable." }, { status: 503, headers }); }
}
