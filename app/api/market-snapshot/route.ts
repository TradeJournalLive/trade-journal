import { NextResponse } from "next/server";

export const runtime = "edge";

type SnapshotRow = {
  label: string;
  previous: number | null;
  current: number | null;
  diffPct: number | null;
};

const SYMBOLS = [
  { label: "DXY", symbol: "DX-Y.NYB" },
  { label: "INDIA VIX", symbol: "^INDIAVIX" },
  { label: "DJI", symbol: "^DJI" },
  { label: "NASDAQ", symbol: "^IXIC" },
  { label: "GOLD", symbol: "GC=F" },
  { label: "BITCOIN", symbol: "BTC-USD" }
] as const;

function fallbackRows(): SnapshotRow[] {
  return SYMBOLS.map((item) => ({
    label: item.label,
    previous: null,
    current: null,
    diffPct: null
  }));
}

export async function GET() {
  const query = encodeURIComponent(SYMBOLS.map((item) => item.symbol).join(","));
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${query}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json({ rows: fallbackRows() });
    }

    const payload = (await response.json()) as {
      quoteResponse?: {
        result?: Array<{
          symbol?: string;
          regularMarketPrice?: number;
          regularMarketPreviousClose?: number;
        }>;
      };
    };

    const bySymbol = new Map(
      (payload.quoteResponse?.result ?? []).map((row) => [row.symbol ?? "", row])
    );

    const rows: SnapshotRow[] = SYMBOLS.map((item) => {
      const source = bySymbol.get(item.symbol);
      const current =
        typeof source?.regularMarketPrice === "number"
          ? source.regularMarketPrice
          : null;
      const previous =
        typeof source?.regularMarketPreviousClose === "number"
          ? source.regularMarketPreviousClose
          : null;

      const diffPct =
        current !== null && previous !== null && previous !== 0
          ? ((current - previous) / previous) * 100
          : null;

      return {
        label: item.label,
        previous,
        current,
        diffPct
      };
    });

    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ rows: fallbackRows() });
  }
}
