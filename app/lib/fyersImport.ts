import type { Trade } from "../data/trades";

type InstrumentDefinition = {
  id: string;
  name: string;
  lotSize: number;
};

export type FyersImportedRow = {
  symbol: string;
  side: "Buy" | "Sell";
  status: string;
  qty: number;
  tradedPrice: number | null;
  date: string;
  time: string;
  ts: number;
};

export type FyersImportCandidate = {
  symbol: string;
  instrumentName: string;
  direction: Trade["direction"];
  date: string;
  entryTime: string;
  exitTime: string;
  qty: number;
  lots: number | null;
  entryPrice: string;
  exitPrice: string;
};

const FYERS_MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};

export function normalizeOcrLine(value: string) {
  return value
    .replace(/[|]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLooseNumber(value?: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFyersDate(value: string) {
  const match = value.trim().match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) return "";
  const day = match[1].padStart(2, "0");
  const month = FYERS_MONTH_INDEX[match[2].toLowerCase()];
  const year = match[3];
  if (!month) return "";
  return `${year}-${month}-${day}`;
}

export function inferInstrumentFromFyersSymbol(
  symbol: string,
  instruments: InstrumentDefinition[]
) {
  const upper = symbol.toUpperCase();
  const directMatch =
    instruments.find((item) => upper.includes(item.name.toUpperCase().replace(/\./g, ""))) ??
    null;
  if (directMatch) return directMatch;
  if (upper.includes("BANKNIFTY") || upper.includes("BNIFTY")) {
    return (
      instruments.find((item) => item.name.toLowerCase().includes("b.nifty")) ??
      instruments.find((item) => item.name.toLowerCase().includes("bank")) ??
      null
    );
  }
  if (upper.includes("SENSEX")) {
    return instruments.find((item) => item.name.toLowerCase().includes("sensex")) ?? null;
  }
  if (upper.includes("NIFTY")) {
    return instruments.find((item) => item.name.toLowerCase().includes("nifty")) ?? null;
  }
  return null;
}

export function extractFyersRowsFromText(rawText: string) {
  const rows: FyersImportedRow[] = [];
  const normalizedText = normalizeOcrLine(rawText);
  const segments = normalizedText
    .split(/(?=NSE:?\s*[A-Z0-9]+)/i)
    .map((segment) => normalizeOcrLine(segment))
    .filter((segment) => segment.toUpperCase().includes("INTRADAY"));

  for (const line of segments) {
    const symbolMatch = line.match(/\bNSE:?\s*[A-Z0-9]+\b/i);
    const sideMatch = line.match(/\b(Buy|Sell)\b/i);
    const statusMatch = line.match(/\b(Filled|Cancelled|Rejected|Working|Inactive)\b/i);
    const dateTimeMatch = line.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(\d{2}:\d{2}:\d{2})/i);
    const qtyMatch = line.match(/\bINTRADAY\b\s+(\d+)/i);

    if (!symbolMatch || !sideMatch || !statusMatch || !dateTimeMatch || !qtyMatch) {
      continue;
    }

    const statusIndex = line.toLowerCase().indexOf(statusMatch[1].toLowerCase());
    const pricingSlice = statusIndex >= 0 ? line.slice(0, statusIndex) : line;
    const decimalTokens = (pricingSlice.match(/\d+\.\d+/g) ?? [])
      .map((token) => parseLooseNumber(token))
      .filter((value): value is number => value !== null);
    const tradedPrice = decimalTokens.length
      ? decimalTokens[decimalTokens.length - 1]
      : null;

    const isoDate = parseFyersDate(dateTimeMatch[1]);
    if (!isoDate) continue;

    const rawSymbol = symbolMatch[0].replace(/\s+/g, "").toUpperCase();
    const symbol = rawSymbol.startsWith("NSE:")
      ? rawSymbol
      : rawSymbol.replace(/^NSE/, "NSE:");
    const normalizedSide = sideMatch[1].toLowerCase() === "sell" ? "Sell" : "Buy";
    const ts = new Date(`${isoDate}T${dateTimeMatch[2]}`).getTime();

    rows.push({
      symbol,
      side: normalizedSide,
      qty: Number(qtyMatch[1]),
      tradedPrice,
      status: statusMatch[1],
      date: isoDate,
      time: dateTimeMatch[2].slice(0, 5),
      ts
    });
  }

  return rows.sort((a, b) => a.ts - b.ts);
}

export function buildFyersImportCandidate(
  rows: FyersImportedRow[],
  instruments: InstrumentDefinition[]
) {
  const filledRows = rows.filter(
    (row) => row.status.toLowerCase() === "filled" && row.tradedPrice !== null
  );
  if (!filledRows.length) return null;

  const grouped = new Map<string, FyersImportedRow[]>();
  filledRows.forEach((row) => {
    const current = grouped.get(row.symbol) ?? [];
    current.push(row);
    grouped.set(row.symbol, current);
  });

  const candidates: Array<FyersImportCandidate & { exitTs: number; score: number }> = [];

  for (const [symbol, symbolRows] of grouped.entries()) {
    const buys = symbolRows.filter((row) => row.side === "Buy").sort((a, b) => a.ts - b.ts);
    const sells = symbolRows.filter((row) => row.side === "Sell").sort((a, b) => a.ts - b.ts);
    if (!buys.length) continue;
    const entry = buys[0];
    const exit = sells.find((row) => row.ts >= entry.ts) ?? null;
    const instrument = inferInstrumentFromFyersSymbol(symbol, instruments);
    const instrumentName = instrument?.name ?? symbol.replace(/^NSE:/, "");
    const lotSize = instrument?.lotSize ?? 0;
    const lots = lotSize > 0 ? entry.qty / lotSize : null;
    const direction: Trade["direction"] = symbol.toUpperCase().includes("PE")
      ? "Short"
      : "Long";

    candidates.push({
      symbol,
      instrumentName,
      direction,
      date: entry.date,
      entryTime: entry.time,
      exitTime: exit?.time ?? "",
      qty: entry.qty,
      lots:
        lots && Number.isFinite(lots) && lots > 0
          ? Number(lots.toFixed(2))
          : null,
      entryPrice: entry.tradedPrice ? String(entry.tradedPrice) : "",
      exitPrice: exit?.tradedPrice ? String(exit.tradedPrice) : "",
      exitTs: exit?.ts ?? entry.ts,
      score: exit ? 2 : 1
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.exitTs - a.exitTs;
  });

  return candidates[0] ?? null;
}
