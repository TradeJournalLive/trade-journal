export type SharedTrade = {
  tradeId: string;
  instrument: string;
  strategy: string;
  direction: "Long" | "Short";
  entryTime: string;
  exitTime: string;
  tradeDuration: string;
  entryPrice: number;
  exitPrice: number;
  pl: number;
  exitReason: string;
  chartUrl: string;
  pnlScreenshotUrl: string;
  remarks: string;
};

export type SharedMarketSnapshotRow = {
  label: string;
  previous: number | null;
  current: number | null;
  diffPct: number | null;
};

export type SharedDailyChecklist = {
  sentimentToday: string;
  viewOutcome: string;
  previousDayMarket: string;
  observations: string;
  notes: string;
};

export type SharedDay = {
  date: string;
  trades: SharedTrade[];
  summary: { totalTrades: number; totalPl: number; winRate: number };
  marketSnapshot: SharedMarketSnapshotRow[];
  checklist: SharedDailyChecklist;
};

export type SharedPayload = {
  month: string;
  currency: "INR" | "USD";
  generatedAt: string;
  days: SharedDay[];
  monthlySummary: {
    totalTrades: number;
    totalPl: number;
    wins: number;
    losses: number;
    winRate: number;
    bestDay: { date: string; totalPl: number } | null;
    worstDay: { date: string; totalPl: number } | null;
  };
};
