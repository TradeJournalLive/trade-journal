// Native TradingView placeholders are strings; derive close from bar-open, not delivery time.
export function niftySignalCandle(value: unknown, timeframe: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.kind !== "SIGNAL") return null;
  const high = Number(data.high), low = Number(data.low), interval = Number(timeframe);
  const opened = Date.parse(String(data.barOpen ?? ""));
  const closedAt = Number.isFinite(opened) && Number.isInteger(interval) && interval >= 1 && interval <= 60
    ? new Date(opened + interval * 60000).toISOString() : String(data.closedAt ?? "");
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0 || high < low || !Number.isFinite(Date.parse(closedAt))) return null;
  return { kind: "SIGNAL", high, low, closedAt };
}
