import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(dateValue: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(dateValue)) {
    const [dd, mm, yyyy] = dateValue.split(/[-/]/);
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function rowDateToIso(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split(/[-/]/);
    return `${yyyy}-${mm}-${dd}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function mapParticipant(value: unknown): ParticipantType | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("fii") || v.includes("fpi")) return "FII";
  if (v.includes("dii")) return "DII";
  if (v.includes("pro")) return "Pro";
  if (v.includes("retail") || v.includes("client")) return "Client";
  return null;
}

function getExact(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  const lowered = new Map<string, unknown>();
  Object.entries(row).forEach(([k, v]) => lowered.set(k.toLowerCase(), v));
  for (const key of keys) {
    const hit = lowered.get(key.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return undefined;
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
  for (const key of [
    "data",
    "result",
    "Result",
    "results",
    "rows",
    "items",
    "tableData",
    "resultData",
    "oiData"
  ]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      );
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        const nested = extractRows(parsed);
        if (nested.length) return nested;
      } catch {
        // ignore non-json string
      }
    }
    if (value && typeof value === "object") {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function calcDoDIndexChange(
  row: Record<string, unknown>,
  longKey: string,
  shortKey: string,
  prevLongKey: string,
  prevShortKey: string
) {
  const currentLong = toNumber(getExact(row, [longKey]));
  const currentShort = toNumber(getExact(row, [shortKey]));
  const prevLong = toNumber(getExact(row, [prevLongKey]));
  const prevShort = toNumber(getExact(row, [prevShortKey]));
  return currentLong - currentShort - (prevLong - prevShort);
}

function changeToPair(change: number) {
  if (change >= 0) return { buy: change, sell: 0 };
  return { buy: 0, sell: Math.abs(change) };
}

function getAvailableDates(payload: unknown) {
  const resultData =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).resultData
      : null;
  const dates =
    resultData && typeof resultData === "object"
      ? (resultData as Record<string, unknown>).date
      : null;
  if (!Array.isArray(dates)) return [] as string[];
  return dates
    .map((value) => rowDateToIso(value))
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a));
}

async function fetchPublicPayload(date: string) {
  const url = new URL(
    "https://webapi.niftytrader.in/webapi/Resource/participant-wise-oi-table-data"
  );
  if (date) {
    url.searchParams.set("date", date);
  }
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://www.niftytrader.in",
      referer: "https://www.niftytrader.in/participant-wise-oi",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`NiftyTrader public API failed (${response.status}).`);
  }
  return response.json();
}

export async function GET(request: Request) {
  const requestDate = new URL(request.url).searchParams.get("date") ?? "";
  const targetDate = toIso(requestDate);
  if (!targetDate) {
    return NextResponse.json({ error: "Invalid or missing date." }, { status: 400 });
  }

  try {
    let payload = await fetchPublicPayload(targetDate);
    let rows = extractRows(payload);
    let availableDates = getAvailableDates(payload);
    let resolvedDate = targetDate;

    const matchedRows = () =>
      rows.filter((row) => {
        const rowDate = rowDateToIso(
          getExact(row, ["created_at", "createdAt", "date", "Date"])
        );
        return rowDate === resolvedDate;
      });

    let exactRows = matchedRows();

    if (!exactRows.length) {
      const fallbackDate = availableDates.find((date) => date <= targetDate) ?? "";
      if (fallbackDate && fallbackDate !== resolvedDate) {
        resolvedDate = fallbackDate;
        payload = await fetchPublicPayload(resolvedDate);
        rows = extractRows(payload);
        availableDates = getAvailableDates(payload);
        exactRows = matchedRows();
      }
    }

    if (!rows.length) {
      return NextResponse.json(
        {
          error: "No participant rows returned by NiftyTrader.",
          availableDates
        },
        { status: 422 }
      );
    }

    if (!exactRows.length) {
      return NextResponse.json(
        {
          error: "No exact rows found for requested date.",
          requestedDate: targetDate,
          availableDates: availableDates.slice(0, 10)
        },
        { status: 422 }
      );
    }

    const items: ParticipantFlow[] = exactRows
      .map((row, index) => {
        const participant = mapParticipant(
          getExact(row, ["clientType", "client_type", "participant", "category", "client"])
        );
        if (!participant) return null;

        const futureChange = calcDoDIndexChange(
          row,
          "future_index_long",
          "future_index_short",
          "prev_future_index_long",
          "prev_future_index_short"
        );
        const ceChange = calcDoDIndexChange(
          row,
          "option_index_call_long",
          "option_index_call_short",
          "prev_option_index_call_long",
          "prev_option_index_call_short"
        );
        const peChange = calcDoDIndexChange(
          row,
          "option_index_put_long",
          "option_index_put_short",
          "prev_option_index_put_long",
          "prev_option_index_put_short"
        );

        const future = changeToPair(futureChange);
        const ce = changeToPair(ceChange);
        const pe = changeToPair(peChange);

        return {
          id: `NT-${resolvedDate}-${participant}-${index}`,
          date: resolvedDate,
          participant,
          futureBoughtQty: future.buy,
          futureSoldQty: future.sell,
          callBoughtQty: ce.buy,
          putBoughtQty: pe.buy,
          callSoldQty: ce.sell,
          putSoldQty: pe.sell
        };
      })
      .filter((item): item is ParticipantFlow => Boolean(item));

    if (!items.length) {
      const sampleKeys = Object.keys(exactRows[0] ?? {}).slice(0, 30);
      const sampleRow =
        exactRows[0] && typeof exactRows[0] === "object"
          ? Object.fromEntries(Object.entries(exactRows[0]).slice(0, 30))
          : {};
      return NextResponse.json(
        {
          error: "Participant mapping failed for this date.",
          rowCount: rows.length,
          keys: sampleKeys,
          sampleRow
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      source: "NiftyTrader",
      date: resolvedDate,
      requestedDate: targetDate,
      items,
      availableDates: availableDates.slice(0, 10)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not fetch NiftyTrader participant data."
      },
      { status: 500 }
    );
  }
}
