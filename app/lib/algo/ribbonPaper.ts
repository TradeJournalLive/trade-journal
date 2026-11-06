import { emptyHamsState as emptyBase, hamsFinalRules } from "./hamsFinalPaper";
export type { HamsState, HamsPosition, HamsTrade, HamsSignal, HamsQuote, HamsCandle } from "./hamsFinalPaper";
export { setHamsEnabled, nextHamsLots, hamsContract, enterHams, markHams } from "./hamsFinalPaper";

export const ribbonRules = Object.freeze({ ...hamsFinalRules,
  strategyId: "nifty_ribbon_test_3m_v1", namespace: "ribbonPaper", initialCapital: 1000000
});
export function emptyHamsState() { return { ...emptyBase(), balance: ribbonRules.initialCapital }; }
