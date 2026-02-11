export type Direction = "Long" | "Short";

export type Trade = {
  tradeId: string;
  date: string; // YYYY-MM-DD
  instrument: string;
  market: string; // Equity / F&O
  entryTime: string; // HH:mm
  exitTime: string; // HH:mm
  strategy: string;
  direction: Direction;
  sizeQty: number;
  lots?: number;
  lotSize?: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  targetPrice: number;
  exitReason: string;
  platform: string;
  chartUrl?: string;
  remarks?: string;
  emotionTag?: string;
  emotionalState?: string;
  mindsetNotes?: string;
};

export const trades: Trade[] = [
  {
    tradeId: "T-1001",
    date: "2026-01-06",
    instrument: "AAPL",
    market: "Equity",
    entryTime: "09:35",
    exitTime: "11:10",
    strategy: "Breakout A+",
    direction: "Long",
    sizeQty: 40,
    lots: 1,
    lotSize: 40,
    entryPrice: 178.4,
    exitPrice: 183.2,
    stopLoss: 176.8,
    targetPrice: 184.0,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Focused",
    emotionalState: "Disciplined",
    mindsetNotes: "Waited for confirmation."
  },
  {
    tradeId: "T-1002",
    date: "2026-01-08",
    instrument: "TSLA",
    market: "Equity",
    entryTime: "10:20",
    exitTime: "12:40",
    strategy: "VWAP Fade",
    direction: "Short",
    sizeQty: 25,
    lots: 1,
    lotSize: 25,
    entryPrice: 242.1,
    exitPrice: 234.8,
    stopLoss: 245.2,
    targetPrice: 232.0,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Calm",
    emotionalState: "Patient"
  },
  {
    tradeId: "T-1003",
    date: "2026-01-10",
    instrument: "NIFTY",
    market: "F&O",
    entryTime: "09:50",
    exitTime: "10:30",
    strategy: "Range Reversal",
    direction: "Long",
    sizeQty: 2,
    lots: 1,
    lotSize: 2,
    entryPrice: 16220,
    exitPrice: 16080,
    stopLoss: 16120,
    targetPrice: 16340,
    exitReason: "Stop Hit",
    platform: "Web",
    emotionTag: "Hesitant",
    emotionalState: "Uncertain"
  },
  {
    tradeId: "T-1004",
    date: "2026-01-12",
    instrument: "MSFT",
    market: "Equity",
    entryTime: "13:05",
    exitTime: "15:45",
    strategy: "Earnings Trend",
    direction: "Long",
    sizeQty: 30,
    lots: 1,
    lotSize: 30,
    entryPrice: 404.2,
    exitPrice: 412.7,
    stopLoss: 401.8,
    targetPrice: 414.0,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Confident",
    emotionalState: "Disciplined"
  },
  {
    tradeId: "T-1005",
    date: "2026-01-14",
    instrument: "RELIANCE",
    market: "Equity",
    entryTime: "10:10",
    exitTime: "11:00",
    strategy: "ORB 30",
    direction: "Long",
    sizeQty: 60,
    lots: 1,
    lotSize: 60,
    entryPrice: 2484,
    exitPrice: 2510,
    stopLoss: 2466,
    targetPrice: 2525,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Focused",
    emotionalState: "Patient"
  },
  {
    tradeId: "T-1006",
    date: "2026-01-18",
    instrument: "BANKNIFTY",
    market: "F&O",
    entryTime: "09:25",
    exitTime: "10:15",
    strategy: "Supply Fade",
    direction: "Short",
    sizeQty: 1,
    lots: 1,
    lotSize: 1,
    entryPrice: 34820,
    exitPrice: 34610,
    stopLoss: 34910,
    targetPrice: 34480,
    exitReason: "Manual Exit",
    platform: "Web",
    emotionTag: "Anxious",
    emotionalState: "Impulsive"
  },
  {
    tradeId: "T-1007",
    date: "2026-01-20",
    instrument: "INFY",
    market: "Equity",
    entryTime: "11:05",
    exitTime: "12:55",
    strategy: "Breakout A+",
    direction: "Long",
    sizeQty: 80,
    lots: 1,
    lotSize: 80,
    entryPrice: 1528,
    exitPrice: 1512,
    stopLoss: 1515,
    targetPrice: 1550,
    exitReason: "Stop Hit",
    platform: "Web",
    emotionTag: "Frustrated",
    emotionalState: "Impulsive"
  },
  {
    tradeId: "T-1008",
    date: "2026-01-24",
    instrument: "AAPL",
    market: "Equity",
    entryTime: "09:45",
    exitTime: "10:40",
    strategy: "Gap Fade",
    direction: "Short",
    sizeQty: 35,
    lots: 1,
    lotSize: 35,
    entryPrice: 186.4,
    exitPrice: 181.9,
    stopLoss: 188.2,
    targetPrice: 181.0,
    exitReason: "Early Exit",
    platform: "Web",
    emotionTag: "FOMO",
    emotionalState: "Distracted"
  },
  {
    tradeId: "T-1009",
    date: "2026-01-28",
    instrument: "NIFTY",
    market: "F&O",
    entryTime: "14:15",
    exitTime: "15:10",
    strategy: "Trend Pullback",
    direction: "Long",
    sizeQty: 3,
    lots: 1,
    lotSize: 3,
    entryPrice: 16410,
    exitPrice: 16560,
    stopLoss: 16340,
    targetPrice: 16610,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Calm",
    emotionalState: "Disciplined"
  },
  {
    tradeId: "T-1010",
    date: "2026-02-04",
    instrument: "TSLA",
    market: "Equity",
    entryTime: "10:05",
    exitTime: "11:20",
    strategy: "VWAP Reclaim",
    direction: "Long",
    sizeQty: 18,
    lots: 1,
    lotSize: 18,
    entryPrice: 229.3,
    exitPrice: 236.4,
    stopLoss: 226.8,
    targetPrice: 238.5,
    exitReason: "Target Hit",
    platform: "Web",
    emotionTag: "Confident",
    emotionalState: "Focused"
  }
];
