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

type CandlePoint = {
  close: number;
  high: number;
  low: number;
  volume: number;
};

const UNIVERSE = [
  "RELIANCE.NS",
  "HDFCBANK.NS",
  "ICICIBANK.NS",
  "SBIN.NS",
  "LT.NS",
  "TATASTEEL.NS",
  "INFY.NS",
  "TCS.NS",
  "AXISBANK.NS",
  "BAJFINANCE.NS",
  "MARUTI.NS",
  "HINDUNILVR.NS"
];

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / period;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atr(points: CandlePoint[], period = 14) {
  if (points.length <= period) return null;
  const trs: number[] = [];
  for (let index = points.length - period; index < points.length; index += 1) {
    const current = points[index];
    const prevClose = points[index - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    trs.push(tr);
  }
  const sum = trs.reduce((acc, value) => acc + value, 0);
  return sum / trs.length;
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

async function fetchCandles(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=6mo`;
  const response = await fetch(url, {
    next: { revalidate: 1800 },
    headers: { "user-agent": "Mozilla/5.0 TradeJournal/1.0" }
  });
  if (!response.ok) throw new Error(`${ticker} fetch failed`);
  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const quote = payload.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes = quote?.close ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const volumes = quote?.volume ?? [];

  const points: CandlePoint[] = [];
  for (let index = 0; index < closes.length; index += 1) {
    const close = closes[index];
    const high = highs[index];
    const low = lows[index];
    const volume = volumes[index];
    if (
      typeof close === "number" &&
      typeof high === "number" &&
      typeof low === "number" &&
      typeof volume === "number"
    ) {
      points.push({ close, high, low, volume });
    }
  }
  return points;
}

function buildSuggestion(ticker: string, points: CandlePoint[]): Suggestion | null {
  if (points.length < 60) return null;
  const symbol = ticker.replace(".NS", "");
  const closes = points.map((point) => point.close);
  const volumes = points.map((point) => point.volume);
  const last = points[points.length - 1];
  const close = last.close;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(points, 14);
  if (sma20 === null || sma50 === null || rsi14 === null || atr14 === null) {
    return null;
  }

  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avgVolume20 > 0 ? last.volume / avgVolume20 : 1;
  const recentHigh20 = Math.max(...closes.slice(-20));
  const breakoutStrength = close / recentHigh20;

  const trendStrong = close > sma20 && sma20 > sma50;
  const momentumHealthy = rsi14 >= 52 && rsi14 <= 74;
  const volumeSupport = volumeRatio >= 1.1;
  const nearBreakout = breakoutStrength >= 0.98;

  let score = 0;
  if (trendStrong) score += 3;
  if (momentumHealthy) score += 2;
  if (volumeSupport) score += 2;
  if (nearBreakout) score += 2;
  if (close > closes[closes.length - 2]) score += 1;

  if (score < 5) return null;

  const style: "Intraday" | "Swing" = score >= 7 ? "Swing" : "Intraday";
  const stopLoss = close - atr14 * (style === "Swing" ? 1.6 : 1.1);
  const riskPct = ((close - stopLoss) / close) * 100;
  const targetMinPct = style === "Swing" ? 10 : 10;
  const targetMaxPct = style === "Swing" ? Math.min(25, 10 + score * 2) : 12;
  const targetPrice = close * (1 + targetMaxPct / 100);
  const rr = (targetPrice - close) / Math.max(close - stopLoss, 1);
  const convictionScore = Math.min(10, Math.max(4, score + (style === "Swing" ? 1 : 0)));
  const confidence: "Low" | "Medium" | "High" =
    convictionScore >= 8 ? "High" : convictionScore >= 6 ? "Medium" : "Low";

  return {
    symbol,
    style,
    entryZone: `${money(close * 0.995)} - ${money(close * 1.005)}`,
    entryTrigger:
      style === "Swing"
        ? "Daily close above breakout level with volume"
        : "Opening range breakout with trend support",
    stopLossPrice: money(stopLoss),
    setup:
      style === "Swing"
        ? "Trend continuation + breakout strength"
        : "Intraday momentum continuation",
    exitPrice: money(targetPrice),
    targetMinPct,
    targetMaxPct,
    riskReward: `1:${round(rr, 2)}`,
    stopLossPct: round(Math.max(1, riskPct), 2),
    convictionScore,
    confidence,
    timeframe: style === "Swing" ? "2-5 weeks" : "Same day",
    positionSizePct: style === "Swing" ? 6 : 3,
    validTill: style === "Swing" ? "Next 3 sessions" : "Today session",
    invalidation: `Close below ${money(stopLoss)}`,
    convictionReason: `Trend ${close > sma20 ? "above" : "below"} 20DMA, RSI ${round(rsi14, 1)}, volume ${round(volumeRatio, 2)}x`,
    note:
      "Model-based idea from public price/volume data. Use your own risk controls."
  };
}

export async function GET() {
  try {
    const results = await Promise.allSettled(
      UNIVERSE.map(async (ticker) => {
        const points = await fetchCandles(ticker);
        return buildSuggestion(ticker, points);
      })
    );

    const ideas = results
      .filter(
        (result): result is PromiseFulfilledResult<Suggestion | null> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value)
      .filter((item): item is Suggestion => Boolean(item))
      .sort((a, b) => b.convictionScore - a.convictionScore)
      .slice(0, 8);

    return NextResponse.json({
      items: ideas,
      disclaimer:
        "Signal model uses daily price/volume structure (trend, RSI, volume, breakout). Educational only, not investment advice."
    });
  } catch {
    return NextResponse.json(
      {
        items: [],
        disclaimer:
          "Could not fetch live opportunities right now. Try refresh in a minute."
      },
      { status: 200 }
    );
  }
}

