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

function toNiftyDate(iso: string) {
  const [yyyy, mm, dd] = iso.split("-");
  if (!yyyy || !mm || !dd) return "";
  return `${dd}/${mm}/${yyyy}`;
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
    "tableData"
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
  // Deep fallback: search recursively for first array of objects.
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      const rows = node.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      );
      if (rows.length) return rows;
      node.forEach((item) => stack.push(item));
      continue;
    }
    Object.values(node as Record<string, unknown>).forEach((value) =>
      stack.push(value)
    );
  }
  return [];
}

function pairFromRow(
  row: Record<string, unknown>,
  buyKeys: string[],
  sellKeys: string[],
  changeKeys: string[]
) {
  // Prefer explicit "change" fields from source (closest to displayed participant activity tables).
  const changeRaw = getExact(row, changeKeys);
  const change = toNumber(changeRaw);
  if (change > 0) return { buy: change, sell: 0, ok: true };
  if (change < 0) return { buy: 0, sell: Math.abs(change), ok: true };
  if (changeRaw !== undefined) return { buy: 0, sell: 0, ok: true };

  const buyRaw = getExact(row, buyKeys);
  const sellRaw = getExact(row, sellKeys);

  const buy = toNumber(buyRaw);
  const sell = toNumber(sellRaw);
  if (buy !== 0 || sell !== 0) {
    return { buy, sell, ok: true };
  }
  return { buy: 0, sell: 0, ok: false };
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

export async function GET(request: Request) {
  const requestDate = new URL(request.url).searchParams.get("date") ?? "";
  const targetDate = toIso(requestDate);
  if (!targetDate) {
    return NextResponse.json({ error: "Invalid or missing date." }, { status: 400 });
  }

  const bearer = process.env.NIFTYTRADER_BEARER_TOKEN;
  if (!bearer) {
    return NextResponse.json(
      {
        error:
          "Missing NIFTYTRADER_BEARER_TOKEN. Add it in Vercel and local env."
      },
      { status: 500 }
    );
  }

  try {
    const url =
      "https://webapi.niftytrader.in/webapi/Resource/participant-oi-table-data";
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      origin: "https://www.niftytrader.in",
      platform_type: "1",
      referer: "https://www.niftytrader.in/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    };
    const fetchPayload = async (dateValue: string) => {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ date: dateValue }),
        next: { revalidate: 300 }
      });
      if (!res.ok) return null;
      return res.json();
    };

    const dateAttempts = [toNiftyDate(targetDate), targetDate, ""];
    let payload: unknown = null;
    let responseOk = false;

    for (const dateValue of dateAttempts) {
      const nextPayload = await fetchPayload(dateValue);
      if (!nextPayload) continue;
      payload = nextPayload;
      responseOk = true;
      const rows = extractRows(payload);
      const targetedRows = rows.filter((row) =>
        String(getExact(row, ["created_at", "createdAt", "date"]) ?? "").startsWith(
          targetDate
        )
      );
      if (targetedRows.length) {
        payload = { rows: targetedRows };
        break;
      }

      const resultData =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).resultData
          : null;
      const availableDates =
        resultData && typeof resultData === "object"
          ? (resultData as Record<string, unknown>).date
          : null;
      if (Array.isArray(availableDates)) {
        const matched = availableDates.find(
          (item) => typeof item === "string" && item.startsWith(targetDate)
        ) as string | undefined;
        if (matched) {
          const byTimestamp = await fetchPayload(matched);
          if (byTimestamp) {
            const stampRows = extractRows(byTimestamp).filter((row) =>
              String(
                getExact(row, ["created_at", "createdAt", "date"]) ?? ""
              ).startsWith(targetDate)
            );
            if (stampRows.length) {
              payload = { rows: stampRows };
              break;
            }
            payload = byTimestamp;
          }
        }
      }
    }

    if (!responseOk || !payload) {
      return NextResponse.json(
        {
          error: "NiftyTrader API failed (no successful response)."
        },
        { status: 503 }
      );
    }
    const rows = extractRows(payload);
    if (!rows.length) {
      const payloadKeys =
        payload && typeof payload === "object"
          ? Object.keys(payload as Record<string, unknown>).slice(0, 20)
          : [];
      return NextResponse.json(
        {
          error: "No participant rows returned by NiftyTrader.",
          payloadType: Array.isArray(payload) ? "array" : typeof payload,
          payloadKeys
        },
        { status: 422 }
      );
    }

    const matchedRows = rows.filter((row) => {
      const rowDate = rowDateToIso(
        getExact(row, ["created_at", "createdAt", "date", "Date"])
      );
      return rowDate === targetDate;
    });
    const strictRows = matchedRows.length ? matchedRows : rows;

    const items: ParticipantFlow[] = strictRows
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
          id: `NT-${targetDate}-${participant}-${index}`,
          date: targetDate,
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
      const sampleKeys = Object.keys(strictRows[0] ?? {}).slice(0, 30);
      const sampleRow =
        strictRows[0] && typeof strictRows[0] === "object"
          ? Object.fromEntries(Object.entries(strictRows[0]).slice(0, 30))
          : {};
      return NextResponse.json(
        {
          error: "Strict NiftyTrader mapping failed for this date.",
          rowCount: rows.length,
          keys: sampleKeys,
          sampleRow
        },
        { status: 422 }
      );
    }

    if (!matchedRows.length) {
      return NextResponse.json(
        {
          error: "No exact rows found for requested date.",
          requestedDate: targetDate
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      source: "NiftyTrader",
      date: targetDate,
      items
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
