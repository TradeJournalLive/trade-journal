export const signalGroups = [["NIFTY", "NIFTY"], ["NIFTY_HAMS", "NIFTY HAMS Final"], ["BTC", "Delta BTC"]] as const;
export function signalGroup(signal: { symbol?: string; strategyId?: string }) {
  if (signal.strategyId === "nifty_confirmation_tracking_v1") return null;
  if (signal.strategyId === "nifty_hams_final_3m_v1") return signal.symbol === "NSE:NIFTY" ? "NIFTY_HAMS" : null;
  return signal.symbol === "NSE:NIFTY" ? "NIFTY" : signal.symbol === "DELTAIN:BTCUSD.P" ? "BTC" : null;
}
