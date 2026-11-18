import { maxPaperCapital } from "./maxPaperCapital";

export const niftyFreshSessionAt = "2026-11-16T18:30:00.000Z"; // 17 Nov, midnight IST
const stepPaise = 130_000;
const freshPaperCapital = 1_000_000;

export type NiftyLossCycle = { loss: number; net: number; count: number };
export type NiftyCapitalReset = { at: string; previousBalance: number; netAtReset: number };
type CycleState = { lossCycleFrom?: string; lossCycle?: NiftyLossCycle; nextLots: number; position: unknown };
type FundedCycleState = CycleState & { balance: number; capitalReset?: NiftyCapitalReset };
const money = (amount: number) => Math.round(amount * 100) / 100;

export function niftyLotsForLoss(loss: number) {
  const units = Math.round(loss * 100) / stepPaise;
  if (!Number.isFinite(units) || units < 0 || !Number.isSafeInteger(Math.round(loss * 100))) throw Error("INVALID_NIFTY_CYCLE_LOSS");
  let threshold = Math.floor((Math.sqrt(1 + 8 * units) - 1) / 2);
  if ((threshold + 1) * (threshold + 2) / 2 <= units) threshold++;
  if (threshold * (threshold + 1) / 2 > units) threshold--;
  return threshold + 1;
}

export function startNiftyLossCycle(s: FundedCycleState, at: string) {
  if (s.position || !s.lossCycleFrom || !(Date.parse(at) >= Date.parse(s.lossCycleFrom))) return;
  if (!s.lossCycle) {
    s.lossCycle = { loss: 0, net: 0, count: 0 };
    s.nextLots = 1;
  }
  if (!s.capitalReset) {
    s.capitalReset = { at, previousBalance: s.balance, netAtReset: s.lossCycle.net };
    s.balance = freshPaperCapital;
  }
}

export function balanceAfterNiftyCapitalReset(cycle: NiftyLossCycle, reset: NiftyCapitalReset) {
  return money(freshPaperCapital + cycle.net - reset.netAtReset);
}

export function finishNiftyCycleTrade(s: CycleState, pnl: number, reason: string) {
  const cycle = s.lossCycle;
  if (!cycle) return;
  cycle.loss = reason === "PREMIUM_TARGET" ? 0 : money(Math.max(0, cycle.loss - pnl));
  cycle.net = money(cycle.net + pnl);
  cycle.count++;
  s.nextLots = niftyLotsForLoss(cycle.loss);
}

export type NiftyPaperStatus = {
  enabled: boolean; status: string; workerStatus: string; feedAt: string | null;
  cycle: NiftyLossCycle | null; lots: number | null; cash: number | null; pendingExit: string | null;
  maxCapitalRequired?: number | null;
  reviewRequired: boolean; position: { contract: string; entry: number; stop: number; target: number; lots: number; quantity: number; mark: number | null; lateEntry: boolean } | null;
};

type CapitalTrade = { openedAt: string; closedAt: string; pnl: number; reason: string; entry: number; quantity: number };
type CapitalEntry = Pick<CapitalTrade, "openedAt" | "entry" | "quantity">;
type ProjectedState = Pick<import("./niftyLimitPaper").LimitState, "enabled"|"status"|"nextLots"|"position"|"balance"|"pendingExit"|"mark"> & { lossCycle?: NiftyLossCycle; trades?: readonly CapitalTrade[] };
export function niftyPaperStatus(s: ProjectedState, workerStatus: string, feedAt: string | null, reviewRequired = false, history = s.trades, previousEntries: readonly CapitalEntry[] = []): NiftyPaperStatus {
  const p = s.position;
  const recorded = history?.filter(t => Date.parse(t.openedAt) >= Date.parse(niftyFreshSessionAt));
  const open = p && Date.parse(p.openedAt) >= Date.parse(niftyFreshSessionAt) ? p : null;
  const entries = previousEntries.filter(p => Date.parse(p.openedAt) >= Date.parse(niftyFreshSessionAt)).map(p => ({ openedAt: p.openedAt, capital: p.entry * p.quantity }));
  const maxCapitalRequired = recorded ? maxPaperCapital(recorded, open, t => t.entry * t.quantity, open ? open.entry * open.quantity : undefined, entries) : null;
  return { enabled: s.enabled, status: s.status, workerStatus, feedAt, cycle: s.lossCycle ?? null,
    maxCapitalRequired: maxCapitalRequired === null ? null : money(maxCapitalRequired),
    lots: s.lossCycle ? s.nextLots : null, cash: p ? money(s.balance - p.entry * p.quantity) : s.balance,
    pendingExit: s.pendingExit?.reason ?? null, reviewRequired,
    position: p ? { contract: p.contract.id, entry: p.entry, stop: p.stop, target: p.target,
      lots: p.lots, quantity: p.quantity, mark: s.mark, lateEntry: Boolean(p.lateEntry) } : null };
}
