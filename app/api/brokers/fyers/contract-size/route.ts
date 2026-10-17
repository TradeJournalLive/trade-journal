import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { createPremiumCache } from "../../../../lib/algo/premiumCache";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const master = createPremiumCache<Map<string, number>>(24 * 3600000, 1);
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, max-age=3600" };
  const symbol = new URL(request.url).searchParams.get("symbol") || "";
  if (!/^NSE:[A-Z0-9]{4,55}(CE|PE)$/.test(symbol)) return NextResponse.json({ error: "Invalid option contract." }, { status: 400 });
  try {
    const sizes = await master("NSE_FO", async () => {
      const response = await fetch("https://public.fyers.in/sym_details/NSE_FO.csv", { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Contract sizes unavailable.");
      const rows: string[][] = parse(await response.text(), { skip_empty_lines: true });
      return new Map(rows.filter(row => Number.isSafeInteger(Number(row[3])) && Number(row[3]) > 0).map(row => [row[9], Number(row[3])]));
    });
    return NextResponse.json({ symbol, lotSize: sizes.get(symbol) ?? null }, { headers });
  } catch { return NextResponse.json({ error: "Lot size unavailable. Confirm manually." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
