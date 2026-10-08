"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { compressToEncodedURIComponent } from "lz-string";
import { trades as seedTrades, type Trade } from "../data/trades";
import {
  breakdownByDay,
  breakdownByMonth,
  breakdownByWeek,
  computeSummary,
  dayOfWeekStats,
  deriveTrades,
  groupStats,
  winRateByMonth
} from "../data/analytics";
import { BarList, DonutChart, Sparkline } from "../components/Charts";
import TradeJournal from "./TradeJournal";
import BrokerConnections from "./BrokerConnections";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

const STORAGE_KEY = "pulsejournal_trades_v2";
const THEME_KEY = "pulsejournal_theme";
const CURRENCY_KEY = "pulsejournal_currency";
const INSTRUMENTS_KEY = "pulsejournal_instruments";
const STRATEGIES_KEY = "pulsejournal_strategies";
const PROFILE_KEY = "pulsejournal_profile";
const PARTICIPANTS_KEY = "pulsejournal_participants";
const JOURNAL_DAILY_INPUTS_KEY = "pulsejournal_daily_inputs";
const MARKET_SNAPSHOT_KEY = "pulsejournal_market_snapshot";
const SHARE_LINK_IDS_KEY = "pulsejournal_share_link_ids";
const ACCOUNTS_KEY = "pulsejournal_accounts";
const PENDING_ACCOUNT_SETUP_KEY = "pulsejournal_pending_account_setup";
const CSV_HEADERS = [
  "Trade ID",
  "Date",
  "Day",
  "Instrument",
  "Market",
  "Entry Time",
  "Exit Time",
  "Strategy",
  "Direction",
  "Size (Qty.)",
  "Entry Price",
  "Exit Price",
  "Stop Loss",
  "Target Price",
  "Risk",
  "Reward",
  "Risk-Reward",
  "P/L",
  "Win/Loss",
  "Exit Reason",
  "Platform",
  "R:R",
  "Trade Duration",
  "Total Investment",
  "Trade Type",
  "Trigger Emotion",
  "Behavioral State",
  "Mindset Notes",
  "Learning",
  "Entry Reason",
  "Chart Link",
  "PnL Screenshot Link"
];

const REQUIRED_HEADERS = [
  "Trade ID",
  "Date",
  "Instrument",
  "Market",
  "Entry Time",
  "Exit Time",
  "Strategy",
  "Direction",
  "Size (Qty.)",
  "Entry Price",
  "Exit Price",
  "Stop Loss",
  "Target Price",
  "Exit Reason",
  "Platform"
];

type StrategyDefinition = {
  id: string;
  name: string;
  rules: string;
};

type InstrumentDefinition = {
  id: string;
  name: string;
  lotSize: number;
};

type TradingAccount = {
  id: string;
  name: string;
  baseCapital: number;
  dailyTradeLimit: number;
  isDefault: boolean;
};

type PendingAccountSetup = {
  email?: string;
  accountName: string;
  baseCapital: number;
};

const DEFAULT_INSTRUMENTS: InstrumentDefinition[] = [
  { id: "inst-nifty", name: "Nifty", lotSize: 1 },
  { id: "inst-bnifty", name: "B.Nifty", lotSize: 1 },
  { id: "inst-sensex", name: "Sensex", lotSize: 1 }
];

const DEFAULT_DAILY_TRADE_LIMIT = 3;

const DEFAULT_LOCAL_ACCOUNT: TradingAccount = {
  id: "acct-primary",
  name: "Primary Account",
  baseCapital: 0,
  dailyTradeLimit: DEFAULT_DAILY_TRADE_LIMIT,
  isDefault: true
};

type DashboardView =
  | "overview"
  | "performance"
  | "strategy"
  | "day"
  | "behavior"
  | "ai"
  | "news"
  | "opportunities"
  | "setup"
  | "instruments"
  | "participants"
  | "brokers"
  | "journal"
  | "profile"
  | "algo"
  | "setup-edit";

type DashboardSection = "overview";
type DashboardNavId = DashboardView | "setups";

type ParticipantType = "FII" | "DII" | "Client" | "Pro";
type ParticipantFlow = {
  id: string;
  date: string;
  participant: ParticipantType;
  futureBoughtQty: number;
  futureSoldQty: number;
  callBoughtQty: number;
  putBoughtQty: number;
  callSoldQty: number;
  putSoldQty: number;
};

type ParticipantActivityRow = {
  participant: ParticipantType;
  label: string;
  instrument: "Future" | "CE" | "PE";
  change: number;
  activity: string;
  trend: "Bullish" | "Bearish" | "Neutral";
  score: number;
};

type MarketNewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  image?: string;
  impact: "High" | "Medium";
};

type StockSuggestionItem = {
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

type MarketSnapshotRow = {
  label: string;
  previous: number | null;
  current: number | null;
  diffPct: number | null;
};

type JournalDailyInput = {
  sentimentToday: string;
  viewOutcome: string;
  previousDayMarket: string;
  observations: string;
  notes: string;
  motivationQuote?: string;
};

const DEFAULT_MARKET_SNAPSHOT_ROWS: MarketSnapshotRow[] = [
  { label: "DXY", previous: null, current: null, diffPct: null },
  { label: "INDIA VIX", previous: null, current: null, diffPct: null },
  { label: "DJI", previous: null, current: null, diffPct: null },
  { label: "NASDAQ", previous: null, current: null, diffPct: null },
  { label: "GOLD", previous: null, current: null, diffPct: null },
  { label: "BITCOIN", previous: null, current: null, diffPct: null }
];

function normalizeSnapshotRows(input: unknown): MarketSnapshotRow[] {
  const rows = Array.isArray(input) ? input : [];
  const byLabel = new Map<string, MarketSnapshotRow>();
  rows.forEach((item) => {
    const row = item as Partial<MarketSnapshotRow>;
    const label = String(row.label ?? "").trim();
    if (!label) return;
    const previous =
      typeof row.previous === "number" && Number.isFinite(row.previous)
        ? row.previous
        : null;
    const current =
      typeof row.current === "number" && Number.isFinite(row.current)
        ? row.current
        : null;
    const diffPct =
      current !== null && previous !== null && previous !== 0
        ? ((current - previous) / previous) * 100
        : null;
    byLabel.set(label, { label, previous, current, diffPct });
  });

  return DEFAULT_MARKET_SNAPSHOT_ROWS.map((base) => {
    const found = byLabel.get(base.label);
    return found ?? { ...base };
  });
}

const EMPTY_JOURNAL_DAILY_INPUT: JournalDailyInput = {
  sentimentToday: "",
  viewOutcome: "",
  previousDayMarket: "",
  observations: "",
  notes: "",
  motivationQuote: ""
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

const EMOTION_NEGATIVE = new Set([
  "fomo",
  "fear",
  "fearful",
  "anxious",
  "frustrated",
  "hesitant"
]);
const EMOTION_POSITIVE = new Set(["calm", "focused", "confident"]);
const STATE_DISCIPLINED = new Set(["disciplined", "patient", "neutral"]);
const STATE_IMPULSIVE = new Set(["impulsive", "distracted", "fatigued"]);

function classifyAlignment(emotionTag?: string, emotionalState?: string) {
  const emotion = emotionTag?.trim().toLowerCase() ?? "";
  const state = emotionalState?.trim().toLowerCase() ?? "";
  if (!emotion || !state) return "Unspecified";

  const isNegative = EMOTION_NEGATIVE.has(emotion);
  const isPositive = EMOTION_POSITIVE.has(emotion);
  const isDisciplined = STATE_DISCIPLINED.has(state);
  const isImpulsive = STATE_IMPULSIVE.has(state);

  if (isNegative && isDisciplined) return "Process-driven";
  if (isNegative && isImpulsive) return "Emotion-driven";
  if (isPositive && isDisciplined) return "Aligned";
  if (isPositive && isImpulsive) return "Emotion-driven";
  if (isDisciplined) return "Aligned";
  if (isImpulsive) return "Emotion-driven";
  return "Unspecified";
}

function getDateRange(trades: Trade[]) {
  if (trades.length === 0) return "No trades yet";
  const dates = trades.map((trade) => trade.date).sort();
  return `${dates[0]} - ${dates[dates.length - 1]}`;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeInstrumentName(value: string) {
  return value.trim();
}

function getRecentTradingDates(count: number) {
  const dates: string[] = [];
  const cursor = new Date();
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

function isWeekdayDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const day = parsed.getDay();
  return day !== 0 && day !== 6;
}

function buildParticipantActivityRows(
  flows: ParticipantFlow[],
  date: string
): ParticipantActivityRow[] {
  const source = flows.filter((item) => item.date === date);
  const groupedToday = new Map<
    ParticipantType,
    {
      futureBuy: number;
      futureSold: number;
      callBuy: number;
      callSold: number;
      putBuy: number;
      putSold: number;
    }
  >();

  source.forEach((item) => {
    const current = groupedToday.get(item.participant) ?? {
      futureBuy: 0,
      futureSold: 0,
      callBuy: 0,
      callSold: 0,
      putBuy: 0,
      putSold: 0
    };
    current.futureBuy += item.futureBoughtQty;
    current.futureSold += item.futureSoldQty;
    current.callBuy += item.callBoughtQty;
    current.callSold += item.callSoldQty;
    current.putBuy += item.putBoughtQty;
    current.putSold += item.putSoldQty;
    groupedToday.set(item.participant, current);
  });

  const order: ParticipantType[] = ["FII", "Pro", "DII", "Client"];
  const rows: ParticipantActivityRow[] = [];

  const evaluate = (
    participant: ParticipantType,
    label: string,
    instrument: "Future" | "CE" | "PE",
    bought: number,
    sold: number
  ) => {
    const change = bought - sold;
    if (change === 0) {
      return {
        participant,
        label,
        instrument,
        change,
        activity: "No change",
        trend: "Neutral" as const,
        score: 0
      };
    }
    if (instrument === "Future") {
      return change > 0
        ? {
            participant,
            label,
            instrument,
            change,
            activity: "Bought Futures",
            trend: "Bullish" as const,
            score: 1
          }
        : {
            participant,
            label,
            instrument,
            change,
            activity: "Sold Futures",
            trend: "Bearish" as const,
            score: -1
          };
    }
    if (instrument === "CE") {
      return change > 0
        ? {
            participant,
            label,
            instrument,
            change,
            activity: "Bought Calls",
            trend: "Bullish" as const,
            score: 1
          }
        : {
            participant,
            label,
            instrument,
            change,
            activity: "Sold Calls",
            trend: "Bearish" as const,
            score: -1
          };
    }
    return change > 0
      ? {
          participant,
          label,
          instrument,
          change,
          activity: "Bought Puts",
          trend: "Bearish" as const,
          score: -1
        }
      : {
          participant,
          label,
          instrument,
          change,
          activity: "Sold Puts",
          trend: "Bullish" as const,
          score: 1
        };
  };

  order.forEach((participant) => {
    const data = groupedToday.get(participant) ?? {
      futureBuy: 0,
      futureSold: 0,
      callBuy: 0,
      callSold: 0,
      putBuy: 0,
      putSold: 0
    };
    const label = participant === "Client" ? "RETAIL" : participant;
    rows.push(
      evaluate(participant, label, "Future", data.futureBuy, data.futureSold)
    );
    rows.push(evaluate(participant, label, "CE", data.callBuy, data.callSold));
    rows.push(evaluate(participant, label, "PE", data.putBuy, data.putSold));
  });

  return rows;
}

function buildInstrumentId(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `INST-${slug}-${Date.now()}`;
}

function buildAccountId(name: string) {
  const slug = normalizeAccountName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "account";
  return `ACCT-${slug}-${Date.now()}`;
}

function normalizeAccountName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDailyTradeLimit(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DAILY_TRADE_LIMIT;
}

function normalizeAccountList(data: unknown): TradingAccount[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const normalized: TradingAccount[] = [];

  data.forEach((item, index) => {
    if (typeof item !== "object" || !item) return;
    const record = item as Partial<TradingAccount>;
    const name = normalizeAccountName(String(record.name ?? "")) || `Account ${index + 1}`;
    const id = String(record.id ?? buildAccountId(name));
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push({
      id,
      name,
      baseCapital: Math.max(0, Number(record.baseCapital ?? 0) || 0),
      dailyTradeLimit: normalizeDailyTradeLimit(record.dailyTradeLimit),
      isDefault: Boolean(record.isDefault)
    });
  });

  if (!normalized.length) return [];
  const defaultIndex = normalized.findIndex((account) => account.isDefault);
  return normalized.map((account, index) => ({
    ...account,
    isDefault: defaultIndex >= 0 ? index === defaultIndex : index === 0
  }));
}

function normalizeInstrumentList(data: unknown): InstrumentDefinition[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (typeof item === "string") {
        const name = normalizeInstrumentName(item);
        if (!name) return null;
        return { id: buildInstrumentId(name), name, lotSize: 1 };
      }
      if (typeof item === "object" && item) {
        const record = item as { id?: string; name?: string; lotSize?: number };
        const name = normalizeInstrumentName(String(record.name ?? ""));
        if (!name) return null;
        const lotSize =
          typeof record.lotSize === "number" && Number.isFinite(record.lotSize)
            ? record.lotSize
            : 1;
        return {
          id: record.id ?? buildInstrumentId(name),
          name,
          lotSize
        };
      }
      return null;
    })
    .filter((item): item is InstrumentDefinition => Boolean(item));
}

function mergeInstrumentDefaults(
  list: InstrumentDefinition[]
): InstrumentDefinition[] {
  const map = new Map<string, InstrumentDefinition>();
  list.forEach((item) => {
    map.set(item.name.toLowerCase(), item);
  });

  const merged = DEFAULT_INSTRUMENTS.map((def) => {
    const existing = map.get(def.name.toLowerCase());
    if (!existing) return def;
    map.delete(def.name.toLowerCase());
    return {
      id: existing.id ?? def.id,
      name: existing.name,
      lotSize:
        Number.isFinite(existing.lotSize) && existing.lotSize > 0
          ? existing.lotSize
          : def.lotSize
    };
  });

  map.forEach((item) => {
    merged.push(item);
  });

  return merged;
}

function toCsvValue(value: string | number | null) {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(":");
  if (parts.length < 2) return "";
  const hours = parts[0].padStart(2, "0");
  const minutes = parts[1].padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|data:|blob:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const PNL_SS_PREFIX = "[PNL_SS]";
const LEARNING_PREFIX = "[LEARNING]";
const TRADE_MEDIA_BUCKET = "trade-media";

function mergeRemarksAndPnl(remarks?: string, pnlScreenshotUrl?: string) {
  const base = (remarks ?? "").trim();
  const pnl = (pnlScreenshotUrl ?? "").trim();
  if (!pnl) return base;
  return base ? `${base}
${PNL_SS_PREFIX}${pnl}` : `${PNL_SS_PREFIX}${pnl}`;
}

function mergeMindsetAndLearning(mindsetNotes?: string, learning?: string) {
  const notes = (mindsetNotes ?? "").trim();
  const lesson = (learning ?? "").trim();
  if (!lesson) return notes;
  const encoded = `${LEARNING_PREFIX}${encodeURIComponent(lesson)}`;
  return notes ? `${notes}\n${encoded}` : encoded;
}

function splitMindsetAndLearning(raw?: string | null) {
  const lines = (raw ?? "").replace(/\r/g, "").split("\n");
  const notes: string[] = [];
  let learning: string | undefined;
  lines.forEach((line) => {
    if (line.startsWith(LEARNING_PREFIX)) {
      try {
        learning = decodeURIComponent(line.slice(LEARNING_PREFIX.length)) || undefined;
      } catch {
        learning = line.slice(LEARNING_PREFIX.length).trim() || undefined;
      }
    } else if (line.trim()) {
      notes.push(line);
    }
  });
  return { mindsetNotes: notes.join("\n").trim() || undefined, learning };
}

function splitRemarksAndPnl(raw?: string | null) {
  const value = (raw ?? "").trim();
  if (!value) {
    return {
      remarks: undefined as string | undefined,
      pnlScreenshotUrl: undefined as string | undefined
    };
  }

  const lines = value.replace(/\r/g, "").split("\n");
  const remaining: string[] = [];
  let pnlScreenshotUrl: string | undefined;

  for (const line of lines) {
    if (line.startsWith(PNL_SS_PREFIX)) {
      const parsed = normalizeUrl(line.slice(PNL_SS_PREFIX.length));
      pnlScreenshotUrl = parsed || undefined;
    } else {
      remaining.push(line);
    }
  }

  const remarks = remaining.join("\n").trim() || undefined;
  return { remarks, pnlScreenshotUrl };
}

function createTradeId() {
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `T-${timePart}${randomPart}`;
}

function parseNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function toSupabaseRow(trade: Trade, userId: string) {
  const remarksWithPnl = mergeRemarksAndPnl(trade.remarks, trade.pnlScreenshotUrl);
  return {
    user_id: userId,
    trade_id: trade.tradeId,
    account_id: trade.accountId ?? null,
    date: trade.date,
    instrument: trade.instrument,
    market: trade.market,
    entry_time: trade.entryTime,
    exit_time: trade.exitTime,
    strategy: trade.strategy,
    direction: trade.direction,
    size_qty: trade.sizeQty,
    lots: trade.lots ?? null,
    lot_size: trade.lotSize ?? null,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    stop_loss: trade.stopLoss,
    target_price: trade.targetPrice,
    exit_reason: trade.exitReason,
    platform: trade.platform,
    chart_url: trade.chartUrl ?? null,
    remarks: remarksWithPnl || null,
    emotion_tag: trade.emotionTag ?? null,
    emotional_state: trade.emotionalState ?? null,
    mindset_notes: mergeMindsetAndLearning(trade.mindsetNotes, trade.learning) || null,
    trade_type: trade.tradeType ?? null
  };
}

function withValidAccountId(trade: Trade, accounts: TradingAccount[]) {
  if (!trade.accountId) return trade;
  if (accounts.some((account) => account.id === trade.accountId)) return trade;
  return { ...trade, accountId: undefined };
}

function fromSupabaseRow(row: Record<string, string | number | null>): Trade {
  const timeValue = (value: string | null) =>
    value ? value.slice(0, 5) : "00:00";
  const sizeQty = Number(row.size_qty ?? 0);
  const parsedRemarks = splitRemarksAndPnl(
    row.remarks ? String(row.remarks) : undefined
  );
  const parsedMindset = splitMindsetAndLearning(
    row.mindset_notes ? String(row.mindset_notes) : undefined
  );
  const lotsValue = row.lots === null ? undefined : Number(row.lots);
  const lotSizeValue = row.lot_size === null ? undefined : Number(row.lot_size);
  return {
    tradeId: String(row.trade_id ?? ""),
    date: String(row.date ?? ""),
    accountId: row.account_id ? String(row.account_id) : undefined,
    instrument: String(row.instrument ?? ""),
    market: String(row.market ?? "Equity"),
    entryTime: timeValue(row.entry_time ? String(row.entry_time) : null),
    exitTime: timeValue(row.exit_time ? String(row.exit_time) : null),
    strategy: String(row.strategy ?? "Unspecified"),
    direction: row.direction === "Short" ? "Short" : "Long",
    sizeQty,
    lots: Number.isFinite(lotsValue as number) ? (lotsValue as number) : undefined,
    lotSize: Number.isFinite(lotSizeValue as number)
      ? (lotSizeValue as number)
      : undefined,
    entryPrice: Number(row.entry_price ?? 0),
    exitPrice: Number(row.exit_price ?? 0),
    stopLoss: Number(row.stop_loss ?? 0),
    targetPrice: Number(row.target_price ?? 0),
    exitReason: String(row.exit_reason ?? "Manual"),
    platform: String(row.platform ?? "Web"),
    chartUrl: row.chart_url ? String(row.chart_url) : undefined,
    remarks: parsedRemarks.remarks,
    pnlScreenshotUrl: parsedRemarks.pnlScreenshotUrl,
    emotionTag: row.emotion_tag ? String(row.emotion_tag) : undefined,
    emotionalState: row.emotional_state
      ? String(row.emotional_state)
      : undefined,
    mindsetNotes: parsedMindset.mindsetNotes,
    learning: parsedMindset.learning,
    tradeType:
      row.trade_type === "Safe" || row.trade_type === "Risky"
        ? row.trade_type
        : undefined
  };
}

function toJournalDailySupabaseRow(
  userId: string,
  date: string,
  input: JournalDailyInput,
  snapshot: MarketSnapshotRow[]
) {
  return {
    user_id: userId,
    entry_date: date,
    sentiment_today: input.sentimentToday || null,
    view_outcome: input.viewOutcome || null,
    previous_day_market: input.previousDayMarket || null,
    observations: input.observations || null,
    notes: input.notes || null,
    motivation_quote: input.motivationQuote || null,
    market_snapshot: snapshot
  };
}

function toTradingAccountRow(userId: string, account: TradingAccount) {
  return {
    id: account.id,
    user_id: userId,
    name: account.name,
    base_capital: account.baseCapital,
    daily_trade_limit: account.dailyTradeLimit,
    is_default: account.isDefault
  };
}

function fromTradingAccountRows(rows: Record<string, unknown>[]) {
  return normalizeAccountList(
    rows.map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Primary Account"),
      baseCapital: Number(row.base_capital ?? 0),
      dailyTradeLimit: normalizeDailyTradeLimit(row.daily_trade_limit),
      isDefault: Boolean(row.is_default)
    }))
  );
}

function readPendingAccountSetup(currentEmail?: string | null) {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(PENDING_ACCOUNT_SETUP_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingAccountSetup;
    const normalizedPendingEmail = String(parsed.email ?? "").trim().toLowerCase();
    const normalizedCurrentEmail = String(currentEmail ?? "").trim().toLowerCase();
    if (!normalizedPendingEmail || !normalizedCurrentEmail || normalizedPendingEmail !== normalizedCurrentEmail) {
      return null;
    }
    return {
      email: parsed.email,
      accountName: normalizeAccountName(parsed.accountName || "Primary Account") || "Primary Account",
      baseCapital: Math.max(0, Number(parsed.baseCapital ?? 0) || 0)
    } as PendingAccountSetup;
  } catch {
    return null;
  }
}

function fromJournalDailySupabaseRows(rows: Record<string, unknown>[]) {
  const inputs: Record<string, JournalDailyInput> = {};
  const snapshots: Record<string, MarketSnapshotRow[]> = {};

  rows.forEach((row) => {
    const date = String(row.entry_date ?? "").slice(0, 10);
    if (!date) return;

    inputs[date] = {
      sentimentToday: String(row.sentiment_today ?? ""),
      viewOutcome: String(row.view_outcome ?? ""),
      previousDayMarket: String(row.previous_day_market ?? ""),
      observations: String(row.observations ?? ""),
      notes: String(row.notes ?? ""),
      motivationQuote: String(row.motivation_quote ?? "")
    };

    snapshots[date] = normalizeSnapshotRows(row.market_snapshot);
  });

  return { inputs, snapshots };
}

function buildCsv(derivedTrades: ReturnType<typeof deriveTrades>) {
  const header = CSV_HEADERS.join(",");
  const rows = derivedTrades.map((trade) =>
    buildExportRow(trade)
      .map((value) => toCsvValue(value))
      .join(",")
  );

  return [header, ...rows].join("\n");
}

function buildTemplateCsv() {
  return CSV_HEADERS.join(",");
}

