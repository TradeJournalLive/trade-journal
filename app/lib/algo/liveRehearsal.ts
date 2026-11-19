import { niftyLotsForLoss } from "./niftyLossCycle";

export const liveRehearsalMode = "REHEARSAL_ONLY" as const;
export const liveOrdersEnabled = false as const;
export type LiveTestStrategy = "current" | "hams";
export type RehearsalDraft = {
  symbol: string; recoveryLoss: number; limit: number; stop: number; target: number;
  maxLots: number; maxCapital: number; dailyLossLimit: number; dayNet: number;
  estimatedCharges: number; maxSpread: number; maxSlippage: number;
};
export type RehearsalMarket = {
  symbol: string; lotSize: number | null; bid: number | null; ask: number | null;
  timestamp: string | number | null; status: string;
};
export type RehearsalCheck = { code: string; label: string; ok: boolean; detail: string };
const money = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1_000_000_000;
export function marketTimestamp(value: RehearsalMarket["timestamp"]): number {
  if (value === null || value === "") return NaN;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  // A time without a date cannot establish quote freshness across trading days.
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}

export function buildRehearsalPlan(draft: RehearsalDraft, market: RehearsalMarket | null, now: number) {
  const checks: RehearsalCheck[] = [];
  const check = (code: string, label: string, ok: boolean, detail: string) => checks.push({ code, label, ok, detail });
  const validInputs = Object.entries(draft).every(([key, n]) => key === "symbol" || typeof n === "number" && finite(n));
  const validLoss = finite(draft.recoveryLoss) && draft.recoveryLoss >= 0;
  const lots = validLoss ? niftyLotsForLoss(draft.recoveryLoss) : null;
  const size = market?.lotSize;
  const validSize = Number.isSafeInteger(size) && Number(size) > 0 && Number(size) <= 100000;
  const quantity = lots !== null && validSize ? lots * Number(size) : null;
  const validPrices = [draft.limit, draft.stop, draft.target].every(n => finite(n) && n > 0) && draft.stop < draft.limit && draft.target > draft.limit;
  const validCharges = finite(draft.estimatedCharges) && draft.estimatedCharges > 0;
  const capital = quantity !== null && validPrices && validCharges ? money(draft.limit * quantity + draft.estimatedCharges) : null;
  const plannedLoss = quantity !== null && validPrices && validCharges ? money((draft.limit - draft.stop) * quantity + draft.estimatedCharges) : null;
  const plannedProfit = quantity !== null && validPrices && validCharges ? money((draft.target - draft.limit) * quantity - draft.estimatedCharges) : null;
  const quoteAt = marketTimestamp(market?.timestamp ?? null), age = now - quoteAt;
  const dateOnly = Number.isFinite(quoteAt) && quoteAt % 86400000 === 0;
  const validBook = market?.status === "ok" && finite(market.bid ?? NaN) && finite(market.ask ?? NaN) && Number(market.bid) > 0 && Number(market.ask) >= Number(market.bid);
  const remainingLossBudget = finite(draft.dailyLossLimit) && finite(draft.dayNet) ? money(Math.max(0, draft.dailyLossLimit + Math.min(0, draft.dayNet))) : null;
  check("INPUTS", "Numeric values", validInputs, validInputs ? "Values are finite and within rehearsal bounds." : "Enter valid numbers in every numeric field.");
  check("CONTRACT", "NIFTY option contract", /^NSE:NIFTY[A-Z0-9]+(?:CE|PE)$/.test(draft.symbol), "NSE NIFTY CE or PE contract required.");
  check("MARKET_MATCH", "Market snapshot", market?.symbol === draft.symbol, "The snapshot must match this exact contract.");
  check("LOT_SIZE", "Exchange lot size", validSize, validSize ? `${size} units per lot from the contract master.` : "Load a verified contract size; no fallback lot size is used.");
  check("FRESH_QUOTE", "Quote freshness", !dateOnly && Number.isFinite(age) && age >= 0 && age <= 5000, dateOnly ? "FYERS returned a midnight timestamp. Tick freshness is unverified; timestamped streaming data is required." : Number.isFinite(age) ? `Snapshot age ${Math.max(0, Math.round(age / 1000))}s; maximum 5s, future quotes rejected.` : "A dated market timestamp is required.");
  check("BOOK", "Bid and ask", Boolean(validBook), "Both prices must be positive and the book cannot be crossed.");
  check("SPREAD", "Spread limit", Boolean(validBook) && finite(draft.maxSpread) && draft.maxSpread >= 0 && Number(market?.ask) - Number(market?.bid) <= draft.maxSpread + 1e-8, "Ask minus bid must stay within the draft spread limit.");
  check("LIMIT_PRICE", "Limit slippage", Boolean(validBook) && finite(draft.maxSlippage) && draft.maxSlippage >= 0 && draft.limit > 0 && draft.limit <= Number(market?.ask) + draft.maxSlippage + 1e-8, "Buy limit cannot exceed ask plus the draft slippage allowance. A lower limit may remain unfilled.");
  check("PRICE_PLAN", "Stop and target", validPrices, "For a long option: stop < buy limit < target.");
  check("CHARGES", "Estimated charges", validCharges, "Enter a positive round-trip charge estimate; actual charges are not verified here.");
  check("RECOVERY", "Recovery sizing", validLoss, lots === null ? "Recovery loss must be non-negative." : `Sheet rule requests ${lots} lot(s); lifetime P&L is not used.`);
  check("LOT_CAP", "Maximum lots", lots !== null && Number.isSafeInteger(draft.maxLots) && draft.maxLots > 0 && lots <= draft.maxLots, "If recovery sizing exceeds the cap, block the plan rather than silently resize it.");
  check("CAPITAL", "Capital allowance", capital !== null && finite(draft.maxCapital) && draft.maxCapital > 0 && capital <= draft.maxCapital, "Premium capital plus estimated charges must fit the draft allowance. Broker funds are not checked.");
  check("DAILY_LOSS", "Daily loss allowance", remainingLossBudget !== null && draft.dailyLossLimit > 0 && remainingLossBudget > 0 && plannedLoss !== null && plannedLoss <= remainingLossBudget, "Planned stop loss plus charges must fit today's remaining draft loss allowance. Stop execution is not guaranteed.");
  return { mode: liveRehearsalMode, realOrdersEnabled: liveOrdersEnabled, checks, valid: checks.every(c => c.ok), lots, quantity, capital, plannedLoss, plannedProfit, remainingLossBudget };
}

