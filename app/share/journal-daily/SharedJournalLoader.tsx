"use client";

import { useEffect, useState } from "react";
import { decompressFromEncodedURIComponent } from "lz-string";
import JournalDailyClient from "./JournalDailyClient";
import type { SharedPayload, SharedTrade } from "./types";

type LegacyPayload = {
  date: string;
  quote: string;
  generatedAt: string;
  trades: SharedTrade[];
};

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
  const json = atob(padded);
  return JSON.parse(json) as unknown;
}

function normalizePayload(parsed: unknown): SharedPayload | null {
  if (!parsed || typeof parsed !== "object") return null;

  if ("days" in parsed && Array.isArray((parsed as SharedPayload).days)) {
    const next = parsed as SharedPayload;
    return {
      ...next,
      days: next.days.map((day) => ({
        ...day,
        motivationQuote:
          day.motivationQuote ||
          "Protect capital first. Big days come from consistency.",
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
          motivationQuote:
            "Protect capital first. Big days come from consistency.",
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

function decodePayload(input: string): SharedPayload | null {
  try {
    const compressed = decompressFromEncodedURIComponent(input);
    if (compressed) {
      return normalizePayload(JSON.parse(compressed) as unknown);
    }
    return normalizePayload(decodeRaw(input));
  } catch {
    return null;
  }
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-ink px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-panel/60 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-56 rounded bg-white/10" />
          <div className="h-16 rounded bg-white/10" />
          <div className="h-64 rounded bg-white/10" />
        </div>
      </div>
    </main>
  );
}

function ErrorState() {
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

export default function SharedJournalLoader({
  id,
  raw
}: {
  id?: string;
  raw?: string;
}) {
  const [payload, setPayload] = useState<SharedPayload | null>(
    raw ? decodePayload(raw) : null
  );
  const [loading, setLoading] = useState(Boolean(id) && !raw);

  useEffect(() => {
    if (!id || raw) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/share-journal?id=${encodeURIComponent(id)}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          if (!cancelled) setPayload(null);
          return;
        }
        const json = (await response.json()) as { payload?: unknown };
        if (!cancelled) {
          setPayload(normalizePayload(json.payload));
        }
      } catch {
        if (!cancelled) setPayload(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, raw]);

  if (loading) return <LoadingState />;
  if (!payload) return <ErrorState />;
  return <JournalDailyClient payload={payload} />;
}