function buildExportRow(trade: ReturnType<typeof deriveTrades>[number]) {
  return [
    trade.tradeId,
    trade.date,
    trade.day,
    trade.instrument,
    trade.market,
    trade.entryTime,
    trade.exitTime,
    trade.strategy,
    trade.direction,
    trade.sizeQty,
    trade.entryPrice,
    trade.exitPrice,
    trade.stopLoss,
    trade.targetPrice,
    trade.risk.toFixed(2),
    trade.reward.toFixed(2),
    trade.riskReward ? trade.riskReward.toFixed(2) : "",
    trade.pl.toFixed(2),
    trade.winLoss,
    trade.exitReason,
    trade.platform,
    trade.rr ? trade.rr.toFixed(2) : "",
    trade.tradeDuration,
    trade.totalInvestment.toFixed(2),
    trade.tradeType ?? "",
    trade.emotionTag ?? "",
    trade.emotionalState ?? "",
    trade.mindsetNotes ?? "",
    trade.learning ?? "",
    trade.remarks ?? "",
    trade.chartUrl ?? "",
    trade.pnlScreenshotUrl ?? ""
  ];
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildDateWiseExcelXml(derivedTrades: ReturnType<typeof deriveTrades>) {
  const columnConfigs = [
    { header: "Trade ID", width: 95, kind: "text" },
    { header: "Date", width: 78, kind: "text" },
    { header: "Day", width: 55, kind: "text" },
    { header: "Instrument", width: 85, kind: "text" },
    { header: "Market", width: 70, kind: "text" },
    { header: "Entry Time", width: 70, kind: "text" },
    { header: "Exit Time", width: 70, kind: "text" },
    { header: "Strategy", width: 110, kind: "text" },
    { header: "Direction", width: 70, kind: "text" },
    { header: "Size (Qty.)", width: 72, kind: "number" },
    { header: "Entry Price", width: 82, kind: "number" },
    { header: "Exit Price", width: 82, kind: "number" },
    { header: "Stop Loss", width: 78, kind: "number" },
    { header: "Target Price", width: 82, kind: "number" },
    { header: "Risk", width: 72, kind: "number" },
    { header: "Reward", width: 72, kind: "number" },
    { header: "Risk-Reward", width: 84, kind: "number" },
    { header: "P/L", width: 82, kind: "number" },
    { header: "Win/Loss", width: 68, kind: "text" },
    { header: "Exit Reason", width: 100, kind: "text" },
    { header: "Platform", width: 82, kind: "text" },
    { header: "R:R", width: 60, kind: "number" },
    { header: "Trade Duration", width: 92, kind: "number" },
    { header: "Total Investment", width: 105, kind: "number" },
    { header: "Trade Type", width: 78, kind: "text" },
    { header: "Trigger Emotion", width: 95, kind: "text" },
    { header: "Behavioral State", width: 102, kind: "text" },
    { header: "Mindset Notes", width: 150, kind: "text" },
    { header: "Entry Reason", width: 170, kind: "text" },
    { header: "Chart Link", width: 110, kind: "link" },
    { header: "PnL Screenshot Link", width: 130, kind: "link" }
  ] as const;

  const grouped = derivedTrades.reduce((map, trade) => {
    const current = map.get(trade.date) ?? [];
    current.push(trade);
    map.set(trade.date, current);
    return map;
  }, new Map<string, ReturnType<typeof deriveTrades>>());

  const sortedEntries = Array.from(grouped.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const monthlyTotalPl = derivedTrades.reduce((sum, trade) => sum + trade.pl, 0);
  const monthlyWins = derivedTrades.filter((trade) => trade.pl > 0).length;
  const monthlyLosses = derivedTrades.filter((trade) => trade.pl < 0).length;
  const monthlyWinRate = derivedTrades.length
    ? ((monthlyWins / derivedTrades.length) * 100).toFixed(2)
    : "0.00";

  const makeCell = (
    value: string | number,
    kind: "text" | "number" | "link" = "text",
    styleId?: string
  ) => {
    const style = styleId ? ` ss:StyleID="${styleId}"` : "";
    if (kind === "number" && value !== "") {
      return `<Cell${style}><Data ss:Type="Number">${value}</Data></Cell>`;
    }
    if (kind === "link") {
      const href = String(value ?? "").trim();
      if (!href) return `<Cell${style}><Data ss:Type="String"></Data></Cell>`;
      return `<Cell${style} ss:HRef="${escapeXml(href)}"><Data ss:Type="String">Open Link</Data></Cell>`;
    }
    return `<Cell${style}><Data ss:Type="String">${escapeXml(String(value ?? ""))}</Data></Cell>`;
  };

  const summaryRows = sortedEntries
    .map(([date, trades]) => {
      const totalPl = trades.reduce((sum, trade) => sum + trade.pl, 0);
      const wins = trades.filter((trade) => trade.pl > 0).length;
      const losses = trades.filter((trade) => trade.pl < 0).length;
      const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(2) : "0.00";
      return `
        <Row>
          ${makeCell(date)}
          ${makeCell(trades.length, "number")}
          ${makeCell(wins, "number")}
          ${makeCell(losses, "number")}
          ${makeCell(winRate, "number")}
          ${makeCell(totalPl.toFixed(2), "number", totalPl >= 0 ? "positive" : "negative")}
        </Row>`;
    })
    .join("");

  const worksheets = sortedEntries
    .map(([date, trades]) => {
      const headerRow = columnConfigs
        .map((column) => makeCell(column.header, "text", "header"))
        .join("");
      const columns = columnConfigs
        .map((column) => `<Column ss:Width="${column.width}"/>`)
        .join("");

      const rows = trades
        .map((trade) => {
          const cells = buildExportRow(trade)
            .map((value, index) => {
              const column = columnConfigs[index];
              const styleId =
                column.header === "P/L"
                  ? Number(value) >= 0
                    ? "positive"
                    : "negative"
                  : undefined;
              return makeCell(
                typeof value === "number" ? value : String(value ?? ""),
                column.kind,
                styleId
              );
            })
            .join("");
          return `<Row>${cells}</Row>`;
        })
        .join("");

      const totalPl = trades.reduce((sum, trade) => sum + trade.pl, 0);
      const totalRow = `
        <Row>
          <Cell ss:MergeAcross="16" ss:StyleID="totalLabel"><Data ss:Type="String">Daily Total</Data></Cell>
          <Cell ss:StyleID="${totalPl >= 0 ? "positive" : "negative"}"><Data ss:Type="Number">${totalPl.toFixed(
            2
          )}</Data></Cell>
        </Row>`;

      return `
        <Worksheet ss:Name="${escapeXml(date)}">
          <Table>
            ${columns}
            <Row>${headerRow}</Row>
            ${rows}
            ${totalRow}
          </Table>
          <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
            <FreezePanes/>
            <FrozenNoSplit/>
            <SplitHorizontal>1</SplitHorizontal>
            <TopRowBottomPane>1</TopRowBottomPane>
          </WorksheetOptions>
        </Worksheet>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Interior ss:Color="#D9EAFE" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="positive">
      <Font ss:Color="#047857" ss:Bold="1"/>
    </Style>
    <Style ss:ID="negative">
      <Font ss:Color="#B91C1C" ss:Bold="1"/>
    </Style>
    <Style ss:ID="totalLabel">
      <Font ss:Bold="1"/>
      <Alignment ss:Horizontal="Right"/>
      <Interior ss:Color="#F3F4F6" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Monthly Summary">
    <Table>
      <Column ss:Width="100"/>
      <Column ss:Width="70"/>
      <Column ss:Width="70"/>
      <Column ss:Width="70"/>
      <Column ss:Width="80"/>
      <Column ss:Width="85"/>
      <Row>
        <Cell ss:StyleID="header"><Data ss:Type="String">Metric</Data></Cell>
        <Cell ss:MergeAcross="4" ss:StyleID="header"><Data ss:Type="String">Value</Data></Cell>
      </Row>
      <Row>
        ${makeCell("Total Trades", "text", "header")}
        <Cell ss:MergeAcross="4"><Data ss:Type="Number">${derivedTrades.length}</Data></Cell>
      </Row>
      <Row>
        ${makeCell("Wins", "text", "header")}
        <Cell ss:MergeAcross="4"><Data ss:Type="Number">${monthlyWins}</Data></Cell>
      </Row>
      <Row>
        ${makeCell("Losses", "text", "header")}
        <Cell ss:MergeAcross="4"><Data ss:Type="Number">${monthlyLosses}</Data></Cell>
      </Row>
      <Row>
        ${makeCell("Win Rate %", "text", "header")}
        <Cell ss:MergeAcross="4"><Data ss:Type="Number">${monthlyWinRate}</Data></Cell>
      </Row>
      <Row>
        ${makeCell("Net P/L", "text", "header")}
        <Cell ss:MergeAcross="4" ss:StyleID="${monthlyTotalPl >= 0 ? "positive" : "negative"}"><Data ss:Type="Number">${monthlyTotalPl.toFixed(
          2
        )}</Data></Cell>
      </Row>
      <Row/>
      <Row>
        ${makeCell("Date", "text", "header")}
        ${makeCell("Trades", "text", "header")}
        ${makeCell("Wins", "text", "header")}
        ${makeCell("Losses", "text", "header")}
        ${makeCell("Win Rate %", "text", "header")}
        ${makeCell("Net P/L", "text", "header")}
      </Row>
      ${summaryRows}
    </Table>
  </Worksheet>
  ${worksheets}
</Workbook>`;
}

function stripLargeSharedMedia(payload: {
  month: string;
  currency: "INR" | "USD";
  generatedAt: string;
  days: Array<{
    date: string;
    motivationQuote: string;
    trades: Array<{
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
      remarks: string;
      pnlScreenshotUrl: string;
    }>;
    summary: { totalTrades: number; totalPl: number; winRate: number };
    marketSnapshot: MarketSnapshotRow[];
    checklist: {
      sentimentToday: string;
      viewOutcome: string;
      previousDayMarket: string;
      observations: string;
      notes: string;
    };
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
}) {
  return {
    ...payload,
    days: payload.days.map((day) => ({
      ...day,
      trades: day.trades.map((trade) => ({
        ...trade,
        pnlScreenshotUrl: trade.pnlScreenshotUrl.startsWith("data:")
          ? ""
          : trade.pnlScreenshotUrl
      }))
    }))
  };
}

type AddTradeFormProps = {
  onAdd: (trade: Trade) => Promise<string | null> | string | null;
  onUpdate: (trade: Trade) => Promise<string | null> | string | null;
  onCancelEdit: () => void;
  editingTrade: Trade | null;
  instruments: InstrumentDefinition[];
  strategies: StrategyDefinition[];
  accounts: TradingAccount[];
  defaultAccountId?: string;
  onUploadPnlScreenshot?: (file: File) => Promise<string>;
};

function AddTradeForm({
  onAdd,
  onUpdate,
  onCancelEdit,
  editingTrade,
  instruments,
  strategies,
  accounts,
  defaultAccountId,
  onUploadPnlScreenshot
}: AddTradeFormProps) {
  const [tradeId, setTradeId] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [instrument, setInstrument] = useState("Nifty");
  const [market, setMarket] = useState("F&O");
  const [entryTime, setEntryTime] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [strategyChoice, setStrategyChoice] = useState("");
  const [direction, setDirection] = useState<Trade["direction"] | "">("");
  const [lots, setLots] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [exitReasonChoice, setExitReasonChoice] = useState("");
  const [exitReasonCustom, setExitReasonCustom] = useState("");
  const [platformChoice, setPlatformChoice] = useState("");
  const [platformCustom, setPlatformCustom] = useState("");
  const [platform, setPlatform] = useState("");
  const [chartUrl, setChartUrl] = useState("");
  const [pnlScreenshotUrl, setPnlScreenshotUrl] = useState("");
  const [remarks, setRemarks] = useState("");
  const [emotionTag, setEmotionTag] = useState("");
  const [emotionalState, setEmotionalState] = useState("");
  const [mindsetNotes, setMindsetNotes] = useState("");
  const [learning, setLearning] = useState("");
  const [tradeType, setTradeType] = useState<"Safe" | "Risky" | "">("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const isEditing = Boolean(editingTrade);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (editingTrade) {
      wasEditingRef.current = true;
      setTradeId(editingTrade.tradeId);
      setDate(editingTrade.date || new Date().toISOString().slice(0, 10));
      setAccountId(editingTrade.accountId || defaultAccountId || accounts[0]?.id || "");
      setInstrument(editingTrade.instrument || "Nifty");
      setMarket(editingTrade.market || "F&O");
      setEntryTime(editingTrade.entryTime || "");
      setExitTime(editingTrade.exitTime || "");
      setStrategyChoice(editingTrade.strategy || "");
      setDirection(editingTrade.direction || "");
      const resolvedLotSize =
        instruments.find((item) => item.name === editingTrade.instrument)
          ?.lotSize ??
        editingTrade.lotSize ??
        1;
      const derivedLots =
        editingTrade.lots ??
        (resolvedLotSize > 0
          ? editingTrade.sizeQty / resolvedLotSize
          : 1);
      setLots(String(Number.isFinite(derivedLots) ? derivedLots : 1));
      setEntryPrice(editingTrade.entryPrice?.toString() ?? "");
      setExitPrice(editingTrade.exitPrice?.toString() ?? "");
      setStopLoss(editingTrade.stopLoss?.toString() ?? "");
      setTargetPrice(editingTrade.targetPrice?.toString() ?? "");
      if (
        editingTrade.exitReason === "Trailing SL" ||
        editingTrade.exitReason === "SL" ||
        editingTrade.exitReason === "Target"
      ) {
        setExitReasonChoice(editingTrade.exitReason);
        setExitReasonCustom("");
      } else if (editingTrade.exitReason) {
        setExitReasonChoice("Custom");
        setExitReasonCustom(editingTrade.exitReason);
      } else {
        setExitReasonChoice("");
        setExitReasonCustom("");
      }
      const storedPlatform = editingTrade.platform || "";
      if (
        storedPlatform === "Backtest" ||
        storedPlatform === "Frontpage" ||
        storedPlatform === "Fyers"
      ) {
        setPlatformChoice(storedPlatform);
        setPlatformCustom("");
      } else if (storedPlatform) {
        setPlatformChoice("Custom");
        setPlatformCustom(storedPlatform);
      } else {
        setPlatformChoice("");
        setPlatformCustom("");
      }
      setPlatform(storedPlatform);
      setChartUrl(editingTrade.chartUrl || "");
      setPnlScreenshotUrl(editingTrade.pnlScreenshotUrl || "");
      setRemarks(editingTrade.remarks || "");
      setEmotionTag(editingTrade.emotionTag || "");
      setEmotionalState(editingTrade.emotionalState || "");
      setMindsetNotes(editingTrade.mindsetNotes || "");
      setLearning(editingTrade.learning || "");
      setTradeType(editingTrade.tradeType || "");
      return;
    }

    if (wasEditingRef.current) {
      wasEditingRef.current = false;
      setTradeId("");
      setDate(new Date().toISOString().slice(0, 10));
      setAccountId(defaultAccountId || accounts[0]?.id || "");
      setInstrument("Nifty");
      setMarket("F&O");
      setEntryTime("");
      setExitTime("");
      setStrategyChoice("");
      setDirection("");
      setLots("");
      setEntryPrice("");
      setExitPrice("");
      setStopLoss("");
      setTargetPrice("");
      setExitReasonChoice("");
      setExitReasonCustom("");
      setPlatform("");
      setPlatformChoice("");
      setPlatformCustom("");
      setPlatformChoice("");
      setPlatformCustom("");
      setChartUrl("");
      setPnlScreenshotUrl("");
      setRemarks("");
      setEmotionTag("");
      setEmotionalState("");
      setMindsetNotes("");
      setLearning("");
      setTradeType("");
    }
  }, [editingTrade, instruments, defaultAccountId, accounts]);

  useEffect(() => {
    if (isEditing) return;
    if (!accountId && (defaultAccountId || accounts[0]?.id)) {
      setAccountId(defaultAccountId || accounts[0]?.id || "");
    }
    if (!instrument) {
      const nifty = instruments.find(
        (item) => item.name.toLowerCase() === "nifty"
      );
      setInstrument(nifty?.name ?? instruments[0]?.name ?? "Nifty");
    }
  }, [instrument, instruments, isEditing, accountId, defaultAccountId, accounts]);

  const instrumentValue = instrument.trim();
  const selectedLotSize =
    instruments.find((item) => item.name === instrumentValue)?.lotSize ?? 0;
  const withFieldError = (field: string, base: string) =>
    `${base} ${fieldErrors[field] ? "border-negative ring-1 ring-negative" : ""}`;
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const tradeIdValue = tradeId || createTradeId();
    const exitReasonValue =
      exitReasonChoice === "Custom"
        ? exitReasonCustom.trim()
        : exitReasonChoice;
    const platformValue = "Journal";
    const chartUrlValue = normalizeUrl(chartUrl);
    const pnlScreenshotUrlValue = normalizeUrl(pnlScreenshotUrl);

    const nextFieldErrors: Record<string, string> = {};
    if (!tradeIdValue) nextFieldErrors.tradeId = "Required";
    if (!date) nextFieldErrors.date = "Required";
    if (accounts.length && !accountId) nextFieldErrors.accountId = "Required";
    if (!instrumentValue) nextFieldErrors.instrument = "Required";
    if (!market) nextFieldErrors.market = "Required";
    if (!entryTime) nextFieldErrors.entryTime = "Required";
    if (!exitTime) nextFieldErrors.exitTime = "Required";
    if (!direction) nextFieldErrors.direction = "Required";
    if (!lots) nextFieldErrors.lots = "Required";
    if (!entryPrice) nextFieldErrors.entryPrice = "Required";
    if (!exitPrice) nextFieldErrors.exitPrice = "Required";
    if (!stopLoss) nextFieldErrors.stopLoss = "Required";
    if (!targetPrice) nextFieldErrors.targetPrice = "Required";
    if (!exitReasonValue) nextFieldErrors.exitReason = "Required";
    if (!tradeType) nextFieldErrors.tradeType = "Required";

    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Please fill all required fields.");
      return;
    }
    setFieldErrors({});

    const lotsValue = Number(lots);
    const qtyValue = lotsValue * selectedLotSize;
    const entryValue = Number(entryPrice);
    const exitValue = Number(exitPrice);
    const stopValue = Number(stopLoss);
    const targetValue = Number(targetPrice);

    if (
      !Number.isFinite(lotsValue) ||
      !Number.isFinite(qtyValue) ||
      !Number.isFinite(entryValue) ||
      !Number.isFinite(exitValue) ||
      !Number.isFinite(stopValue) ||
      !Number.isFinite(targetValue)
    ) {
      setError("Numeric fields must be valid numbers.");
      return;
    }
    if (lotsValue <= 0) {
      setError("Lots must be greater than 0.");
      return;
    }
    if (!Number.isFinite(selectedLotSize) || selectedLotSize <= 0) {
      setError("Select instrument with a valid lot size.");
      return;
    }

    const trade: Trade = {
      tradeId: tradeIdValue,
      date,
      accountId: accountId || undefined,
      instrument: instrumentValue,
      market,
      entryTime,
      exitTime,
      strategy: strategyChoice || "Unspecified",
      direction: direction as Trade["direction"],
      sizeQty: qtyValue,
      lots: lotsValue,
      lotSize: selectedLotSize,
      entryPrice: entryValue,
      exitPrice: exitValue,
      stopLoss: stopValue,
      targetPrice: targetValue,
      exitReason: exitReasonValue,
      platform: platformValue,
      chartUrl: chartUrlValue || undefined,
      pnlScreenshotUrl: pnlScreenshotUrlValue || undefined,
      remarks: remarks.trim() || undefined,
      emotionTag: emotionTag.trim() || undefined,
      emotionalState: emotionalState.trim() || undefined,
      mindsetNotes: mindsetNotes.trim() || undefined,
      learning: learning.trim() || undefined,
      tradeType: tradeType || undefined
    };

    setSaving(true);
    try {
      const response = isEditing ? await onUpdate(trade) : await onAdd(trade);
      if (response) {
        setError(response);
        return;
      }
      if (isEditing) {
        setSuccess("Trade updated.");
        setTimeout(() => setSuccess(""), 2000);
        onCancelEdit();
        return;
      }
      setTradeId("");
      setAccountId(defaultAccountId || accounts[0]?.id || "");
      setInstrument("Nifty");
      setMarket("F&O");
      setEntryTime("");
      setExitTime("");
      setStrategyChoice("");
      setDirection("");
      setEntryPrice("");
      setExitPrice("");
      setStopLoss("");
      setTargetPrice("");
      setLots("");
      setExitReasonChoice("");
      setExitReasonCustom("");
      setPlatform("");
      setPlatformChoice("");
      setPlatformCustom("");
      setChartUrl("");
      setPnlScreenshotUrl("");
      setRemarks("");
      setEmotionTag("");
      setEmotionalState("");
      setMindsetNotes("");
      setLearning("");
      setTradeType("");
      setFieldErrors({});
      setSuccess("Trade saved.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePnlScreenshotUpload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload a valid image for PnL screenshot.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("PnL screenshot is too large. Keep it under 4 MB.");
      return;
    }

    try {
      setUploadingScreenshot(true);
      if (onUploadPnlScreenshot) {
        const uploadedUrl = await onUploadPnlScreenshot(file);
        setPnlScreenshotUrl(uploadedUrl);
        setError("");
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          if (!result) {
            reject(new Error("Upload failed"));
            return;
          }
          resolve(result);
        };
        reader.onerror = () => reject(new Error("Upload failed"));
        reader.readAsDataURL(file);
      });
      setPnlScreenshotUrl(dataUrl);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not read screenshot file. Try again."
      );
    } finally {
      setUploadingScreenshot(false);
    }
  }

  return (
    <form id="trade-form" onSubmit={handleSubmit} className="trade-form-card">
      <div className="trade-form-head">
        <div>
          <h3>{isEditing ? "Edit trade" : "Add trade"}</h3>
          <p>Record the plan, execution, screenshot and post-trade lesson.</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              type="button"
              className="rounded-lg border border-[#e1e7f0] bg-white px-4 py-2 text-xs font-bold text-[#425370]"
              onClick={onCancelEdit}
            >
              Cancel edit
            </button>
          )}
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
            disabled={saving}
          >
            {saving ? "Saving..." : isEditing ? "Update trade" : "Save trade"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-negative">{error}</p>}
      {success && <p className="mt-3 text-xs text-positive">{success}</p>}
      {!error && (
        <p className="mt-3 text-[11px] text-muted">
          Tip: If you don’t see the trade, clear top filters.
        </p>
      )}

      <div className="trade-form-grid trade-form-grid-primary">
        <input
          placeholder="Trade ID (Auto)"
          value={tradeId}
          readOnly
          className="rounded-lg border border-white/10 bg-ink/70 px-3 py-2 text-white"
        />
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={withFieldError(
            "date",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        />
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className={withFieldError(
            "accountId",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        >
          <option value="" disabled>
            Select account
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <div>
          <input
            list="instrument-options"
            placeholder="Instrument"
            value={instrument}
            onChange={(event) => setInstrument(event.target.value)}
            className={withFieldError(
              "instrument",
              "w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            )}
            required
          />
          <datalist id="instrument-options">
            {instruments.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>
        <select
          value={market}
          onChange={(event) => setMarket(event.target.value)}
          className={withFieldError(
            "market",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        >
          <option value="" disabled>
            Select market
          </option>
          <option value="Equity">Equity</option>
          <option value="F&O">F&O</option>
          <option value="Crypto">Crypto</option>
        </select>
        <input
          type="time"
          value={entryTime}
          onChange={(event) => setEntryTime(event.target.value)}
          className={withFieldError(
            "entryTime",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        />
        <input
          type="time"
          value={exitTime}
          onChange={(event) => setExitTime(event.target.value)}
          className={withFieldError(
            "exitTime",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        />
      </div>

      <div className="trade-form-grid">
        <select
          value={strategyChoice}
          onChange={(event) => setStrategyChoice(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="">
            Strategy (optional)
          </option>
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.name}>
              {strategy.name}
            </option>
          ))}
        </select>
        <select
          value={direction}
          onChange={(event) =>
            setDirection(event.target.value as Trade["direction"])
          }
          className={withFieldError(
            "direction",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        >
          <option value="" disabled>
            Select side
          </option>
          <option value="Long">Call (Buy)</option>
          <option value="Short">Put (Buy)</option>
        </select>
        <input
          placeholder="Lots"
          value={lots}
          onChange={(event) => setLots(event.target.value)}
          className={withFieldError(
            "lots",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
          required
        />
        <input
          placeholder="Qty (Auto)"
          value={
            instrumentValue
              ? `${Number(lots || 0) * (selectedLotSize || 0)}`
              : ""
          }
          readOnly
          className="rounded-lg border border-white/10 bg-ink/70 px-3 py-2 text-white"
        />
        <input
          placeholder="Entry Price"
          value={entryPrice}
          onChange={(event) => setEntryPrice(event.target.value)}
          className={withFieldError(
            "entryPrice",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
          required
        />
        <input
          placeholder="Exit Price"
          value={exitPrice}
          onChange={(event) => setExitPrice(event.target.value)}
          className={withFieldError(
            "exitPrice",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
          required
        />
        <input
          placeholder="Stop Loss"
          value={stopLoss}
          onChange={(event) => setStopLoss(event.target.value)}
          className={withFieldError(
            "stopLoss",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
          required
        />
      </div>

      <p className="mt-2 text-[10px] text-muted">
        {instrumentValue
          ? `1 lot = ${selectedLotSize} qty (set in Instruments)`
          : "Select an instrument to load its lot size"}
      </p>

      <div className="trade-form-grid trade-form-grid-wide">
        <input
          placeholder="Target Price"
          value={targetPrice}
          onChange={(event) => setTargetPrice(event.target.value)}
          className={withFieldError(
            "targetPrice",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
          required
        />
        <div className="flex flex-col gap-2">
          <select
            value={exitReasonChoice}
            onChange={(event) => setExitReasonChoice(event.target.value)}
            className={withFieldError(
              "exitReason",
              "w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            )}
          >
            <option value="" disabled>
              Exit reason
            </option>
            <option value="Trailing SL">Trailing SL</option>
            <option value="SL">SL</option>
            <option value="Target">Target</option>
            <option value="Custom">Custom</option>
          </select>
          {exitReasonChoice === "Custom" && (
            <input
              placeholder="Custom reason"
              value={exitReasonCustom}
              onChange={(event) => setExitReasonCustom(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
          )}
        </div>
        <input
          placeholder="Chart link (optional)"
          value={chartUrl}
          onChange={(event) => setChartUrl(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
        <div className="trade-upload-box">
          <label className="trade-upload-button">
            Upload screenshot
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handlePnlScreenshotUpload(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <div className="ml-2 flex shrink-0 items-center gap-1">
            <span className={`text-[11px] font-bold ${pnlScreenshotUrl ? "text-positive" : "text-muted"}`}>
              {uploadingScreenshot ? "Uploading..." : pnlScreenshotUrl ? "Added" : "No SS"}
            </span>
            {pnlScreenshotUrl ? (
              <button
                type="button"
                className="rounded-lg border border-[#e1e7f0] bg-white px-2 py-1 text-[10px] font-bold text-[#425370]"
                onClick={() => setPnlScreenshotUrl("")}
              >
                X
              </button>
            ) : null}
          </div>
        </div>
        <select
          value={tradeType}
          onChange={(event) =>
            setTradeType(event.target.value as "Safe" | "Risky" | "")
          }
          className={withFieldError(
            "tradeType",
            "rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          )}
        >
          <option value="" disabled>
            Trade type
          </option>
          <option value="Safe">Safe</option>
          <option value="Risky">Risky</option>
        </select>
      </div>

      {pnlScreenshotUrl ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
          <img
            src={pnlScreenshotUrl}
            alt="PnL screenshot preview"
            className="h-9 w-12 rounded border border-white/15 object-cover"
          />
          <span>PnL screenshot selected</span>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a5 5 0 0 1 5 5c0 2-1.2 3.6-2.4 4.7-.8.7-1.3 1.6-1.3 2.6v.7h-2.6v-.7c0-1-.5-1.9-1.3-2.6C7.2 11.6 6 10 6 8a5 5 0 0 1 6-5Z" />
              <path d="M9 21h6" />
            </svg>
          </span>
          <div>
            <div className="text-sm font-semibold">Psychology tracking</div>
            <div className="text-xs text-muted">
              Identify patterns in your behavior and market performance.
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
          <div>
            <input
              list="emotion-tag-options"
              placeholder="Trigger emotion"
              value={emotionTag}
              onChange={(event) => setEmotionTag(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
            <datalist id="emotion-tag-options">
              <option value="Calm" />
              <option value="Focused" />
              <option value="Confident" />
              <option value="Anxious" />
              <option value="FOMO" />
              <option value="Hesitant" />
              <option value="Frustrated" />
              <option value="Fearful" />
            </datalist>
          </div>
          <div>
            <input
              list="behavior-state-options"
              placeholder="Behavioral state"
              value={emotionalState}
              onChange={(event) => setEmotionalState(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
            <datalist id="behavior-state-options">
              <option value="Disciplined" />
              <option value="Patient" />
              <option value="Neutral" />
              <option value="Impulsive" />
              <option value="Distracted" />
              <option value="Fatigued" />
            </datalist>
          </div>
          <input
            placeholder="Mindset notes (optional)"
            value={mindsetNotes}
            onChange={(event) => setMindsetNotes(event.target.value)}
            className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          />
        </div>
        <div className="mt-3 text-[11px] text-muted">
          Trigger emotion = what you felt. Behavioral state = how you acted. If both match, flag it.
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <textarea
          placeholder="Entry Reason (optional)"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
        />
        <textarea
          placeholder="Learning from this trade (optional)"
          value={learning}
          onChange={(event) => setLearning(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
        />
      </div>
    </form>
  );
}

export default function ClientDashboard({
  view = "overview",
  editStrategyId,
  presetInstrument
}: {
  view?: DashboardView;
  editStrategyId?: string;
  presetInstrument?: string;
}) {
  const router = useRouter();
  const [tradeList, setTradeList] = useState<Trade[]>(() =>
    isSupabaseConfigured ? [] : seedTrades
  );
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [journalFormOpen, setJournalFormOpen] = useState(false);
  const [selectedJournalTradeId, setSelectedJournalTradeId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [globalAccount, setGlobalAccount] = useState("all");
  const [globalMarket, setGlobalMarket] = useState("all");
  const [globalInstrument, setGlobalInstrument] = useState("all");
  const [globalStrategy, setGlobalStrategy] = useState("all");
  const [globalStartDate, setGlobalStartDate] = useState("");
  const [globalEndDate, setGlobalEndDate] = useState("");
  const [dataSource, setDataSource] = useState<"local" | "supabase">(
    isSupabaseConfigured ? "supabase" : "local"
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const lastUserIdRef = useRef<string | null>(null);
  const [accounts, setAccounts] = useState<TradingAccount[]>(() =>
    isSupabaseConfigured ? [] : [DEFAULT_LOCAL_ACCOUNT]
  );
  const [accountNameInput, setAccountNameInput] = useState("");
  const [accountBaseCapitalInput, setAccountBaseCapitalInput] = useState("");
  const [accountDailyTradeLimitInput, setAccountDailyTradeLimitInput] = useState(String(DEFAULT_DAILY_TRADE_LIMIT));
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const [editingAccountBaseCapital, setEditingAccountBaseCapital] = useState("");
  const [editingAccountDailyTradeLimit, setEditingAccountDailyTradeLimit] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [instruments, setInstruments] =
    useState<InstrumentDefinition[]>(DEFAULT_INSTRUMENTS);
  const [instrumentNameInput, setInstrumentNameInput] = useState("");
  const [instrumentLotSizeInput, setInstrumentLotSizeInput] = useState("1");
  const [instrumentEditId, setInstrumentEditId] = useState<string | null>(null);
  const [instrumentEditName, setInstrumentEditName] = useState("");
  const [instrumentEditLotSize, setInstrumentEditLotSize] = useState("");
  const [instrumentStatus, setInstrumentStatus] = useState("");
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [strategyNameInput, setStrategyNameInput] = useState("");
  const [strategyRulesInput, setStrategyRulesInput] = useState("");
  const [strategyStatus, setStrategyStatus] = useState("");
  const [strategyEditName, setStrategyEditName] = useState("");
  const [strategyEditRules, setStrategyEditRules] = useState("");
  const [strategyEditStatus, setStrategyEditStatus] = useState("");
  const [participantFlows, setParticipantFlows] = useState<ParticipantFlow[]>([]);
  const [flowDate, setFlowDate] = useState(new Date().toISOString().slice(0, 10));
  const [participantViewDate, setParticipantViewDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [flowParticipant, setFlowParticipant] = useState<ParticipantType>("FII");
  const [flowFutureBought, setFlowFutureBought] = useState("");
  const [flowFutureSold, setFlowFutureSold] = useState("");
  const [flowCallBought, setFlowCallBought] = useState("");
  const [flowPutBought, setFlowPutBought] = useState("");
  const [flowCallSold, setFlowCallSold] = useState("");
  const [flowPutSold, setFlowPutSold] = useState("");
  const [flowStatus, setFlowStatus] = useState("");
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<DashboardNavId>("overview");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [marketNews, setMarketNews] = useState<MarketNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState("");
  const [newsPage, setNewsPage] = useState(1);
  const [newsHasMore, setNewsHasMore] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [journalSummaryMonth, setJournalSummaryMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [journalSummaryLink, setJournalSummaryLink] = useState("");
  const [journalSummaryStatus, setJournalSummaryStatus] = useState("");
  const [checklistSaveStatus, setChecklistSaveStatus] = useState("");
  const [journalDailyDate, setJournalDailyDate] = useState("");
  const [journalDailyInputs, setJournalDailyInputs] = useState<
    Record<string, JournalDailyInput>
  >({});
  const [marketSnapshotRows, setMarketSnapshotRows] = useState<MarketSnapshotRow[]>(
    DEFAULT_MARKET_SNAPSHOT_ROWS
  );
  const [marketSnapshotsByDate, setMarketSnapshotsByDate] = useState<
    Record<string, MarketSnapshotRow[]>
  >({});
  const [stockSuggestions, setStockSuggestions] = useState<StockSuggestionItem[]>([]);
  const [stockSuggestionStatus, setStockSuggestionStatus] = useState("");
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const participantsTableRef = useRef<HTMLTableElement | null>(null);
  const migratedJournalRef = useRef<string>("");
  const migratedTradeAccountsRef = useRef<string>("");

  const accountStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${ACCOUNTS_KEY}_${session.user.id}`;
    }
    return ACCOUNTS_KEY;
  }, [dataSource, session?.user?.id]);

  const instrumentStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${INSTRUMENTS_KEY}_${session.user.id}`;
    }
    return INSTRUMENTS_KEY;
  }, [dataSource, session?.user?.id]);

  const strategyStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${STRATEGIES_KEY}_${session.user.id}`;
    }
    return STRATEGIES_KEY;
  }, [dataSource, session?.user?.id]);

  const profileStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${PROFILE_KEY}_${session.user.id}`;
    }
    return PROFILE_KEY;
  }, [dataSource, session?.user?.id]);

  const participantsStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${PARTICIPANTS_KEY}_${session.user.id}`;
    }
    return PARTICIPANTS_KEY;
  }, [dataSource, session?.user?.id]);


  const checklistStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${JOURNAL_DAILY_INPUTS_KEY}_${session.user.id}`;
    }
    return JOURNAL_DAILY_INPUTS_KEY;
  }, [dataSource, session?.user?.id]);

  const marketSnapshotStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${MARKET_SNAPSHOT_KEY}_${session.user.id}`;
    }
    return MARKET_SNAPSHOT_KEY;
  }, [dataSource, session?.user?.id]);

  const uploadTradeScreenshot = useCallback(
    async (file: File) => {
      if (!supabase || !session?.user?.id) {
        throw new Error("Please sign in before uploading screenshots.");
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const extension = safeName.includes(".")
        ? safeName.split(".").pop()
        : file.type.split("/").pop() || "png";
      const objectPath = `${session.user.id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${extension}`;

      const { error } = await supabase.storage
        .from(TRADE_MEDIA_BUCKET)
        .upload(objectPath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type
        });

      if (error) {
        throw new Error(error.message);
      }

      const { data } = supabase.storage
        .from(TRADE_MEDIA_BUCKET)
        .getPublicUrl(objectPath);

      if (!data.publicUrl) {
        throw new Error("Could not create screenshot URL.");
      }

      return data.publicUrl;
    },
    [session?.user?.id]
  );

  const loadMarketNews = useCallback(async ({
    page = 1,
    append = false,
    pageSize = 8
  }: {
    page?: number;
    append?: boolean;
    pageSize?: number;
  } = {}) => {
    setNewsLoading(true);
    setNewsError("");
    try {
      const response = await fetch(
        `/api/market-news?page=${page}&pageSize=${pageSize}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        items?: MarketNewsItem[];
        error?: string;
        page?: number;
        hasMore?: boolean;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch market news.");
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      setMarketNews((prev) => (append ? [...prev, ...items] : items));
      setNewsPage(payload.page ?? page);
      setNewsHasMore(Boolean(payload.hasMore));
    } catch (error) {
      if (!append) {
        setMarketNews([]);
      }
      setNewsError(
        error instanceof Error ? error.message : "Failed to fetch market news."
      );
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setDataSource("local");
      setAuthLoading(false);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as Trade[];
        if (Array.isArray(parsed)) {
          setTradeList(parsed);
        }
      } catch (error) {
        console.error("Failed to load stored trades", error);
      }
      return;
    }

    setDataSource("supabase");
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      lastUserIdRef.current = data.session?.user?.id ?? null;
      setAuthLoading(false);
      if (!data.session) {
        router.replace("/sign-in");
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        const nextUserId = nextSession?.user?.id ?? null;
        if (nextUserId !== lastUserIdRef.current) {
          setTradeList([]);
          setImportStatus(null);
        }
        lastUserIdRef.current = nextUserId;
        setSession(nextSession);
        if (!nextSession) {
          router.replace("/sign-in");
        }
      }
    );

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (dataSource !== "local") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Trade[];
      if (Array.isArray(parsed)) {
        setTradeList(parsed);
      }
    } catch (error) {
      console.error("Failed to load stored trades", error);
    }
  }, [dataSource]);

  useEffect(() => {
    if (dataSource !== "supabase" || !supabase || !session) return;
    (async () => {
      setImportStatus(null);
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .is("team_id", null)
        .order("date", { ascending: false })
        .order("entry_time", { ascending: false });
      if (error) {
        setImportStatus(`Supabase error: ${error.message}`);
        setTradeList([]);
        return;
      }
      if (data) {
        setTradeList(data.map((row) => fromSupabaseRow(row)));
      } else {
        setTradeList([]);
      }
    })();
  }, [dataSource, session]);

  useEffect(() => {
    if (dataSource !== "supabase" || !supabase || !session?.user?.id) return;

    (async () => {
      const { data, error } = await supabase
        .from("trading_accounts")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (error) {
        setAccountStatus(`Account load failed: ${error.message}`);
        return;
      }

      let nextAccounts = fromTradingAccountRows(
        Array.isArray(data) ? (data as Record<string, unknown>[]) : []
      );

      if (!nextAccounts.length) {
        const pending = readPendingAccountSetup(session.user.email ?? undefined);
        const metadata = session.user.user_metadata ?? {};
        const initialName =
          pending?.accountName ||
          normalizeAccountName(String(metadata.initial_account_name ?? "")) ||
          DEFAULT_LOCAL_ACCOUNT.name;
        const initialBaseCapital = Math.max(
          0,
          Number(pending?.baseCapital ?? metadata.initial_base_capital ?? 0) || 0
        );
        const initialAccount: TradingAccount = {
          id: buildAccountId(initialName),
          name: initialName,
          baseCapital: initialBaseCapital,
          dailyTradeLimit: DEFAULT_DAILY_TRADE_LIMIT,
          isDefault: true
        };

        const { error: insertError } = await supabase
          .from("trading_accounts")
          .insert(toTradingAccountRow(session.user.id, initialAccount));

        if (insertError) {
          setAccountStatus(`Account setup failed: ${insertError.message}`);
          return;
        }

        nextAccounts = [initialAccount];
        localStorage.removeItem(PENDING_ACCOUNT_SETUP_KEY);
      }

      setAccounts(nextAccounts);
    })();
  }, [dataSource, session?.user?.id]);

  useEffect(() => {
    if (dataSource !== "local") return;
    const stored = localStorage.getItem(accountStorageKey);
    if (!stored) {
      setAccounts([DEFAULT_LOCAL_ACCOUNT]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      const normalized = normalizeAccountList(parsed);
      setAccounts(normalized.length ? normalized : [DEFAULT_LOCAL_ACCOUNT]);
    } catch (error) {
      console.error("Failed to load accounts", error);
      setAccounts([DEFAULT_LOCAL_ACCOUNT]);
    }
  }, [accountStorageKey, dataSource]);

  useEffect(() => {
    if (dataSource === "supabase") return;
    localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
  }, [accountStorageKey, accounts, dataSource]);

  useEffect(() => {
    if (globalAccount !== "all" && !accounts.some((account) => account.id === globalAccount)) {
      setGlobalAccount("all");
    }
  }, [accounts, globalAccount]);

  useEffect(() => {
    const defaultAccount = accounts.find((account) => account.isDefault) ?? accounts[0];
    if (!defaultAccount) return;

    setTradeList((prev) => {
      let changed = false;
      const next = prev.map((trade) => {
        if (trade.accountId) return trade;
        changed = true;
        return { ...trade, accountId: defaultAccount.id };
      });
      return changed ? next : prev;
    });

    if (dataSource !== "supabase" || !supabase || !session?.user?.id) return;
    const missingTradeIds = tradeList.filter((trade) => !trade.accountId).map((trade) => trade.tradeId);
    if (!missingTradeIds.length) return;
    const signature = `${session.user.id}:${defaultAccount.id}:${missingTradeIds.join("|")}`;
    if (migratedTradeAccountsRef.current === signature) return;
    migratedTradeAccountsRef.current = signature;
    void supabase
      .from("trades")
      .update({ account_id: defaultAccount.id })
      .eq("user_id", session.user.id)
      .is("account_id", null)
      .then(({ error }) => {
        if (error) {
          console.error("Failed to backfill trade accounts", error);
          migratedTradeAccountsRef.current = "";
        }
      });
  }, [accounts, dataSource, session?.user?.id, tradeList]);

  useEffect(() => {
    const stored = localStorage.getItem(instrumentStorageKey);
    if (!stored) {
      setInstruments(DEFAULT_INSTRUMENTS);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      const normalized = normalizeInstrumentList(parsed);
      if (normalized.length) {
        setInstruments(mergeInstrumentDefaults(normalized));
      } else {
        setInstruments(DEFAULT_INSTRUMENTS);
      }
    } catch (error) {
      console.error("Failed to load instruments", error);
      setInstruments(DEFAULT_INSTRUMENTS);
    }
  }, [instrumentStorageKey]);

  useEffect(() => {
    localStorage.setItem(instrumentStorageKey, JSON.stringify(instruments));
  }, [instrumentStorageKey, instruments]);

  useEffect(() => {
    const stored = localStorage.getItem(strategyStorageKey);
    if (!stored) {
      setStrategies([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StrategyDefinition[];
      if (Array.isArray(parsed)) {
        setStrategies(parsed);
      } else {
        setStrategies([]);
      }
    } catch (error) {
      console.error("Failed to load strategies", error);
      setStrategies([]);
    }
  }, [strategyStorageKey]);

  useEffect(() => {
    localStorage.setItem(strategyStorageKey, JSON.stringify(strategies));
  }, [strategyStorageKey, strategies]);


  useEffect(() => {
    const stored = localStorage.getItem(checklistStorageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, JournalDailyInput>;
      if (parsed && typeof parsed === "object") {
        setJournalDailyInputs(parsed);
      }
    } catch (error) {
      console.error("Failed to load checklist inputs", error);
    }
  }, [checklistStorageKey]);

  useEffect(() => {
    const stored = localStorage.getItem(marketSnapshotStorageKey);
    if (!stored) {
      setMarketSnapshotsByDate({});
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        setMarketSnapshotsByDate({});
        return;
      }
      const normalized: Record<string, MarketSnapshotRow[]> = {};
      Object.entries(parsed).forEach(([date, rows]) => {
        normalized[date] = normalizeSnapshotRows(rows);
      });
      setMarketSnapshotsByDate(normalized);
    } catch (error) {
      console.error("Failed to load saved market snapshots", error);
      setMarketSnapshotsByDate({});
    }
  }, [marketSnapshotStorageKey]);

  useEffect(() => {
    if (dataSource !== "supabase" || !supabase || !session?.user?.id) return;

    (async () => {
      const { data, error } = await supabase
        .from("journal_daily_entries")
        .select("*")
        .eq("user_id", session.user.id)
        .order("entry_date", { ascending: false });

      if (error) {
        console.error("Failed to load journal daily entries", error);
        return;
      }

      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      const { inputs, snapshots } = fromJournalDailySupabaseRows(rows);

      setJournalDailyInputs((prev) => ({
        ...prev,
        ...inputs
      }));
      setMarketSnapshotsByDate((prev) => ({
        ...prev,
        ...snapshots
      }));
    })();
  }, [dataSource, session?.user?.id]);

  useEffect(() => {
    if (dataSource !== "supabase" || !supabase || !session?.user?.id) return;

    const localDates = Array.from(
      new Set([
        ...Object.keys(journalDailyInputs),
        ...Object.keys(marketSnapshotsByDate)
      ])
    ).sort();

    if (!localDates.length) return;

    const signature = `${session.user.id}:${localDates.join("|")}`;
    if (migratedJournalRef.current === signature) return;

    migratedJournalRef.current = signature;

    const payload = localDates.map((date) =>
      toJournalDailySupabaseRow(
        session.user.id,
        date,
        journalDailyInputs[date] ?? EMPTY_JOURNAL_DAILY_INPUT,
        marketSnapshotsByDate[date] ?? DEFAULT_MARKET_SNAPSHOT_ROWS
      )
    );

    void supabase
      .from("journal_daily_entries")
      .upsert(payload, { onConflict: "user_id,entry_date" })
      .then(({ error }) => {
        if (error) {
          console.error("Failed to sync local journal daily entries", error);
          migratedJournalRef.current = "";
        }
      });
  }, [
    dataSource,
    session?.user?.id,
    journalDailyInputs,
    marketSnapshotsByDate
  ]);

  useEffect(() => {
    const stored = localStorage.getItem(participantsStorageKey);
    if (!stored) {
      setParticipantFlows([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as ParticipantFlow[];
      if (Array.isArray(parsed)) {
        setParticipantFlows(
          parsed.map((item) => ({
            ...item,
            futureBoughtQty: Number(item.futureBoughtQty ?? 0) || 0,
            futureSoldQty: Number(item.futureSoldQty ?? 0) || 0,
            callBoughtQty: Number(item.callBoughtQty ?? 0) || 0,
            putBoughtQty: Number(item.putBoughtQty ?? 0) || 0,
            callSoldQty: Number(item.callSoldQty ?? 0) || 0,
            putSoldQty: Number(item.putSoldQty ?? 0) || 0
          }))
        );
      } else {
        setParticipantFlows([]);
      }
    } catch (error) {
      console.error("Failed to load participant activity", error);
      setParticipantFlows([]);
    }
  }, [participantsStorageKey]);

  useEffect(() => {
    localStorage.setItem(participantsStorageKey, JSON.stringify(participantFlows));
  }, [participantsStorageKey, participantFlows]);

  useEffect(() => {
    const stored = localStorage.getItem(profileStorageKey);
    if (!stored) {
      setProfileImage(null);
      return;
    }
    setProfileImage(stored);
  }, [profileStorageKey]);

  useEffect(() => {
    if (profileImage) {
      localStorage.setItem(profileStorageKey, profileImage);
    } else {
      localStorage.removeItem(profileStorageKey);
    }
  }, [profileImage, profileStorageKey]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const navTarget = view === "setup-edit" ? "setup" : view;
    if (view !== "overview") {
      setActiveSection(navTarget);
      return;
    }

    setActiveSection("overview");
  }, [view]);

  useEffect(() => {
    if (view !== "journal") {
      setEditingTrade(null);
      setJournalFormOpen(false);
      setSelectedJournalTradeId(null);
    }
  }, [view, loadMarketNews]);

  useEffect(() => {
    if (view !== "journal") return;
    if (presetInstrument && presetInstrument !== globalInstrument) {
      setGlobalInstrument(presetInstrument);
    }
  }, [view, presetInstrument, globalInstrument]);

  useEffect(() => {
    if (view !== "overview" && view !== "news") return;
    setNewsPage(1);
    const pageSize = view === "news" ? 10 : 6;
    void loadMarketNews({ page: 1, append: false, pageSize });
  }, [view, loadMarketNews]);

  const loadStockSuggestions = useCallback(async () => {
    try {
      const response = await fetch("/api/stock-suggestions", {
        cache: "no-store"
      });
      const payload = (await response.json()) as {
        items?: StockSuggestionItem[];
        disclaimer?: string;
      };
      setStockSuggestions(Array.isArray(payload.items) ? payload.items : []);
      setStockSuggestionStatus(payload.disclaimer ?? "");
    } catch {
      setStockSuggestions([]);
      setStockSuggestionStatus("Could not load stock suggestions right now.");
    }
  }, []);

  useEffect(() => {
    if (view !== "overview" && view !== "opportunities") return;
    void loadStockSuggestions();
  }, [view, loadStockSuggestions]);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    const storedCurrency = localStorage.getItem(CURRENCY_KEY);
    if (storedCurrency === "INR" || storedCurrency === "USD") {
      setCurrency(storedCurrency);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CURRENCY_KEY, currency);
  }, [currency]);

  useEffect(() => {
    if (dataSource === "supabase") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tradeList));
  }, [tradeList, dataSource]);

  const marketOptions = useMemo(
    () => Array.from(new Set(tradeList.map((t) => t.market))).sort(),
    [tradeList]
  );
  const instrumentOptions = useMemo(
    () => Array.from(new Set(tradeList.map((t) => t.instrument))).sort(),
    [tradeList]
  );
  const strategyOptions = useMemo(
    () => Array.from(new Set(tradeList.map((t) => t.strategy))).sort(),
    [tradeList]
  );
  const defaultTradingAccount = useMemo(
    () => accounts.find((account) => account.isDefault) ?? accounts[0] ?? null,
    [accounts]
  );
  const selectedTradingAccount = useMemo(
    () => accounts.find((account) => account.id === globalAccount) ?? null,
    [accounts, globalAccount]
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );

  const filteredTrades = useMemo(
    () =>
      tradeList.filter((trade) => {
        if (globalAccount !== "all" && trade.accountId !== globalAccount) return false;
        if (globalMarket !== "all" && trade.market !== globalMarket) return false;
        if (
          globalInstrument !== "all" &&
          trade.instrument !== globalInstrument
        )
          return false;
        if (globalStrategy !== "all" && trade.strategy !== globalStrategy)
          return false;
        if (globalStartDate && trade.date < globalStartDate) return false;
        if (globalEndDate && trade.date > globalEndDate) return false;
        return true;
      }),
    [
      tradeList,
      globalAccount,
      globalMarket,
      globalInstrument,
      globalStrategy,
      globalStartDate,
      globalEndDate
    ]
  );

  const derived = useMemo(() => deriveTrades(filteredTrades), [filteredTrades]);
  const journalMonthDates = useMemo(() => {
    const fromTrades = tradeList
      .filter(
        (trade) =>
          trade.date.startsWith(`${journalSummaryMonth}-`) &&
          (globalAccount === "all" || trade.accountId === globalAccount)
      )
      .map((trade) => trade.date);
    const fromChecklist = Object.keys(journalDailyInputs).filter((date) =>
      date.startsWith(`${journalSummaryMonth}-`)
    );
    const fromSnapshots = Object.keys(marketSnapshotsByDate).filter((date) =>
      date.startsWith(`${journalSummaryMonth}-`)
    );
    const set = new Set([...fromTrades, ...fromChecklist, ...fromSnapshots]);
    const today = new Date().toISOString().slice(0, 10);
    if (today.startsWith(`${journalSummaryMonth}-`)) {
      set.add(today);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tradeList, journalSummaryMonth, journalDailyInputs, marketSnapshotsByDate, globalAccount]);
  const selectedJournalDailyInput = useMemo(
    () =>
      journalDailyDate
        ? journalDailyInputs[journalDailyDate] ?? EMPTY_JOURNAL_DAILY_INPUT
        : EMPTY_JOURNAL_DAILY_INPUT,
    [journalDailyDate, journalDailyInputs]
  );

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const preferredToday =
      today.startsWith(`${journalSummaryMonth}-`) ? today : "";

    if (!journalMonthDates.length) {
      setJournalDailyDate(preferredToday);
      return;
    }
    if (!journalDailyDate || !journalMonthDates.includes(journalDailyDate)) {
      setJournalDailyDate(preferredToday || journalMonthDates[0]);
    }
  }, [journalMonthDates, journalDailyDate, journalSummaryMonth]);

  useEffect(() => {
    if (!journalDailyDate) {
      setMarketSnapshotRows(DEFAULT_MARKET_SNAPSHOT_ROWS);
      return;
    }
    const saved = marketSnapshotsByDate[journalDailyDate];
    setMarketSnapshotRows(saved ?? DEFAULT_MARKET_SNAPSHOT_ROWS);
  }, [journalDailyDate, marketSnapshotsByDate]);

  const summary = useMemo(() => computeSummary(derived), [derived]);
  const dayBreakdown = useMemo(() => breakdownByDay(derived), [derived]);
  const weekBreakdown = useMemo(() => breakdownByWeek(derived), [derived]);
  const monthBreakdown = useMemo(() => breakdownByMonth(derived), [derived]);
  const monthWinRate = useMemo(() => winRateByMonth(derived), [derived]);
  const dateRange = useMemo(() => getDateRange(filteredTrades), [filteredTrades]);
  const dayStats = useMemo(() => dayOfWeekStats(derived), [derived]);
  const safeRiskStats = useMemo(() => {
    const build = (type: "Safe" | "Risky") => {
      const trades = derived.filter((trade) => trade.tradeType === type);
      const wins = trades.filter((trade) => trade.pl > 0).length;
      const totalPl = trades.reduce((sum, trade) => sum + trade.pl, 0);
      return {
        type,
        count: trades.length,
        winRate: trades.length ? wins / trades.length : 0,
        totalPl
      };
    };
    return {
      safe: build("Safe"),
      risky: build("Risky")
    };
  }, [derived]);

  const overviewProfitStats = useMemo(() => {
    const grossProfit = derived
      .filter((trade) => trade.pl > 0)
      .reduce((sum, trade) => sum + trade.pl, 0);
    const grossLoss = derived
      .filter((trade) => trade.pl < 0)
      .reduce((sum, trade) => sum + trade.pl, 0);
    return { grossProfit, grossLoss };
  }, [derived]);

  const strategyStats = useMemo(
    () =>
      groupStats(derived, (trade) => trade.strategy).sort(
        (a, b) => b.totalPl - a.totalPl
      ),
    [derived]
  );

  const instrumentStats = useMemo(
    () =>
      groupStats(derived, (trade) => trade.instrument).sort(
        (a, b) => b.totalPl - a.totalPl
      ),
    [derived]
  );

  const locale = currency === "INR" ? "en-IN" : "en-US";
  const money0 = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
      }),
    [currency, locale]
  );
  const money2 = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2
      }),
    [currency, locale]
  );
  const signedMoney0 = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
        signDisplay: "always"
      }),
    [currency, locale]
  );
  const signedMoney2 = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
        signDisplay: "always"
      }),
    [currency, locale]
  );

  const profitFactorLabel =
    summary.profitFactor === null
      ? "—"
      : summary.profitFactor.toFixed(2);

  const expectancyLabel =
    summary.expectancyR === null
      ? "—"
      : `${summary.expectancyR.toFixed(2)}R`;

  const avgRRLabel = summary.avgRR === null ? "—" : summary.avgRR.toFixed(2);

  const maxDrawdownPct =
    summary.maxDrawdownPct === null
      ? "—"
      : `${(summary.maxDrawdownPct * 100).toFixed(1)}%`;

  const exitReasons = useMemo(() => {
    const map = new Map<string, number>();
    derived.forEach((trade) => {
      const key = trade.exitReason || "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }, [derived]);

  const emotionStats = useMemo(() => {
    const map = new Map<string, { wins: number; total: number; totalPl: number }>();
    derived.forEach((trade) => {
      const key = trade.emotionTag?.trim() || "Unspecified";
      const current = map.get(key) ?? { wins: 0, total: 0, totalPl: 0 };
      current.total += 1;
      if (trade.pl > 0) current.wins += 1;
      current.totalPl += trade.pl;
      map.set(key, current);
    });
    return [...map.entries()]
      .map(([label, value]) => ({
        label,
        trades: value.total,
        winRate: value.total ? value.wins / value.total : 0,
        totalPl: value.totalPl
      }))
      .sort((a, b) => b.totalPl - a.totalPl);
  }, [derived]);

  const mindsetStats = useMemo(() => {
    const map = new Map<string, { wins: number; total: number; totalPl: number }>();
    derived.forEach((trade) => {
      const key = trade.emotionalState?.trim() || "Unspecified";
      const current = map.get(key) ?? { wins: 0, total: 0, totalPl: 0 };
      current.total += 1;
      if (trade.pl > 0) current.wins += 1;
      current.totalPl += trade.pl;
      map.set(key, current);
    });
    return [...map.entries()]
      .map(([label, value]) => ({
        label,
        trades: value.total,
        winRate: value.total ? value.wins / value.total : 0,
        totalPl: value.totalPl
      }))
      .sort((a, b) => b.totalPl - a.totalPl);
  }, [derived]);

  const hasPsychologyData =
    emotionStats.some((row) => row.label !== "Unspecified") ||
    mindsetStats.some((row) => row.label !== "Unspecified");

  const alignmentStats = useMemo(() => {
    const map = new Map<string, number>();
    derived.forEach((trade) => {
      const label = classifyAlignment(trade.emotionTag, trade.emotionalState);
      map.set(label, (map.get(label) ?? 0) + 1);
    });
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [derived]);

  const lowRRCount = derived.filter(
    (trade) => trade.rr !== null && trade.rr < 1
  ).length;
  const earlyExitCount = derived.filter((trade) =>
    trade.exitReason.toLowerCase().includes("early")
  ).length;
  const stopHits = derived.filter((trade) =>
    trade.exitReason.toLowerCase().includes("stop")
  ).length;
  const targetHits = derived.filter((trade) =>
    trade.exitReason.toLowerCase().includes("target")
  ).length;

  const overtradeDays = derived.reduce<
    Record<
      string,
      { date: string; accountName: string; count: number; limit: number }
    >
  >((acc, trade) => {
    const account = trade.accountId
      ? accountById.get(trade.accountId)
      : defaultTradingAccount;
    const accountKey = account?.id ?? "unassigned";
    const key = `${trade.date}:${accountKey}`;
    const existing = acc[key] ?? {
      date: trade.date,
      accountName: account?.name ?? "Unassigned account",
      count: 0,
      limit: account?.dailyTradeLimit ?? DEFAULT_DAILY_TRADE_LIMIT
    };
    existing.count += 1;
    acc[key] = existing;
    return acc;
  }, {});
  const overtradeList = Object.values(overtradeDays)
    .filter((row) => row.count > row.limit)
    .sort((a, b) => b.count - b.limit - (a.count - a.limit));

  const bestStrategy = strategyStats[0];
  const worstStrategy = strategyStats[strategyStats.length - 1];

  const bestDay = [...dayStats].sort((a, b) => b.totalPl - a.totalPl)[0];
  const worstDay = [...dayStats].sort((a, b) => a.totalPl - b.totalPl)[0];

  const learningStats = useMemo(() => {
    const grouped = new Map<string, { label: string; count: number }>();
    derived.forEach((trade) => {
      const label = trade.learning?.trim();
      if (!label) return;
      const key = label.toLowerCase();
      const existing = grouped.get(key);
      grouped.set(key, { label: existing?.label ?? label, count: (existing?.count ?? 0) + 1 });
    });
    return [...grouped.values()].sort((a, b) => b.count - a.count);
  }, [derived]);
  const topLearning = learningStats[0] ?? null;

  const dailyPerformance = useMemo(() => {
    const map = new Map<string, { date: string; trades: number; totalPl: number; wins: number }>();
    derived.forEach((trade) => {
      const current = map.get(trade.date) ?? { date: trade.date, trades: 0, totalPl: 0, wins: 0 };
      current.trades += 1;
      current.totalPl += trade.pl;
      if (trade.pl > 0) current.wins += 1;
      map.set(trade.date, current);
    });
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [derived]);

  const selectedMonthInfo = useMemo(() => {
    const anchor = dailyPerformance[dailyPerformance.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
    const [yearText, monthText] = anchor.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(year, monthIndex, 1)
    );
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const firstDay = new Date(year, monthIndex, 1).getDay();
    const mondayOffset = (firstDay + 6) % 7;
    const byDay = new Map(dailyPerformance.map((row) => [Number(row.date.slice(8, 10)), row]));
    const cells = Array.from({ length: Math.ceil((mondayOffset + dayCount) / 7) * 7 }, (_, index) => {
      const dayNumber = index - mondayOffset + 1;
      if (dayNumber < 1 || dayNumber > dayCount) {
        return { dayNumber: null as number | null, row: null as (typeof dailyPerformance)[number] | null };
      }
      return { dayNumber, row: byDay.get(dayNumber) ?? null };
    });
    return { monthLabel, cells };
  }, [dailyPerformance]);

  const bestCalendarDay = dailyPerformance.length
    ? [...dailyPerformance].sort((a, b) => b.totalPl - a.totalPl)[0]
    : null;
  const worstCalendarDay = dailyPerformance.length
    ? [...dailyPerformance].sort((a, b) => a.totalPl - b.totalPl)[0]
    : null;

  const behaviorQualityRows = [
    { label: "Followed plan", value: Math.max(0, safeRiskStats.safe.count), tone: "good" },
    { label: "Exited early", value: earlyExitCount, tone: "neutral" },
    { label: "Low R:R trades", value: lowRRCount, tone: "bad" },
    { label: "Stop hits", value: stopHits, tone: "bad" },
    { label: "Target hits", value: targetHits, tone: "good" }
  ];
  const maxBehaviorQuality = Math.max(1, ...behaviorQualityRows.map((row) => row.value));

  const selectedJournalTrade = selectedJournalTradeId
    ? derived.find((trade) => trade.tradeId === selectedJournalTradeId) ?? null
    : null;
  const selectedJournalIndex = selectedJournalTrade
    ? derived.findIndex((trade) => trade.tradeId === selectedJournalTrade.tradeId)
    : -1;
  const previousJournalTrade = selectedJournalIndex > 0 ? derived[selectedJournalIndex - 1] : null;
  const nextJournalTrade =
    selectedJournalIndex >= 0 && selectedJournalIndex < derived.length - 1
      ? derived[selectedJournalIndex + 1]
      : null;

  const aiSummary = useMemo(() => {
    const performance: string[] = [];
    const strategy: string[] = [];
    const behavior: string[] = [];
    const right: string[] = [];
    const wrong: string[] = [];

    if (summary.totalTrades === 0) {
      performance.push("Log a few trades to generate deeper insights.");
    } else {
      performance.push(
        `Win rate ${formatPercent(summary.winRate)} with expectancy ${expectancyLabel}.`
      );
      if (summary.profitFactor !== null) {
        performance.push(`Profit factor ${summary.profitFactor.toFixed(2)}.`);
      }
      if (summary.avgRR !== null && summary.avgRR < 1) {
        performance.push("Average R:R below 1 — tighten exits or targets.");
      }
      if (summary.maxDrawdown !== 0) {
        performance.push(
          `Max drawdown ${signedMoney2.format(summary.maxDrawdown)}.`
        );
      }
    }

    if (monthBreakdown.length >= 2) {
      const last = monthBreakdown[monthBreakdown.length - 1];
      const prev = monthBreakdown[monthBreakdown.length - 2];
      const delta = last.value - prev.value;
      performance.push(
        `Latest month ${delta >= 0 ? "up" : "down"} ${signedMoney0.format(
          Math.abs(delta)
        )} vs prior.`
      );
    }

    if (bestStrategy) {
      strategy.push(
        `Best: ${bestStrategy.name} (${signedMoney2.format(
          bestStrategy.totalPl
        )}).`
      );
    }
    if (worstStrategy && worstStrategy !== bestStrategy) {
      strategy.push(
        `Weakest: ${worstStrategy.name} (${signedMoney2.format(
          worstStrategy.totalPl
        )}).`
      );
    }
    if (strategyStats.length) {
      const topWin = [...strategyStats].sort(
        (a, b) => b.winRate - a.winRate
      )[0];
      if (topWin) {
        strategy.push(
          `Top win rate: ${topWin.name} (${formatPercent(topWin.winRate)}).`
        );
      }
    }
    if (bestDay) {
      strategy.push(`Best day: ${bestDay.day}.`);
    }

    if (!strategy.length) {
      strategy.push("Add strategy tags to compare playbooks.");
    }

    if (lowRRCount > 0) {
      behavior.push(`Low R:R trades: ${lowRRCount}.`);
    }
    if (earlyExitCount > 0) {
      behavior.push(`Early exits: ${earlyExitCount}.`);
    }
    if (stopHits || targetHits) {
      behavior.push(`Stop hits ${stopHits} vs targets ${targetHits}.`);
    }
    if (overtradeList.length) {
      const top = overtradeList[0];
      behavior.push(
        `Daily limit broken on ${top.date} in ${top.accountName}: ${top.count}/${top.limit} trades.`
      );
    }

    if (summary.totalTrades === 0) {
      right.push("No review signals yet. Add trades to build feedback.");
      wrong.push("No mistakes detected yet because there are no trades.");
    } else {
      if (summary.totalPl > 0) {
        right.push(`Net profitable: ${signedMoney2.format(summary.totalPl)}.`);
      }
      if (summary.avgRR !== null && summary.avgRR >= 1) {
        right.push(`Average R:R held above 1 at ${summary.avgRR.toFixed(2)}.`);
      }
      if (targetHits > stopHits) {
        right.push(`More target exits than stop exits: ${targetHits} vs ${stopHits}.`);
      }
      if (safeRiskStats.safe.count > 0 && safeRiskStats.safe.totalPl >= safeRiskStats.risky.totalPl) {
        right.push("Safer trades are carrying performance better than risky trades.");
      }
      if (summary.totalPl < 0) {
        wrong.push(`Net loss: ${signedMoney2.format(summary.totalPl)}.`);
      }
      if (lowRRCount > 0) {
        wrong.push(`${lowRRCount} trades had R:R below 1.`);
      }
      if (earlyExitCount > 0) {
        wrong.push(`${earlyExitCount} early exits need review.`);
      }
      if (stopHits > targetHits) {
        wrong.push(`Stop exits beat target exits: ${stopHits} vs ${targetHits}.`);
      }
      if (overtradeList.length) {
        const top = overtradeList[0];
        wrong.push(
          `${top.accountName} crossed the daily limit on ${top.date}: ${top.count}/${top.limit} trades.`
        );
      }
      if (!right.length) {
        right.push("You kept journaling enough data for review. Keep the sample growing.");
      }
      if (!wrong.length) {
        wrong.push("No major discipline flags in the current filter.");
      }
    }

    if (!behavior.length) {
      behavior.push("Execution looks consistent. Keep tracking.");
    }

    return { performance, strategy, behavior, right, wrong };
  }, [
    summary,
    expectancyLabel,
    formatPercent,
    signedMoney2,
    signedMoney0,
    monthBreakdown,
    bestStrategy,
    worstStrategy,
    strategyStats,
    bestDay,
    lowRRCount,
    earlyExitCount,
    stopHits,
    targetHits,
    overtradeList,
    safeRiskStats
  ]);

  const kpis = [
    { label: "Overall P/L", value: signedMoney0.format(summary.totalPl) },
    { label: "Total trades", value: summary.totalTrades.toString() },
    { label: "Win %", value: formatPercent(summary.winRate) },
    { label: "Avg profit", value: money2.format(summary.avgWin) },
    { label: "Avg loss", value: money2.format(-summary.avgLoss) },
    { label: "Max profit", value: signedMoney2.format(summary.maxProfitTrade) },
    { label: "Max loss", value: signedMoney2.format(summary.maxLossTrade) },
    { label: "Expectancy", value: expectancyLabel },
    { label: "Profit factor", value: profitFactorLabel },
    { label: "Max drawdown", value: signedMoney2.format(summary.maxDrawdown) }
  ];

  async function handleShareMonthlyPnl() {
    if (!monthBreakdown.length) {
      setShareStatus("No monthly data to share yet.");
      setTimeout(() => setShareStatus(""), 1800);
      return;
    }
    const payload = {
      currency,
      totalPl: summary.totalPl,
      generatedAt: new Date().toISOString(),
      months: monthBreakdown.map((row) => ({
        label: row.label,
        value: row.value
      }))
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const link = `${window.location.origin}/share/monthly?data=${encoded}`;
    setShareLink(link);
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Trade Journal - Monthly P&L",
          text: "Monthly P&L report",
          url: link
        });
        setShareStatus("Share link generated and shared.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setShareStatus("Share link copied.");
      } else {
        setShareStatus("Share link generated.");
      }
    } catch {
      setShareStatus("Share cancelled.");
    }
    setTimeout(() => setShareStatus(""), 2200);
  }

  function updateJournalDailyInput(
    date: string,
    patch: Partial<JournalDailyInput>
  ) {
    if (!date) return;
    setJournalDailyInputs((prev) => {
      const current = prev[date] ?? EMPTY_JOURNAL_DAILY_INPUT;
      return {
        ...prev,
        [date]: {
          ...current,
          ...patch
        }
      };
    });
  }


  function handleSaveChecklistAndSnapshot() {
    if (!journalDailyDate) {
      setChecklistSaveStatus("Select a date first.");
      setTimeout(() => setChecklistSaveStatus(""), 1800);
      return;
    }
    const snapshotForDate = normalizeSnapshotRows(marketSnapshotRows);
    const nextSnapshots = {
      ...marketSnapshotsByDate,
      [journalDailyDate]: snapshotForDate
    };

    try {
      localStorage.setItem(checklistStorageKey, JSON.stringify(journalDailyInputs));
      localStorage.setItem(marketSnapshotStorageKey, JSON.stringify(nextSnapshots));
      setMarketSnapshotsByDate(nextSnapshots);
      setMarketSnapshotRows(DEFAULT_MARKET_SNAPSHOT_ROWS);
    } catch {
      setChecklistSaveStatus("Could not save.");
      setTimeout(() => setChecklistSaveStatus(""), 1800);
      return;
    }

    if (dataSource !== "supabase" || !supabase || !session?.user?.id) {
      setChecklistSaveStatus("Checklist + snapshot saved. Snapshot form reset.");
      setTimeout(() => setChecklistSaveStatus(""), 1800);
      return;
    }

    void supabase
      .from("journal_daily_entries")
      .upsert(
        toJournalDailySupabaseRow(
          session.user.id,
          journalDailyDate,
          journalDailyInputs[journalDailyDate] ?? EMPTY_JOURNAL_DAILY_INPUT,
          snapshotForDate
        ),
        { onConflict: "user_id,entry_date" }
      )
      .then(({ error }) => {
        setChecklistSaveStatus(
          error
            ? `Saved locally, but Supabase sync failed: ${error.message}`
            : "Checklist + snapshot saved. Snapshot form reset."
        );
        setTimeout(() => setChecklistSaveStatus(""), 2200);
      });
  }

  function handleMarketSnapshotInput(
    label: string,
    field: "previous" | "current",
    rawValue: string
  ) {
    const trimmed = rawValue.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    const value = Number.isFinite(parsed as number) ? (parsed as number) : null;
    setMarketSnapshotRows((prev) =>
      prev.map((row) => {
        if (row.label !== label) return row;
        const nextRow: MarketSnapshotRow = {
          ...row,
          [field]: value
        };
        nextRow.diffPct =
          nextRow.current !== null &&
          nextRow.previous !== null &&
          nextRow.previous !== 0
            ? ((nextRow.current - nextRow.previous) / nextRow.previous) * 100
            : null;
        return nextRow;
      })
    );
  }

  function readLegacySavedMarketSnapshot(month: string): MarketSnapshotRow[] | null {
    try {
      const raw = localStorage.getItem(`${marketSnapshotStorageKey}_${month}`);
      if (!raw) return null;
      return normalizeSnapshotRows(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function handleGenerateJournalSummaryLink() {
    const monthPrefix = `${journalSummaryMonth}-`;
    const monthTrades = deriveTrades(
      tradeList.filter(
        (trade) =>
          trade.date.startsWith(monthPrefix) &&
          (globalAccount === "all" || trade.accountId === globalAccount)
      )
    );

    if (!monthTrades.length) {
      setJournalSummaryStatus("No trades found for selected month.");
      setTimeout(() => setJournalSummaryStatus(""), 1800);
      return;
    }

    const legacySnapshotRows = readLegacySavedMarketSnapshot(journalSummaryMonth);

    const grouped = new Map<
      string,
      Array<{
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
        remarks: string;
        pnlScreenshotUrl: string;
      }>
    >();
    monthTrades.forEach((trade) => {
      const current = grouped.get(trade.date) ?? [];
      current.push({
        tradeId: trade.tradeId,
        instrument: trade.instrument,
        strategy: trade.strategy,
        direction: trade.direction,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        tradeDuration:
          typeof trade.tradeDuration === "number"
            ? `${trade.tradeDuration}m`
            : String(trade.tradeDuration ?? "—"),
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pl: trade.pl,
        exitReason: trade.exitReason,
        chartUrl: trade.chartUrl ?? "",
        remarks: trade.remarks ?? "",
        pnlScreenshotUrl: trade.pnlScreenshotUrl ?? ""
      });
      grouped.set(trade.date, current);
    });

    const sortedGroupedEntries = Array.from(grouped.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    const days = await Promise.all(
      sortedGroupedEntries.map(async ([date, trades]) => {
        const totalPl = trades.reduce((sum, trade) => sum + trade.pl, 0);
        const wins = trades.filter((trade) => trade.pl > 0).length;
        const winRate = trades.length ? (wins / trades.length) * 100 : 0;
        const motivationQuote = journalDailyInputs[date]?.motivationQuote?.trim() || "—";
        return {
          date,
          motivationQuote,
          trades,
          summary: {
            totalTrades: trades.length,
            totalPl,
            winRate
          },
          marketSnapshot:
            marketSnapshotsByDate[date] ??
            legacySnapshotRows ??
            (journalDailyDate === date
              ? normalizeSnapshotRows(marketSnapshotRows)
              : DEFAULT_MARKET_SNAPSHOT_ROWS),
          checklist: {
            sentimentToday:
              journalDailyInputs[date]?.sentimentToday.trim() || "—",
            viewOutcome:
              journalDailyInputs[date]?.viewOutcome.trim() || "—",
            previousDayMarket:
              journalDailyInputs[date]?.previousDayMarket.trim() || "—",
            observations:
              journalDailyInputs[date]?.observations.trim() || "",
            notes: journalDailyInputs[date]?.notes.trim() || ""
          }
        };
      })
    );

    const totalTrades = monthTrades.length;
    const totalPl = monthTrades.reduce((sum, trade) => sum + trade.pl, 0);
    const wins = monthTrades.filter((trade) => trade.pl > 0).length;
    const losses = monthTrades.filter((trade) => trade.pl < 0).length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const bestDay = [...days].sort((a, b) => b.summary.totalPl - a.summary.totalPl)[0];
    const worstDay = [...days].sort((a, b) => a.summary.totalPl - b.summary.totalPl)[0];

    const payload = {
      month: journalSummaryMonth,
      currency,
      generatedAt: new Date().toISOString(),
      ownerUserId: session?.user?.id,
      days,
      monthlySummary: {
        totalTrades,
        totalPl,
        wins,
        losses,
        winRate,
        bestDay: bestDay
          ? { date: bestDay.date, totalPl: bestDay.summary.totalPl }
          : null,
        worstDay: worstDay
          ? { date: worstDay.date, totalPl: worstDay.summary.totalPl }
          : null
      }
    };

    const shareLinkMapKey =
      dataSource === "supabase" && session?.user?.id
        ? `${SHARE_LINK_IDS_KEY}_${session.user.id}`
        : SHARE_LINK_IDS_KEY;
    let existingId = "";
    try {
      const raw = localStorage.getItem(shareLinkMapKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        existingId = String(parsed?.[journalSummaryMonth] ?? "");
      }
    } catch {
      existingId = "";
    }
    if (!existingId && journalSummaryLink.includes("id=")) {
      try {
        const currentId = new URL(journalSummaryLink).searchParams.get("id") ?? "";
        existingId = currentId.trim();
      } catch {
        // ignore parse errors
      }
    }

    let link = "";
    let usedReducedPayload = false;
    try {
      let response = await fetch("/api/share-journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, id: existingId || undefined })
      });
      if (!response.ok) {
        const reducedPayload = stripLargeSharedMedia(payload);
        response = await fetch("/api/share-journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: reducedPayload, id: existingId || undefined })
        });
        usedReducedPayload = response.ok;
      }
      if (response.ok) {
        const data = (await response.json()) as { id?: string };
        if (data.id) {
          try {
            const raw = localStorage.getItem(shareLinkMapKey);
            const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            localStorage.setItem(
              shareLinkMapKey,
              JSON.stringify({ ...parsed, [journalSummaryMonth]: data.id })
            );
          } catch {
            // ignore local mapping write failures
          }
          link = `${window.location.origin}/share/journal-daily?id=${data.id}`;
        }
      }
    } catch {
      // fallback handled below
    }

    if (!link) {
      setJournalSummaryStatus(
        "Share link could not be generated. Try removing screenshot or saving fewer records."
      );
      setTimeout(() => setJournalSummaryStatus(""), 2600);
      return;
    }

    setJournalSummaryLink(link);
    try {
      await navigator.clipboard.writeText(link);
      setJournalSummaryStatus(
        usedReducedPayload
          ? "Summary link generated and copied. Screenshot embeds were skipped."
          : "Summary link generated and copied."
      );
    } catch {
      setJournalSummaryStatus(
        usedReducedPayload
          ? "Summary link generated. Screenshot embeds were skipped."
          : "Summary link generated."
      );
    }
    setTimeout(() => setJournalSummaryStatus(""), 2200);
  }

  const sectionNavIds: DashboardSection[] = ["overview"];

  const handleSectionNav = (id: DashboardSection) => {
    setActiveSection(id);
    const target = document.getElementById(id);
    if (!target) return;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - 110;
    window.scrollTo({ top: Math.max(targetTop, 0), behavior: "smooth" });
    window.history.replaceState(null, "", "/dashboard");
  };

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadExcelXml(xml: string, filename: string) {
    const blob = new Blob([xml], {
      type: "application/vnd.ms-excel;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    const csv = buildCsv(derived);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `pulsejournal-export-${stamp}.csv`);
  }

  function handleExportDateWiseExcel() {
    const excel = buildDateWiseExcelXml(derived);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadExcelXml(excel, `pulsejournal-date-tabs-${stamp}.xls`);
  }

  function handleDownloadTemplate() {
    const csv = buildTemplateCsv();
    downloadCsv(csv, "pulsejournal-template.csv");
  }

  async function handleImportFile(file: File) {
    setImportStatus(null);
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      setImportStatus("No rows found in CSV.");
      return;
    }

    const headerRow = rows[0];
    const headerMap = new Map<string, number>();
    headerRow.forEach((cell, index) => {
      headerMap.set(normalizeHeader(cell), index);
    });

    const missing = REQUIRED_HEADERS.filter(
      (header) => !headerMap.has(normalizeHeader(header))
    );

    if (missing.length) {
      setImportStatus(`Missing headers: ${missing.join(", ")}`);
      return;
    }

    const importStamp = Date.now();
    const imported: Trade[] = [];
    let skipped = 0;

    const getCell = (row: string[], header: string) => {
      const index = headerMap.get(normalizeHeader(header));
      return index === undefined ? "" : row[index] ?? "";
    };

    rows.slice(1).forEach((row, index) => {
      const tradeId =
        getCell(row, "Trade ID").trim() || `CSV-${importStamp}-${index + 1}`;
      const date = normalizeDate(getCell(row, "Date"));
      const instrument = getCell(row, "Instrument").trim();
      const market = getCell(row, "Market").trim() || "Equity";
      const entryTime = normalizeTime(getCell(row, "Entry Time"));
      const exitTime = normalizeTime(getCell(row, "Exit Time"));
      const strategy = getCell(row, "Strategy").trim() || "Unspecified";
      const directionRaw = getCell(row, "Direction").toLowerCase();
      const direction = directionRaw.includes("short") ? "Short" : "Long";
      const sizeQty = parseNumber(getCell(row, "Size (Qty.)"));
      const entryPrice = parseNumber(getCell(row, "Entry Price"));
      const exitPrice = parseNumber(getCell(row, "Exit Price"));
      const stopLoss = parseNumber(getCell(row, "Stop Loss"));
      const targetPrice = parseNumber(getCell(row, "Target Price"));
      const exitReason = getCell(row, "Exit Reason").trim() || "Manual";
      const platform = getCell(row, "Platform").trim() || "Web";
      const tradeTypeRaw = getCell(row, "Trade Type").trim();
      const tradeType =
        tradeTypeRaw === "Safe" || tradeTypeRaw === "Risky"
          ? tradeTypeRaw
          : undefined;
      const emotionTag = getCell(row, "Trigger Emotion").trim();
      const emotionalState = getCell(row, "Behavioral State").trim();
      const mindsetNotes = getCell(row, "Mindset Notes").trim();
      const learning = getCell(row, "Learning").trim();
      const entryReason = getCell(row, "Entry Reason").trim();
      const chartUrl = normalizeUrl(getCell(row, "Chart Link").trim());
      const pnlScreenshotUrl = normalizeUrl(
        getCell(row, "PnL Screenshot Link").trim()
      );

      if (
        !date ||
        !instrument ||
        !entryTime ||
        !exitTime ||
        sizeQty === null ||
        entryPrice === null ||
        exitPrice === null ||
        stopLoss === null ||
        targetPrice === null
      ) {
        skipped += 1;
        return;
      }

      imported.push({
        tradeId,
        date,
        accountId: defaultTradingAccount?.id,
        instrument,
        market,
        entryTime,
        exitTime,
        strategy,
        direction,
        sizeQty,
        lots: 1,
        lotSize: sizeQty,
        entryPrice,
        exitPrice,
        stopLoss,
        targetPrice,
        exitReason,
        platform,
        chartUrl: chartUrl || undefined,
        pnlScreenshotUrl: pnlScreenshotUrl || undefined,
        remarks: entryReason || undefined,
        tradeType,
        emotionTag: emotionTag || undefined,
        emotionalState: emotionalState || undefined,
        mindsetNotes: mindsetNotes || undefined,
        learning: learning || undefined
      });
    });

    if (!imported.length) {
      setImportStatus("No valid rows found. Check required fields.");
      return;
    }

    if (dataSource === "supabase") {
      if (!supabase) {
        setImportStatus("Supabase is not configured.");
        return;
      }
      if (!session) {
        setImportStatus("Please sign in to import trades.");
        return;
      }
      if (replaceOnImport) {
        const { error: deleteError } = await supabase
          .from("trades")
          .delete()
          .eq("user_id", session.user.id)
          .is("team_id", null);
        if (deleteError) {
          setImportStatus(`Supabase delete failed: ${deleteError.message}`);
          return;
        }
      }
      const { error } = await supabase
        .from("trades")
        .upsert(
          imported.map((trade) => toSupabaseRow(trade, session.user.id)),
          { onConflict: "user_id,trade_id" }
        );
      if (error) {
        setImportStatus(`Supabase import failed: ${error.message}`);
        return;
      }
      const { data } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .is("team_id", null)
        .order("date", { ascending: false })
        .order("entry_time", { ascending: false });
      if (data) {
        setTradeList(data.map((row) => fromSupabaseRow(row)));
      }
    } else {
      if (replaceOnImport) {
        setTradeList(imported);
      } else {
        setTradeList((prev) => [...imported, ...prev]);
      }
    }

    setImportStatus(
      `Imported ${imported.length} trade${imported.length === 1 ? "" : "s"}${
        skipped ? `, skipped ${skipped}` : ""
      }.`
    );
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setTradeList([]);
    router.replace("/sign-in");
  }

  async function handleClearAllTrades() {
    if (!window.confirm("Clear all trades? This cannot be undone.")) {
      return;
    }

    if (dataSource === "supabase") {
      if (!supabase) return;
      if (!session) return;
      const { error } = await supabase
        .from("trades")
        .delete()
        .eq("user_id", session.user.id)
        .is("team_id", null);
      if (error) {
        setImportStatus(`Supabase clear failed: ${error.message}`);
        return;
      }
      setTradeList([]);
      setImportStatus("All trades cleared.");
      return;
    }

    setTradeList([]);
    setImportStatus("All trades cleared.");
  }

  async function reloadTradesFromSupabase() {
    if (!supabase || !session) return null;
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", session.user.id)
      .is("team_id", null)
      .order("date", { ascending: false })
      .order("entry_time", { ascending: false });
    if (error) return error.message;
    if (data) setTradeList(data.map((row) => fromSupabaseRow(row)));
    return null;
  }

  async function handleJournalAddTrade(trade: Trade) {
    if (dataSource === "supabase") {
      if (!supabase) return "Supabase is not configured.";
      if (!session) return "Please sign in to save trades.";
      const { error } = await supabase
        .from("trades")
        .insert(toSupabaseRow(withValidAccountId(trade, accounts), session.user.id));
      if (error) {
        setImportStatus(`Supabase insert failed: ${error.message}`);
        return `Supabase error: ${error.message}`;
      }
      const reloadError = await reloadTradesFromSupabase();
      if (reloadError) return `Supabase fetch error: ${reloadError}`;
    } else {
      setTradeList((prev) => [trade, ...prev]);
    }
    setJournalFormOpen(false);
    setEditingTrade(null);
    setSelectedJournalTradeId(trade.tradeId);
    return null;
  }

  async function handleJournalUpdateTrade(trade: Trade) {
    if (dataSource === "supabase") {
      if (!supabase) return "Supabase is not configured.";
      if (!session) return "Please sign in to save trades.";
      const { error } = await supabase
        .from("trades")
        .update(toSupabaseRow(withValidAccountId(trade, accounts), session.user.id))
        .eq("user_id", session.user.id)
        .eq("trade_id", trade.tradeId);
      if (error) {
        setImportStatus(`Supabase update failed: ${error.message}`);
        return `Supabase error: ${error.message}`;
      }
      const reloadError = await reloadTradesFromSupabase();
      if (reloadError) return `Supabase fetch error: ${reloadError}`;
    } else {
      setTradeList((prev) =>
        prev.map((item) => (item.tradeId === trade.tradeId ? trade : item))
      );
    }
    setJournalFormOpen(false);
    setEditingTrade(null);
    setSelectedJournalTradeId(trade.tradeId);
    return null;
  }

  function handleEditTrade(trade: Trade) {
    setEditingTrade(trade);
    setJournalFormOpen(true);
  }

  async function handleDeleteTrades(tradeIds: string[]) {
    if (!tradeIds.length) return;
    if (!window.confirm("Delete selected trade(s)? This cannot be undone.")) {
      return;
    }
    if (dataSource === "supabase") {
      if (!supabase) return;
      if (!session) return;
      const { error } = await supabase
        .from("trades")
        .delete()
        .eq("user_id", session.user.id)
        .in("trade_id", tradeIds);
      if (error) {
        setImportStatus(`Supabase delete failed: ${error.message}`);
        return;
      }
      const { data, error: fetchError } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .is("team_id", null)
        .order("date", { ascending: false })
        .order("entry_time", { ascending: false });
      if (fetchError) {
        setImportStatus(`Supabase fetch failed: ${fetchError.message}`);
        return;
      }
      if (data) {
        setTradeList(data.map((row) => fromSupabaseRow(row)));
      }
      setImportStatus(`Deleted ${tradeIds.length} trade(s).`);
      return;
    }

    setTradeList((prev) =>
      prev.filter((trade) => !tradeIds.includes(trade.tradeId))
    );
    setImportStatus(`Deleted ${tradeIds.length} trade(s).`);
  }

  async function handlePasswordUpdate() {
    setProfileStatus("");
    if (!supabase) {
      setProfileStatus("Supabase is not configured.");
      return;
    }
    if (!passwordNext || passwordNext.length < 8) {
      setProfileStatus("Password must be at least 8 characters.");
      return;
    }
    if (passwordNext !== passwordConfirm) {
      setProfileStatus("Passwords do not match.");
      return;
    }
    const { error } = await supabase.auth.updateUser({
      password: passwordNext
    });
    if (error) {
      setProfileStatus(error.message);
      return;
    }
    setPasswordNext("");
    setPasswordConfirm("");
    setProfileStatus("Password updated.");
  }

  function handleProfileImageUpload(file: File | null) {
    setProfileStatus("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileStatus("Please upload an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setProfileImage(result || null);
    };
    reader.readAsDataURL(file);
  }

  async function handleAddTradingAccount() {
    const name = normalizeAccountName(accountNameInput) || "Primary Account";
    const baseCapital = Math.max(0, Number(accountBaseCapitalInput || 0));
    const dailyTradeLimit = normalizeDailyTradeLimit(accountDailyTradeLimitInput);

    if (!name) {
      setAccountStatus("Account name is required.");
      return;
    }
    if (!Number.isFinite(baseCapital) || baseCapital < 0) {
      setAccountStatus("Base capital must be 0 or more.");
      return;
    }
    if (accounts.some((account) => account.name.toLowerCase() === name.toLowerCase())) {
      setAccountStatus("Account already exists.");
      return;
    }

    const nextAccount: TradingAccount = {
      id: buildAccountId(name),
      name,
      baseCapital,
      dailyTradeLimit,
      isDefault: accounts.length === 0
    };

    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setAccountStatus("Please sign in to add accounts.");
        return;
      }
      const { error } = await supabase
        .from("trading_accounts")
        .insert(toTradingAccountRow(session.user.id, nextAccount));
      if (error) {
        setAccountStatus(`Account save failed: ${error.message}`);
        return;
      }
    }

    setAccounts((prev) => normalizeAccountList([...prev, nextAccount]));
    setAccountNameInput("");
    setAccountBaseCapitalInput("");
    setAccountDailyTradeLimitInput(String(DEFAULT_DAILY_TRADE_LIMIT));
    setAccountStatus("Account added.");
    setTimeout(() => setAccountStatus(""), 1800);
  }

  async function handleSetDefaultAccount(accountId: string) {
    const nextAccounts = accounts.map((account) => ({
      ...account,
      isDefault: account.id === accountId
    }));

    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setAccountStatus("Please sign in to update default account.");
        return;
      }
      const payload = nextAccounts.map((account) => toTradingAccountRow(session.user.id, account));
      const { error } = await supabase
        .from("trading_accounts")
        .upsert(payload, { onConflict: "id" });
      if (error) {
        setAccountStatus(`Default update failed: ${error.message}`);
        return;
      }
    }

    setAccounts(nextAccounts);
    setAccountStatus("Default account updated.");
    setTimeout(() => setAccountStatus(""), 1800);
  }

  function beginEditAccount(account: TradingAccount) {
    setEditingAccountId(account.id);
    setEditingAccountName(account.name);
    setEditingAccountBaseCapital(String(account.baseCapital));
    setEditingAccountDailyTradeLimit(String(account.dailyTradeLimit));
    setAccountStatus("");
  }

  function cancelEditAccount() {
    setEditingAccountId(null);
    setEditingAccountName("");
    setEditingAccountBaseCapital("");
    setEditingAccountDailyTradeLimit("");
  }

  async function handleSaveAccountEdit() {
    if (!editingAccountId) return;
    const name = normalizeAccountName(editingAccountName);
    const baseCapital = Math.max(0, Number(editingAccountBaseCapital || 0));
    const dailyTradeLimit = normalizeDailyTradeLimit(editingAccountDailyTradeLimit);

    if (!name) {
      setAccountStatus("Account name is required.");
      return;
    }
    if (!Number.isFinite(baseCapital) || baseCapital < 0) {
      setAccountStatus("Base capital must be 0 or more.");
      return;
    }
    if (accounts.some((account) => account.id !== editingAccountId && account.name.toLowerCase() === name.toLowerCase())) {
      setAccountStatus("Another account already uses this name.");
      return;
    }

    const nextAccounts = accounts.map((account) =>
      account.id === editingAccountId
        ? { ...account, name, baseCapital, dailyTradeLimit }
        : account
    );

    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setAccountStatus("Please sign in to edit accounts.");
        return;
      }
      const payload = nextAccounts.map((account) => toTradingAccountRow(session.user.id, account));
      const { error } = await supabase
        .from("trading_accounts")
        .upsert(payload, { onConflict: "id" });
      if (error) {
        setAccountStatus(`Account update failed: ${error.message}`);
        return;
      }
    }

    setAccounts(nextAccounts);
    cancelEditAccount();
    setAccountStatus("Account updated.");
    setTimeout(() => setAccountStatus(""), 1800);
  }

  async function handleDeleteAccount(accountId: string) {
    const target = accounts.find((account) => account.id === accountId);
    if (!target) return;
    if (accounts.length <= 1) {
      setAccountStatus("Keep at least one account.");
      return;
    }
    const linkedTrades = tradeList.filter((trade) => trade.accountId === accountId).length;
    if (linkedTrades > 0) {
      setAccountStatus("Move or delete trades from this account first.");
      return;
    }
    if (!window.confirm(`Delete account ${target.name}?`)) {
      return;
    }

    const remaining = accounts.filter((account) => account.id !== accountId);
    const nextAccounts = remaining.some((account) => account.isDefault)
      ? remaining
      : remaining.map((account, index) => ({ ...account, isDefault: index === 0 }));

    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setAccountStatus("Please sign in to delete accounts.");
        return;
      }
      const { error } = await supabase
        .from("trading_accounts")
        .delete()
        .eq("user_id", session.user.id)
        .eq("id", accountId);
      if (error) {
        setAccountStatus(`Account delete failed: ${error.message}`);
        return;
      }
      const { error: syncError } = await supabase
        .from("trading_accounts")
        .upsert(nextAccounts.map((account) => toTradingAccountRow(session.user.id, account)), { onConflict: "id" });
      if (syncError) {
        setAccountStatus(`Default sync failed: ${syncError.message}`);
        return;
      }
    }

    setAccounts(nextAccounts);
    if (globalAccount === accountId) {
      setGlobalAccount("all");
    }
    if (editingAccountId === accountId) {
      cancelEditAccount();
    }
    setAccountStatus("Account deleted.");
    setTimeout(() => setAccountStatus(""), 1800);
  }

  function handleAddInstrument() {
    const name = normalizeInstrumentName(instrumentNameInput);
    const lotSizeValue = Number(instrumentLotSizeInput);
    if (!name) {
      setInstrumentStatus("Instrument name is required.");
      return;
    }
    if (!Number.isFinite(lotSizeValue) || lotSizeValue <= 0) {
      setInstrumentStatus("Lot size must be a positive number.");
      return;
    }
    setInstruments((prev) => {
      if (prev.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        return prev;
      }
      return [
        {
          id: buildInstrumentId(name),
          name,
          lotSize: lotSizeValue
        },
        ...prev
      ];
    });
    setInstrumentNameInput("");
    setInstrumentLotSizeInput("1");
    setInstrumentStatus("Instrument added.");
    setTimeout(() => setInstrumentStatus(""), 1500);
  }

  function handleRemoveInstrument(id: string) {
    setInstruments((prev) => prev.filter((item) => item.id !== id));
    if (instrumentEditId === id) {
      setInstrumentEditId(null);
      setInstrumentEditName("");
      setInstrumentEditLotSize("");
    }
  }

  function beginEditInstrument(item: InstrumentDefinition) {
    setInstrumentEditId(item.id);
    setInstrumentEditName(item.name);
    setInstrumentEditLotSize(String(item.lotSize));
    setInstrumentStatus("");
  }

  function handleUpdateInstrument() {
    if (!instrumentEditId) return;
    const name = normalizeInstrumentName(instrumentEditName);
    const lotSizeValue = Number(instrumentEditLotSize);
    if (!name) {
      setInstrumentStatus("Instrument name is required.");
      return;
    }
    if (!Number.isFinite(lotSizeValue) || lotSizeValue <= 0) {
      setInstrumentStatus("Lot size must be a positive number.");
      return;
    }
    if (
      instruments.some(
        (item) =>
          item.id !== instrumentEditId &&
          item.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      setInstrumentStatus("Instrument already exists.");
      return;
    }
    setInstruments((prev) =>
      prev.map((item) =>
        item.id === instrumentEditId
          ? { ...item, name, lotSize: lotSizeValue }
          : item
      )
    );
    setInstrumentStatus("Instrument updated.");
    setInstrumentEditId(null);
    setInstrumentEditName("");
    setInstrumentEditLotSize("");
    setTimeout(() => setInstrumentStatus(""), 1500);
  }

  function cancelEditInstrument() {
    setInstrumentEditId(null);
    setInstrumentEditName("");
    setInstrumentEditLotSize("");
  }

  function handleAddStrategy() {
    const name = strategyNameInput.trim();
    const rules = strategyRulesInput.trim();
    if (!name) {
      setStrategyStatus("Strategy name is required.");
      return;
    }
    if (
      strategies.some((item) => item.name.toLowerCase() === name.toLowerCase())
    ) {
      setStrategyStatus("Strategy already exists.");
      return;
    }
    setStrategies((prev) => [
      {
        id: `STR-${Date.now()}`,
        name,
        rules
      },
      ...prev
    ]);
    setStrategyNameInput("");
    setStrategyRulesInput("");
    setStrategyStatus("Strategy added.");
    setTimeout(() => setStrategyStatus(""), 1500);
  }

  function handleRemoveStrategy(id: string) {
    setStrategies((prev) => prev.filter((item) => item.id !== id));
  }

  function handleAddParticipantFlow() {
    const futureBuyQty = Number(flowFutureBought);
    const futureSellQty = Number(flowFutureSold);
    const callBuyQty = Number(flowCallBought);
    const putBuyQty = Number(flowPutBought);
    const callQty = Number(flowCallSold);
    const putQty = Number(flowPutSold);
    if (!flowDate) {
      setFlowStatus("Date is required.");
      return;
    }
    if (!Number.isFinite(callBuyQty) || callBuyQty < 0) {
      setFlowStatus("Call buy qty should be 0 or more.");
      return;
    }
    if (!Number.isFinite(futureBuyQty) || futureBuyQty < 0) {
      setFlowStatus("Future buy qty should be 0 or more.");
      return;
    }
    if (!Number.isFinite(futureSellQty) || futureSellQty < 0) {
      setFlowStatus("Future sold qty should be 0 or more.");
      return;
    }
    if (!Number.isFinite(putBuyQty) || putBuyQty < 0) {
      setFlowStatus("Put buy qty should be 0 or more.");
      return;
    }
    if (!Number.isFinite(callQty) || callQty < 0) {
      setFlowStatus("Call sold qty should be 0 or more.");
      return;
    }
    if (!Number.isFinite(putQty) || putQty < 0) {
      setFlowStatus("Put sold qty should be 0 or more.");
      return;
    }
    const next: ParticipantFlow = {
      id: `PF-${Date.now()}`,
      date: flowDate,
      participant: flowParticipant,
      futureBoughtQty: futureBuyQty,
      futureSoldQty: futureSellQty,
      callBoughtQty: callBuyQty,
      putBoughtQty: putBuyQty,
      callSoldQty: callQty,
      putSoldQty: putQty
    };
    setParticipantFlows((prev) => [next, ...prev]);
    setFlowFutureBought("");
    setFlowFutureSold("");
    setFlowCallBought("");
    setFlowPutBought("");
    setFlowCallSold("");
    setFlowPutSold("");
    setFlowStatus("Participant activity saved.");
    setTimeout(() => setFlowStatus(""), 1500);
  }

  function handleRemoveParticipantFlow(id: string) {
    setParticipantFlows((prev) => prev.filter((item) => item.id !== id));
  }

  function handleAddSampleParticipantFlows() {
    const today = new Date().toISOString().slice(0, 10);
    setParticipantFlows((prev) => [
      {
        id: `PF-S-${Date.now()}-1`,
        date: today,
        participant: "FII",
        futureBoughtQty: 3200,
        futureSoldQty: 1800,
        callBoughtQty: 9000,
        putBoughtQty: 14000,
        callSoldQty: 12000,
        putSoldQty: 18000
      },
      {
        id: `PF-S-${Date.now()}-2`,
        date: today,
        participant: "Client",
        futureBoughtQty: 6400,
        futureSoldQty: 8000,
        callBoughtQty: 11000,
        putBoughtQty: 8400,
        callSoldQty: 9500,
        putSoldQty: 7600
      },
      ...prev
    ]);
    setFlowStatus("Sample participant data added.");
    setTimeout(() => setFlowStatus(""), 1500);
  }

  const fetchParticipantForDate = useCallback(async (date: string, silent = false) => {
    if (!silent) {
      setFlowStatus(`Fetching NiftyTrader data for ${date}...`);
    }
    try {
      const response = await fetch(
        `/api/participants-nse?date=${encodeURIComponent(date)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        items?: ParticipantFlow[];
        date?: string;
        source?: string;
        error?: string;
        details?: string[];
      };
      if (!response.ok) {
        const detailText =
          Array.isArray(payload.details) && payload.details.length
            ? ` (${payload.details.join(" | ")})`
            : "";
        throw new Error((payload.error || "NiftyTrader fetch failed.") + detailText);
      }
      const items = Array.isArray(payload.items) ? payload.items : [];
      const resolvedDate = payload.date ?? date;
      if (!items.length) {
        if (!silent) {
          setFlowStatus("No participant rows received from NSE.");
        }
        return null;
      }
      setParticipantFlows((prev) => {
        const kept = prev.filter((item) => item.date !== resolvedDate);
        return [...items, ...kept];
      });
      if (!silent && payload.date) {
        setParticipantViewDate(payload.date);
      }
      if (!silent) {
        setFlowStatus(
          `Fetched ${payload.source ?? "NiftyTrader"} participant data for ${resolvedDate}.`
        );
        setTimeout(() => setFlowStatus(""), 1800);
      }
      return resolvedDate;
    } catch (error) {
      if (!silent) {
        setFlowStatus(
          error instanceof Error ? error.message : "Could not fetch from NSE."
        );
      }
      return null;
    }
  }, []);

  async function handleFetchParticipantFromNse() {
    await fetchParticipantForDate(flowDate, false);
  }

  useEffect(() => {
    if (view !== "participants") return;
    const candidateDates = getRecentTradingDates(14);

    let cancelled = false;
    (async () => {
      let loaded = 0;
      let newestLoadedDate: string | null = null;
      for (const date of candidateDates) {
        if (cancelled) return;
        setParticipantFlows((prev) => prev.filter((item) => item.date !== date));
        const resolvedDate = await fetchParticipantForDate(date, true);
        if (resolvedDate) {
          loaded += 1;
          if (!newestLoadedDate || resolvedDate > newestLoadedDate) {
            newestLoadedDate = resolvedDate;
          }
        }
        if (loaded >= 5) {
          break;
        }
      }
      if (!cancelled && newestLoadedDate) {
        setParticipantViewDate(newestLoadedDate);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, fetchParticipantForDate]);

  const participantSummary = useMemo(() => {
    const grouped = new Map<
      ParticipantType,
      {
        futureBuy: number;
        futureSold: number;
        callBuy: number;
        putBuy: number;
        callSold: number;
        putSold: number;
      }
    >();
    participantFlows.forEach((item) => {
      const current = grouped.get(item.participant) ?? {
        futureBuy: 0,
        futureSold: 0,
        callBuy: 0,
        putBuy: 0,
        callSold: 0,
        putSold: 0
      };
      current.futureBuy += item.futureBoughtQty;
      current.futureSold += item.futureSoldQty;
      current.callBuy += item.callBoughtQty;
      current.putBuy += item.putBoughtQty;
      current.callSold += item.callSoldQty;
      current.putSold += item.putSoldQty;
      grouped.set(item.participant, current);
    });
    return (["FII", "DII", "Client", "Pro"] as ParticipantType[]).map((key) => {
      const row = grouped.get(key) ?? {
        futureBuy: 0,
        futureSold: 0,
        callBuy: 0,
        putBuy: 0,
        callSold: 0,
        putSold: 0
      };
      return {
        participant: key,
        futureBuy: row.futureBuy,
        futureSold: row.futureSold,
        callBuy: row.callBuy,
        putBuy: row.putBuy,
        callSold: row.callSold,
        putSold: row.putSold,
        netFutures: row.futureBuy - row.futureSold,
        netCalls: row.callBuy - row.callSold,
        netPuts: row.putBuy - row.putSold
      };
    });
  }, [participantFlows]);

  const participantDateOptions = useMemo(
    () =>
      Array.from(
        new Set(
          participantFlows
            .map((item) => item.date)
            .filter((date) => isWeekdayDate(date))
        )
      ).sort((a, b) => b.localeCompare(a)),
    [participantFlows]
  );

  useEffect(() => {
    if (!participantDateOptions.length) return;
    if (!participantDateOptions.includes(participantViewDate)) {
      setParticipantViewDate(participantDateOptions[0]);
    }
  }, [participantDateOptions, participantViewDate]);

  const participantActivityRows = useMemo(
    () => buildParticipantActivityRows(participantFlows, participantViewDate),
    [participantFlows, participantViewDate]
  );

  const participantOverallTrend = useMemo(() => {
    const fiiProRows = participantActivityRows.filter(
      (row) => row.participant === "FII" || row.participant === "Pro"
    );
    const score = participantActivityRows.reduce(
      (sum, row) => sum + row.score * Math.max(1, Math.abs(row.change)),
      0
    );
    const scopedScore = fiiProRows.reduce(
      (sum, row) => sum + row.score * Math.max(1, Math.abs(row.change)),
      0
    );
    const finalScore = fiiProRows.length ? scopedScore : score;
    if (finalScore > 0) return "Bullish";
    if (finalScore < 0) return "Bearish";
    return "Neutral";
  }, [participantActivityRows]);

  const participantViewDateDisplay = useMemo(() => {
    if (!participantViewDate) return "N/A";
    const [year, month, day] = participantViewDate.split("-");
    if (!year || !month || !day) return participantViewDate;
    return `${day}/${month}/${year}`;
  }, [participantViewDate]);

  const snapshotDates = useMemo(() => {
    const byDate = new Map<string, ParticipantFlow[]>();
    participantFlows.forEach((item) => {
      if (!isWeekdayDate(item.date)) return;
      const current = byDate.get(item.date) ?? [];
      current.push(item);
      byDate.set(item.date, current);
    });

    const validDates = Array.from(byDate.entries())
      .filter(([, rows]) => {
        const participants = new Set(rows.map((row) => row.participant));
        const hasAllParticipants =
          participants.has("FII") &&
          participants.has("DII") &&
          participants.has("Pro") &&
          participants.has("Client");
        if (!hasAllParticipants) return false;

        const totalAbsChange = rows.reduce(
          (sum, row) =>
            sum +
            Math.abs(row.futureBoughtQty - row.futureSoldQty) +
            Math.abs(row.callBoughtQty - row.callSoldQty) +
            Math.abs(row.putBoughtQty - row.putSoldQty),
          0
        );
        return totalAbsChange > 0;
      })
      .map(([date]) => date)
      .sort((a, b) => b.localeCompare(a));

    return validDates.slice(0, 5);
  }, [participantFlows]);


  const lastFiveDateTables = useMemo(() => {
    return snapshotDates.map((date) => {
      const rows = buildParticipantActivityRows(participantFlows, date);
      const fiiProRows = rows.filter(
        (row) => row.participant === "FII" || row.participant === "Pro"
      );
      const score = rows.reduce(
        (sum, row) => sum + row.score * Math.max(1, Math.abs(row.change)),
        0
      );
      const scopedScore = fiiProRows.reduce(
        (sum, row) => sum + row.score * Math.max(1, Math.abs(row.change)),
        0
      );
      const finalScore = fiiProRows.length ? scopedScore : score;
      return {
        date,
        display: date.split("-").reverse().join("/"),
        rows,
        ready: rows.some((row) => row.change !== 0),
        overallTrend:
          finalScore > 0 ? "Bullish" : finalScore < 0 ? "Bearish" : "Neutral"
      };
    });
  }, [participantFlows, snapshotDates]);


  function handleParticipantCsvDownload() {
    const lines = [
      `${participantViewDateDisplay} - Participant Wise Open Interest and Changes`,
      "Participant,Instrument,Change,Activity,Trend",
      ...participantActivityRows.map(
        (row) =>
          `${row.label},${row.instrument},${row.change},${row.activity},${row.trend}`
      ),
      `OVERALL TREND,,,,${participantOverallTrend}`
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `participant-activity-${participantViewDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleParticipantPngDownload() {
    const headers = ["Participant", "Instrument", "Change", "Activity", "Trend"];
    const rowHeight = 44;
    const titleHeight = 54;
    const headerHeight = 44;
    const footerHeight = 48;
    const tableRows = participantActivityRows.length;
    const width = 980;
    const height = titleHeight + headerHeight + tableRows * rowHeight + footerHeight;
    const colWidths = [180, 170, 190, 230, 210];
    const starts = [0, colWidths[0], colWidths[0] + colWidths[1], colWidths[0] + colWidths[1] + colWidths[2], colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3]];

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 28px Inter, system-ui, sans-serif";
    ctx.fillText(
      `${participantViewDateDisplay} - Participant Wise Open Interest and Changes`,
      24,
      36
    );

    const tableTop = titleHeight;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, tableTop, width, headerHeight);
    ctx.font = "700 18px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#0f172a";
    headers.forEach((header, index) => {
      const x = starts[index] + 16;
      const y = tableTop + 28;
      if (index === 2) {
        ctx.textAlign = "right";
        ctx.fillText(header, starts[index] + colWidths[index] - 16, y);
        ctx.textAlign = "left";
      } else {
        ctx.fillText(header, x, y);
      }
    });

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    for (let i = 0; i <= tableRows + 1; i += 1) {
      const y = tableTop + headerHeight + i * rowHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    starts.concat(width).forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, tableTop);
      ctx.lineTo(x, tableTop + headerHeight + tableRows * rowHeight);
      ctx.stroke();
    });

    ctx.font = "600 16px Inter, system-ui, sans-serif";
    participantActivityRows.forEach((row, index) => {
      const top = tableTop + headerHeight + index * rowHeight;
      const midY = top + 28;

      if (index % 3 === 0) {
        ctx.fillStyle = "#0f172a";
        ctx.font = "700 16px Inter, system-ui, sans-serif";
        ctx.fillText(row.label, 16, midY + rowHeight);
        ctx.font = "600 16px Inter, system-ui, sans-serif";
      }

      ctx.fillStyle = "#0f172a";
      ctx.fillText(row.instrument, starts[1] + 16, midY);
      ctx.textAlign = "right";
      ctx.fillText(
        row.change > 0 ? `+${row.change.toLocaleString()}` : row.change.toLocaleString(),
        starts[2] + colWidths[2] - 16,
        midY
      );
      ctx.textAlign = "left";

      ctx.fillStyle =
        row.activity.includes("Bought")
          ? "#047857"
          : row.activity.includes("Sold")
            ? "#be123c"
            : "#334155";
      ctx.fillText(row.activity, starts[3] + 16, midY);

      ctx.fillStyle =
        row.trend === "Bullish"
          ? "#047857"
          : row.trend === "Bearish"
            ? "#b91c1c"
            : "#334155";
      ctx.fillText(row.trend, starts[4] + 16, midY);
    });

    const footerTop = tableTop + headerHeight + tableRows * rowHeight;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, footerTop, width, footerHeight);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 20px Inter, system-ui, sans-serif";
    ctx.fillText("OVERALL TREND", 24, footerTop + 30);
    ctx.fillStyle =
      participantOverallTrend === "Bullish"
        ? "#34d399"
        : participantOverallTrend === "Bearish"
          ? "#f87171"
          : "#cbd5e1";
    ctx.fillText(participantOverallTrend, width - 220, footerTop + 30);

    const link = document.createElement("a");
    link.download = `participant-activity-${participantViewDate}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  const strategyBeingEdited = useMemo(() => {
    if (!editStrategyId) return null;
    return strategies.find((strategy) => strategy.id === editStrategyId) ?? null;
  }, [editStrategyId, strategies]);

  useEffect(() => {
    if (view !== "setup-edit") return;
    if (strategyBeingEdited) {
      setStrategyEditName(strategyBeingEdited.name);
      setStrategyEditRules(strategyBeingEdited.rules);
    } else {
      setStrategyEditName("");
      setStrategyEditRules("");
    }
    setStrategyEditStatus("");
  }, [view, strategyBeingEdited]);

  function handleUpdateStrategy() {
    if (!editStrategyId) return;
    const name = strategyEditName.trim();
    const rules = strategyEditRules.trim();
    if (!name) {
      setStrategyEditStatus("Strategy name is required.");
      return;
    }
    if (
      strategies.some(
        (item) =>
          item.id !== editStrategyId &&
          item.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      setStrategyEditStatus("Strategy already exists.");
      return;
    }
    setStrategies((prev) =>
      prev.map((item) =>
        item.id === editStrategyId ? { ...item, name, rules } : item
      )
    );
    setStrategyEditStatus("Strategy updated.");
    setTimeout(() => setStrategyEditStatus(""), 1500);
  }

  async function handleImportBrokerTrades(payload: {
    connection: {
      id: string;
      brokerName: "FYERS" | "ZERODHA";
      label: string;
    };
    previews: Array<{
      externalRef: string;
      brokerTradeId?: string;
      brokerOrderId?: string;
      symbol: string;
      direction: Trade["direction"];
      quantity: number;
      lots: number | null;
      lotSize: number | null;
      entryPrice: number;
      exitPrice: number;
      entryTime: string;
      exitTime: string;
      date: string;
      inferredInstrument: string;
      market: string;
      platform: string;
      notes: string;
      rawPayload: unknown;
    }>;
    targetAccountId: string;
  }) {
    const importedTrades = payload.previews.map((preview) => ({
      tradeId: createTradeId(),
      date: preview.date,
      accountId: payload.targetAccountId,
      instrument: preview.inferredInstrument,
      market: preview.market,
      entryTime: preview.entryTime || "00:00",
      exitTime: preview.exitTime || preview.entryTime || "00:00",
      strategy: "Broker Import",
      direction: preview.direction,
      sizeQty: preview.quantity,
      lots: preview.lots ?? undefined,
      lotSize: preview.lotSize ?? undefined,
      entryPrice: preview.entryPrice,
      exitPrice: preview.exitPrice,
      stopLoss: preview.entryPrice,
      targetPrice: preview.exitPrice,
      exitReason: `${payload.connection.brokerName} Import`,
      platform: payload.connection.brokerName,
      remarks: `${preview.notes} | ${payload.connection.label} | ${preview.symbol}`
    } satisfies Trade));

    if (dataSource === "supabase") {
      if (!supabase) return "Supabase is not configured.";
      if (!session) return "Please sign in to import broker trades.";

      const refs = payload.previews.map((item) => item.externalRef);
      const { data: existingImports, error: existingError } = await supabase
        .from("broker_imported_trades")
        .select("external_ref")
        .eq("user_id", session.user.id)
        .eq("broker_name", payload.connection.brokerName)
        .in("external_ref", refs);
      if (existingError) {
        return `Broker dedupe failed: ${existingError.message}. Run broker_connections.sql first.`;
      }
      const existingRefSet = new Set(
        (existingImports ?? []).map((row) => String((row as Record<string, unknown>).external_ref ?? ""))
      );
      const freshPairs = payload.previews
        .map((preview, index) => ({ preview, trade: importedTrades[index] }))
        .filter(({ preview }) => !existingRefSet.has(preview.externalRef));

      if (!freshPairs.length) {
        return "These broker trades were already imported.";
      }

      const { error: tradeInsertError } = await supabase
        .from("trades")
        .insert(
          freshPairs.map(({ trade }) =>
            toSupabaseRow(withValidAccountId(trade, accounts), session.user.id)
          )
        );
      if (tradeInsertError) {
        return `Broker trade insert failed: ${tradeInsertError.message}`;
      }

      const importRows = freshPairs.map(({ preview, trade }) => ({
        id: `${payload.connection.id}-${trade.tradeId}`,
        user_id: session.user.id,
        broker_account_id: payload.connection.id,
        broker_name: payload.connection.brokerName,
        external_ref: preview.externalRef,
        broker_trade_id: preview.brokerTradeId ?? null,
        broker_order_id: preview.brokerOrderId ?? null,
        symbol: preview.symbol,
        side: preview.direction,
        quantity: preview.quantity,
        entry_price: preview.entryPrice,
        exit_price: preview.exitPrice,
        executed_at: `${preview.date}T${preview.exitTime || preview.entryTime || "00:00"}:00`,
        raw_payload: preview.rawPayload,
        imported_to_trade_id: trade.tradeId
      }));
      const { error: importLogError } = await supabase
        .from("broker_imported_trades")
        .insert(importRows);
      if (importLogError) {
        return `Broker import log failed: ${importLogError.message}. Run broker_connections.sql first.`;
      }

      const { data, error: fetchError } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .is("team_id", null)
        .order("date", { ascending: false })
        .order("entry_time", { ascending: false });
      if (fetchError) {
        return `Trade refresh failed: ${fetchError.message}`;
      }
      if (data) {
        setTradeList(data.map((row) => fromSupabaseRow(row)));
      }
      return null;
    }

    const localImportedKey = session?.user?.id
      ? `pulsejournal_broker_imported_${session.user.id}`
      : "pulsejournal_broker_imported";
    const existing = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(localImportedKey) || "[]");
        return Array.isArray(parsed) ? new Set(parsed.map((item) => String(item))) : new Set<string>();
      } catch {
        return new Set<string>();
      }
    })();
    const freshPairs = payload.previews
      .map((preview, index) => ({ preview, trade: importedTrades[index] }))
      .filter(({ preview }) => !existing.has(preview.externalRef));
    if (!freshPairs.length) {
      return "These broker trades were already imported.";
    }
    localStorage.setItem(
      localImportedKey,
      JSON.stringify([...existing, ...freshPairs.map(({ preview }) => preview.externalRef)])
    );
    setTradeList((prev) => [...freshPairs.map(({ trade }) => trade), ...prev]);
    return null;
  }

  const navGroups: {
    label: string;
    items: { label: string; href: string; id: DashboardNavId }[];
  }[] = [
    {
      label: "Workspace",
      items: [
        { label: "Overview", href: "/dashboard", id: "overview" },
        { label: "Algo Trading", href: "/dashboard/algo", id: "algo" },
        { label: "Trade journal", href: "/dashboard/journal", id: "journal" },
        { label: "Day-wise", href: "/dashboard/day", id: "day" },
        { label: "Performance", href: "/dashboard/performance", id: "performance" },
        { label: "Strategies", href: "/dashboard/strategies", id: "strategy" },
        { label: "Setups", href: "/dashboard/setup", id: "setups" },
        { label: "Behavior", href: "/dashboard/behavior", id: "behavior" }
      ]
    },
    {
      label: "Insights",
      items: [
        { label: "AI summary", href: "/dashboard/ai", id: "ai" },
        { label: "Market news", href: "/dashboard/news", id: "news" },
        { label: "Opportunities", href: "/dashboard/opportunities", id: "opportunities" },
        { label: "Instruments", href: "/dashboard/instruments", id: "instruments" },
        { label: "Participant data", href: "/dashboard/participants", id: "participants" },
        { label: "Brokers", href: "/dashboard/brokers", id: "brokers" }
      ]
    },
    {
      label: "Account",
      items: [{ label: "Settings", href: "/dashboard/profile", id: "profile" }]
    }
  ];

  const navItems = navGroups.flatMap((group) => group.items);

  const navIcon = (id: string) => {
    const common = "h-5 w-5";
    if (id === "overview") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19H2" />
        </svg>
      );
    }
    if (id === "journal") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h8l4 4v14H7z" />
          <path d="M15 3v5h5" />
          <path d="M10 13h6" />
          <path d="M10 17h4" />
        </svg>
      );
    }
    if (id === "algo") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17h4l2-9 4 12 2-7h4" />
          <path d="M5 5h4" />
          <path d="M15 5h4" />
          <path d="M7 5v5" />
          <path d="M17 5v7" />
        </svg>
      );
    }
    if (id === "performance") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M7 15l4-4 3 3 5-7" />
        </svg>
      );
    }
    if (id === "strategy") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18" />
          <path d="M6 8h12" />
          <path d="M8 8v8" />
          <path d="M16 8v8" />
          <path d="M4 16h16" />
        </svg>
      );
    }
    if (id === "behavior") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3a4 4 0 0 0-4 4v1a4 4 0 0 0-2 3.5A4.5 4.5 0 0 0 7.5 16H9" />
          <path d="M15 3a4 4 0 0 1 4 4v1a4 4 0 0 1 2 3.5A4.5 4.5 0 0 1 16.5 16H15" />
          <path d="M9 21v-6" />
          <path d="M15 21v-6" />
          <path d="M9 12h6" />
        </svg>
      );
    }
    if (id === "participants") {
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 20v-8" />
          <path d="M12 20V6" />
          <path d="M17 20v-5" />
          <path d="M4 20h16" />
          <path d="M5 8l4-3 4 4 6-6" />
        </svg>
      );
    }
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20 7.1l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.8.8Z" />
      </svg>
    );
  };

  const isOverviewView = view === "overview";

  const isNavItemActive = (id: DashboardNavId) =>
    activeSection === id ||
    (!isOverviewView && view === id) ||
    (!isOverviewView && view === "journal" && id === "journal") ||
    (!isOverviewView && view === "algo" && id === "algo") ||
    (!isOverviewView && view === "participants" && id === "participants") ||
    (!isOverviewView && view === "setup" && id === "setups") ||
    (!isOverviewView && view === "profile" && id === "profile");

  const navLabel =
    view === "participants"
      ? "Participant data"
      : view === "journal"
        ? "Trade journal"
        : view === "algo"
          ? "Algo Trading"
        : view === "setup"
          ? "Setups"
          : view === "profile"
            ? "Settings"
            : view === "brokers"
              ? "Brokers"
              : view === "instruments"
                ? "Instruments"
                : view === "news"
                  ? "Market news"
                  : view === "opportunities"
                    ? "Opportunities"
                    : view === "ai"
                      ? "AI summary"
                      : view === "day"
                        ? "Day-wise"
                        : view === "performance"
                          ? "Performance"
                          : view === "strategy"
                            ? "Strategies"
                            : view === "behavior"
                              ? "Behavior"
                              : "Overview";

  const profileInitial =
    session?.user?.email?.charAt(0).toUpperCase() ?? "U";

  const dataSourceLabel =
    dataSource === "supabase"
      ? `Supabase — ${session?.user?.email ?? "Personal"}`
      : "Browser local storage";

  if (dataSource === "supabase" && authLoading) {
    return (
      <main className="min-h-screen bg-ink text-white flex items-center justify-center">
        <div className="card text-sm text-muted">Loading your workspace...</div>
      </main>
    );
  }

  if (dataSource === "supabase" && !session) {
    return (
      <main className="min-h-screen bg-ink text-white flex items-center justify-center">
        <div className="card text-sm text-muted">Redirecting to sign in...</div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell min-h-screen bg-slate-50 text-slate-950 relative overflow-x-hidden dark:bg-ink dark:text-white">
      <div className="relative flex min-w-0 items-start">
        <aside className="hidden h-screen w-[244px] flex-col border-r border-[#e1e7f0] bg-[#f5f8ff] lg:flex lg:sticky lg:top-0 lg:self-start overflow-y-auto dark:border-white/10 dark:bg-panel/95">
          {isOverviewView ? (
            <button
              type="button"
              onClick={() => handleSectionNav("overview")}
              className="flex h-[68px] w-full items-center gap-2 border-b border-[#e1e7f0] px-5 text-left text-base font-extrabold tracking-[-0.03em] text-[#132342] dark:border-white/10 dark:text-white"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#e4efff] text-[#1767e8]">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 17h4v-5H4zm6 0h4V8h-4zm6 0h4V4h-4z" />
                </svg>
              </span>
              <span>1to2 Trading Journal</span>
            </button>
          ) : (
            <Link href="/dashboard" className="flex h-[68px] items-center gap-2 border-b border-[#e1e7f0] px-5 text-base font-extrabold tracking-[-0.03em] text-[#132342] dark:border-white/10 dark:text-white">
              <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[#e4efff] text-[#1767e8]">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 17h4v-5H4zm6 0h4V8h-4zm6 0h4V4h-4z" />
                </svg>
              </span>
              <span>1to2 Trading Journal</span>
            </Link>
          )}
          <nav className="space-y-5 px-3 py-4 text-sm">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#96a2b6] dark:text-slate-500">
                  {group.label}
                </div>
                <div className="grid gap-1">
                  {group.items.map((item) => {
                    const isSection = sectionNavIds.includes(item.id as DashboardSection);
                    const isActive = isNavItemActive(item.id);
                    const classes = `flex w-full items-center gap-3 h-[39px] rounded-[9px] px-3 text-left font-semibold transition ${
                      isActive
                        ? "bg-[#e1efff] text-[#1767e8] dark:bg-sky-400/15 dark:text-sky-200"
                        : "text-[#52627d] hover:bg-[#edf3fd] hover:text-[#132342] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                    }`;
                    const content = (
                      <>
                        <span className={isActive ? "text-[#1767e8] dark:text-sky-200" : "text-[#52627d] dark:text-slate-400"}>
                          {navIcon(item.id)}
                        </span>
                        <span>{item.label}</span>
                      </>
                    );
                    if (isOverviewView && isSection) {
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => handleSectionNav(item.id as DashboardSection)}
                          className={classes}
                        >
                          {content}
                        </button>
                      );
                    }
                    return (
                      <Link key={item.label} href={item.href} className={classes}>
                        {content}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto border-t border-[#e1e7f0] px-4 py-3 text-[11px] text-[#71809b] dark:border-white/10 dark:text-slate-400">
            Data source<br />
            <span className="font-semibold text-slate-700 dark:text-slate-200">{dataSourceLabel}</span>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-[#e1e7f0] bg-white/95 backdrop-blur dark:border-white/10 dark:bg-ink/85">
            <div className="mx-auto flex min-h-[68px] max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-7">
              <div className="algo-panel-switch flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold shadow-sm dark:border-white/10 dark:bg-white/5">
                <Link href="/dashboard" className={`rounded-lg px-3 py-2 transition ${view === "algo" ? "text-slate-600 hover:bg-white dark:text-slate-300" : "bg-white text-blue-700 shadow-sm dark:bg-white/10 dark:text-sky-200"}`}>Journal</Link>
                <Link href="/dashboard/algo" className={`rounded-lg px-3 py-2 transition ${view === "algo" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/10"}`}>Algo Trading</Link>
              </div>
              <div className="hidden flex-wrap items-center gap-2 text-xs md:flex">
                {isOverviewView ? (
                  <button
                    type="button"
                    onClick={() => handleSectionNav("overview")}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:text-blue-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                  >
                    Home
                  </button>
                ) : (
                  <Link
                    href="/dashboard"
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:text-blue-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                  >
                    Home
                  </Link>
                )}
                <input
                  type="date"
                  value={globalStartDate}
                  onChange={(event) => setGlobalStartDate(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                />
                <input
                  type="date"
                  value={globalEndDate}
                  onChange={(event) => setGlobalEndDate(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                />
                <select
                  value={globalAccount}
                  onChange={(event) => setGlobalAccount(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  <option value="all">All accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <select
                  value={globalMarket}
                  onChange={(event) => setGlobalMarket(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  <option value="all">All markets</option>
                  {marketOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-bold text-blue-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200">
                  NIFTY 50
                </span>
                <select
                  value={globalInstrument}
                  onChange={(event) => setGlobalInstrument(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  <option value="all">All instruments</option>
                  {instrumentOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  value={globalStrategy}
                  onChange={(event) => setGlobalStrategy(event.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  <option value="all">All strategies</option>
                  {strategyOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <button
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:text-blue-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                  onClick={() => {
                    setGlobalAccount("all");
                    setGlobalMarket("all");
                    setGlobalInstrument("all");
                    setGlobalStrategy("all");
                    setGlobalStartDate("");
                    setGlobalEndDate("");
                  }}
                >
                  Clear filters
                </button>
                <select
                  value={currency}
                  onChange={(event) =>
                    setCurrency(event.target.value as "INR" | "USD")
                  }
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted">
                    {theme === "dark" ? (
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                      </svg>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-pressed={theme === "dark"}
                    onClick={() =>
                      setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                    }
                    className={`relative flex h-7 w-12 items-center rounded-full border transition ${
                      theme === "dark"
                        ? "justify-end border-white/10 bg-white/10"
                        : "justify-start border-slate-300 bg-slate-200"
                    }`}
                  >
                    <span
                      className={`mx-1 h-5 w-5 rounded-full shadow transition ${
                        theme === "dark" ? "bg-white" : "bg-slate-900"
                      }`}
                    />
                  </button>
                </div>
                {session && (
                  <div className="relative" ref={profileMenuRef}>
                    <button
                      type="button"
                      onClick={() => setProfileOpen((prev) => !prev)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    >
                      {profileImage ? (
                        <img
                          src={profileImage}
                          alt="Profile"
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <span>{profileInitial}</span>
                      )}
                    </button>
                    {profileOpen && (
                      <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg dark:border-white/10 dark:bg-panel/95 dark:text-muted">
                        <div className="mb-3 border-b border-slate-200 pb-2 text-[11px] text-slate-600 dark:border-white/10 dark:text-muted">
                          Signed in as{" "}
                          <span className="text-slate-900 dark:text-white">
                            {session.user.email ?? "Trader"}
                          </span>
                        </div>
                        <Link
                          href="/dashboard/profile"
                          className="block rounded-lg px-2 py-2 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          Profile settings
                        </Link>
                        <Link
                          href="/dashboard/profile#password"
                          className="block rounded-lg px-2 py-2 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          Change password
                        </Link>
                        <button
                          className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:text-muted dark:hover:bg-white/10 dark:hover:text-white"
                          onClick={handleSignOut}
                        >
                          Sign out
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                  onClick={handleExportCsv}
                >
                  Export CSV
                </button>
                <button
                  className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-100"
                  onClick={handleExportDateWiseExcel}
                >
                  Export Excel Tabs
                </button>
              </div>
              <div className="flex w-full items-center justify-end gap-2 md:hidden">
                <button
                  type="button"
                  onClick={() => handleSectionNav("overview")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                >
                  Home
                </button>
                <button
                  type="button"
                  onClick={() => setMobileControlsOpen((prev) => !prev)}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm"
                >
                  {mobileControlsOpen ? "Hide filters" : "Filters"}
                </button>
              </div>
            </div>
            {mobileControlsOpen && (
              <div className="border-t border-white/5 px-4 py-3 md:hidden">
                <div className="grid gap-2">
                  <input
                    type="date"
                    value={globalStartDate}
                    onChange={(event) => setGlobalStartDate(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  />
                  <input
                    type="date"
                    value={globalEndDate}
                    onChange={(event) => setGlobalEndDate(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  />
                  <select
                    value={globalAccount}
                    onChange={(event) => setGlobalAccount(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  >
                    <option value="all">All accounts</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={globalMarket}
                    onChange={(event) => setGlobalMarket(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  >
                    <option value="all">All markets</option>
                    {marketOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    value={globalInstrument}
                    onChange={(event) => setGlobalInstrument(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  >
                    <option value="all">All instruments</option>
                    {instrumentOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    value={globalStrategy}
                    onChange={(event) => setGlobalStrategy(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                  >
                    <option value="all">All strategies</option>
                    {strategyOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={currency}
                      onChange={(event) =>
                        setCurrency(event.target.value as "INR" | "USD")
                      }
                      className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                    </select>
                    <button
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-muted"
                      onClick={() => {
                        setGlobalAccount("all");
                        setGlobalMarket("all");
                        setGlobalInstrument("all");
                        setGlobalStrategy("all");
                        setGlobalStartDate("");
                        setGlobalEndDate("");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary"
                    onClick={handleExportCsv}
                  >
                    Export CSV
                  </button>
                  <button
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    onClick={handleExportDateWiseExcel}
                  >
                    Export Excel Tabs
                  </button>
                </div>
              </div>
            )}
            <div className="lg:hidden border-t border-white/5">
              <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-2 text-sm sm:px-6">
                {navItems.map((item) => {
                  const isSection = sectionNavIds.includes(item.id as DashboardSection);
                  const isActive = isNavItemActive(item.id);
                  const classes = `rounded-full border px-3 py-1.5 whitespace-nowrap font-medium ${
                    isActive
                      ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-sky-200"
                      : "border-slate-200 text-[#52627d] hover:bg-[#edf3fd] hover:text-[#132342] dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                  }`;
                  if (isOverviewView && isSection) {
                    return (
                      <button
                        key={`mobile-${item.label}`}
                        type="button"
                        onClick={() => handleSectionNav(item.id as DashboardSection)}
                        className={classes}
                      >
                        {item.label}
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={`mobile-${item.label}`}
                      href={item.href}
                      className={classes}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </header>

          {view === "algo" && (
            <section id="algo" className="mx-auto max-w-[1680px] space-y-5 px-7 py-6">
              <div className="algo-hero">
                <div>
                  <div className="algo-eyebrow">1to2 Trading OS</div>
                  <h2 className="section-title"><span className="pagesymbol algo-page-symbol">AT</span> Algo Trading</h2>
                  <p className="section-lead">Build. Test. Trade. Protect. Dhan-first automation, risk controls, paper trading and journal feedback inside your existing 1to2 workspace.</p>
                </div>
                <div className="algo-hero-actions">
                  <Link href="/dashboard/brokers" className="algo-secondary-button">Connect Dhan</Link>
                  <button type="button" className="algo-danger-button">EXIT ALL</button>
                </div>
              </div>

              <div className="algo-metrics-grid">
                {[
                  { label: "Today P&L", value: signedMoney0.format(summary.totalPl), helper: `${formatPercent(summary.winRate)} win rate from journal`, tone: summary.totalPl >= 0 ? "good" : "bad" },
                  { label: "Running strategies", value: "0", helper: "No live strategy deployed yet", tone: "blue" },
                  { label: "Capital deployed", value: money0.format(defaultTradingAccount?.baseCapital ?? 0), helper: defaultTradingAccount?.name ?? "Primary account", tone: "blue" },
                  { label: "Risk active", value: `${Math.max(0, overtradeList.length)} flags`, helper: overtradeList[0] ? `Daily limit broken: ${overtradeList[0].date}` : "All journal limits clean", tone: overtradeList.length ? "bad" : "good" },
                  { label: "Broker health", value: "Dhan ready", helper: "Adapter-first foundation", tone: "good" }
                ].map((item) => (
                  <div key={item.label} className="algo-kpi-card">
                    <span className={`algo-kpi-dot algo-kpi-${item.tone}`} />
                    <span className="text-xs font-bold text-muted">{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.helper}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
                <div className="algo-panel algo-builder-panel">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3>Strategy Builder</h3>
                      <p>No-code rule builder for NIFTY, BANKNIFTY, FINNIFTY, options and equities.</p>
                    </div>
                    <button type="button" className="algo-primary-button">+ New strategy</button>
                  </div>
                  <div className="algo-rule-stack">
                    <div className="algo-rule-card">
                      <span>WHEN</span>
                      <b>NIFTY · 5 minute</b>
                      <p>EMA(9) crosses above EMA(21) AND RSI(14) &gt; 55 AND Close &gt; VWAP</p>
                    </div>
                    <div className="algo-rule-connector">THEN</div>
                    <div className="algo-rule-card">
                      <span>BUY</span>
                      <b>NIFTY ATM CE · Current expiry</b>
                      <p>1 lot · SL 20% · Target 40% · Trail by 10% after +30%</p>
                    </div>
                  </div>
                  <div className="algo-chip-row">
                    {['EMA', 'VWAP', 'RSI', 'MACD', 'Supertrend', 'ATR', 'Bollinger Bands', 'ADX'].map((item) => <span key={item}>{item}</span>)}
                  </div>
                </div>

                <div className="algo-panel algo-risk-panel">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3>Risk Engine</h3>
                      <p>Runs before every order. Failed checks reject the signal.</p>
                    </div>
                    <span className="algo-status-pill good">Armed</span>
                  </div>
                  <div className="algo-risk-list">
                    {[
                      ['Daily loss limit', '₹5,000'],
                      ['Daily profit target', '₹10,000'],
                      ['Max trades per day', String(defaultTradingAccount?.dailyTradeLimit ?? DEFAULT_DAILY_TRADE_LIMIT)],
                      ['Max open positions', '2'],
                      ['No new entries after', '3:15 PM']
                    ].map(([label, value]) => (
                      <div key={label}><span>{label}</span><b>{value}</b></div>
                    ))}
                  </div>
                  <button type="button" className="algo-danger-wide">Activate kill switch</button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="algo-panel">
                  <h3>Broker Connections</h3>
                  <p>Dhan is the first live broker. Future adapters stay separate from strategy logic.</p>
                  <div className="algo-broker-card">
                    <div><b>Dhan</b><span>Primary broker</span></div>
                    <span className="algo-status-pill pending">Not connected</span>
                  </div>
                  <div className="algo-mini-list">
                    <div><span>Profile</span><b>Secure server-side token</b></div>
                    <div><span>Funds</span><b>Pending connection</b></div>
                    <div><span>Orders</span><b>Adapter ready</b></div>
                  </div>
                </div>

                <div className="algo-panel">
                  <h3>Backtest & Paper</h3>
                  <p>Validate with slippage, brokerage, taxes, execution delay and options data availability.</p>
                  <div className="algo-mode-grid">
                    <div><span>Backtests</span><b>0</b><small>Create from strategy builder</small></div>
                    <div><span>Paper mode</span><b>Ready</b><small>Stores as executionMode = PAPER</small></div>
                  </div>
                  <button type="button" className="algo-secondary-button w-full">Run sample backtest</button>
                </div>

                <div className="algo-panel">
                  <h3>Live Trading</h3>
                  <p>Signals must pass lifecycle, broker health, duplicate checks and risk validation.</p>
                  <div className="algo-lifecycle">
                    {['Draft', 'Backtested', 'Paper', 'Ready', 'Live'].map((item, index) => <span key={item} className={index === 0 ? 'active' : ''}>{item}</span>)}
                  </div>
                  <div className="algo-mini-list">
                    <div><span>Duplicate signal guard</span><b>Required</b></div>
                    <div><span>Order state check</span><b>Required</b></div>
                    <div><span>Journal sync</span><b>Automatic</b></div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                <div className="algo-panel">
                  <div className="flex items-center justify-between gap-3">
                    <h3>Positions & Orders</h3>
                    <span className="algo-status-pill pending">Waiting for broker</span>
                  </div>
                  <div className="overflow-auto">
                    <table className="algo-table">
                      <thead><tr><th>Strategy</th><th>Instrument</th><th>Mode</th><th>Status</th><th>P&L</th><th>Risk</th></tr></thead>
                      <tbody>
                        <tr><td>NIFTY EMA 9/21</td><td>NIFTY ATM CE</td><td>Paper</td><td>Draft</td><td>₹0</td><td>20% SL</td></tr>
                        <tr><td>Opening range</td><td>BANKNIFTY Futures</td><td>Paper</td><td>Paused</td><td>₹0</td><td>1 lot max</td></tr>
                        <tr><td>VWAP pullback</td><td>NIFTY 50</td><td>Backtest</td><td>Ready to test</td><td>₹0</td><td>Time filter</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="algo-panel">
                  <h3>Auto Journal Feedback</h3>
                  <p>Every paper/live fill should become a journal trade and feed analysis.</p>
                  <div className="algo-feedback-box">
                    <b>Top learning</b>
                    <span>{topLearning ? `${topLearning.label} appeared in ${topLearning.count} trade${topLearning.count > 1 ? 's' : ''}.` : 'Add learning notes to see strategy feedback here.'}</span>
                  </div>
                  <div className="algo-feedback-box muted">
                    <b>What to protect</b>
                    <span>{overtradeList[0] ? `${overtradeList[0].accountName} crossed the daily trade limit.` : 'Keep risk limits green before deploying live.'}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === "overview" && (
            <section
              id="overview"
              className="mx-auto max-w-[1680px] space-y-4 px-7 py-6 scroll-mt-24"
            >
              <div className="pagehead">
                <div>
                  <h2 className="section-title">
                    <span className="pagesymbol overview-page-symbol">◆</span>
                    Overview
                  </h2>
                  <p className="section-lead">
                    Your trading performance at a glance. Journal. Learn. Improve.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <div className="kpi">
                  <div className="flex items-center justify-between text-xs font-bold text-[#5e6f8c]">
                    <span>Net P&amp;L</span>
                    <span className="overview-kpi-icon overview-kpi-icon-good">↗</span>
                  </div>
                  <strong className={`mt-3 block text-2xl tracking-[-0.03em] ${summary.totalPl >= 0 ? "text-positive" : "text-negative"}`}>
                    {signedMoney0.format(summary.totalPl)}
                  </strong>
                  <span className="mt-2 block text-[11px] text-muted">Selected period · {dateRange}</span>
                </div>
                <div className="kpi">
                  <div className="flex items-center justify-between text-xs font-bold text-[#5e6f8c]">
                    <span>Win rate</span>
                    <span className="overview-kpi-icon overview-kpi-icon-blue">●</span>
                  </div>
                  <strong className="mt-3 block text-2xl tracking-[-0.03em] text-[#132342]">
                    {formatPercent(summary.winRate)}
                  </strong>
                  <span className="mt-2 block text-[11px] text-muted">{summary.wins} wins / {summary.losses} losses</span>
                </div>
                <div className="kpi">
                  <div className="flex items-center justify-between text-xs font-bold text-[#5e6f8c]">
                    <span>Profit factor</span>
                    <span className="overview-kpi-icon overview-kpi-icon-blue">♙</span>
                  </div>
                  <strong className="mt-3 block text-2xl tracking-[-0.03em] text-[#132342]">
                    {profitFactorLabel}
                  </strong>
                  <span className="mt-2 block text-[11px] text-muted">
                    Gross profit {money0.format(overviewProfitStats.grossProfit)} · Gross loss {money0.format(Math.abs(overviewProfitStats.grossLoss))}
                  </span>
                </div>
                <div className="kpi">
                  <div className="flex items-center justify-between text-xs font-bold text-[#5e6f8c]">
                    <span>Expectancy</span>
                    <span className="overview-kpi-icon overview-kpi-icon-good">✦</span>
                  </div>
                  <strong className="mt-3 block text-2xl tracking-[-0.03em] text-[#132342]">
                    {expectancyLabel}
                  </strong>
                  <span className="mt-2 block text-[11px] text-muted">Per trade · {summary.totalTrades} trades</span>
                </div>
                <div className="kpi">
                  <div className="flex items-center justify-between text-xs font-bold text-[#5e6f8c]">
                    <span>Max drawdown</span>
                    <span className="overview-kpi-icon overview-kpi-icon-bad">↘</span>
                  </div>
                  <strong className="mt-3 block text-2xl tracking-[-0.03em] text-negative">
                    {signedMoney0.format(summary.maxDrawdown)}
                  </strong>
                  <span className="mt-2 block text-[11px] text-muted">From peak equity · {maxDrawdownPct}</span>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.95fr)]">
                <div className="card">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-[#132342]">Cumulative P&amp;L</h3>
                      <p className="mt-1 text-[11px] text-muted">Equity curve · daily net results</p>
                    </div>
                    <div className="flex gap-2 text-[11px] font-bold text-[#52627d]">
                      <span className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-1.5">1W</span>
                      <span className="rounded-lg bg-[#e1efff] px-3 py-1.5 text-[#1767e8]">1M</span>
                      <span className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-1.5">3M</span>
                      <span className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-1.5">All</span>
                    </div>
                  </div>
                  <div className="overview-chart-box">
                    <div className="overview-chart-axis">
                      <span>₹6k</span>
                      <span>₹4k</span>
                      <span>₹2k</span>
                      <span>₹0</span>
                      <span>-₹2k</span>
                    </div>
                    <div className="overview-chart-plot">
                      <Sparkline
                        data={summary.equityCurve.map((point) => point.equity)}
                        height={178}
                        stroke="#07966c"
                        fill="rgba(7,150,108,0.12)"
                      />
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="mb-4">
                    <h3 className="text-sm font-extrabold text-[#132342]">Win / Loss breakdown</h3>
                    <p className="mt-1 text-[11px] text-muted">Results in selected period</p>
                  </div>
                  <div className="flex min-h-[190px] items-center justify-center gap-7">
                    <div className="overview-donut-wrap">
                      <DonutChart
                        value={summary.winRate}
                        size={138}
                        stroke="#07966c"
                        track="#ef5656"
                      />
                      <div className="overview-donut-center">
                        <strong>{summary.totalTrades}</strong>
                        <span>trades</span>
                      </div>
                    </div>
                    <div className="grid gap-2 text-[11px] text-[#596984]">
                      <div><span className="text-positive">●</span> Wins&nbsp; <b>{summary.wins}</b> · {formatPercent(summary.winRate)}</div>
                      <div><span className="text-negative">●</span> Losses&nbsp; <b>{summary.losses}</b> · {formatPercent(summary.totalTrades ? summary.losses / summary.totalTrades : 0)}</div>
                      <div>Average win&nbsp; <b className="text-positive">{money0.format(summary.avgWin)}</b></div>
                      <div>Average loss&nbsp; <b className="text-negative">{money0.format(Math.abs(summary.avgLoss))}</b></div>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-3 rounded-[10px] border border-[#f4e5c9] bg-[#fff6e6] p-3 text-xs text-[#75664b]">
                    <span className="text-lg text-[#d78a19]">!</span>
                    <div>
                      <strong className="text-[#132342]">Risky trades account for most losses</strong>
                      <p className="mt-1">Trades above your risk rule have a lower win rate.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-[#132342]">Recent trades</h3>
                    <p className="mt-1 text-[11px] text-muted">Latest entries from your journal</p>
                  </div>
                  <Link href="/dashboard/journal" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 text-[11px] font-bold text-[#425370] shadow-sm">
                    View all trades →
                  </Link>
                </div>
                <div className="overflow-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Instrument</th>
                        <th>Setup</th>
                        <th>Side</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>Qty</th>
                        <th>P&amp;L ({currency === "INR" ? "₹" : "$"})</th>
                        <th>Risk</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {derived.slice(0, 5).map((trade) => (
                        <tr key={trade.tradeId}>
                          <td>{trade.date}</td>
                          <td className="font-bold text-[#132342]">{trade.instrument}</td>
                          <td>{trade.strategy}</td>
                          <td>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trade.direction === "Long" ? "bg-[#e5f7f0] text-[#07966c]" : "bg-[#fff0ef] text-[#df4747]"}`}>
                              {trade.direction}
                            </span>
                          </td>
                          <td>{trade.entryPrice}</td>
                          <td>{trade.exitPrice}</td>
                          <td>{trade.sizeQty}</td>
                          <td className={trade.pl >= 0 ? "text-positive" : "text-negative"}>{signedMoney0.format(trade.pl)}</td>
                          <td>{trade.tradeType ?? "—"}</td>
                          <td>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trade.pl >= 0 ? "bg-[#e5f7f0] text-[#07966c]" : "bg-[#fff0ef] text-[#df4747]"}`}>
                              {trade.pl >= 0 ? "Win" : "Loss"}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!derived.length && (
                        <tr>
                          <td colSpan={10} className="text-center text-muted">No trades in this filter.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {view === "ai" && (
            <section
              id="ai-summary"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
              <div>
                <h2 className="section-title">AI summary</h2>
                <p className="section-lead">What you did right, what went wrong, and the learning to carry forward.</p>
              </div>

            <div className="card scroll-mt-24">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3v4M5.6 5.6l2.8 2.8M3 12h4M5.6 18.4l2.8-2.8M12 17v4M18.4 18.4l-2.8-2.8M17 12h4M18.4 5.6l-2.8 2.8" />
                    </svg>
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">AI summarizer</h3>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500/15 text-teal-500">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 12h4l3-6 4 12 2-6h5" />
                      </svg>
                    </span>
                    <div className="text-sm font-semibold">Performance</div>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {aiSummary.performance.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-teal-500/80" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/15 text-sky-500">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 6h7l2 3h7v9H4z" />
                        <path d="M8 6l1.5-3h5L16 6" />
                      </svg>
                    </span>
                    <div className="text-sm font-semibold">Strategy</div>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {aiSummary.strategy.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-sky-500/80" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 4v7" />
                        <path d="m7 12 5 4 5-4" />
                        <path d="M4 20h16" />
                      </svg>
                    </span>
                    <div className="text-sm font-semibold">Behavior</div>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {aiSummary.behavior.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-amber-500/80" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                  <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">What you did right</div>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {aiSummary.right.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500/80" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
                  <div className="text-sm font-semibold text-rose-700 dark:text-rose-300">What went wrong</div>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {aiSummary.wrong.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-rose-500/80" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-sky-400/20 bg-sky-500/10 p-4">
                <div className="text-sm font-semibold text-sky-700 dark:text-sky-300">Top learning</div>
                <div className="mt-2 text-sm text-muted">
                  {topLearning
                    ? `${topLearning.label}${topLearning.count > 1 ? ` (${topLearning.count} trades)` : ""}`
                    : "Add a learning to your journal trades to see the strongest repeated lesson."}
                </div>
              </div>
            </div>
              </section>

          )}

          {view === "performance" && (
            <section
              id="performance"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="section-title"><span className="pagesymbol">↗</span> Performance analytics</h2>
                  <p className="section-lead">Understand your edge by strategy, time, instrument and risk.</p>
                </div>
                <button className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white">Export report</button>
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <div className="kpi"><span className="text-xs font-bold text-muted">Total trades</span><strong className="mt-3 block text-2xl">{summary.totalTrades}</strong><span className="text-[11px] text-muted">Selected period</span></div>
                <div className="kpi"><span className="text-xs font-bold text-muted">Win rate</span><strong className="mt-3 block text-2xl">{formatPercent(summary.winRate)}</strong><span className="text-[11px] text-muted">{summary.wins} wins / {summary.losses} losses</span></div>
                <div className="kpi"><span className="text-xs font-bold text-muted">Profit factor</span><strong className="mt-3 block text-2xl">{profitFactorLabel}</strong><span className="text-[11px] text-muted">Gross profit + gross loss</span></div>
                <div className="kpi"><span className="text-xs font-bold text-muted">Avg R multiple</span><strong className="mt-3 block text-2xl text-positive">{expectancyLabel}</strong><span className="text-[11px] text-muted">Per trade</span></div>
                <div className="kpi"><span className="text-xs font-bold text-muted">Largest drawdown</span><strong className="mt-3 block text-2xl text-negative">{signedMoney0.format(summary.maxDrawdown)}</strong><span className="text-[11px] text-muted">Peak-to-trough</span></div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
                <div className="card">
                  <div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-extrabold">Cumulative P&amp;L</h3><p className="text-[11px] text-muted">Equity curve · daily net results</p></div><div className="flex gap-2 text-[11px] font-bold text-[#52627d]"><span className="rounded-lg border border-[#e1e7f0] px-3 py-1.5">1W</span><span className="rounded-lg bg-[#e1efff] px-3 py-1.5 text-[#1767e8]">1M</span><span className="rounded-lg border border-[#e1e7f0] px-3 py-1.5">3M</span><span className="rounded-lg border border-[#e1e7f0] px-3 py-1.5">All</span></div></div>
                  <Sparkline data={summary.equityCurve.map((point) => point.equity)} />
                </div>
                <div className="card">
                  <h3 className="text-sm font-extrabold">P&amp;L distribution</h3>
                  <div className="mt-5 space-y-4 text-xs">
                    {[{ label: "Winners", count: summary.wins, color: "#07966c" }, { label: "Losers", count: summary.losses, color: "#df4747" }, { label: "Breakeven", count: summary.breakeven, color: "#1767e8" }].map((row) => (
                      <div key={row.label} className="grid grid-cols-[80px_1fr_70px] items-center gap-3"><span className="text-muted">{row.label}</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className="block h-2 rounded-full" style={{ width: `${summary.totalTrades ? Math.max(8, (row.count / summary.totalTrades) * 100) : 0}%`, backgroundColor: row.color }} /></span><b>{row.count} trades</b></div>
                    ))}
                  </div>
                  <div className="mt-6 border-t border-[#e1e7f0] pt-4 text-xs"><div className="flex justify-between"><span className="text-muted">Avg win</span><b className="text-positive">{money0.format(summary.avgWin)}</b></div><div className="mt-3 flex justify-between"><span className="text-muted">Avg loss</span><b className="text-negative">-{money0.format(summary.avgLoss).replace(/^[-+]/, "")}</b></div></div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="card"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Performance by strategy</h3><span className="rounded-lg bg-[#f1f5fb] px-3 py-1.5 text-[11px] font-bold text-muted">{summary.totalTrades} trades</span></div><div className="space-y-3 text-xs">{strategyStats.slice(0, 5).map((row) => <div key={row.name} className="grid grid-cols-[120px_1fr_82px] items-center gap-3"><span className="text-muted">{row.name}</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className={`block h-2 rounded-full ${row.totalPl >= 0 ? "bg-[#07966c]" : "bg-[#df4747]"}`} style={{ width: `${Math.max(10, Math.min(100, Math.abs(row.totalPl) / Math.max(1, Math.abs(bestStrategy?.totalPl ?? row.totalPl)) * 100))}%` }} /></span><b className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>{signedMoney0.format(row.totalPl)}</b></div>)}</div></div>
                <div className="card"><h3 className="text-sm font-extrabold">Risk and execution</h3><div className="mt-5 space-y-3 text-xs"><div className="grid grid-cols-[120px_1fr_70px] items-center gap-3"><span className="text-muted">Within risk rule</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className="block h-2 rounded-full bg-[#07966c]" style={{ width: `${summary.totalTrades ? (safeRiskStats.safe.count / summary.totalTrades) * 100 : 0}%` }} /></span><b>{safeRiskStats.safe.count} trades</b></div><div className="grid grid-cols-[120px_1fr_70px] items-center gap-3"><span className="text-muted">Exceeded risk</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className="block h-2 rounded-full bg-[#df4747]" style={{ width: `${summary.totalTrades ? (safeRiskStats.risky.count / summary.totalTrades) * 100 : 0}%` }} /></span><b>{safeRiskStats.risky.count} trades</b></div></div><p className="mt-5 rounded-lg bg-[#f5f8fc] px-4 py-3 text-xs text-muted">Compare results after brokerage and taxes. Use consistent net P&amp;L values for reliable expectancy.</p></div>
              </div>
            </section>
          )}

          {view === "strategy" && (
            <section id="strategy" className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="section-title"><span className="pagesymbol">⌘</span> Strategies</h2><p className="section-lead">Compare setups using the same rules and a consistent sample size.</p></div><Link href="/dashboard/setup" className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white">+ New strategy</Link></div>
              <div className="grid gap-4 lg:grid-cols-5"><div className="kpi"><span className="text-xs font-bold text-muted">Active strategies</span><strong className="mt-3 block text-2xl">{strategyStats.length}</strong><span className="text-[11px] text-muted">{strategies.length} saved</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Best expectancy</span><strong className="mt-3 block text-2xl text-positive">{bestStrategy?.expectancyR ? `${bestStrategy.expectancyR.toFixed(2)}R` : "—"}</strong><span className="text-[11px] text-muted">{bestStrategy?.name ?? "No setup yet"}</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Most used</span><strong className="mt-3 block text-2xl">{strategyStats[0]?.name ?? "—"}</strong><span className="text-[11px] text-muted">{strategyStats[0]?.trades ?? 0} trades</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Needs review</span><strong className="mt-3 block text-2xl text-negative">{strategyStats.filter((row) => row.totalPl < 0).length} strategy</strong><span className="text-[11px] text-muted">Negative expectancy</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Rule adherence</span><strong className="mt-3 block text-2xl">{formatPercent(safeRiskStats.safe.count / Math.max(1, summary.totalTrades))}</strong><span className="text-[11px] text-muted">Across all tagged trades</span></div></div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]"><div className="card space-y-4"><div className="flex items-center justify-between"><h3 className="text-sm font-extrabold">Strategy performance</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">Sort: Expectancy</span></div>{strategyStats.slice(0, 4).map((row) => <div key={row.name} className="rounded-xl border border-[#e1e7f0] p-4"><div className="flex items-center justify-between"><h4 className="font-extrabold text-[#132342]">{row.name}</h4><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.totalPl >= 0 ? "bg-[#e5f7f0] text-[#07966c]" : "bg-[#fff0ef] text-[#df4747]"}`}>{row.totalPl >= 0 ? "Positive edge" : "Needs review"}</span></div><p className="mt-3 text-sm text-muted">{strategies.find((item) => item.name === row.name)?.rules || "Rules not written yet."}</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-[#e1e7f0] p-3"><span className="text-[11px] text-muted">Trades</span><b className="block text-lg">{row.trades}</b></div><div className="rounded-lg border border-[#e1e7f0] p-3"><span className="text-[11px] text-muted">Win rate</span><b className="block text-lg">{formatPercent(row.winRate)}</b></div><div className="rounded-lg border border-[#e1e7f0] p-3"><span className="text-[11px] text-muted">Expectancy</span><b className={row.totalPl >= 0 ? "block text-lg text-positive" : "block text-lg text-negative"}>{row.expectancyR ? `${row.expectancyR.toFixed(2)}R` : "—"}</b></div></div></div>)}</div><div className="space-y-4"><div className="card"><h3 className="text-sm font-extrabold">Strategy comparison</h3><div className="mt-5 space-y-4 text-xs">{strategyStats.slice(0, 6).map((row) => <div key={row.name} className="grid grid-cols-[120px_1fr_64px] items-center gap-3"><span className="text-muted">{row.name}</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className={`block h-2 rounded-full ${row.totalPl >= 0 ? "bg-[#07966c]" : "bg-[#df4747]"}`} style={{ width: `${Math.max(10, Math.min(100, Math.abs(row.totalPl) / Math.max(1, Math.abs(bestStrategy?.totalPl ?? row.totalPl)) * 100))}%` }} /></span><b className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>{row.expectancyR ? `${row.expectancyR.toFixed(2)}R` : "—"}</b></div>)}</div></div><div className="card"><h3 className="text-sm font-extrabold">Review queue</h3><div className="mt-4 rounded-lg border border-[#f4e5c9] bg-[#fff6e6] p-4 text-xs text-[#75664b]"><b className="text-[#132342]">{worstStrategy?.name ?? "No strategy"} needs review</b><p className="mt-1">{worstStrategy ? `${worstStrategy.trades} trades · ${signedMoney0.format(worstStrategy.totalPl)} net result.` : "Add trades to build a queue."}</p></div></div></div></div>
            </section>
          )}

          {view === "day" && (
            <section id="day" className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="section-title"><span className="pagesymbol">▦</span> Day-wise performance</h2><p className="section-lead">Spot your strongest sessions, drawdown days and weekly rhythm.</p></div><div className="flex gap-2"><button className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-xs font-bold">‹</button><span className="rounded-lg border border-[#e1e7f0] px-4 py-2 text-xs font-bold">{selectedMonthInfo.monthLabel}</span><button className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-xs font-bold">›</button></div></div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]"><div className="card"><div className="mb-4 flex items-start justify-between"><div><h3 className="text-sm font-extrabold">{selectedMonthInfo.monthLabel}</h3><p className="text-[11px] text-muted">Daily net P&amp;L · select a day to review trades</p></div><div className="flex gap-2"><span className="rounded-full bg-[#e5f7f0] px-3 py-1 text-[10px] font-bold text-[#07966c]">Profit day</span><span className="rounded-full bg-[#fff0ef] px-3 py-1 text-[10px] font-bold text-[#df4747]">Loss day</span></div></div><div className="grid grid-cols-7 gap-2 text-xs"><div className="text-center font-bold text-muted">Mon</div><div className="text-center font-bold text-muted">Tue</div><div className="text-center font-bold text-muted">Wed</div><div className="text-center font-bold text-muted">Thu</div><div className="text-center font-bold text-muted">Fri</div><div className="text-center font-bold text-muted">Sat</div><div className="text-center font-bold text-muted">Sun</div>{selectedMonthInfo.cells.map((cell, index) => <div key={index} className={`min-h-[66px] rounded-lg border p-2 ${cell.row ? cell.row.totalPl >= 0 ? "border-[#cbeee2] bg-[#edf9f4]" : "border-[#ffd9d6] bg-[#fff3f1]" : "border-[#e1e7f0] bg-white"}`}><span className="text-[11px] text-muted">{cell.dayNumber ?? ""}</span>{cell.row ? <b className={`mt-3 block ${cell.row.totalPl >= 0 ? "text-positive" : "text-negative"}`}>{signedMoney0.format(cell.row.totalPl)}</b> : null}</div>)}</div></div><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><div className="card"><span className="text-xs font-bold text-muted">Best day</span><strong className="mt-3 block text-2xl text-positive">{bestCalendarDay ? signedMoney0.format(bestCalendarDay.totalPl) : "—"}</strong><span className="text-[11px] text-muted">{bestCalendarDay ? `${bestCalendarDay.date} · ${bestCalendarDay.trades} trades` : "No trades"}</span></div><div className="card"><span className="text-xs font-bold text-muted">Worst day</span><strong className="mt-3 block text-2xl text-negative">{worstCalendarDay ? signedMoney0.format(worstCalendarDay.totalPl) : "—"}</strong><span className="text-[11px] text-muted">{worstCalendarDay ? `${worstCalendarDay.date} · ${worstCalendarDay.trades} trades` : "No trades"}</span></div></div><div className="card"><h3 className="text-sm font-extrabold">Weekday pattern</h3><div className="mt-5 space-y-3 text-xs">{dayStats.map((row) => <div key={row.day} className="grid grid-cols-[84px_1fr_70px] items-center gap-3"><span className="text-muted">{row.day}</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className={`block h-2 rounded-full ${row.totalPl >= 0 ? "bg-[#07966c]" : "bg-[#df4747]"}`} style={{ width: `${Math.max(8, Math.min(100, Math.abs(row.totalPl) / Math.max(1, Math.abs(bestDay?.totalPl ?? row.totalPl)) * 100))}%` }} /></span><b className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>{signedMoney0.format(row.totalPl)}</b></div>)}</div></div><div className="card"><h3 className="text-sm font-extrabold">Session note</h3><p className="mt-4 rounded-lg bg-[#f5f8fc] px-4 py-3 text-xs text-muted">Your best results came from the strongest green sessions. Review loss days for size, timing and rule breaks.</p></div></div></div>
              <div className="card"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Daily summary</h3><button className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold">Download</button></div><div className="overflow-auto"><table><thead><tr><th>Date</th><th>Trades</th><th>Wins</th><th>Win rate</th><th>P&amp;L</th></tr></thead><tbody>{dailyPerformance.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.trades}</td><td>{row.wins}</td><td>{formatPercent(row.trades ? row.wins / row.trades : 0)}</td><td className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>{signedMoney0.format(row.totalPl)}</td></tr>)}</tbody></table></div></div>
            </section>
          )}

          {view === "behavior" && (
            <section id="behavior" className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="section-title"><span className="pagesymbol">◎</span> Behavior &amp; psychology</h2><p className="section-lead">Review the habits that shape your execution, beyond the chart.</p></div><button className="rounded-lg border border-[#e1e7f0] px-4 py-2 text-xs font-bold">Last 30 days</button></div>
              <div className="grid gap-4 lg:grid-cols-5"><div className="kpi"><span className="text-xs font-bold text-muted">Plan adherence</span><strong className="mt-3 block text-2xl">{formatPercent(safeRiskStats.safe.count / Math.max(1, summary.totalTrades))}</strong><span className="text-[11px] text-muted">{safeRiskStats.safe.count} of {summary.totalTrades} trades</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Emotional trades</span><strong className="mt-3 block text-2xl text-negative">{earlyExitCount + lowRRCount}</strong><span className="text-[11px] text-muted">Execution flags</span></div><div className="kpi"><span className="text-xs font-bold text-muted">After a loss</span><strong className="mt-3 block text-2xl text-positive">{expectancyLabel}</strong><span className="text-[11px] text-muted">Current expectancy</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Overtrading days</span><strong className="mt-3 block text-2xl text-negative">{overtradeList.length}</strong><span className="text-[11px] text-muted">More than daily limit</span></div><div className="kpi"><span className="text-xs font-bold text-muted">Best state</span><strong className="mt-3 block text-2xl">{emotionStats[0]?.label ?? "Patient"}</strong><span className="text-[11px] text-muted">Highest rule adherence</span></div></div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]"><div className="card"><h3 className="text-sm font-extrabold">Execution quality by behavior</h3><p className="text-[11px] text-muted">Tag each trade after exit</p><div className="mt-5 space-y-4 text-xs">{behaviorQualityRows.map((row) => <div key={row.label} className="grid grid-cols-[120px_1fr_70px] items-center gap-3"><span className="text-muted">{row.label}</span><span className="h-2 rounded-full bg-[#edf1f7]"><span className={`block h-2 rounded-full ${row.tone === "good" ? "bg-[#07966c]" : row.tone === "bad" ? "bg-[#df4747]" : "bg-[#1767e8]"}`} style={{ width: `${Math.max(8, (row.value / maxBehaviorQuality) * 100)}%` }} /></span><b>{row.value} trades</b></div>)}</div></div><div className="space-y-4"><div className="card"><h3 className="text-sm font-extrabold">Emotion tags</h3><div className="mt-4 flex flex-wrap gap-2">{emotionStats.filter((row) => row.label !== "Unspecified").slice(0, 5).map((row) => <span key={row.label} className="rounded-full bg-[#e9f2ff] px-3 py-1 text-[10px] font-bold text-[#1767e8]">{row.label} · {row.trades}</span>)}{!hasPsychologyData ? <span className="text-xs text-muted">No emotion tags yet.</span> : null}</div><p className="mt-4 rounded-lg bg-[#f5f8fc] px-4 py-3 text-xs text-muted">Compare emotion-tagged entries with your written setup rules.</p></div><div className="card"><h3 className="text-sm font-extrabold">Reflection prompts</h3><ol className="mt-4 space-y-2 text-xs text-muted"><li>1. Did I wait for my setup?</li><li>2. Was the stop fixed before entry?</li><li>3. What will I repeat or change tomorrow?</li></ol></div></div></div>
            </section>
          )}

          {view === "setup" && (
            <section
              id="setup"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
            <div>
              <h2 className="section-title">Setup</h2>
              <p className="section-lead">
                Maintain your strategy playbook.
              </p>
            </div>

            <div className="grid gap-6">
              <div className="card space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Strategies</h3>
                  <p className="text-sm text-muted">
                    Add a strategy and its rules — it will appear in the trade form.
                  </p>
                </div>
                <div className="grid gap-3">
                  <input
                    placeholder="Strategy name"
                    value={strategyNameInput}
                    onChange={(event) => setStrategyNameInput(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    placeholder="Rules / checklist (optional)"
                    value={strategyRulesInput}
                    onChange={(event) => setStrategyRulesInput(event.target.value)}
                    rows={3}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <button
                    className="w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                    onClick={handleAddStrategy}
                  >
                    Add strategy
                  </button>
                  {strategyStatus && (
                    <span className="text-xs text-muted">{strategyStatus}</span>
                  )}
                </div>

                {strategies.length === 0 && (
                  <p className="text-xs text-muted">No strategies added yet.</p>
                )}
                {strategies.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-white/10">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-muted">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            Strategy
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Rules
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {strategies.map((strategy) => (
                          <tr
                            key={strategy.id}
                            className="border-t border-white/5"
                          >
                            <td className="px-3 py-3 align-top">
                              <div className="font-semibold">
                                {strategy.name}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="text-muted">
                                {strategy.rules || "—"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right align-top">
                              <div className="flex items-center justify-end gap-2">
                                <Link
                                  href={`/dashboard/setup/strategy/${strategy.id}`}
                                  className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted hover:text-white"
                                >
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted hover:text-white"
                                  onClick={() => handleRemoveStrategy(strategy.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Trading accounts</h3>
                  <p className="text-sm text-muted">
                    Create multiple accounts with their own base capital, then tag trades and analytics account-wise.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
                  <input
                    type="text"
                    placeholder="Account name"
                    value={accountNameInput}
                    onChange={(event) => setAccountNameInput(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Base capital"
                    value={accountBaseCapitalInput}
                    onChange={(event) => setAccountBaseCapitalInput(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Daily trade limit"
                    value={accountDailyTradeLimitInput}
                    onChange={(event) => setAccountDailyTradeLimitInput(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <button
                    className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                    onClick={handleAddTradingAccount}
                  >
                    Add account
                  </button>
                </div>
                <div className="space-y-3">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      {editingAccountId === account.id ? (
                        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto_auto]">
                          <input
                            type="text"
                            value={editingAccountName}
                            onChange={(event) => setEditingAccountName(event.target.value)}
                            className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editingAccountBaseCapital}
                            onChange={(event) => setEditingAccountBaseCapital(event.target.value)}
                            className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                          />
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editingAccountDailyTradeLimit}
                            onChange={(event) => setEditingAccountDailyTradeLimit(event.target.value)}
                            className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                          />
                          <button
                            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                            onClick={handleSaveAccountEdit}
                          >
                            Save
                          </button>
                          <button
                            className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted hover:text-white"
                            onClick={cancelEditAccount}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{account.name}</div>
                            <div className="text-xs text-muted">
                              Base capital: {money2.format(account.baseCapital)} · Daily limit: {account.dailyTradeLimit} trades
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {account.isDefault ? (
                              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                Default
                              </span>
                            ) : (
                              <button
                                className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted hover:text-white"
                                onClick={() => handleSetDefaultAccount(account.id)}
                              >
                                Set default
                              </button>
                            )}
                            <button
                              className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                              onClick={() => beginEditAccount(account)}
                            >
                              Edit
                            </button>
                            <button
                              className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                              onClick={() => handleDeleteAccount(account.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {accountStatus ? <div className="text-xs text-muted">{accountStatus}</div> : null}
                {selectedTradingAccount ? (
                  <div className="text-xs text-muted">
                    Current analysis filter: {selectedTradingAccount.name}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          )}

          {view === "profile" && (
            <section
              id="profile"
              className="mx-auto max-w-3xl space-y-6 px-6 py-8"
            >
              <div>
                <h2 className="section-title">Profile</h2>
                <p className="section-lead">
                  Manage your profile photo, password, and preferences.
                </p>
              </div>

              <div className="card space-y-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full border border-white/10 bg-white/5 overflow-hidden flex items-center justify-center text-lg font-semibold">
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt="Profile"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{profileInitial}</span>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {session?.user?.email ?? "Trader"}
                    </div>
                    <div className="text-xs text-muted">Trading workspace</div>
                  </div>
                </div>
                <label className="text-xs text-muted">
                  Update profile photo
                  <input
                    type="file"
                    accept="image/*"
                    className="mt-2 block w-full text-xs text-muted"
                    onChange={(event) =>
                      handleProfileImageUpload(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {profileImage && (
                  <button
                    className="w-fit rounded-full border border-white/10 px-4 py-2 text-xs text-muted"
                    onClick={() => setProfileImage(null)}
                  >
                    Remove photo
                  </button>
                )}
              </div>

              <div id="password" className="card space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Change password</h3>
                  <p className="text-sm text-muted">
                    Use a strong password to keep your journal secure.
                  </p>
                </div>
                <div className="grid gap-3">
                  <input
                    type="password"
                    placeholder="New password"
                    value={passwordNext}
                    onChange={(event) => setPasswordNext(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <input
                    type="password"
                    placeholder="Confirm new password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <button
                    className="w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                    onClick={handlePasswordUpdate}
                  >
                    Update password
                  </button>
                  {profileStatus && (
                    <span className="text-xs text-muted">{profileStatus}</span>
                  )}
                </div>
              </div>

              <div className="card space-y-3">
                <h3 className="text-lg font-semibold">Other settings</h3>
                <div className="text-xs text-muted">
                  Default currency: {currency} · Theme: {theme}
                </div>
                <div className="text-xs text-muted">
                  Data source: {dataSourceLabel}
                </div>
              </div>
          </section>
          )}

          {view === "instruments" && (
            <section
              id="instruments"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
              <div>
                <h2 className="section-title">Instruments</h2>
                <p className="section-lead">
                  Maintain instrument names and their current lot size.
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="card space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">Add instrument</h3>
                    <p className="text-sm text-muted">
                      Set how many quantity equals 1 lot.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <input
                      placeholder="Instrument name"
                      value={instrumentNameInput}
                      onChange={(event) =>
                        setInstrumentNameInput(event.target.value)
                      }
                      className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                    />
                      <input
                        placeholder="1 lot = qty"
                        value={instrumentLotSizeInput}
                        onChange={(event) =>
                          setInstrumentLotSizeInput(event.target.value)
                        }
                        className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                    />
                    <button
                      className="w-fit rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                      onClick={handleAddInstrument}
                    >
                      Add instrument
                    </button>
                    {instrumentStatus && (
                      <span className="text-xs text-muted">
                        {instrumentStatus}
                      </span>
                    )}
                  </div>
                </div>

                <div className="card space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">Edit instrument</h3>
                    <p className="text-sm text-muted">
                      Select an instrument from the list to update its lot size.
                    </p>
                  </div>
                  {instrumentEditId ? (
                    <div className="grid gap-3">
                      <input
                        placeholder="Instrument name"
                        value={instrumentEditName}
                        onChange={(event) =>
                          setInstrumentEditName(event.target.value)
                        }
                        className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                      />
                      <input
                        placeholder="1 lot = qty"
                        value={instrumentEditLotSize}
                        onChange={(event) =>
                          setInstrumentEditLotSize(event.target.value)
                        }
                        className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                          onClick={handleUpdateInstrument}
                        >
                          Save changes
                        </button>
                        <button
                          className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted"
                          onClick={cancelEditInstrument}
                        >
                          Cancel
                        </button>
                      </div>
                      {instrumentStatus && (
                        <span className="text-xs text-muted">
                          {instrumentStatus}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      Pick an instrument below to edit.
                    </p>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Instrument list</h3>
                  <span className="text-xs text-muted">
                    {instruments.length} instruments
                  </span>
                </div>
                <div className="mt-4 overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-xs">
                    <thead className="bg-white/5 text-muted">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          Instrument
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          1 lot = qty
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {instruments.map((item) => (
                        <tr
                          key={item.id}
                          className="border-t border-white/5"
                        >
                          <td className="px-3 py-3 font-semibold">
                            {item.name}
                          </td>
                          <td className="px-3 py-3 text-muted">
                            {item.lotSize}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted hover:text-white"
                                onClick={() => beginEditInstrument(item)}
                              >
                                Edit
                              </button>
                              <button
                                className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted hover:text-white"
                                onClick={() => handleRemoveInstrument(item.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {view === "participants" && (
            <section
              id="participants"
              className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8"
            >
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-white/10 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
                    Participant Wise OI
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                    Market positioning overview
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                    FII, Pro, DII, and Retail positioning from NSE participant open interest.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    onClick={() => {
                      const d = new Date(`${participantViewDate}T00:00:00`);
                      d.setDate(d.getDate() - 1);
                      const prev = d.toISOString().slice(0, 10);
                      setParticipantViewDate(prev);
                      setFlowDate(prev);
                    }}
                  >
                    Prev
                  </button>
                  <input
                    type="date"
                    value={participantViewDate}
                    onChange={(event) => {
                      setParticipantViewDate(event.target.value);
                      setFlowDate(event.target.value);
                    }}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    onClick={() => {
                      const d = new Date(`${participantViewDate}T00:00:00`);
                      d.setDate(d.getDate() + 1);
                      const next = d.toISOString().slice(0, 10);
                      setParticipantViewDate(next);
                      setFlowDate(next);
                    }}
                  >
                    Next
                  </button>
                  <button
                    className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
                    onClick={handleFetchParticipantFromNse}
                  >
                    Fetch latest
                  </button>
                </div>
              </div>

              {flowStatus && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-800 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200">
                  {flowStatus}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[#52627d] dark:text-slate-400">Overall trend</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        participantOverallTrend === "Bullish"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200"
                          : participantOverallTrend === "Bearish"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200"
                            : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200"
                      }`}
                    >
                      {participantOverallTrend}
                    </span>
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                    {participantOverallTrend}
                  </div>
                  <p className="mt-2 text-xs text-[#52627d] dark:text-slate-400">
                    Weighted more toward FII and Pro activity.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs font-semibold text-[#52627d] dark:text-slate-400">Tracked dates</p>
                  <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                    {participantDateOptions.length}
                  </div>
                  <p className="mt-2 text-xs text-[#52627d] dark:text-slate-400">
                    Latest loaded: {participantDateOptions[0]?.split("-").reverse().join("/") ?? "N/A"}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs font-semibold text-[#52627d] dark:text-slate-400">Active participants</p>
                  <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                    {new Set(participantActivityRows.map((row) => row.participant)).size}
                  </div>
                  <p className="mt-2 text-xs text-[#52627d] dark:text-slate-400">
                    FII, Pro, DII, and Retail rows expected.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs font-semibold text-[#52627d] dark:text-slate-400">Total OI change</p>
                  <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                    {participantActivityRows
                      .reduce((sum, row) => sum + Math.abs(row.change), 0)
                      .toLocaleString()}
                  </div>
                  <p className="mt-2 text-xs text-[#52627d] dark:text-slate-400">
                    Absolute change across futures, CE, and PE.
                  </p>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                        {participantViewDateDisplay} - Participant Wise Open Interest and Changes
                      </h3>
                      <p className="mt-1 text-xs text-[#52627d] dark:text-slate-400">
                        Bullish means buying futures/calls or selling puts. Bearish means selling futures/calls or buying puts.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                        onClick={handleParticipantCsvDownload}
                      >
                        CSV
                      </button>
                      <button
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                        onClick={handleParticipantPngDownload}
                      >
                        PNG
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table ref={participantsTableRef} className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                        <tr>
                          <th className="px-5 py-3 text-left font-semibold">Participant</th>
                          <th className="px-5 py-3 text-left font-semibold">Instrument</th>
                          <th className="px-5 py-3 text-right font-semibold">Change</th>
                          <th className="px-5 py-3 text-left font-semibold">Activity</th>
                          <th className="px-5 py-3 text-left font-semibold">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                        {participantActivityRows.map((row, index) => (
                          <tr key={`${row.participant}-${row.instrument}`} className="hover:bg-slate-50/80 dark:hover:bg-white/5">
                            {index % 3 === 0 ? (
                              <td className="px-5 py-4 align-middle font-semibold text-slate-950 dark:text-white" rowSpan={3}>
                                {row.label}
                              </td>
                            ) : null}
                            <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{row.instrument}</td>
                            <td
                              className={`px-5 py-3 text-right font-semibold ${
                                row.change > 0
                                  ? "text-emerald-600 dark:text-emerald-300"
                                  : row.change < 0
                                    ? "text-rose-600 dark:text-rose-300"
                                    : "text-[#52627d] dark:text-slate-400"
                              }`}
                            >
                              {row.change > 0 ? `+${row.change.toLocaleString()}` : row.change.toLocaleString()}
                            </td>
                            <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{row.activity}</td>
                            <td className="px-5 py-3">
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  row.trend === "Bullish"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200"
                                    : row.trend === "Bearish"
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200"
                                      : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200"
                                }`}
                              >
                                {row.trend}
                              </span>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-950 text-white dark:bg-sky-400/10">
                          <td className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em]" colSpan={4}>
                            Overall trend
                          </td>
                          <td className="px-5 py-4">
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-950 dark:bg-sky-300 dark:text-slate-950">
                              {participantOverallTrend}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Recent EOD snapshots</h3>
                        <p className="mt-1 text-xs text-[#52627d] dark:text-slate-400">Latest valid participant days.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        {lastFiveDateTables.length} days
                      </span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {lastFiveDateTables.map((table) => (
                        <button
                          key={table.date}
                          type="button"
                          onClick={() => {
                            setParticipantViewDate(table.date);
                            setFlowDate(table.date);
                          }}
                          className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                            table.date === participantViewDate
                              ? "border-sky-300 bg-sky-50 dark:border-sky-400/40 dark:bg-sky-400/10"
                              : "border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-950 dark:text-white">{table.display}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                table.overallTrend === "Bullish"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200"
                                  : table.overallTrend === "Bearish"
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-200"
                                    : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200"
                              }`}
                            >
                              {table.overallTrend}
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                            <div
                              className={`h-full rounded-full ${
                                table.overallTrend === "Bullish"
                                  ? "bg-emerald-500"
                                  : table.overallTrend === "Bearish"
                                    ? "bg-rose-500"
                                    : "bg-slate-400"
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(
                                    12,
                                    table.rows.reduce((sum, row) => sum + Math.abs(row.change), 0) / 20000
                                  )
                                )}%`
                              }}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
                    <div className="font-semibold">Keep this panel focused</div>
                    <p className="mt-2 text-xs leading-5">
                      Participant Wise OI stays as the decision panel. Extra photo cards and duplicate tables have been removed from the main view.
                    </p>
                  </div>
                </aside>
              </div>
            </section>
          )}

          {view === "news" && (
            <section id="news" className="mx-auto max-w-6xl space-y-6 px-6 py-8">
              <div>
                <h2 className="section-title">Market News</h2>
                <p className="section-lead">
                  Important headlines that can impact Indian markets.
                </p>
              </div>

              <div className="card border border-blue-200/40 bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(20,184,166,0.06))]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">NSE/BSE impact feed</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadMarketNews({ page: 1, append: false, pageSize: 10 })}
                      className="rounded-full bg-[linear-gradient(135deg,#2563eb,#14b8a6)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-105"
                    >
                      Refresh
                    </button>
                    <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                      Auto-refresh: 1h
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {newsLoading && (
                    <div className="text-sm text-muted">Loading latest headlines...</div>
                  )}
                  {!newsLoading && newsError && (
                    <div className="text-sm text-negative">{newsError}</div>
                  )}
                  {!newsLoading && !newsError && marketNews.length === 0 && (
                    <div className="text-sm text-muted">No headlines available right now.</div>
                  )}
                  {!newsLoading &&
                    !newsError &&
                    marketNews.map((item) => (
                      <a
                        key={`${item.link}-${item.publishedAt}`}
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
                      >
                        <div className="h-36 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(20,184,166,0.12))]">
                          {item.image ? (
                            <img
                              src={item.image}
                              alt={item.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                        <div className="px-4 py-3">
                          <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span>{item.source}</span>
                            <span>•</span>
                            <span>{item.publishedAt || "Latest"}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 font-semibold ${
                                item.impact === "High"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {item.impact} impact
                            </span>
                          </div>
                        </div>
                      </a>
                    ))}
                  {!newsLoading && !newsError && newsHasMore && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          void loadMarketNews({
                            page: newsPage + 1,
                            append: true,
                            pageSize: 10
                          })
                        }
                        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Next page
                      </button>
                    </div>
                  )}
                  {!newsLoading && !newsError && !newsHasMore && marketNews.length > 0 && (
                    <div className="text-xs text-slate-500">No more headlines.</div>
                  )}
                </div>
              </div>
            </section>
          )}

          {view === "opportunities" && (
            <section
              id="opportunities"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
              <div>
                <h2 className="section-title">Live Opportunities</h2>
                <p className="section-lead">
                  Rule-based opportunities from live price/volume structure.
                </p>
              </div>

              <div className="card">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold">
                    Stock Suggestions (Intraday / Swing)
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                      Target 10-25%
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadStockSuggestions()}
                      className="rounded-full bg-[linear-gradient(135deg,#2563eb,#14b8a6)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-105"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                        <th className="px-3 py-2 text-left font-semibold">Style</th>
                        <th className="px-3 py-2 text-left font-semibold">Entry Zone</th>
                        <th className="px-3 py-2 text-left font-semibold">Exit Price</th>
                        <th className="px-3 py-2 text-left font-semibold">SL</th>
                        <th className="px-3 py-2 text-left font-semibold">Target %</th>
                        <th className="px-3 py-2 text-left font-semibold">R:R</th>
                        <th className="px-3 py-2 text-left font-semibold">Conviction</th>
                        <th className="px-3 py-2 text-left font-semibold">Reason</th>
                        <th className="px-3 py-2 text-left font-semibold">Timeframe</th>
                        <th className="px-3 py-2 text-left font-semibold">Size %</th>
                        <th className="px-3 py-2 text-left font-semibold">Valid Till</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockSuggestions.map((item) => (
                        <tr
                          key={`${item.symbol}-${item.style}`}
                          className="border-t border-slate-200"
                        >
                          <td className="px-3 py-2 font-semibold">{item.symbol}</td>
                          <td className="px-3 py-2">{item.style}</td>
                          <td className="px-3 py-2">{item.entryZone}</td>
                          <td className="px-3 py-2">{item.exitPrice}</td>
                          <td className="px-3 py-2">
                            {item.stopLossPrice} ({item.stopLossPct}%)
                          </td>
                          <td className="px-3 py-2">
                            {item.targetMinPct}% - {item.targetMaxPct}%
                          </td>
                          <td className="px-3 py-2 font-semibold text-sky-700">
                            {item.riskReward}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                item.convictionScore >= 8
                                  ? "bg-emerald-100 text-emerald-700"
                                  : item.convictionScore >= 6
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {item.convictionScore}/10
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{item.convictionReason}</div>
                            <div className="text-[11px] text-muted">
                              Trigger: {item.entryTrigger}
                            </div>
                            <div className="text-[11px] text-muted">
                              Invalidation: {item.invalidation}
                            </div>
                          </td>
                          <td className="px-3 py-2">{item.timeframe}</td>
                          <td className="px-3 py-2">{item.positionSizePct}%</td>
                          <td className="px-3 py-2">{item.validTill}</td>
                        </tr>
                      ))}
                      {stockSuggestions.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="px-3 py-4 text-center text-muted">
                            No live opportunities matched the current model.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {stockSuggestionStatus ||
                    "Educational watchlist only. Use your own risk management."}
                </div>
              </div>
            </section>
          )}

          {view === "setup-edit" && (
            <section
              id="setup-edit"
              className="mx-auto max-w-4xl space-y-6 px-6 py-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Edit strategy</h2>
                  <p className="section-lead">
                    Update the playbook with more detailed notes.
                  </p>
                </div>
                <Link
                  href="/dashboard/setup"
                  className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted"
                >
                  Back to setup
                </Link>
              </div>

              <div className="card space-y-4">
                {!strategyBeingEdited ? (
                  <div className="text-sm text-muted">
                    Strategy not found. Go back and choose a valid strategy.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3">
                      <label className="text-xs text-muted">
                        Strategy name
                        <input
                          value={strategyEditName}
                          onChange={(event) =>
                            setStrategyEditName(event.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                        />
                      </label>
                      <label className="text-xs text-muted">
                        Rules / checklist
                        <textarea
                          value={strategyEditRules}
                          onChange={(event) =>
                            setStrategyEditRules(event.target.value)
                          }
                          rows={6}
                          className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        className="rounded-full bg-primary px-5 py-2 text-xs font-semibold"
                        onClick={handleUpdateStrategy}
                      >
                        Save changes
                      </button>
                      <Link
                        href="/dashboard/setup"
                        className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted"
                      >
                        Cancel
                      </Link>
                      {strategyEditStatus && (
                        <span className="text-xs text-muted">
                          {strategyEditStatus}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {view === "brokers" && (
            <BrokerConnections
              dataSource={dataSource}
              session={session}
              instruments={instruments}
              accounts={accounts}
              defaultAccountId={defaultTradingAccount?.id}
              tradeList={tradeList}
              onImportBrokerTrades={handleImportBrokerTrades}
            />
          )}

          {view === "journal" && (
            <section id="journal" className="mx-auto max-w-6xl space-y-6 px-6 py-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="section-title"><span className="pagesymbol">▣</span> Trade journal</h2>
                  <p className="section-lead">
                    {selectedJournalTrade
                      ? "Review your execution notes, chart references and lessons learned."
                      : "Log every trade with its setup, risk, execution and review."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {selectedJournalTrade ? (
                    <>
                      <button type="button" onClick={() => setSelectedJournalTradeId(null)} className="rounded-lg border border-[#e1e7f0] bg-white px-4 py-2 font-bold text-[#425370]">← Back to journal</button>
                      <button type="button" disabled={!previousJournalTrade} onClick={() => previousJournalTrade && setSelectedJournalTradeId(previousJournalTrade.tradeId)} className="rounded-lg border border-[#e1e7f0] bg-white px-4 py-2 font-bold text-[#425370] disabled:opacity-40">Previous trade</button>
                      <button type="button" disabled={!nextJournalTrade} onClick={() => nextJournalTrade && setSelectedJournalTradeId(nextJournalTrade.tradeId)} className="rounded-lg border border-[#e1e7f0] bg-white px-4 py-2 font-bold text-[#425370] disabled:opacity-40">Next trade</button>
                    </>
                  ) : (
                    <>
                      <Link href="/dashboard/journal/nifty" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 font-bold text-[#425370]">Nifty</Link>
                      <Link href="/dashboard/journal/bnifty" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 font-bold text-[#425370]">B.Nifty</Link>
                      <Link href="/dashboard/journal/sensex" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 font-bold text-[#425370]">Sensex</Link>
                      <Link href="/dashboard/journal" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 font-bold text-[#425370]">All</Link>
                      <button type="button" onClick={handleExportCsv} className="rounded-lg bg-primary px-4 py-2 font-bold text-white">Export CSV</button>
                    </>
                  )}
                  <button type="button" onClick={() => { setEditingTrade(null); setJournalFormOpen(true); }} className="rounded-lg bg-primary px-4 py-2 font-bold text-white">+ Add trade</button>
                </div>
              </div>

              {selectedJournalTrade ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.95fr)]">
                  <div className="space-y-4">
                    <div className="card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2"><h3 className="text-base font-extrabold text-[#132342]">{selectedJournalTrade.instrument}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${selectedJournalTrade.pl >= 0 ? "bg-[#e5f7f0] text-[#07966c]" : "bg-[#fff0ef] text-[#df4747]"}`}>{selectedJournalTrade.winLoss}</span></div>
                          <p className="mt-1 text-xs text-muted">{selectedJournalTrade.date} · {selectedJournalTrade.entryTime}–{selectedJournalTrade.exitTime} · {selectedJournalTrade.strategy} · {selectedJournalTrade.lots ?? 1} lot × {selectedJournalTrade.lotSize ?? selectedJournalTrade.sizeQty} qty</p>
                        </div>
                        <button type="button" onClick={() => handleEditTrade(selectedJournalTrade)} className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 text-[11px] font-bold text-[#425370]">Edit trade</button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {[{ label: "Entry", value: selectedJournalTrade.entryPrice }, { label: "Exit", value: selectedJournalTrade.exitPrice }, { label: "Stop", value: selectedJournalTrade.stopLoss }, { label: "Target", value: selectedJournalTrade.targetPrice }, { label: "Net P&L", value: signedMoney0.format(selectedJournalTrade.pl), tone: selectedJournalTrade.pl >= 0 ? "text-positive" : "text-negative" }, { label: "R:R", value: selectedJournalTrade.rMultiple === null ? "—" : `${selectedJournalTrade.rMultiple.toFixed(1)}R` }].map((item) => (
                          <div key={item.label} className="rounded-lg border border-[#e1e7f0] bg-white p-3"><span className="text-[11px] text-muted">{item.label}</span><b className={`mt-1 block text-lg ${item.tone ?? "text-[#132342]"}`}>{item.value}</b></div>
                        ))}
                      </div>
                    </div>

                    <div className="card">
                      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Chart &amp; execution</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">•••</span></div>
                      <div className="grid min-h-[225px] place-items-center rounded-xl border border-dashed border-[#cbd7e8] bg-[#fbfdff] p-6 text-center text-sm text-muted">
                        {selectedJournalTrade.pnlScreenshotUrl ? (
                          <img src={selectedJournalTrade.pnlScreenshotUrl} alt="Trade screenshot" className="max-h-[360px] rounded-lg object-contain" />
                        ) : selectedJournalTrade.chartUrl ? (
                          <a href={selectedJournalTrade.chartUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[#e1e7f0] bg-white px-4 py-2 text-xs font-bold text-[#425370]">Open chart link</a>
                        ) : (
                          <div><div className="text-lg">↝</div><p>Attach chart screenshot or paste a chart link while adding the trade.</p></div>
                        )}
                      </div>
                    </div>

                    <div className="card">
                      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Review notes</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">•••</span></div>
                      <div className="grid gap-3 md:grid-cols-2"><div><span className="text-[11px] font-bold text-muted">What went well</span><p className="mt-2 rounded-lg bg-[#f5f8fc] p-3 text-xs text-muted">{selectedJournalTrade.remarks || "No entry reason written yet."}</p></div><div><span className="text-[11px] font-bold text-muted">What to improve</span><p className="mt-2 rounded-lg bg-[#f5f8fc] p-3 text-xs text-muted">{selectedJournalTrade.mindsetNotes || "Add review notes after the trade."}</p></div></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="card"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Trade plan</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">•••</span></div><div className="space-y-3 text-xs text-muted"><div>✅ Strategy: {selectedJournalTrade.strategy}</div><div>✅ Exit reason: {selectedJournalTrade.exitReason}</div><div>✅ Trade type: {selectedJournalTrade.tradeType ?? "Unspecified"}</div><div>⬜ Avoided oversized candle</div></div></div>
                    <div className="card"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Psychology tags</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">•••</span></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-[#e5f7f0] px-3 py-1 text-[10px] font-bold text-[#07966c]">{selectedJournalTrade.emotionalState || "Patient"}</span><span className="rounded-full bg-[#e9f2ff] px-3 py-1 text-[10px] font-bold text-[#1767e8]">{selectedJournalTrade.emotionTag || "Followed plan"}</span></div></div>
                    <div className="card"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-extrabold">Learning</h3><span className="rounded-lg border border-[#e1e7f0] px-3 py-2 text-[11px] font-bold text-muted">•••</span></div><p className="rounded-lg bg-[#f5f8fc] p-3 text-xs text-muted">{selectedJournalTrade.learning || "Add one clean lesson from this trade."}</p><p className="mt-3 text-[11px] text-muted">Saved to your journal · {selectedJournalTrade.date}</p></div>
                  </div>
                </div>
              ) : (
                <TradeJournal
                  trades={filteredTrades}
                  currency={currency}
                  onEdit={handleEditTrade}
                  onDelete={handleDeleteTrades}
                  onReview={(trade) => setSelectedJournalTradeId(trade.tradeId)}
                />
              )}

              {journalFormOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#132342]/35 px-4 py-8 backdrop-blur-sm">
                  <div className="max-h-[86vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e1e7f0] bg-white px-5 py-4">
                      <div><h3 className="text-base font-extrabold text-[#132342]">{editingTrade ? "Edit trade" : "Add a trade"}</h3><p className="text-xs text-muted">Record the plan and review it after exit.</p></div>
                      <button type="button" onClick={() => { setJournalFormOpen(false); setEditingTrade(null); }} className="grid h-8 w-8 place-items-center rounded-lg border border-[#e1e7f0] text-[#425370]">×</button>
                    </div>
                    <div className="p-5">
                      <AddTradeForm
                        instruments={instruments}
                        strategies={strategies}
                        accounts={accounts}
                        defaultAccountId={defaultTradingAccount?.id}
                        editingTrade={editingTrade}
                        onCancelEdit={() => { setEditingTrade(null); setJournalFormOpen(false); }}
                        onUploadPnlScreenshot={dataSource === "supabase" ? uploadTradeScreenshot : undefined}
                        onAdd={handleJournalAddTrade}
                        onUpdate={handleJournalUpdateTrade}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
