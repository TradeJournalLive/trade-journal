import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DHAN_SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
const MAX_ROWS_TO_SCAN = 120000;

type InstrumentMatch = {
  securityId: string;
  displayName: string;
  tradingSymbol: string;
  exchangeSegment: string;
  underlying: string;
  expiry: string;
  strike: string;
  optionType: string;
  lotSize: number;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (rows.length > MAX_ROWS_TO_SCAN) break;
      continue;
    }
    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function getValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== "") return value.trim();
  }
  return "";
}

function normalizeUnderlying(value: string) {
  const upper = value.toUpperCase().replace(/\s+/g, "");
  if (upper === "NIFTY50") return "NIFTY";
  if (upper === "NIFTYBANK") return "BANKNIFTY";
  return upper;
}

function inferOptionType(text: string) {
  const upper = text.toUpperCase();
  if (/\b(CE|CALL)\b/.test(upper) || upper.endsWith("CE")) return "CE";
  if (/\b(PE|PUT)\b/.test(upper) || upper.endsWith("PE")) return "PE";
  return "";
}

function inferStrike(text: string) {
  const match = text.replace(/,/g, "").match(/(?:^|\D)(\d{4,6})(?:\D|$)/);
  return match?.[1] ?? "";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = normalizeUnderlying(searchParams.get("underlying") || "NIFTY");
  const optionType = (searchParams.get("optionType") || "").toUpperCase();
  const expiry = (searchParams.get("expiry") || "").toUpperCase();
  const strike = (searchParams.get("strike") || "").trim();
  const query = (searchParams.get("q") || "").toUpperCase();
  const limit = Math.min(Number(searchParams.get("limit") || 60), 120);

  const response = await fetch(DHAN_SCRIP_MASTER_URL, { cache: "no-store" });
  if (!response.ok) {
    return NextResponse.json({ error: "Could not fetch Dhan instrument master." }, { status: 502 });
  }

  const csv = await response.text();
  const rows = parseCsv(csv);
  const header = rows.shift()?.map((item) => item.trim()) ?? [];
  const matches: InstrumentMatch[] = [];

  for (const values of rows) {
    const record: Record<string, string> = {};
    header.forEach((key, index) => { record[key] = values[index]?.trim() ?? ""; });

    const exchange = getValue(record, ["EXCH_ID", "SEM_EXM_EXCH_ID"]);
    const segment = getValue(record, ["SEGMENT", "SEM_SEGMENT"]);
    const instrument = getValue(record, ["INSTRUMENT", "SEM_INSTRUMENT_NAME", "INSTRUMENT_TYPE", "SEM_EXCH_INSTRUMENT_TYPE"]);
    const recordUnderlying = normalizeUnderlying(getValue(record, ["UNDERLYING_SYMBOL", "SM_SYMBOL_NAME", "SYMBOL_NAME"]));
    const displayName = getValue(record, ["DISPLAY_NAME", "SEM_CUSTOM_SYMBOL", "SM_SYMBOL_NAME", "SYMBOL_NAME", "SEM_TRADING_SYMBOL"]);
    const tradingSymbol = getValue(record, ["TRADING_SYMBOL", "SEM_TRADING_SYMBOL", "DISPLAY_NAME", "SEM_CUSTOM_SYMBOL"]);
    const securityId = getValue(record, ["SECURITY_ID", "SEM_SMST_SECURITY_ID", "SEM_SECURITY_ID"]);
    const rawExpiry = getValue(record, ["EXPIRY_DATE", "SEM_EXPIRY_DATE", "SM_EXPIRY_DATE", "EXPIRY"]);
    const rawStrike = getValue(record, ["STRIKE_PRICE", "SEM_STRIKE_PRICE", "SM_STRIKE_PRICE"]) || inferStrike(`${displayName} ${tradingSymbol}`);
    const rawOptionType = getValue(record, ["OPTION_TYPE", "SEM_OPTION_TYPE", "DRV_OPTION_TYPE"]) || inferOptionType(`${displayName} ${tradingSymbol}`);
    const lotSize = Number(getValue(record, ["LOT_SIZE", "SEM_LOT_UNITS", "LOT_UNITS"]) || 0);
    const searchText = `${recordUnderlying} ${displayName} ${tradingSymbol} ${instrument}`.toUpperCase();

    if (!securityId || !displayName) continue;
    if (exchange && !["NSE", "BSE"].includes(exchange.toUpperCase())) continue;
    if (segment && !["D", "E"].includes(segment.toUpperCase())) continue;
    if (instrument && !instrument.toUpperCase().includes("OPT") && !searchText.includes(" CE") && !searchText.includes(" PE")) continue;
    if (underlying && !searchText.includes(underlying)) continue;
    if (optionType && rawOptionType.toUpperCase() !== optionType) continue;
    if (expiry && !rawExpiry.toUpperCase().includes(expiry)) continue;
    if (strike && rawStrike.replace(/\.0+$/, "") !== strike) continue;
    if (query && !searchText.includes(query)) continue;

    matches.push({
      securityId,
      displayName,
      tradingSymbol,
      exchangeSegment: exchange.toUpperCase() === "BSE" ? "BSE_FNO" : "NSE_FNO",
      underlying: recordUnderlying || underlying,
      expiry: rawExpiry,
      strike: rawStrike,
      optionType: rawOptionType.toUpperCase(),
      lotSize: Number.isFinite(lotSize) && lotSize > 0 ? lotSize : 1
    });

    if (matches.length >= limit) break;
  }

  return NextResponse.json({ matches, source: "Dhan instrument master", count: matches.length });
}
