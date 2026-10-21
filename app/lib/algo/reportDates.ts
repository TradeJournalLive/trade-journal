const zone = "Asia/Kolkata";
export function istDay(value: string | null | undefined) {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at + 19800000).toISOString().slice(0, 10) : "";
}
export function istTime(value: string | null | undefined) {
  return istDay(value) ? new Date(value!).toLocaleTimeString("en-GB", { timeZone: zone, hour12: false }) : "";
}
export function onTradeDate<T extends { openedAt: string }>(trades: T[], date: string) {
  return date ? trades.filter(trade => istDay(trade.openedAt) === date) : trades;
}
export function signalTime(event: { signal: { timestamp: string; metadata?: Record<string, unknown> } }) {
  for (const key of ["btcPaper", "niftyPaper"]) {
    const candle = event.signal.metadata?.[key] as { closedAt?: string } | undefined;
    if (candle?.closedAt && istDay(candle.closedAt)) return candle.closedAt;
  }
  return event.signal.timestamp;
}
export function tradeSignalTimes(events: { receivedAt: string; signal: { id: string; symbol: string; timestamp: string; metadata?: Record<string, unknown> } }[], id: string, symbol: string, openedAt: string) {
  const matching = events.filter(event => event.signal.id === id && event.signal.symbol === symbol && Date.parse(event.receivedAt) <= Date.parse(openedAt));
  const event = matching.length === 1 ? matching[0] : undefined;
  return { signalReceivedAt: event?.receivedAt, signalClosedAt: event ? signalTime(event) : undefined };
}
