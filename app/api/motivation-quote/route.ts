import { NextResponse } from "next/server";

export const runtime = "edge";

const FALLBACK_QUOTES = [
  "Protect capital first. Big days come from consistency.",
  "Trade your plan, not your emotion.",
  "Small disciplined wins beat random big bets.",
  "Good risk management is the real edge.",
  "Focus on process. P&L is the byproduct."
];

function fallbackQuote() {
  const index = Math.floor(Math.random() * FALLBACK_QUOTES.length);
  return FALLBACK_QUOTES[index];
}

export async function GET() {
  const sources = [
    "https://zenquotes.io/api/random",
    "https://api.quotable.io/random?tags=motivational%7Cinspirational"
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) continue;
      const data = (await response.json()) as unknown;

      if (url.includes("zenquotes") && Array.isArray(data) && data.length > 0) {
        const row = data[0] as { q?: string; a?: string };
        if (row.q) {
          return NextResponse.json({ quote: row.q, author: row.a ?? "Unknown" });
        }
      }

      if (!url.includes("zenquotes") && data && typeof data === "object") {
        const row = data as { content?: string; author?: string };
        if (row.content) {
          return NextResponse.json({ quote: row.content, author: row.author ?? "Unknown" });
        }
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ quote: fallbackQuote(), author: "PulseJournal" });
}
