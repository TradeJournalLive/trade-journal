import type { BtcPosition, BtcTrade } from "./btcPaperEngine";

export function isPointOneBtc(position: BtcPosition) {
  const filled = position.entryQuantityBtc ?? position.quantityBtc;
  const requested = filled + (position.canceledEntryBtc ?? 0);
  return Number.isFinite(requested) && Math.abs(requested - 0.1) < 1e-9;
}

// Recompute from the complete ledger, never the compacted all-size lifetime base.
export function pointOneBtcPerformance(book: { trades: BtcTrade[]; position: BtcPosition | null; unrealized: number | null }) {
  const trades = book.trades.filter(isPointOneBtc);
  const verified = trades.filter(trade => !trade.monitoringGap);
  const eligiblePosition = Boolean(book.position && isPointOneBtc(book.position));
  const verifiedPosition = eligiblePosition && !book.position!.monitoringGap;
  return { trades, realized: verified.reduce((sum, trade) => sum + trade.pnl, 0) + (verifiedPosition ? book.position!.realizedPnl ?? 0 : 0),
    tradeCount: verified.length, unrealized: verifiedPosition ? book.unrealized : book.position ? null : 0 };
}
