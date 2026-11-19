export type RecoveryPosition = { signalId: string; openedAt: string; entry: number; stop: number; target: number; quantity: number; lots: number; contract: { id: string; side: string } };
export type RecoveryCandle = { at: string; open: number; high: number; low: number; close: number; volume: number };
export function recoverySessionEnd(openedAt: string) {
  const day = new Date(Date.parse(openedAt) + 330 * 60000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00Z`) + (14 * 60 + 50 - 330) * 60000).toISOString();
}
export function normalizeRecoveryCandles(rows: unknown, now: number): RecoveryCandle[] {
  if (!Array.isArray(rows)) throw Error("Invalid FYERS candle response.");
  const result: RecoveryCandle[] = [], seen = new Set<number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0,6).some(n => typeof n !== "number" || !Number.isFinite(n)) || row[0] <= 0 || row[0] % 60 !== 0 || row[5] < 0 || row.slice(1,5).some(n => n <= 0) || row[2] < Math.max(row[1],row[3],row[4]) || row[3] > Math.min(row[1],row[2],row[4]) || seen.has(row[0])) throw Error("Malformed or duplicate FYERS candles; review remains unverified.");
    seen.add(row[0]);
    if (row[0] * 1000 + 60000 > now) continue;
    result.push({ at: new Date(row[0] * 1000).toISOString(), open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
  }
  return result.sort((a,b) => Date.parse(a.at)-Date.parse(b.at));
}
export function reviewRecoveryCandles(position: RecoveryPosition, pausedAt: string, candles: RecoveryCandle[], oppositeSignalTimes: string[], now: number) {
  const start = Date.parse(pausedAt), opened = Date.parse(position.openedAt), cutoff = Date.parse(recoverySessionEnd(position.openedAt));
  if (![start, opened, cutoff].every(Number.isFinite) || start < opened || !(position.stop > 0 && position.stop < position.entry && position.target > position.entry && position.quantity > 0)) throw Error("Invalid saved paper position or pause timestamp.");
  const bars = candles.filter(c => Date.parse(c.at)+60000 > start && Date.parse(c.at) <= cutoff);
  const opposite = oppositeSignalTimes.map(Date.parse).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  let previous = Math.floor(start / 60000) * 60000 - 60000;
  const missing: string[] = [];
  for (const c of bars) {
    const at = Date.parse(c.at);
    for (let t=previous+60000;t<at;t+=60000) missing.push(new Date(t).toISOString());
    previous = at;
    if (c.volume === 0) { missing.push(c.at); continue; }
    const stop = c.low <= position.stop, target = c.high >= position.target;
    const reason = at >= cutoff ? "TIME_EXIT" : stop && target ? "AMBIGUOUS_SL_AND_TARGET" : stop ? "PREMIUM_SL" : target ? "PREMIUM_TARGET" : null;
    if (!reason) continue;
    const partialPauseBar = at < start;
    const unresolvedOpposite = Number.isFinite(opposite) && opposite < at+60000;
    const ambiguous = reason === "AMBIGUOUS_SL_AND_TARGET" || partialPauseBar || missing.length > 0 || unresolvedOpposite;
    const exitEstimate = ambiguous ? null : reason === "TIME_EXIT" ? c.open : reason === "PREMIUM_SL" ? Math.min(position.stop,c.open) : position.target;
    return { source: "FYERS_1M_OHLC" as const, fillVerified: false as const, status: ambiguous ? "AMBIGUOUS_HISTORY" : "CANDLE_RECONSTRUCTION_AVAILABLE", reason, windowStart: c.at, windowEnd: new Date(at+60000).toISOString(), exitEstimate, grossEstimate: exitEstimate === null ? null : Math.round((exitEstimate-position.entry)*position.quantity*100)/100, cutoffAt: new Date(cutoff).toISOString(), partialPauseBar, unresolvedOpposite, missingMinutes: missing, candidateCandle: c, note: "Historical trade candles do not establish executable bid, available depth, limit-fill timing or an exact exit. This is not a verified paper fill." };
  }
  return { source: "FYERS_1M_OHLC" as const, fillVerified: false as const, status: now < cutoff+60000 ? "WAITING_FOR_COMPLETED_CANDLES" : "INCOMPLETE_HISTORY", reason: null, exitEstimate: null, grossEstimate: null, cutoffAt: new Date(cutoff).toISOString(), missingMinutes: missing, note: "No complete, unambiguous exit reconstruction is available. No exit or P&L has been assumed." };
}
