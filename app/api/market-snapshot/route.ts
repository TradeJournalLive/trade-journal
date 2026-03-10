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

function validNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIstDateKeyFromUnix(tsSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(tsSeconds * 1000));
}

function currentIstDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function toRow(label: string, previous: number | null, current: number | null): SnapshotRow {
  const diffPct =
    current !== null && previous !== null && previous !== 0
      ? ((current - previous) / previous) * 100
      : null;
  return { label, previous, current, diffPct };
}

async function fetchYahooQuoteRows() {
  const query = encodeURIComponent(SYMBOLS.map((item) => item.symbol).join(","));
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${query}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Yahoo quote failed: ${response.status}`);
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

  return SYMBOLS.map((item) => {
    const source = bySymbol.get(item.symbol);
    const current = validNumber(source?.regularMarketPrice);
    const previous = validNumber(source?.regularMarketPreviousClose);
    return toRow(item.label, previous, current);
  });
}

async function fetchYahooChartRow(
  symbol: string,
  label: string,
  options?: { excludeToday?: boolean }
): Promise<SnapshotRow> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=5d&interval=1d`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    },
    cache: "no-store"
  });

  if (!response.ok) return toRow(label, null, null);

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const timestamps = payload.chart?.result?.[0]?.timestamp ?? [];
  const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const todayIst = currentIstDateKey();

  const valid = closes
    .map((close, index) => {
      const ts = timestamps[index];
      if (typeof close !== "number" || !Number.isFinite(close)) return null;
      if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
      const rowIst = toIstDateKeyFromUnix(ts);
      if (options?.excludeToday && rowIst >= todayIst) return null;
      return close;
    })
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (!valid.length) return toRow(label, null, null);
  const current = valid[valid.length - 1] ?? null;
  const previous = valid.length >= 2 ? valid[valid.length - 2] : null;
  return toRow(label, previous, current);
}

async function fetchYahooChartRows() {
  const rows = await Promise.all(
    SYMBOLS.map((item) => fetchYahooChartRow(item.symbol, item.label))
  );
  return rows;
}

async function fetchChartRowsWithRule() {
  const rows = await Promise.all(
    SYMBOLS.map((item) =>
      fetchYahooChartRow(item.symbol, item.label, {
        excludeToday: item.label !== "INDIA VIX"
      })
    )
  );
  return rows;
}

async function fetchMixedRows() {
  const quoteRows = await fetchYahooQuoteRows();
  const quoteByLabel = new Map(quoteRows.map((row) => [row.label, row]));

  const rows = await Promise.all(
    SYMBOLS.map(async (item) => {
      if (item.label === "INDIA VIX") {
        return quoteByLabel.get(item.label) ?? toRow(item.label, null, null);
      }
      return fetchYahooChartRow(item.symbol, item.label, { excludeToday: true });
    })
  );

  return rows;
}

export async function GET() {
  try {
    let rows = await fetchMixedRows();
    const hasData = rows.some((row) => row.current !== null && row.previous !== null);

    if (!hasData) {
      rows = await fetchChartRowsWithRule();
    }

    const finalHasData = rows.some(
      (row) => row.current !== null && row.previous !== null
    );

    return NextResponse.json({ rows, hasData: finalHasData });
  } catch {
    try {
      const rows = await fetchChartRowsWithRule();
      const hasData = rows.some(
        (row) => row.current !== null && row.previous !== null
      );
      return NextResponse.json({ rows, hasData });
    } catch {
      return NextResponse.json({ rows: fallbackRows(), hasData: false });
    }
  }
}
