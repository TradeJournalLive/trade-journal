import type { AlgoSignal } from "./automation";

export const markets = ["BTC", "NIFTY", "GOLD"] as const;
export type PaperMarket = typeof markets[number];
export type PaperEvent = {
  receivedAt: string;
  signal: AlgoSignal;
  raw: { automation?: { mode?: string; enabled?: boolean; underlying?: string }; paperControl?: { market: PaperMarket; enabled: boolean } };
};
export type IndexPosition = { id: string; symbol: string; side: "LONG" | "SHORT"; entry: number; openedAt: string; signalId: string };
export type IndexTrade = IndexPosition & { exit: number; closedAt: string; exitSignalId: string; points: number; reason: string };
export type PaperBook = { market: PaperMarket; enabled: boolean; position: IndexPosition | null; trades: IndexTrade[]; lastPrice: number | null; lastSignalAt: string | null; ignored: number; pendingSessionClose: boolean };

function marketOf(event: PaperEvent): PaperMarket | null {
  const symbol = event.signal.symbol.toUpperCase();
  const underlying = event.raw.automation?.underlying?.toUpperCase();
  if (symbol.includes("BTC") || symbol.includes("BITCOIN")) return "BTC";
  if (symbol.includes("GOLD") || symbol.includes("XAU")) return "GOLD";
  if (symbol.includes("NIFTY") && !/BANK|FIN|MID/.test(symbol)) return "NIFTY";
  return markets.includes(underlying as PaperMarket) ? underlying as PaperMarket : null;
}
function ist(iso: string) {
  const date = new Date(Date.parse(iso) + 330 * 60000);
  return { day: date.toISOString().slice(0, 10), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

// Rebuild from durable signal/control events: refreshes and duplicate deliveries cannot execute twice.
export function buildPaperBooks(events: PaperEvent[], now = new Date().toISOString()) {
  const books = Object.fromEntries(markets.map(market => [market, { market, enabled: false, position: null, trades: [], lastPrice: null, lastSignalAt: null, ignored: 0, pendingSessionClose: false }])) as Record<PaperMarket, PaperBook>;
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.signal.id.localeCompare(b.signal.id))) {
    const control = event.raw.paperControl;
    if (control && markets.includes(control.market)) { books[control.market].enabled = control.enabled; continue; }
    const market = marketOf(event);
    if (!market || event.signal.metadata?.diagnostic || event.signal.id.startsWith("panel-test-") || event.signal.metadata?.source === "Manual curl test") continue;
    if (event.raw.automation?.mode === "LIVE" || event.raw.automation?.enabled === false) continue;
    const dedupe = `${event.signal.strategyId}:${event.signal.id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const price = event.signal.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const book = books[market];
    if (book.position && book.position.symbol !== event.signal.symbol) { book.ignored++; continue; }
    const action = event.signal.action;
    if (!["BUY", "SELL", "EXIT", "CLOSE_LONG", "CLOSE_SHORT"].includes(action)) continue;
    book.lastPrice = price;
    book.lastSignalAt = event.receivedAt;
    const position = book.position;
    const time = ist(event.receivedAt);
    const sessionEnd = market === "NIFTY" && time.minutes >= 915;
    const staleSession = market === "NIFTY" && position && ist(position.openedAt).day !== time.day;
    // Do not invent a 15:15 fill using a stale or next-day signal price.
    if (staleSession) { book.pendingSessionClose = true; book.ignored++; continue; }
    const explicitExit = action === "EXIT" || (action === "CLOSE_LONG" && position?.side === "LONG") || (action === "CLOSE_SHORT" && position?.side === "SHORT");
    const opposite = position && ((position.side === "LONG" && action === "SELL") || (position.side === "SHORT" && action === "BUY"));
    if (position && (explicitExit || opposite || sessionEnd)) {
      book.trades.push({ ...position, exit: price, closedAt: event.receivedAt, exitSignalId: event.signal.id,
        points: (price - position.entry) * (position.side === "LONG" ? 1 : -1), reason: sessionEnd ? "Session close signal" : explicitExit ? "Exit signal" : "Opposite signal" });
      book.position = null;
    }
    if (!book.enabled || sessionEnd || (market === "NIFTY" && time.minutes < 555) || !["BUY", "SELL"].includes(action)) continue;
    if (book.position) { book.ignored++; continue; }
    book.position = { id: dedupe, symbol: event.signal.symbol, side: action === "BUY" ? "LONG" : "SHORT", entry: price, openedAt: event.receivedAt, signalId: event.signal.id };
  }
  const current = ist(now);
  const nifty = books.NIFTY;
  if (nifty.position && (ist(nifty.position.openedAt).day < current.day || current.minutes >= 915)) nifty.pendingSessionClose = true;
  return books;
}
