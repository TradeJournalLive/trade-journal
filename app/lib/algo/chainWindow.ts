export function chainWindow(strikes: number[], spot: number | null | undefined, count = 10) {
  const sorted = [...new Set(strikes.filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  if (typeof spot !== "number" || !Number.isFinite(spot) || spot <= 0 || !sorted.length) return { atm: null, strikes: [] as number[] };
  const atm = sorted.reduce((best, strike) => Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best, sorted[0]);
  const index = sorted.indexOf(atm);
  return { atm, strikes: sorted.slice(Math.max(0, index - count), index + count + 1) };
}
