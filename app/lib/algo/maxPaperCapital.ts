type Trade = { openedAt: string; closedAt: string; pnl: number; reason: string };

export function maxPaperCapital<T extends Trade>(
  trades: readonly T[], open: { openedAt: string } | null | undefined,
  capital: (trade: T) => number, openCapital?: number,
) {
  const events: { at: number; kind: number; amount: number; target?: boolean }[] = [];
  for (const trade of trades) {
    events.push({ at: Date.parse(trade.openedAt), kind: 1, amount: capital(trade) });
    events.push({ at: Date.parse(trade.closedAt), kind: 0, amount: Math.max(0, -trade.pnl),
      target: /^(PREMIUM_TARGET|TARGET(?:_[0-9]+(?:_[0-9]+)?R)?)$/.test(trade.reason) });
  }
  if (open && openCapital !== undefined) events.push({ at: Date.parse(open.openedAt), kind: 1, amount: openCapital });
  let losses = 0, peak: number | null = null;
  for (const event of events.sort((a, b) => a.at - b.at || a.kind - b.kind)) {
    if (!Number.isFinite(event.at) || !Number.isFinite(event.amount)) continue;
    if (event.kind === 1) peak = Math.max(peak ?? 0, losses + event.amount);
    else losses = event.target ? 0 : losses + event.amount;
  }
  return peak;
}
