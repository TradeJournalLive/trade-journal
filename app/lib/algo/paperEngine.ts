import type { AlgoSignal } from "./automation";

export const markets = ["BTC", "NIFTY", "GOLD"] as const;
export type PaperMarket = typeof markets[number];
export type PaperEvent = {
  receivedAt: string;
  signal: AlgoSignal;
  raw: { automation?: { mode?: string; enabled?: boolean; underlying?: string }; paperControl?: { market: PaperMarket; enabled: boolean; symbol?: string; slippage?: number; nextCandle?: boolean } };
};
export type IndexPosition = { id: string; symbol: string; side: "LONG" | "SHORT"; entry: number; referenceEntry: number; entrySlippage: number; openedAt: string; signalId: string };
export type IndexTrade = IndexPosition & { exit: number; referenceExit: number; closedAt: string; exitSignalId: string; points: number; grossPoints: number; slippagePoints: number; reason: string };
export type PaperBook = { market: PaperMarket; enabled: boolean; symbol: string | null; slippage: number; nextCandle: boolean; pending: { signalId: string; symbol: string; action: string; signalPrice: number; openTime: string; timeframe: string } | null; unresolvedPositions: IndexPosition[]; position: IndexPosition | null; trades: IndexTrade[]; lastPrice: number | null; lastSignalAt: string | null; ignored: number; pendingSessionClose: boolean };

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
  const books = Object.fromEntries(markets.map(market => [market, { market, enabled: false, symbol: null, slippage: 0, nextCandle: false, pending: null, unresolvedPositions: [], position: null, trades: [], lastPrice: null, lastSignalAt: null, ignored: 0, pendingSessionClose: false }])) as Record<PaperMarket, PaperBook>;
  const candles = events.filter(event => event.signal.metadata?.paperBarOpen === true && event.raw.automation?.mode === "PAPER" && !event.signal.metadata?.diagnostic);
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.signal.id.localeCompare(b.signal.id))) {
    const control = event.raw.paperControl;
    if (control && markets.includes(control.market)) {
      const book = books[control.market];
      book.enabled = control.enabled;
      if (typeof control.nextCandle === "boolean") book.nextCandle = control.nextCandle;
      if (!control.enabled) book.pending = null;
      if (control.symbol && control.symbol !== book.symbol) {
        if (book.position && book.position.symbol !== control.symbol) { book.unresolvedPositions.push(book.position); book.position = null; }
        book.symbol = control.symbol;
        book.pending = null;
        book.lastPrice = null;
        book.lastSignalAt = null;
      }
      if (typeof control.slippage === "number" && Number.isFinite(control.slippage) && control.slippage >= 0) book.slippage = control.slippage;
      continue;
    }
    const market = marketOf(event);
    if (event.signal.metadata?.paperBarOpen === true) continue;
    if (!market || event.signal.metadata?.diagnostic || event.signal.id.startsWith("panel-test-") || event.signal.metadata?.source === "Manual curl test") continue;
    if (event.raw.automation?.mode === "LIVE" || event.raw.automation?.enabled === false) continue;
    const dedupe = `${event.signal.strategyId}:${event.signal.id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    let price = event.signal.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const book = books[market];
    if (book.symbol && book.symbol !== event.signal.symbol) { book.ignored++; continue; }
    if (book.position && book.position.symbol !== event.signal.symbol) { book.ignored++; continue; }
    const action = event.signal.action;
    if (!["BUY", "SELL", "EXIT", "CLOSE_LONG", "CLOSE_SHORT"].includes(action)) continue;
    book.lastPrice = price;
    book.lastSignalAt = event.receivedAt;
    let fillTime = event.receivedAt;
    if (book.nextCandle) {
      const timeframe = event.signal.timeframe ?? "";
      const minutes = /^\d+$/.test(timeframe) ? Number(timeframe) : 0;
      const barTime = Date.parse(String(event.signal.metadata?.signalBarTime ?? ""));
      if (!minutes || !Number.isFinite(barTime)) { book.ignored++; continue; }
      const openTime = new Date(barTime + minutes * 60000).toISOString();
      const candle = candles.find(item => item.signal.symbol === event.signal.symbol && item.signal.timeframe === timeframe && Date.parse(item.signal.timestamp) === Date.parse(openTime) && typeof item.signal.price === "number" && Number.isFinite(item.signal.price) && item.signal.price > 0);
      if (!candle) {
        book.pending = { signalId: event.signal.id, symbol: event.signal.symbol, action, signalPrice: price, openTime, timeframe };
        continue;
      }
      price = candle.signal.price!;
      fillTime = openTime;
      book.pending = null;
    }
    const position = book.position;
    const time = ist(fillTime);
    const sessionEnd = market === "NIFTY" && time.minutes >= 915;
    const staleSession = market === "NIFTY" && position && ist(position.openedAt).day !== time.day;
    // Do not invent a 15:15 fill using a stale or next-day signal price.
    if (staleSession) { book.pendingSessionClose = true; book.ignored++; continue; }
    const explicitExit = action === "EXIT" || (action === "CLOSE_LONG" && position?.side === "LONG") || (action === "CLOSE_SHORT" && position?.side === "SHORT");
    const opposite = position && ((position.side === "LONG" && action === "SELL") || (position.side === "SHORT" && action === "BUY"));
    if (position && (explicitExit || opposite || sessionEnd)) {
      const direction = position.side === "LONG" ? 1 : -1;
      const exit = price - direction * book.slippage;
      book.trades.push({ ...position, exit, referenceExit: price, closedAt: fillTime, exitSignalId: event.signal.id,
        points: (exit - position.entry) * direction, grossPoints: (price - position.referenceEntry) * direction,
        slippagePoints: position.entrySlippage + book.slippage, reason: sessionEnd ? "Session close signal" : explicitExit ? "Exit signal" : "Opposite signal" });
      book.position = null;
    }
    if (!book.enabled || sessionEnd || (market === "NIFTY" && time.minutes < 555) || !["BUY", "SELL"].includes(action)) continue;
    if (book.position) { book.ignored++; continue; }
    book.position = { id: dedupe, symbol: event.signal.symbol, side: action === "BUY" ? "LONG" : "SHORT", entry: price + (action === "BUY" ? book.slippage : -book.slippage), referenceEntry: price, entrySlippage: book.slippage, openedAt: fillTime, signalId: event.signal.id };
  }
  const current = ist(now);
  const nifty = books.NIFTY;
  if (nifty.position && (ist(nifty.position.openedAt).day < current.day || current.minutes >= 915)) nifty.pendingSessionClose = true;
  return books;
}

// Marks never execute trades and must use the exact feed of the open position.
export function paperValuation(book: PaperBook, events: PaperEvent[], now = new Date().toISOString()) {
  const realized = book.trades.filter(trade => !book.symbol || trade.symbol === book.symbol).reduce((sum, trade) => sum + trade.points, 0);
  const position = book.position;
  if (!position) return { realized, unrealized: 0, total: realized, mark: null, stale: false };
  const candidates = events.filter(event => event.signal.symbol === position.symbol
    && event.raw.automation?.mode === "PAPER" && !event.signal.metadata?.diagnostic
    && !event.signal.id.startsWith("panel-test-") && event.signal.metadata?.source !== "Manual curl test"
    && typeof event.signal.price === "number" && Number.isFinite(event.signal.price) && event.signal.price > 0
    && Date.parse(event.signal.timestamp) >= Date.parse(position.openedAt)
    && Date.parse(event.signal.timestamp) <= Date.parse(now));
  candidates.sort((a, b) => Date.parse(b.signal.timestamp) - Date.parse(a.signal.timestamp));
  const latest = candidates[0];
  if (!latest) return { realized, unrealized: null, total: null, mark: null, stale: true };
  const mark = { price: latest.signal.price!, timestamp: latest.signal.timestamp, symbol: latest.signal.symbol, source: latest.signal.metadata?.paperBarOpen === true ? "Candle open" : "Signal" };
  const unrealized = (mark.price - position.entry) * (position.side === "LONG" ? 1 : -1);
  return { realized, unrealized, total: realized + unrealized, mark, stale: Date.parse(now) - Date.parse(mark.timestamp) > 90000 };
}
