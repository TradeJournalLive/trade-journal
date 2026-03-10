import { NextResponse } from "next/server";

export const runtime = "edge";

const FALLBACK_QUOTES = [
  "Protect capital first. Big days come from consistency.",
  "Trade your plan, not your emotion.",
  "Small disciplined wins beat random big bets.",
  "Good risk management is the real edge.",
  "Focus on process. P&L is the byproduct.",
  "Patience compounds faster than aggression.",
  "Clarity before entry, discipline after entry.",
  "Your edge is execution quality, not prediction."
];

function hashSeed(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pickDeterministic(quotes: string[], date: string, seed: string) {
  const key = `${date || "today"}|${seed || "default"}`;
  const index = hashSeed(key) % Math.max(quotes.length, 1);
  return quotes[index] || FALLBACK_QUOTES[0];
}

async function fetchWebQuotes() {
  const sources = [
    "https://zenquotes.io/api/quotes",
    "https://zenquotes.io/api/today"
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) continue;
      const data = (await response.json()) as unknown;
      if (!Array.isArray(data)) continue;

      const quotes = data
        .map((item) => {
          const row = item as { q?: string };
          return (row.q ?? "").trim();
        })
        .filter((quote) => quote.length > 0);

      if (quotes.length > 0) {
        return quotes;
      }
    } catch {
      continue;
    }
  }

  return FALLBACK_QUOTES;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const seed = searchParams.get("seed") ?? "";

  const quotes = await fetchWebQuotes();
  const quote = pickDeterministic(quotes, date, seed);

  return NextResponse.json({ quote });
}
