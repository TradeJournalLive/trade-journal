import { NextResponse } from "next/server";

export const runtime = "edge";
export const preferredRegion = ["bom1", "sin1"];

const PNL_SS_PREFIX = "[PNL_SS]";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|data:|blob:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function splitRemarksAndPnl(raw?: string | null) {
  const value = (raw ?? "").trim();
  if (!value) {
    return {
      pnlScreenshotUrl: ""
    };
  }

  const lines = value.replace(/\r/g, "").split("\n");
  let pnlScreenshotUrl = "";

  for (const line of lines) {
    if (line.startsWith(PNL_SS_PREFIX)) {
      pnlScreenshotUrl = normalizeUrl(line.slice(PNL_SS_PREFIX.length));
    }
  }

  return { pnlScreenshotUrl };
}

async function enrichPayloadFromTrades(
  payload: unknown,
  url: string,
  key: string
) {
  if (!payload || typeof payload !== "object") return payload;
  if (!("ownerUserId" in payload) || !("days" in payload)) return payload;

  const ownerUserId = String((payload as { ownerUserId?: unknown }).ownerUserId ?? "");
  const days = Array.isArray((payload as { days?: unknown[] }).days)
    ? ((payload as { days: Array<{ trades?: unknown[] }> }).days ?? [])
    : [];

  if (!ownerUserId || !days.length) return payload;

  const tradeIds = Array.from(
    new Set(
      days.flatMap((day) =>
        (Array.isArray(day.trades) ? day.trades : [])
          .filter(
            (trade) =>
              trade &&
              typeof trade === "object" &&
              !String((trade as { pnlScreenshotUrl?: unknown }).pnlScreenshotUrl ?? "")
          )
          .map((trade) => String((trade as { tradeId?: unknown }).tradeId ?? ""))
          .filter(Boolean)
      )
    )
  );

  if (!tradeIds.length) return payload;

  const response = await fetch(
    `${url}/rest/v1/trades?select=trade_id,chart_url,remarks&user_id=eq.${encodeURIComponent(
      ownerUserId
    )}&trade_id=in.(${tradeIds.map((id) => `"${id}"`).join(",")})`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      cache: "no-store"
    }
  );

  if (!response.ok) return payload;

  const rows = (await response.json()) as Array<{
    trade_id?: string;
    chart_url?: string | null;
    remarks?: string | null;
  }>;

  const byTradeId = new Map(
    rows.map((row) => {
      const parsed = splitRemarksAndPnl(row.remarks);
      return [
        String(row.trade_id ?? ""),
        {
          chartUrl: row.chart_url ?? "",
          pnlScreenshotUrl: parsed.pnlScreenshotUrl
        }
      ];
    })
  );

  return {
    ...(payload as Record<string, unknown>),
    days: days.map((day) => ({
      ...day,
      trades: (Array.isArray(day.trades) ? day.trades : []).map((trade) => {
        if (!trade || typeof trade !== "object") return trade;
        const found = byTradeId.get(String((trade as { tradeId?: unknown }).tradeId ?? ""));
        if (!found) return trade;
        return {
          ...(trade as Record<string, unknown>),
          chartUrl:
            String((trade as { chartUrl?: unknown }).chartUrl ?? "") || found.chartUrl || "",
          pnlScreenshotUrl:
            String((trade as { pnlScreenshotUrl?: unknown }).pnlScreenshotUrl ?? "") ||
            found.pnlScreenshotUrl ||
            ""
        };
      })
    }))
  };
}

function randomId(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

export async function POST(request: Request) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase env is missing." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { payload?: unknown; id?: string };
  if (!body.payload) {
    return NextResponse.json({ error: "Missing payload." }, { status: 400 });
  }

  const requestedId = (body.id ?? "").trim();
  const id = requestedId || randomId(10);
  const response = await fetch(
    `${url}/rest/v1/shared_journal_links?on_conflict=id`,
    {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=merge-duplicates"
    },
    body: JSON.stringify([
      {
        id,
        payload: body.payload
      }
    ])
    }
  );

  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: `Create failed: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ id });
}

export async function GET(request: Request) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase env is missing." },
      { status: 500 }
    );
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const response = await fetch(
    `${url}/rest/v1/shared_journal_links?select=payload&id=eq.${encodeURIComponent(
      id
    )}&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      cache: "no-store"
    }
  );
  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: `Fetch failed: ${message}` },
      { status: 500 }
    );
  }
  const rows = (await response.json()) as Array<{ payload: unknown }>;
  if (!rows.length) {
    return NextResponse.json({ error: "Share link not found." }, { status: 404 });
  }
  const payload = await enrichPayloadFromTrades(rows[0].payload, url, key);
  return NextResponse.json(
    { payload },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
      }
    }
  );
}
