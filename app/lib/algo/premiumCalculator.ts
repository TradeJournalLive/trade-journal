export function completedPremiumCandle(rows: unknown[], now: number) {
  return rows.filter((row): row is number[] => Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every(v => typeof v === "number" && Number.isFinite(v))
    && row[0] > 0 && (row[0] + 300) * 1000 <= now && row[3] > 0 && row[2] >= Math.max(row[1], row[4]) && row[3] <= Math.min(row[1], row[4]))
    .sort((a, b) => b[0] - a[0]).map(row => ({ openedAt: new Date(row[0] * 1000).toISOString(), closedAt: new Date((row[0] + 300) * 1000).toISOString(), low: row[3], close: row[4] }))[0] ?? null;
}
export function premiumCalculation(close: number, low: number, entry: number, lots: number, lotSize: number) {
  if (![close, low, entry].every(v => Number.isFinite(v) && v > 0) || low >= close) throw new Error("Candle close must be above its positive low.");
  if (![lots, lotSize].every(v => Number.isSafeInteger(v) && v > 0) || !Number.isSafeInteger(lots * lotSize)) throw new Error("Enter valid whole lots and lot size.");
  const target = close + 1.5 * (close - low), quantity = lots * lotSize;
  const risk = entry - low, reward = target - entry;
  return { stop: low, target, quantity, referenceRisk: close - low, entryValue: entry * quantity, riskAmount: risk * quantity, rewardAmount: reward * quantity, actualRR: risk > 0 && reward > 0 ? reward / risk : null, warning: risk <= 0 ? "Entry is at or below the stop." : reward <= 0 ? "Entry is at or above the target." : null };
}
