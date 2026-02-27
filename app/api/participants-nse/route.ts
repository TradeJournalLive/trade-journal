import { NextResponse } from "next/server";

type ParticipantType = "FII" | "DII" | "Client" | "Pro";

type ParticipantFlow = {
  id: string;
  date: string;
  participant: ParticipantType;
  futureBoughtQty: number;
  futureSoldQty: number;
  callBoughtQty: number;
  putBoughtQty: number;
  callSoldQty: number;
  putSoldQty: number;
};

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapParticipant(value: string): ParticipantType | null {
  const v = value.toLowerCase();
  if (v.includes("fii") || v.includes("fpi")) return "FII";
  if (v.includes("dii")) return "DII";
  if (v.includes("pro")) return "Pro";
  if (v.includes("client")) return "Client";
  return null;
}

function toDateStamp(date: Date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toIsoFromUnknown(value: unknown) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(v)) {
    const [dd, mm, yyyy] = v.split(/[-/]/);
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function getByAliases(
  row: Record<string, unknown>,
  aliases: string[]
) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = entries.find(([key]) =>
      key.toLowerCase().replace(/[^a-z0-9]/g, "").includes(normalizedAlias)
    );
    if (match) return match[1];
  }
  return undefined;
}

function changeToBuySell(change: number) {
  if (change >= 0) {
    return { buy: change, sell: 0 };
  }
  return { buy: 0, sell: Math.abs(change) };
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const directKeys = [
    "data",
    "result",
    "results",
    "rows",
    "items",
    "tableData",
    "records"
  ];
  for (const key of directKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      );
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractRows(candidate);
      if (nested.length) return nested;
    }
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      const rows = value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      );
      if (rows.length) return rows;
    }
  }
  return [];
}

function pickIndexes(
  header: string[],
  preferredTokens: string[],
  fallbackTokens: string[]
) {
  const preferredWithContracts = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        preferredTokens.every((token) => h.includes(token)) &&
        h.includes("contracts") &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (preferredWithContracts.length) return preferredWithContracts;

  const preferred = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        preferredTokens.every((token) => h.includes(token)) &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (preferred.length) return preferred;

  const fallbackWithContracts = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        fallbackTokens.every((token) => h.includes(token)) &&
        h.includes("contracts") &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (fallbackWithContracts.length) return fallbackWithContracts;

  return header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        fallbackTokens.every((token) => h.includes(token)) &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
}

function pickByMode(
  header: string[],
  baseTokens: string[],
  mode: "buy" | "sell" | "long" | "short"
) {
  return pickIndexes(
    header,
    [...baseTokens, mode],
    [...baseTokens, mode]
  );
}

