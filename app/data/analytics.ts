import type { Trade } from "./trades";

export type TradeResult = "Win" | "Loss" | "BE";

export type DerivedTrade = Trade & {
  day: string;
  risk: number;
  reward: number;
  riskReward: number | null;
  rr: number | null;
  pl: number;
  grossPl: number;
  netPl: number;
  winLoss: TradeResult;
  tradeDuration: number; // minutes
  totalInvestment: number;
  rMultiple: number | null;
};

export type Summary = {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPl: number;
  avgPl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number;
  expectancyR: number | null;
  avgRR: number | null;
  equityCurve: { date: string; equity: number }[];
  drawdownSeries: number[];
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  maxProfitTrade: number;
  maxLossTrade: number;
};

export type BreakdownRow = { label: string; value: number };
export type WinRateRow = { label: string; value: number };

export type GroupStat = {
  name: string;
  trades: number;
  winRate: number;
  totalPl: number;
  avgPl: number;
  avgRR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function toDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

export function deriveTrades(trades: Trade[]): DerivedTrade[] {
  return trades.map((trade) => {
    const direction = trade.direction === "Long" ? 1 : -1;
    const grossPl = (trade.exitPrice - trade.entryPrice) * trade.sizeQty * direction;
    const netPl = grossPl; // no fees in v1
    const risk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.sizeQty;
    const reward = Math.abs(trade.targetPrice - trade.entryPrice) * trade.sizeQty;
    const riskReward = risk > 0 ? reward / risk : null;
    const rr = riskReward;
    const rMultiple = risk > 0 ? netPl / risk : null;
    const winLoss: TradeResult = netPl > 0 ? "Win" : netPl < 0 ? "Loss" : "BE";
    const entry = toDateTime(trade.date, trade.entryTime).getTime();
    const exit = toDateTime(trade.date, trade.exitTime).getTime();
    const tradeDuration = Math.max(0, Math.round((exit - entry) / 60000));
    const totalInvestment = trade.entryPrice * trade.sizeQty;
    const day = DAY_NAMES[toDate(trade.date).getDay()];

    return {
      ...trade,
      day,
      risk,
      reward,
      riskReward,
      rr,
      pl: netPl,
      grossPl,
      netPl,
      winLoss,
      tradeDuration,
      totalInvestment,
      rMultiple
    };
  });
}

export function computeSummary(trades: DerivedTrade[]): Summary {
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.pl > 0).length;
  const losses = trades.filter((t) => t.pl < 0).length;
  const breakeven = totalTrades - wins - losses;
  const totalPl = trades.reduce((sum, t) => sum + t.pl, 0);
  const avgPl = totalTrades ? totalPl / totalTrades : 0;
  const winsPl = trades.filter((t) => t.pl > 0).map((t) => t.pl);
  const lossesPl = trades.filter((t) => t.pl < 0).map((t) => t.pl);
  const avgWin = winsPl.length
    ? winsPl.reduce((sum, v) => sum + v, 0) / winsPl.length
    : 0;
  const avgLoss = lossesPl.length
    ? Math.abs(lossesPl.reduce((sum, v) => sum + v, 0) / lossesPl.length)
    : 0;
  const profitFactor =
    lossesPl.length === 0
      ? null
      : winsPl.reduce((sum, v) => sum + v, 0) /
        Math.abs(lossesPl.reduce((sum, v) => sum + v, 0));

  const winRate = totalTrades ? wins / totalTrades : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  const rMultiples = trades
    .map((t) => t.rMultiple)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const expectancyR = rMultiples.length
    ? rMultiples.reduce((sum, v) => sum + v, 0) / rMultiples.length
    : null;

  const rrValues = trades
    .map((t) => t.rr)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avgRR = rrValues.length
    ? rrValues.reduce((sum, v) => sum + v, 0) / rrValues.length
    : null;

  const equityCurve = computeEquityCurve(trades);
  const { drawdownSeries, maxDrawdown, maxDrawdownPct } =
    computeDrawdown(equityCurve);

  const maxProfitTrade = trades.length
    ? Math.max(...trades.map((t) => t.pl))
    : 0;
  const maxLossTrade = trades.length
    ? Math.min(...trades.map((t) => t.pl))
    : 0;

  return {
    totalTrades,
    wins,
    losses,
    breakeven,
    winRate,
    totalPl,
    avgPl,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    expectancyR,
    avgRR,
    equityCurve,
    drawdownSeries,
    maxDrawdown,
    maxDrawdownPct,
    maxProfitTrade,
    maxLossTrade
  };
}

