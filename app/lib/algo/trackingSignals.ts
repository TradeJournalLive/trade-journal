export const NIFTY_TRACKING_STRATEGY = "nifty_confirmation_tracking_v1";

export function isolateTrackingSignal<T extends { strategyId?: string; metadata?: Record<string, unknown>; automation?: Record<string, unknown> }>(payload: T): T {
  if (payload.strategyId !== NIFTY_TRACKING_STRATEGY) return payload;
  const { niftyPaper, btcPaper, paperBarOpen, ...metadata } = payload.metadata ?? {};
  return { ...payload, metadata: { ...metadata, trackingOnly: true }, automation: { enabled: false, mode: "PAPER", underlying: "NIFTY" } };
}
