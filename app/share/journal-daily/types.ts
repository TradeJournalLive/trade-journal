export type SharedTrade = {
  tradeId: string;
  instrument: string;
  strategy: string;
  direction: "Long" | "Short";
  entryPrice: number;
  exitPrice: number;
  pl: number;
  exitReason: string;
  chartUrl: string;
  remarks: string;
  quote: string;
};

export type SharedPayload = {
  month: string;
  currency: "INR" | "USD";
  generatedAt: string;
  days: Array<{
    date: string;
    trades: SharedTrade[];
    summary: { totalTrades: number; totalPl: number; winRate: number };
  }>;
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

