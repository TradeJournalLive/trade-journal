import { NextResponse } from "next/server";

export const runtime = "edge";

type SnapshotRow = {
  label: string;
  previous: number | null;
  current: number | null;
  diffPct: number | null;
};

const SYMBOLS = [
  { label: "DXY", tvSymbol: "TVC:DXY", live: false },
  { label: "INDIA VIX", tvSymbol: "NSE:INDIAVIX", live: true },
  { label: "DJI", tvSymbol: "TVC:DJI", live: false },
  { label: "NASDAQ", tvSymbol: "TVC:IXIC", live: false },
  { label: "GOLD", tvSymbol: "COMEX:GC1!", live: false },
  { label: "BITCOIN", tvSymbol: "BINANCE:BTCUSDT", live: false }
] as const;

function fallbackRows(): SnapshotRow[] {
  return SYMBOLS.map((item) => ({
    label: item.label,
    previous: null,
    current: null,
    diffPct: null
  }));
}

function validNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRow(label: string, previous: number | null, current: number | null): SnapshotRow {
  const diffPct =
    current !== null && previous !== null && previous !== 0
      ? ((current - previous) / previous) * 100
      : null;
  return { label, previous, current, diffPct };
}

type TradingViewScanResponse = {
  data?: Array<{
    s?: string;
    d?: Array<number | string | null>;
  }>;
};

async function fetchTradingViewRows() {
  const response = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      symbols: {
        tickers: SYMBOLS.map((item) => item.tvSymbol),
        query: { types: [] }
      },
      columns: ["name", "close[2]", "close[1]", "close"]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`TradingView scan failed: ${response.status}`);
  }

  const payload = (await response.json()) as TradingViewScanResponse;
  const bySymbol = new Map((payload.data ?? []).map((row) => [row.s ?? "", row.d ?? []]));

  return SYMBOLS.map((item) => {
    const d = bySymbol.get(item.tvSymbol) ?? [];
    const close2 = validNumber(d[1]);
    const close1 = validNumber(d[2]);
    const close0 = validNumber(d[3]);

    // Rule:
    // - INDIA VIX -> live pair (previous close vs current/live)
    // - Others    -> previous two completed closes (day-before-yesterday vs yesterday)
    const previous = item.live ? close1 : close2;
    const current = item.live ? close0 : close1;

    return toRow(item.label, previous, current);
  });
}

export async function GET() {
  try {
    const rows = await fetchTradingViewRows();
    const hasData = rows.some((row) => row.current !== null && row.previous !== null);
    return NextResponse.json({ rows, hasData });
  } catch {
    return NextResponse.json({ rows: fallbackRows(), hasData: false });
  }
}
