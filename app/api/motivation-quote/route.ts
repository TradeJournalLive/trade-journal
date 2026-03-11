import { NextResponse } from "next/server";

export const runtime = "edge";

const FALLBACK_QUOTES = [
  "Hard work beats hype. Show up, execute, repeat.",
  "Stay consistent when nobody is watching.",
  "Put in the work every day; confidence follows preparation.",
  "Success in trading is earned through routine, not luck.",
  "Outwork your excuses. Respect your process.",
  "Consistent hard work compounds faster than random big wins.",
  "The market rewards preparation, patience, and effort.",
  "Work hard on risk first; profits will follow."
];

const HARD_WORK_KEYWORDS = [
  "hard work",
  "work hard",
  "discipline",
  "effort",
  "consisten",
  "grind",
  "focus",
  "process",
  "patience"
];

const BLOCKED_QUOTES = new Set([
  "Discipline is hard work made visible."
]);

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

function filterHardWorkQuotes(quotes: string[]) {
  const filtered = quotes.filter((quote) => {
    const normalized = quote.toLowerCase();
    return (
      !BLOCKED_QUOTES.has(quote.trim()) &&
      HARD_WORK_KEYWORDS.some((keyword) => normalized.includes(keyword))
    );
  });
  return filtered.length > 0 ? filtered : FALLBACK_QUOTES;
}

async function fetchWebQuotes() {
  const collected: string[] = [];
  const sources = [
    "https://zenquotes.io/api/quotes",
    "https://zenquotes.io/api/today",
    "https://api.quotable.io/quotes?limit=50"
  ];

  for (const url of sources) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) continue;
      const data = (await response.json()) as unknown;

      if (Array.isArray(data)) {
        data.forEach((row) => {
          const item = row as { q?: string; content?: string };
          const text = (item.q ?? item.content ?? "").trim();
          if (text) collected.push(text);
        });
      } else if (data && typeof data === "object") {
        const payload = data as { results?: Array<{ content?: string }> };
        payload.results?.forEach((row) => {
          const text = (row.content ?? "").trim();
          if (text) collected.push(text);
        });
      }
    } catch {
      continue;
    }
  }

  const unique = Array.from(new Set(collected));
  const filtered = filterHardWorkQuotes(unique);
  return filtered.sort((a, b) => a.localeCompare(b));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const seed = searchParams.get("seed") ?? "";

  const webQuotes = await fetchWebQuotes();
  const quote = pickDeterministic(webQuotes.length ? webQuotes : FALLBACK_QUOTES, date, seed);

  return NextResponse.json({ quote });
}