export function computeEquityCurve(trades: DerivedTrade[]) {
  const sorted = [...trades].sort((a, b) =>
    `${a.date} ${a.exitTime}`.localeCompare(`${b.date} ${b.exitTime}`)
  );
  let equity = 0;
  return sorted.map((trade) => {
    equity += trade.pl;
    return { date: trade.date, equity };
  });
}

export function computeDrawdown(
  equityCurve: { date: string; equity: number }[]
) {
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct: number | null = null;
  const drawdownSeries: number[] = [];

  equityCurve.forEach((point) => {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = point.equity - peak;
    drawdownSeries.push(drawdown);
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = peak === 0 ? null : drawdown / peak;
    }
  });

  return { drawdownSeries, maxDrawdown, maxDrawdownPct };
}

export function breakdownByDay(trades: DerivedTrade[]): BreakdownRow[] {
  return breakdown(trades, (trade) => trade.date);
}

export function breakdownByWeek(trades: DerivedTrade[]): BreakdownRow[] {
  return breakdown(trades, (trade) => {
    const date = toDate(trade.date);
    const { year, week } = getISOWeek(date);
    return `${year}-W${String(week).padStart(2, "0")}`;
  });
}

export function breakdownByMonth(trades: DerivedTrade[]): BreakdownRow[] {
  return breakdown(trades, (trade) => trade.date.slice(0, 7));
}

export function winRateByMonth(trades: DerivedTrade[]): WinRateRow[] {
  const map = new Map<string, { wins: number; total: number }>();
  trades.forEach((trade) => {
    const key = trade.date.slice(0, 7);
    const current = map.get(key) ?? { wins: 0, total: 0 };
    current.total += 1;
    if (trade.pl > 0) current.wins += 1;
    map.set(key, current);
  });
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value: value.total ? value.wins / value.total : 0 }));
}

export function dayOfWeekStats(trades: DerivedTrade[]) {
  const map = new Map<string, DerivedTrade[]>();
  trades.forEach((trade) => {
    const key = trade.day;
    const group = map.get(key) ?? [];
    group.push(trade);
    map.set(key, group);
  });

  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return [...map.entries()]
    .map(([day, group]) => {
      const summary = computeSummary(group);
      return {
        day,
        trades: summary.totalTrades,
        winRate: summary.winRate,
        totalPl: summary.totalPl
      };
    })
    .sort(
      (a, b) => order.indexOf(a.day) - order.indexOf(b.day)
    );
}

function breakdown(
  trades: DerivedTrade[],
  keyFn: (trade: DerivedTrade) => string
): BreakdownRow[] {
  const map = new Map<string, number>();
  trades.forEach((trade) => {
    const key = keyFn(trade);
    map.set(key, (map.get(key) ?? 0) + trade.pl);
  });
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
}

export function groupStats(
  trades: DerivedTrade[],
  keyFn: (trade: DerivedTrade) => string
): GroupStat[] {
  const map = new Map<string, DerivedTrade[]>();
  trades.forEach((trade) => {
    const key = keyFn(trade) || "Unspecified";
    const group = map.get(key) ?? [];
    group.push(trade);
    map.set(key, group);
  });

  return [...map.entries()].map(([name, group]) => {
    const summary = computeSummary(group);
    return {
      name,
      trades: summary.totalTrades,
      winRate: summary.winRate,
      totalPl: summary.totalPl,
      avgPl: summary.avgPl,
      avgRR: summary.avgRR,
      expectancyR: summary.expectancyR,
      profitFactor: summary.profitFactor
    };
  });
}

export function getISOWeek(date: Date) {
  const temp = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: temp.getUTCFullYear(), week };
}
