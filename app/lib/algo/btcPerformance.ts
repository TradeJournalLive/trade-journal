import type { BtcPosition, BtcTrade } from "./btcPaperEngine";

export function isPointOneBtc(position: BtcPosition) {
  const filled = position.entryQuantityBtc ?? position.quantityBtc;
  const requested = filled + (position.canceledEntryBtc ?? 0);
  return Number.isFinite(requested) && Math.abs(requested - 0.1) < 1e-9;
}

export function inBtcPerformanceScope(position: BtcPosition) {
  const requested = position.requestedQuantityBtc;
  return isPointOneBtc(position) || (position.sizingPolicy === "SL_STEP_0_1_CAP_0_8_V1" && typeof requested === "number"
    && Number.isFinite(requested) && requested >= 0.1 && requested <= 0.8 && Math.abs(requested * 10 - Math.round(requested * 10)) < 1e-9);
}

export function btcDateRange<T extends { openedAt: string }>(trades: T[], from: string, to: string) {
  if (from && to && from > to) return [];
  return trades.filter(trade => {
    const at = Date.parse(trade.openedAt);
    if (!Number.isFinite(at)) return false;
    const date = new Date(at + 19800000).toISOString().slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  });
}

// Recompute from the complete ledger, never the compacted all-size lifetime base.
export function btcProgressionPerformance(book: { trades: BtcTrade[]; position: BtcPosition | null; unrealized: number | null }) {
  const trades = book.trades.filter(inBtcPerformanceScope);
  const verified = trades.filter(trade => !trade.monitoringGap);
  const eligiblePosition = Boolean(book.position && inBtcPerformanceScope(book.position));
  const verifiedPosition = eligiblePosition && !book.position!.monitoringGap;
  return { trades, realized: verified.reduce((sum, trade) => sum + trade.pnl, 0) + (verifiedPosition ? book.position!.realizedPnl ?? 0 : 0),
    tradeCount: verified.length, unrealized: verifiedPosition ? book.unrealized : book.position ? null : 0 };
}
