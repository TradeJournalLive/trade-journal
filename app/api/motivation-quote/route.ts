import { NextResponse } from "next/server";

export const runtime = "edge";

const FALLBACK_QUOTES = [
  "Hard work beats hype. Show up, execute, repeat.",
  "Discipline is hard work made visible.",
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
    return HARD_WORK_KEYWORDS.some((keyword) => normalized.includes(keyword));
  });
  return filtered.length > 0 ? filtered : FALLBACK_QUOTES;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const seed = searchParams.get("seed") ?? "";

  const quote = pickDeterministic(
    filterHardWorkQuotes(FALLBACK_QUOTES),
    date,
    seed
  );

  return NextResponse.json({ quote });
}