export async function GET(request: Request) {
  const bases = [
    "https://archives.nseindia.com/content/nsccl",
    "https://www1.nseindia.com/content/nsccl"
  ];
  const errors: string[] = [];

  const requestDate = new URL(request.url).searchParams.get("date");
  const candidateDates: Date[] = [];
  if (requestDate) {
    const parsed = new Date(`${requestDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      candidateDates.push(parsed);
    }
  }
  if (!candidateDates.length) {
    for (let offset = 0; offset < 21; offset += 1) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      candidateDates.push(d);
    }
  }

  const targetDate = candidateDates[0] ? toIso(candidateDates[0]) : "";

  // Try NiftyTrader participant endpoint first (closest to user reference output).
  try {
    const niftyUrl = "https://webapi.niftytrader.in/webapi/Resource/participant-oi-table-data";
    const niftyRequestUrl = targetDate
      ? `${niftyUrl}?date=${encodeURIComponent(targetDate)}`
      : niftyUrl;
    const niftyResponse = await fetch(niftyRequestUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        origin: "https://www.niftytrader.in",
        referer: "https://www.niftytrader.in/participant-wise-oi",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      },
      next: { revalidate: 900 }
    });

    if (niftyResponse.ok) {
      const payload = await niftyResponse.json();
      const rows = extractRows(payload);
      const filtered = targetDate
        ? rows.filter((row) => {
            const rowDate = toIsoFromUnknown(
              getByAliases(row, ["date", "tradingDate", "asOnDate"])
            );
            return !rowDate || rowDate === targetDate;
          })
        : rows;

      const mapped: ParticipantFlow[] = filtered
        .map((row, index) => {
          const participant = mapParticipant(
            String(
              getByAliases(row, ["clientType", "participant", "category", "client"]) ?? ""
            )
          );
          if (!participant) return null;

          const futureBuyRaw = toNumber(
            String(
              getByAliases(row, [
                "futureIndexLong",
                "futureLong",
                "futureBuy",
                "futureBought"
              ]) ?? "0"
            )
          );
          const futureSellRaw = toNumber(
            String(
              getByAliases(row, [
                "futureIndexShort",
                "futureShort",
                "futureSell",
                "futureSold"
              ]) ?? "0"
            )
          );
          const ceBuyRaw = toNumber(
            String(
              getByAliases(row, [
                "optionIndexCallLong",
                "callLong",
                "ceBuy",
                "callBuy"
              ]) ?? "0"
            )
          );
          const ceSellRaw = toNumber(
            String(
              getByAliases(row, [
                "optionIndexCallShort",
                "callShort",
                "ceSell",
                "callSell"
              ]) ?? "0"
            )
          );
          const peBuyRaw = toNumber(
            String(
              getByAliases(row, [
                "optionIndexPutLong",
                "putLong",
                "peBuy",
                "putBuy"
              ]) ?? "0"
            )
          );
          const peSellRaw = toNumber(
            String(
              getByAliases(row, [
                "optionIndexPutShort",
                "putShort",
                "peSell",
                "putSell"
              ]) ?? "0"
            )
          );

          // If endpoint gives ready change values, convert to buy/sell proxy.
          const futureChange = toNumber(
            String(getByAliases(row, ["futureChange", "futureNetChange"]) ?? "0")
          );
          const ceChange = toNumber(
            String(getByAliases(row, ["ceChange", "callChange"]) ?? "0")
          );
          const peChange = toNumber(
            String(getByAliases(row, ["peChange", "putChange"]) ?? "0")
          );

          const futurePair =
            futureBuyRaw || futureSellRaw
              ? { buy: futureBuyRaw, sell: futureSellRaw }
              : changeToBuySell(futureChange);
          const cePair =
            ceBuyRaw || ceSellRaw
              ? { buy: ceBuyRaw, sell: ceSellRaw }
              : changeToBuySell(ceChange);
          const pePair =
            peBuyRaw || peSellRaw
              ? { buy: peBuyRaw, sell: peSellRaw }
              : changeToBuySell(peChange);

          return {
            id: `NT-${targetDate || "latest"}-${participant}-${index}`,
            date: targetDate || toIsoFromUnknown(getByAliases(row, ["date", "tradingDate"])) || new Date().toISOString().slice(0, 10),
            participant,
            futureBoughtQty: futurePair.buy,
            futureSoldQty: futurePair.sell,
            callBoughtQty: cePair.buy,
            putBoughtQty: pePair.buy,
            callSoldQty: cePair.sell,
            putSoldQty: pePair.sell
          };
        })
        .filter((item): item is ParticipantFlow => Boolean(item));

      if (mapped.length) {
        return NextResponse.json({
          source: "NiftyTrader",
          date: targetDate || mapped[0].date,
          file: "participant-oi-table-data",
          items: mapped
        });
      }
    }
  } catch {
    // Fall back to NSE archive parser below.
  }

  for (const d of candidateDates) {
    const stamp = toDateStamp(d);
    const isoDate = toIso(d);
    const filenames = [`fao_participant_vol_${stamp}.csv`, `fao_participant_oi_${stamp}.csv`];

    for (const base of bases) {
      for (const filename of filenames) {
      const url = `${base}/${filename}`;
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            accept: "text/csv,*/*"
          },
          next: { revalidate: 1800 }
        });
        if (!response.ok) {
          errors.push(`${stamp}:${response.status}`);
          continue;
        }
        const csv = await response.text();
        const lines = csv
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length < 2) continue;

        let headerIndex = -1;
        let clientIdx = -1;
        let futureLongIndexes: number[] = [];
        let futureShortIndexes: number[] = [];
        let callLongIndexes: number[] = [];
        let putLongIndexes: number[] = [];
        let callShortIndexes: number[] = [];
        let putShortIndexes: number[] = [];

        for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
          const header = parseCsvLine(lines[i]).map(normalize);
          const cIdx = header.findIndex((h) => h.includes("clienttype"));
          // Prefer volume buy/sell columns; fallback to OI long/short.
          const futBuyIdxs =
            pickByMode(header, ["future", "index"], "buy").length
              ? pickByMode(header, ["future", "index"], "buy")
              : pickByMode(header, ["future", "index"], "long");
          const futSellIdxs =
            pickByMode(header, ["future", "index"], "sell").length
              ? pickByMode(header, ["future", "index"], "sell")
              : pickByMode(header, ["future", "index"], "short");
          const callBuyIdxs =
            pickByMode(header, ["option", "index", "call"], "buy").length
              ? pickByMode(header, ["option", "index", "call"], "buy")
              : pickByMode(header, ["option", "index", "call"], "long");
          const putBuyIdxs =
            pickByMode(header, ["option", "index", "put"], "buy").length
              ? pickByMode(header, ["option", "index", "put"], "buy")
              : pickByMode(header, ["option", "index", "put"], "long");
          const callSellIdxs =
            pickByMode(header, ["option", "index", "call"], "sell").length
              ? pickByMode(header, ["option", "index", "call"], "sell")
              : pickByMode(header, ["option", "index", "call"], "short");
          const putSellIdxs =
            pickByMode(header, ["option", "index", "put"], "sell").length
              ? pickByMode(header, ["option", "index", "put"], "sell")
              : pickByMode(header, ["option", "index", "put"], "short");
          if (
            cIdx >= 0 &&
            futBuyIdxs.length &&
            futSellIdxs.length &&
            callBuyIdxs.length &&
            putBuyIdxs.length &&
            callSellIdxs.length &&
            putSellIdxs.length
          ) {
            headerIndex = i;
            clientIdx = cIdx;
            futureLongIndexes = futBuyIdxs;
            futureShortIndexes = futSellIdxs;
            callLongIndexes = callBuyIdxs;
            putLongIndexes = putBuyIdxs;
            callShortIndexes = callSellIdxs;
            putShortIndexes = putSellIdxs;
            break;
          }
        }

        if (headerIndex < 0) {
          errors.push(`${stamp}:header-not-found`);
          continue;
        }

        const items: ParticipantFlow[] = [];
        for (let i = headerIndex + 1; i < lines.length; i += 1) {
          const row = parseCsvLine(lines[i]);
          const participant = mapParticipant(row[clientIdx] ?? "");
          if (!participant) continue;
          const futureBoughtQty = futureLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const futureSoldQty = futureShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const callBoughtQty = callLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const putBoughtQty = putLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const callSoldQty = callShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const putSoldQty = putShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          items.push({
            id: `NSE-${stamp}-${participant}`,
            date: isoDate,
            participant,
            futureBoughtQty,
            futureSoldQty,
            callBoughtQty,
            putBoughtQty,
            callSoldQty,
            putSoldQty
          });
        }

        if (items.length) {
          return NextResponse.json({
            source: "NSE",
            date: isoDate,
            file: filename,
            items
          });
        }
        errors.push(`${stamp}:no-mapped-items`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown-fetch-error";
        errors.push(`${stamp}:${message}`);
        continue;
      }
    }
    }
  }

  return NextResponse.json(
    {
      error: "Could not fetch participant data from NSE right now.",
      details: errors.slice(0, 6)
    },
    { status: 503 }
  );
}
