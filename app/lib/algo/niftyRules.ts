export const niftyRules = {
  id: "nifty_signal_breakout_options_v1",
  mode: "PAPER",
  selection: "1 OTM",
  expiry: "NEAREST",
  validCandles: 10,
  maxSignalRange: 35,
  cutoffMinutesIST: 14 * 60 + 55,
  startingLots: 1,
  maxLots: null,
  sizeReset: false,
  targetR: 1.5,
} as const;

export type NiftySetup = { action: "BUY" | "SELL"; high: number; low: number };
export type SizeState = { lots: number; consecutiveLosses: number };

export function premiumStopDistance(entry: number) {
  if (!Number.isFinite(entry) || entry <= 0) throw new Error("A positive option premium is required.");
  return Math.min(20, entry * 0.2);
}

export function nextNiftySize(state: SizeState, result: { points: number; stopLoss: boolean }): SizeState {
  if (!Number.isSafeInteger(state.lots) || state.lots < 1 || !Number.isFinite(result.points)) throw new Error("Invalid sizing input.");
  if (result.stopLoss) return { lots: state.lots + 1, consecutiveLosses: 0 };
  const losses = result.points < 0 ? state.consecutiveLosses + 1 : 0;
  return losses >= 2 ? { lots: state.lots + 1, consecutiveLosses: 0 } : { lots: state.lots, consecutiveLosses: losses };
}

// Requires consecutive same-feed index ticks, never option prices or candle closes.
export function niftyBreakout(setup: NiftySetup, previous: number, current: number, candlesAfterSignal: number, minutesIST: number) {
  if (![setup.high, setup.low, previous, current, candlesAfterSignal, minutesIST].every(Number.isFinite)
    || setup.low <= 0 || setup.high < setup.low || previous <= 0 || current <= 0
    || setup.high - setup.low > niftyRules.maxSignalRange
    || !Number.isInteger(candlesAfterSignal) || candlesAfterSignal < 1 || candlesAfterSignal > niftyRules.validCandles
    || minutesIST < 555 || minutesIST >= niftyRules.cutoffMinutesIST) return null;
  if (setup.action === "BUY" && previous <= setup.high && current > setup.high) return "CE";
  if (setup.action === "SELL" && previous >= setup.low && current < setup.low) return "PE";
  return null;
}

export function niftyExit(input: {
  side: "CE" | "PE"; entryPremium: number; premium: number; index: number;
  previous15m: { high: number; low: number }; oppositeSignal: boolean; minutesIST: number;
}) {
  if (input.minutesIST >= niftyRules.cutoffMinutesIST) return "TIME_EXIT";
  if (input.oppositeSignal) return "OPPOSITE_SIGNAL";
  if (input.premium > 0 && input.premium <= input.entryPremium - premiumStopDistance(input.entryPremium)) return "PREMIUM_SL";
  if (input.premium >= input.entryPremium + niftyRules.targetR * premiumStopDistance(input.entryPremium)) return "TARGET_1_5R";
  if (input.side === "CE" && input.index < input.previous15m.low) return "INDEX_15M_TRAIL";
  if (input.side === "PE" && input.index > input.previous15m.high) return "INDEX_15M_TRAIL";
  return null;
}
