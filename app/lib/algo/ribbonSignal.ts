import { ribbonRules } from "./ribbonPaper";
import { niftySignalCandle } from "./niftySignal";
export function isolateRibbonSignal<T extends { strategyId?: string; symbol?: string; timeframe?: string; action?: string; metadata?: Record<string, unknown>; automation?: Record<string, unknown> }>(payload: T): T {
  if (payload.strategyId !== ribbonRules.strategyId) {
    if (payload.metadata?.ribbonPaper) throw new Error("Ribbon metadata requires its dedicated strategy ID.");
    return payload;
  }
  const candle = niftySignalCandle(payload.metadata?.ribbonPaper, payload.timeframe);
  if (payload.symbol !== "NSE:NIFTY" || payload.timeframe !== "3" || !["BUY", "SELL"].includes(payload.action || "") || !candle) throw new Error("Invalid HAMS 3-minute signal.");
  const { niftyPaper, btcPaper, hamsFinalPaper, paperBarOpen, ...metadata } = payload.metadata ?? {};
  return { ...payload, metadata: { ...metadata, ribbonPaper: candle, isolatedPaperStrategy: true }, automation: { enabled: false, mode: "PAPER", underlying: "NIFTY" } };
}
