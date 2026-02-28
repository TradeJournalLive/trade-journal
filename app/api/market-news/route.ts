import { NextResponse } from "next/server";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  image: string;
  impact: "High" | "Medium";
};

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function sanitizeText(value: string) {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return sanitizeText((match?.[1] ?? "").trim());
}

function getAttr(block: string, tag: string, attr: string) {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`, "i");
  const match = block.match(regex);
  return sanitizeText((match?.[1] ?? "").trim());
}

function getDescriptionImage(block: string) {
  const raw = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
  const desc = decodeEntities((raw?.[1] ?? "").trim());
  const img = desc.match(/<img[^>]*src=["']([^"']+)["']/i);
  return sanitizeText((img?.[1] ?? "").trim());
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
      20,
      Math.max(5, Number(searchParams.get("pageSize") ?? "8"))
    );

    const feeds = [
      "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
      "https://www.moneycontrol.com/rss/marketreports.xml",
      "https://www.business-standard.com/rss/markets-106.rss",
      "https://www.livemint.com/rss/markets",
      "https://news.google.com/rss/search?q=Indian+stock+market+OR+Nifty+OR+Sensex+OR+RBI+OR+FII+OR+DII+when:2d&hl=en-IN&gl=IN&ceid=IN:en"
    ];

    const fetched = await Promise.all(
      feeds.map(async (rssUrl) => {
        try {
          const response = await fetch(rssUrl, {
            next: { revalidate: 3600 },
            headers: { "user-agent": "TradeJournal/1.0" }
          });
          if (!response.ok) return [] as NewsItem[];
          const xml = await response.text();
          const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
          return itemBlocks.map((block) => {
            const title = getTag(block, "title");
            const link = getTag(block, "link");
            const source = getTag(block, "source") || rssUrl.replace(/^https?:\/\//, "").split("/")[0];
            const publishedAt = getTag(block, "pubDate");
            const image =
              getAttr(block, "media:content", "url") ||
              getAttr(block, "media:thumbnail", "url") ||
              getAttr(block, "enclosure", "url") ||
              getDescriptionImage(block);
            return {
              title,
              link,
              source,
              publishedAt,
              image,
              impact: toImpact(title)
            };
          });
        } catch {
          return [] as NewsItem[];
        }
      })
    );

    const merged = fetched.flat().filter((item) => item.title && item.link);
    const deduped: NewsItem[] = [];
    const seen = new Set<string>();
    for (const item of merged) {
      const key = `${item.title}::${item.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    const sorted = deduped.sort((a, b) => {
      const left = Date.parse(a.publishedAt || "");
      const right = Date.parse(b.publishedAt || "");
      return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
    });
    const start = (page - 1) * pageSize;
    const paged = sorted.slice(start, start + pageSize);
    const hasMore = start + pageSize < sorted.length;

    return NextResponse.json({ items: paged, page, pageSize, hasMore });
  } catch {
    return NextResponse.json(
      { error: "Could not fetch market news." },
      { status: 500 }
    );
  }
}
