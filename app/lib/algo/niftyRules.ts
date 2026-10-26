export const niftyRules = {
  id: "nifty_signal_breakout_options_v1",
  mode: "PAPER",
  selection: "1 OTM",
  expiry: "NEAREST",
  validCandles: 10,
  maxSignalRange: 35,
  lastSignalMinutesIST: 14 * 60 + 55,
  cutoffMinutesIST: 14 * 60 + 55,
  startingLots: 1,
  maxLots: null,
  sizeReset: false,
  targetR: 10,
  maxEntrySlippage: 4,
  entryDepthWaitMs: 1500,
} as const;

export function niftyTargets(entry: number, lots: number, lotSize: number) {
  return [{ price: entry + niftyRules.targetR * premiumStopDistance(entry), quantity: lots * lotSize, filled: false }];
}

export type NiftyDepthLevel = { price: number; quantity: number };
export function niftyEntryFill(ask: number, quantity: number, levels: NiftyDepthLevel[], initialAsk = ask) {
  if (!Number.isFinite(ask) || ask <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !levels.length) return null;
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  if (sorted[0].price !== ask || sorted.some((l, i) => !Number.isFinite(l.price) || l.price <= 0 || !Number.isSafeInteger(l.quantity) || l.quantity <= 0 || (i > 0 && l.price === sorted[i - 1].price))) return null;
  let remaining = quantity, cost = 0;
  const fills: NiftyDepthLevel[] = [];
  for (const level of sorted) {
    if (level.price > initialAsk + niftyRules.maxEntrySlippage + 1e-9) break;
    const taken = Math.min(remaining, level.quantity);
    fills.push({ price: level.price, quantity: taken }); cost += taken * level.price; remaining -= taken;
    if (!remaining) return { price: cost / quantity, initialAsk, slippage: cost / quantity - initialAsk, fills };
  }
  return null;
}

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
  previous15m: { high: number; low: number }; oppositeSignal: boolean; minutesIST: number; premiumTargets?: boolean;
}) {
  if (input.minutesIST >= niftyRules.cutoffMinutesIST) return "TIME_EXIT";
  if (input.oppositeSignal) return "OPPOSITE_SIGNAL";
  if (input.premium > 0 && input.premium <= input.entryPremium - premiumStopDistance(input.entryPremium)) return "PREMIUM_SL";
  if (input.premium >= input.entryPremium + niftyRules.targetR * premiumStopDistance(input.entryPremium)) return "TARGET_10R";
  return null;
}
