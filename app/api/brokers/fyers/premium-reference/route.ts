import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { fyersDevice, readFyers } from "../../../../lib/algo/fyersConnection";
import { completedPremiumCandle } from "../../../../lib/algo/premiumCalculator";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
    const response = await fetch(url, { headers: { Authorization: `${connection.appId}:${connection.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || body.s !== "ok") throw new Error("FYERS candle request failed. Check your data session and permissions.");
    const candle = completedPremiumCandle(Array.isArray(body.candles) ? body.candles : [], Date.now());
    if (!candle) throw new Error("No completed 5-minute candle available for this contract.");
    let lotSize: number | null = null;
    try {
      const master = await fetch("https://public.fyers.in/sym_details/NSE_FO.csv", { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) });
      if (master.ok) {
        const rows: string[][] = parse(await master.text(), { skip_empty_lines: true });
        const size = Number(rows.find(row => row[9] === symbol)?.[3]);
        if (Number.isSafeInteger(size) && size > 0) lotSize = size;
      }
    } catch { /* Candle calculations remain available with a manually confirmed lot size. */ }
    return NextResponse.json({ symbol, candle, lotSize, checkedAt: new Date().toISOString() }, { headers });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Premium data unavailable." }, { status: 503, headers }); }
}
