import type { StoredAlgoEvent } from "./automation";
import type { loadPaperBooks } from "./paperHistory";
import { istDay, istTime, signalTime } from "./reportDates";

type Books = Awaited<ReturnType<typeof loadPaperBooks>>;
export type ReportTrade = {
  id: string; market: string; engine: string; symbol: string; side: string; status: "OPEN" | "CLOSED";
  signalId: string; signalAt?: string; receivedAt?: string; openedAt: string; closedAt?: string;
  entry: number; exit?: number; quantity?: number; lots?: number; capital?: number; currency: string;
  pnl?: number; recordedPnl?: number; points?: number; stop?: number; target?: number; reason?: string; quality: string;
};
export const tradeColumns = ["Entry date", "Engine", "Instrument", "Side", "Status", "Signal date", "Signal time (IST)", "Received date", "Received time (IST)", "Entry time (IST)", "Entry price", "Exit date", "Exit time (IST)", "Exit price", "Quantity", "Lots", "Capital used", "Currency", "Gross P&L", "Recorded gross P&L", "Points", "Recorded SL", "Recorded target", "Exit reason", "Quality", "Signal ID", "Trade ID"];
function signalFor(events: StoredAlgoEvent[], id: string, symbol: string, openedAt: string) {
  const matching = events.filter(event => event.signal.id === id && event.signal.symbol === symbol && Date.parse(event.receivedAt) <= Date.parse(openedAt));
  return matching.length === 1 ? matching[0] : undefined;
}
export function buildTradeReports(books: Books, events: StoredAlgoEvent[]) {
  const records: ReportTrade[] = [];
  for (const [market, book] of Object.entries(books)) {
    const options = book.options;
    if (market === "NIFTY" && options) {
      const positions: (NonNullable<typeof options.position> & Partial<typeof options.trades[number]>)[] = [...options.trades, ...(options.position ? [options.position] : [])];
      for (const trade of positions) {
        const closed = Boolean(trade.closedAt), signal = signalFor(events, trade.signalId, trade.indexSymbol, trade.openedAt);
        records.push({ id: `nifty:${trade.signalId}:${trade.openedAt}`, market, engine: "Options breakout", symbol: trade.contract.id, side: trade.contract.side, status: closed ? "CLOSED" : "OPEN", signalId: trade.signalId, signalAt: signal ? signalTime(signal) : undefined, receivedAt: signal?.receivedAt, openedAt: trade.openedAt, entry: trade.entry, quantity: trade.quantity, lots: trade.lots, capital: trade.entry * trade.quantity, currency: "INR", quality: "Recorded", ...(closed ? { closedAt: trade.closedAt, exit: trade.exit, pnl: trade.pnl, recordedPnl: trade.pnl, reason: trade.reason } : {}) });
      }
    }
    const btc = book.delta;
    if (market === "BTC" && btc) {
      const positions: (NonNullable<typeof btc.position> & Partial<typeof btc.trades[number]>)[] = [...btc.trades, ...(btc.position ? [btc.position] : [])];
      for (const trade of positions) {
        const closed = Boolean(trade.closedAt);
        records.push({ id: `btc:${trade.id}:${trade.openedAt}`, market, engine: "Delta breakout", symbol: "DELTAIN:BTCUSD.P", side: trade.side, status: closed ? "CLOSED" : "OPEN", signalId: trade.id, signalAt: trade.signalClosedAt, receivedAt: trade.signalReceivedAt, openedAt: trade.openedAt, entry: trade.entry, quantity: trade.quantityBtc, capital: trade.initialMargin, currency: "USD", stop: trade.stop, target: trade.target, quality: trade.monitoringGap ? "Monitoring interrupted - unverified" : "Recorded", ...(closed ? { closedAt: trade.closedAt, exit: trade.exit, pnl: trade.monitoringGap ? undefined : trade.pnl, recordedPnl: trade.pnl, reason: trade.reason } : {}) });
      }
    }
    const legacy: (NonNullable<typeof book.position> & Partial<typeof book.trades[number]>)[] = [...book.trades, ...(book.position ? [book.position] : [])];
    for (const trade of legacy) {
      const closed = Boolean(trade.closedAt), signal = signalFor(events, trade.signalId, trade.symbol, trade.openedAt);
      records.push({ id: `legacy:${market}:${trade.id}`, market, engine: "Legacy signal-price test", symbol: trade.symbol, side: trade.side, status: closed ? "CLOSED" : "OPEN", signalId: trade.signalId, signalAt: signal ? signalTime(signal) : undefined, receivedAt: signal?.receivedAt, openedAt: trade.openedAt, entry: trade.entry, currency: "POINTS", quality: "Price-only test", ...(closed ? { closedAt: trade.closedAt, exit: trade.exit, points: trade.points, reason: trade.reason } : {}) });
    }
  }
  const unique = new Map<string, ReportTrade>();
  // A ledger close can arrive before its worker heartbeat; the close wins that race.
  for (const record of records) if (!unique.has(record.id) || record.status === "CLOSED") unique.set(record.id, record);
  return [...unique.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));
}
export function tradeRows(trades: ReportTrade[]) {
  return trades.map(t => [istDay(t.openedAt), t.engine, t.symbol, t.side, t.status, istDay(t.signalAt), istTime(t.signalAt), istDay(t.receivedAt), istTime(t.receivedAt), istTime(t.openedAt), t.entry, istDay(t.closedAt), istTime(t.closedAt), t.exit ?? "", t.quantity ?? "", t.lots ?? "", t.capital ?? "", t.currency, t.pnl ?? "", t.recordedPnl ?? "", t.points ?? "", t.stop ?? "", t.target ?? "", t.reason ?? "", t.quality, t.signalId, t.id]);
}
