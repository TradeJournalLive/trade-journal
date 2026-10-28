import { hamsFinalRules } from "./hamsFinalPaper";
import { niftySignalCandle } from "./niftySignal";
export function isolateHamsSignal<T extends { strategyId?: string; symbol?: string; timeframe?: string; action?: string; metadata?: Record<string, unknown>; automation?: Record<string, unknown> }>(payload: T): T {
  if (payload.strategyId !== hamsFinalRules.strategyId) {
    if (payload.metadata?.hamsFinalPaper) throw new Error("HAMS metadata requires its dedicated strategy ID.");
    return payload;
  }
  const candle = niftySignalCandle(payload.metadata?.hamsFinalPaper, payload.timeframe);
  if (payload.symbol !== "NSE:NIFTY" || payload.timeframe !== "3" || !["BUY", "SELL"].includes(payload.action || "") || !candle) throw new Error("Invalid HAMS 3-minute signal.");
  const { niftyPaper, btcPaper, paperBarOpen, ...metadata } = payload.metadata ?? {};
  return { ...payload, metadata: { ...metadata, hamsFinalPaper: candle, isolatedPaperStrategy: true }, automation: { enabled: false, mode: "PAPER", underlying: "NIFTY" } };
}
