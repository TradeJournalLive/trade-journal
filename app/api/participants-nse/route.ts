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
    const bodyAttempts = [
      { date: toNiftyDate(targetDate) },
      { date: targetDate },
      { date: "" }
    ];

    let response: Response | null = null;
    for (const body of bodyAttempts) {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        next: { revalidate: 300 }
      });
      if (res.ok) {
        response = res;
        break;
      }
      response = res;
    }

    if (!response?.ok) {
      return NextResponse.json(
        {
          error: `NiftyTrader API failed (${response?.status ?? "no-response"}).`
        },
        { status: 503 }
      );
    }

    const payload = await response.json();
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

    const items: ParticipantFlow[] = rows
      .map((row, index) => {
        const participant = mapParticipant(
          getExact(row, ["clientType", "client_type", "participant", "category", "client"])
        );
        if (!participant) return null;

        const future = pairFromRow(
          row,
          ["futureIndexBuy", "futureBuy", "futureBought", "futureLong", "futureContractsBuy"],
          ["futureIndexSell", "futureSell", "futureSold", "futureShort", "futureContractsSell"],
          [
            "futureChange",
            "futureNetChange",
            "future_contract_change",
            "futureContractsChange",
            "futChange",
            "futureOiChange"
          ]
        );
        const ce = pairFromRow(
          row,
          ["ceIndexBuy", "ceBuy", "callBuy", "callLong", "optionCallBuy"],
          ["ceIndexSell", "ceSell", "callSell", "callShort", "optionCallSell"],
          ["ceChange", "callChange", "ceNetChange", "ceContractsChange", "callOiChange"]
        );
        const pe = pairFromRow(
          row,
          ["peIndexBuy", "peBuy", "putBuy", "putLong", "optionPutBuy"],
          ["peIndexSell", "peSell", "putSell", "putShort", "optionPutSell"],
          ["peChange", "putChange", "peNetChange", "peContractsChange", "putOiChange"]
        );

        // Strict mode: require each instrument pair to be discoverable from exact keys.
        if (!future.ok || !ce.ok || !pe.ok) return null;

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
      const sampleKeys = Object.keys(rows[0] ?? {}).slice(0, 30);
      return NextResponse.json(
        {
          error: "Strict NiftyTrader mapping failed for this date.",
          keys: sampleKeys
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
