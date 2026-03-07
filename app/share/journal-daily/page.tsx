import JournalDailyClient from "./JournalDailyClient";

type SharedTrade = {
  tradeId: string;
  instrument: string;
  strategy: string;
  direction: "Long" | "Short";
  entryPrice: number;
  exitPrice: number;
  pl: number;
  exitReason: string;
  chartUrl: string;
  remarks: string;
  quote: string;
};

type LegacyPayload = {
  date: string;
  quote: string;
  generatedAt: string;
  trades: SharedTrade[];
};

type NewPayload = {
  month: string;
  currency: "INR" | "USD";
  generatedAt: string;
  days: Array<{
    date: string;
    trades: SharedTrade[];
    summary: { totalTrades: number; totalPl: number; winRate: number };
  }>;
  monthlySummary: {
    totalTrades: number;
    totalPl: number;
    wins: number;
    losses: number;
    winRate: number;
    bestDay: { date: string; totalPl: number } | null;
    worstDay: { date: string; totalPl: number } | null;
  };
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
    return parsed as NewPayload;
  }

  if ("trades" in parsed && Array.isArray((parsed as LegacyPayload).trades)) {
    const legacy = parsed as LegacyPayload;
    const trades = legacy.trades.map((trade) => ({
      ...trade,
      quote: trade.quote ?? legacy.quote
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
          }
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
    const parsed = decodeRaw(input);
    return normalizePayload(parsed);
  } catch {
    return null;
  }
}

export default function JournalDailySharePage({
  searchParams
}: {
  searchParams?: { data?: string };
}) {
  const payload = searchParams?.data ? decodePayload(searchParams.data) : null;

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
