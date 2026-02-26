import { NextResponse } from "next/server";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  impact: "High" | "Medium";
};

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function getTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities((match?.[1] ?? "").trim());
}

function toImpact(title: string): "High" | "Medium" {
  const text = title.toLowerCase();
  const highKeywords = [
    "rbi",
    "fed",
    "inflation",
    "budget",
    "rate cut",
    "rate hike",
    "geopolitical",
    "war",
    "crude",
    "gdp",
    "nifty",
    "sensex",
    "bank nifty"
  ];
  return highKeywords.some((word) => text.includes(word)) ? "High" : "Medium";
}

export async function GET() {
  try {
    const rssUrl =
      "https://news.google.com/rss/search?q=Indian+stock+market+OR+Nifty+OR+Sensex+OR+RBI+OR+FII+OR+DII+when:2d&hl=en-IN&gl=IN&ceid=IN:en";
    const response = await fetch(rssUrl, {
      next: { revalidate: 900 },
      headers: { "user-agent": "TradeJournal/1.0" }
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "News feed unavailable right now." },
        { status: 503 }
      );
    }
    const xml = await response.text();
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

    const items: NewsItem[] = itemBlocks.slice(0, 12).map((block) => {
      const title = getTag(block, "title");
      const link = getTag(block, "link");
      const source = getTag(block, "source") || "Market Desk";
      const publishedAt = getTag(block, "pubDate");
      return {
        title,
        link,
        source,
        publishedAt,
        impact: toImpact(title)
      };
    });

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json(
      { error: "Could not fetch market news." },
      { status: 500 }
    );
  }
}
