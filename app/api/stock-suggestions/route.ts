import { NextResponse } from "next/server";

type Suggestion = {
  symbol: string;
  style: "Intraday" | "Swing";
  entryZone: string;
  entryTrigger: string;
  stopLossPrice: string;
  setup: string;
  exitPrice: string;
  targetMinPct: number;
  targetMaxPct: number;
  riskReward: string;
  stopLossPct: number;
  convictionScore: number;
  confidence: "Low" | "Medium" | "High";
  timeframe: string;
  positionSizePct: number;
  validTill: string;
  invalidation: string;
  convictionReason: string;
  note: string;
};

const IDEAS: Suggestion[] = [
  {
    symbol: "RELIANCE",
    style: "Swing",
    entryZone: "₹2,920 - ₹2,965",
    entryTrigger: "Daily breakout above ₹2,965 with volume",
    stopLossPrice: "₹2,835",
    setup: "Breakout above prior range with volume",
    exitPrice: "Partial near ₹3,210, trail above ₹3,280",
    targetMinPct: 10,
    targetMaxPct: 18,
    riskReward: "1:2.4",
    stopLossPct: 4,
    convictionScore: 7,
    confidence: "Medium",
    timeframe: "2-5 weeks",
    positionSizePct: 8,
    validTill: "5 sessions",
    invalidation: "Close below ₹2,835",
    convictionReason: "Range expansion + index leadership",
    note: "Wait for daily close confirmation."
  },
  {
    symbol: "HDFCBANK",
    style: "Swing",
    entryZone: "₹1,790 - ₹1,812",
    entryTrigger: "Higher-low hold + close above ₹1,812",
    stopLossPrice: "₹1,750",
    setup: "Higher-low continuation setup",
    exitPrice: "Book near ₹1,980 and ₹2,050",
    targetMinPct: 10,
    targetMaxPct: 15,
    riskReward: "1:2.2",
    stopLossPct: 3,
    convictionScore: 6,
    confidence: "Medium",
    timeframe: "3-6 weeks",
    positionSizePct: 7,
    validTill: "7 sessions",
    invalidation: "Break and close below ₹1,750",
    convictionReason: "Banking strength + structure",
    note: "Avoid entries against index weakness."
  },
  {
    symbol: "TATASTEEL",
    style: "Swing",
    entryZone: "₹186 - ₹190",
    entryTrigger: "Momentum candle close above ₹190",
    stopLossPrice: "₹178",
    setup: "Momentum expansion after base",
    exitPrice: "Scale out at ₹208 and ₹225",
    targetMinPct: 12,
    targetMaxPct: 20,
    riskReward: "1:2.0",
    stopLossPct: 5,
    convictionScore: 5,
    confidence: "Low",
    timeframe: "2-4 weeks",
    positionSizePct: 5,
    validTill: "4 sessions",
    invalidation: "Daily close below ₹178",
    convictionReason: "High beta momentum",
    note: "Higher beta; size smaller."
  },
  {
    symbol: "ICICIBANK",
    style: "Intraday",
    entryZone: "₹1,265 - ₹1,272",
    entryTrigger: "Opening range breakout",
    stopLossPrice: "₹1,249",
    setup: "Opening range breakout",
    exitPrice: "Exit near ₹1,360 or by EOD",
    targetMinPct: 10,
    targetMaxPct: 12,
    riskReward: "1:1.8",
    stopLossPct: 1.8,
    convictionScore: 4,
    confidence: "Low",
    timeframe: "Same day",
    positionSizePct: 4,
    validTill: "Today only",
    invalidation: "Break below OR low",
    convictionReason: "Momentum dependent setup",
    note: "Aggressive; use strict stop-loss."
  },
  {
    symbol: "SBIN",
    style: "Intraday",
    entryZone: "₹902 - ₹910",
    entryTrigger: "VWAP reclaim + higher high",
    stopLossPrice: "₹892",
    setup: "VWAP reclaim + trend continuation",
    exitPrice: "Exit near ₹1,000 or trailing VWAP",
    targetMinPct: 10,
    targetMaxPct: 14,
    riskReward: "1:2.0",
    stopLossPct: 2,
    convictionScore: 5,
    confidence: "Low",
    timeframe: "Same day",
    positionSizePct: 4,
    validTill: "Today only",
    invalidation: "Loss of VWAP with volume",
    convictionReason: "Bank index breadth confirmation",
    note: "Only with strong bank index breadth."
  },
  {
    symbol: "LT",
    style: "Swing",
    entryZone: "₹3,880 - ₹3,940",
    entryTrigger: "Pullback hold + reversal candle",
    stopLossPrice: "₹3,760",
    setup: "Trend pullback into support",
    exitPrice: "Book near ₹4,320 and ₹4,520",
    targetMinPct: 10,
    targetMaxPct: 16,
    riskReward: "1:2.5",
    stopLossPct: 3.5,
    convictionScore: 7,
    confidence: "Medium",
    timeframe: "3-5 weeks",
    positionSizePct: 7,
    validTill: "6 sessions",
    invalidation: "Close below ₹3,760",
    convictionReason: "Trend + support confluence",
    note: "Enter in 2 tranches."
  }
];

export async function GET() {
  const day = new Date().getUTCDate();
  const rotated = [...IDEAS.slice(day % IDEAS.length), ...IDEAS.slice(0, day % IDEAS.length)];
  return NextResponse.json({
    items: rotated.slice(0, 5),
    disclaimer:
      "Educational watchlist only. No return is guaranteed. Use your own risk management."
  });
}
