export const niftyFreshSessionAt = "2026-11-16T18:30:00.000Z"; // 17 Nov, midnight IST
const stepPaise = 130_000;

export type NiftyLossCycle = { loss: number; net: number; count: number };
type CycleState = { lossCycleFrom?: string; lossCycle?: NiftyLossCycle; nextLots: number; position: unknown };
const money = (amount: number) => Math.round(amount * 100) / 100;

export function niftyLotsForLoss(loss: number) {
  const units = Math.round(loss * 100) / stepPaise;
  if (!Number.isFinite(units) || units < 0 || !Number.isSafeInteger(Math.round(loss * 100))) throw Error("INVALID_NIFTY_CYCLE_LOSS");
  let threshold = Math.floor((Math.sqrt(1 + 8 * units) - 1) / 2);
  if ((threshold + 1) * (threshold + 2) / 2 <= units) threshold++;
  if (threshold * (threshold + 1) / 2 > units) threshold--;
  return threshold + 1;
}

export function startNiftyLossCycle(s: CycleState, at: string) {
  if (s.lossCycle || s.position || !s.lossCycleFrom || !(Date.parse(at) >= Date.parse(s.lossCycleFrom))) return;
  s.lossCycle = { loss: 0, net: 0, count: 0 };
  s.nextLots = 1;
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
  reviewRequired: boolean; position: { contract: string; entry: number; stop: number; target: number; lots: number; quantity: number; mark: number | null; lateEntry: boolean } | null;
};

type ProjectedState = Pick<import("./niftyLimitPaper").LimitState, "enabled"|"status"|"nextLots"|"position"|"balance"|"pendingExit"|"mark"> & { lossCycle?: NiftyLossCycle };
export function niftyPaperStatus(s: ProjectedState, workerStatus: string, feedAt: string | null, reviewRequired = false): NiftyPaperStatus {
  const p = s.position;
  return { enabled: s.enabled, status: s.status, workerStatus, feedAt, cycle: s.lossCycle ?? null,
    lots: s.lossCycle ? s.nextLots : null, cash: p ? money(s.balance - p.entry * p.quantity) : s.balance,
    pendingExit: s.pendingExit?.reason ?? null, reviewRequired,
    position: p ? { contract: p.contract.id, entry: p.entry, stop: p.stop, target: p.target,
      lots: p.lots, quantity: p.quantity, mark: s.mark, lateEntry: Boolean(p.lateEntry) } : null };
}