export function runRehearsalChecks() {
  const now = Date.parse("2026-11-19T04:00:00Z");
  const draft: RehearsalDraft = { symbol: "NSE:NIFTY26NOV25250CE", recoveryLoss: 0, limit: 100, stop: 80, target: 200, maxLots: 1, maxCapital: 10000, dailyLossLimit: 2500, dayNet: 0, estimatedCharges: 80, maxSpread: 2, maxSlippage: 2 };
  const market: RehearsalMarket = { symbol: draft.symbol, lotSize: 65, bid: 99, ask: 100, timestamp: now / 1000, status: "ok" };
  const plan = (change: Partial<RehearsalDraft> = {}, quote: RehearsalMarket | null = market) => buildRehearsalPlan({ ...draft, ...change }, quote, now);
  const blocked = (result: ReturnType<typeof plan>, code: string) => !result.valid && result.checks.some(c => c.code === code && !c.ok);
  return [
    { name: "Valid draft", passed: plan().valid && plan().realOrdersEnabled === false, detail: "Valid fixture stays rehearsal-only." },
    { name: "Stale market data", passed: blocked(plan({}, { ...market, timestamp: (now - 6000) / 1000 }), "FRESH_QUOTE"), detail: "A six-second-old quote is blocked." },
    { name: "Missing contract size", passed: blocked(plan({}, { ...market, lotSize: null }), "LOT_SIZE"), detail: "No hard-coded exchange lot size fallback." },
    { name: "Recovery exceeds cap", passed: blocked(plan({ recoveryLoss: 1300 }), "LOT_CAP"), detail: "Two recovery lots cannot bypass a one-lot cap." },
    { name: "Insufficient capital", passed: blocked(plan({ maxCapital: 6000 }), "CAPITAL"), detail: "Premium plus charges exceeds the allowance." },
    { name: "Daily loss exhausted", passed: blocked(plan({ dayNet: -2500 }), "DAILY_LOSS"), detail: "No plan passes after the daily loss allowance is spent." },
    { name: "Invalid protection levels", passed: blocked(plan({ stop: 110 }), "PRICE_PLAN"), detail: "A stop above a long entry is rejected." },
    { name: "Wrong contract quote", passed: blocked(plan({}, { ...market, symbol: "NSE:OTHERCE" }), "MARKET_MATCH"), detail: "Another contract's quote cannot validate this plan." }
  ];
}
