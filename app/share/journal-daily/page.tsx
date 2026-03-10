import JournalDailyClient from "./JournalDailyClient";
import { decompressFromEncodedURIComponent } from "lz-string";
import type { SharedPayload, SharedTrade } from "./types";

type LegacyPayload = {
  date: string;
  quote: string;
  generatedAt: string;
  trades: SharedTrade[];
};

type NewPayload = SharedPayload;

const FALLBACK_MARKET_SNAPSHOT = [
  { label: "DXY", previous: null, current: null, diffPct: null },
  { label: "INDIA VIX", previous: null, current: null, diffPct: null },
  { label: "DJI", previous: null, current: null, diffPct: null },
  { label: "NASDAQ", previous: null, current: null, diffPct: null },
  { label: "GOLD", previous: null, current: null, diffPct: null },
  { label: "BITCOIN", previous: null, current: null, diffPct: null }
];

const FALLBACK_CHECKLIST = {
  sentimentToday: "—",
  viewOutcome: "—",
  previousDayMarket: "—",
  observations: "",
  notes: ""
};

function decodeRaw(input: string): unknown {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(json) as unknown;
}

function normalizePayload(parsed: unknown): NewPayload | null {
  if (!parsed || typeof parsed !== "object") return null;

  if ("days" in parsed && Array.isArray((parsed as NewPayload).days)) {
    const next = parsed as NewPayload;
    return {
      ...next,
      days: next.days.map((day) => ({
        ...day,
        trades: day.trades.map((trade) => ({
          ...trade,
          entryTime: trade.entryTime ?? "—",
          exitTime: trade.exitTime ?? "—",
          tradeDuration: trade.tradeDuration ?? "—",
          pnlScreenshotUrl: trade.pnlScreenshotUrl ?? ""
        })),
        marketSnapshot:
          Array.isArray(day.marketSnapshot) && day.marketSnapshot.length
            ? day.marketSnapshot
            : [...FALLBACK_MARKET_SNAPSHOT],
        checklist: {
          ...FALLBACK_CHECKLIST,
          ...(day.checklist ?? {})
        }
      }))
    };
  }

  if ("trades" in parsed && Array.isArray((parsed as LegacyPayload).trades)) {
    const legacy = parsed as LegacyPayload;
    const trades = legacy.trades.map((trade) => ({
      ...trade,
      entryTime: trade.entryTime ?? "—",
      exitTime: trade.exitTime ?? "—",
      tradeDuration: trade.tradeDuration ?? "—",
      pnlScreenshotUrl: trade.pnlScreenshotUrl ?? ""
    }));
    const totalPl = trades.reduce((sum, trade) => sum + trade.pl, 0);
    const wins = trades.filter((trade) => trade.pl > 0).length;
    const losses = trades.filter((trade) => trade.pl < 0).length;
    const month = legacy.date?.slice(0, 7) || "Unknown";
    return {
      month,
      currency: "INR",
      generatedAt: legacy.generatedAt,
      days: [
        {
          date: legacy.date,
          trades,
          summary: {
            totalTrades: trades.length,
            totalPl,
            winRate: trades.length ? (wins / trades.length) * 100 : 0
          },
          marketSnapshot: [...FALLBACK_MARKET_SNAPSHOT],
          checklist: { ...FALLBACK_CHECKLIST }
        }
      ],
      monthlySummary: {
        totalTrades: trades.length,
        totalPl,
        wins,
        losses,
        winRate: trades.length ? (wins / trades.length) * 100 : 0,
        bestDay: { date: legacy.date, totalPl },
        worstDay: { date: legacy.date, totalPl }
      }
    };
  }

  return null;
}

function decodePayload(input: string): NewPayload | null {
  try {
    const compressed = decompressFromEncodedURIComponent(input);
    if (compressed) {
      const parsed = JSON.parse(compressed) as unknown;
      return normalizePayload(parsed);
    }
    const parsed = decodeRaw(input);
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}

async function fetchPayloadById(id: string): Promise<NewPayload | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const response = await fetch(
      `${url}/rest/v1/shared_journal_links?select=payload&id=eq.${encodeURIComponent(
        id
      )}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        },
        next: { revalidate: 3600 }
      }
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ payload: unknown }>;
    if (!rows.length) return null;
    return normalizePayload(rows[0].payload);
  } catch {
    return null;
  }
}

export default async function JournalDailySharePage({
  searchParams
}: {
  searchParams?: { data?: string; s?: string; id?: string };
}) {
  const id = searchParams?.id ?? "";
  const raw = searchParams?.s ?? searchParams?.data ?? "";
  const payload = id ? await fetchPayloadById(id) : raw ? decodePayload(raw) : null;

  if (!payload) {
    return (
      <main className="min-h-screen bg-ink px-4 py-12 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">Shared journal unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            This journal summary link is invalid or expired.
          </p>
        </div>
      </main>
    );
  }

  return <JournalDailyClient payload={payload} />;
}
