"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
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
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

const STORAGE_KEY = "pulsejournal_trades_v2";
const THEME_KEY = "pulsejournal_theme";
const CURRENCY_KEY = "pulsejournal_currency";
const INSTRUMENTS_KEY = "pulsejournal_instruments";
const STRATEGIES_KEY = "pulsejournal_strategies";
const PROFILE_KEY = "pulsejournal_profile";
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
  "Total Investment"
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

const DEFAULT_INSTRUMENTS = ["Nifty", "B.Nifty", "Sensex"];

type StrategyDefinition = {
  id: string;
  name: string;
  rules: string;
};

type DashboardView =
  | "overview"
  | "performance"
  | "strategy"
  | "day"
  | "behavior"
  | "setup"
  | "journal"
  | "profile"
  | "setup-edit";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getDateRange(trades: Trade[]) {
  if (trades.length === 0) return "No trades yet";
  const dates = trades.map((trade) => trade.date).sort();
  return `${dates[0]} - ${dates[dates.length - 1]}`;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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
  return {
    user_id: userId,
    trade_id: trade.tradeId,
    date: trade.date,
    instrument: trade.instrument,
    market: trade.market,
    entry_time: trade.entryTime,
    exit_time: trade.exitTime,
    strategy: trade.strategy,
    direction: trade.direction,
    size_qty: trade.sizeQty,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    stop_loss: trade.stopLoss,
    target_price: trade.targetPrice,
    exit_reason: trade.exitReason,
    platform: trade.platform,
    chart_url: trade.chartUrl ?? null
  };
}

function fromSupabaseRow(row: Record<string, string | number | null>): Trade {
  const timeValue = (value: string | null) =>
    value ? value.slice(0, 5) : "00:00";
  return {
    tradeId: String(row.trade_id ?? ""),
    date: String(row.date ?? ""),
    instrument: String(row.instrument ?? ""),
    market: String(row.market ?? "Equity"),
    entryTime: timeValue(row.entry_time ? String(row.entry_time) : null),
    exitTime: timeValue(row.exit_time ? String(row.exit_time) : null),
    strategy: String(row.strategy ?? "Unspecified"),
    direction: row.direction === "Short" ? "Short" : "Long",
    sizeQty: Number(row.size_qty ?? 0),
    entryPrice: Number(row.entry_price ?? 0),
    exitPrice: Number(row.exit_price ?? 0),
    stopLoss: Number(row.stop_loss ?? 0),
    targetPrice: Number(row.target_price ?? 0),
    exitReason: String(row.exit_reason ?? "Manual"),
    platform: String(row.platform ?? "Web"),
    chartUrl: row.chart_url ? String(row.chart_url) : undefined
  };
}

function buildCsv(derivedTrades: ReturnType<typeof deriveTrades>) {
  const header = CSV_HEADERS.join(",");
  const rows = derivedTrades.map((trade) =>
    [
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
      trade.totalInvestment.toFixed(2)
    ]
      .map((value) => toCsvValue(value))
      .join(",")
  );

  return [header, ...rows].join("\n");
}

function buildTemplateCsv() {
  return CSV_HEADERS.join(",");
}

type AddTradeFormProps = {
  onAdd: (trade: Trade) => Promise<string | null> | string | null;
  onUpdate: (trade: Trade) => Promise<string | null> | string | null;
  onCancelEdit: () => void;
  editingTrade: Trade | null;
  instruments: string[];
  strategies: StrategyDefinition[];
};

function AddTradeForm({
  onAdd,
  onUpdate,
  onCancelEdit,
  editingTrade,
  instruments,
  strategies
}: AddTradeFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [tradeId, setTradeId] = useState(createTradeId());
  const [date, setDate] = useState(today);
  const [instrument, setInstrument] = useState(instruments[0] ?? "");
  const [market, setMarket] = useState("Equity");
  const [entryTime, setEntryTime] = useState("09:30");
  const [exitTime, setExitTime] = useState("10:30");
  const [strategyChoice, setStrategyChoice] = useState(
    strategies[0]?.name ?? "Unspecified"
  );
  const [direction, setDirection] = useState<Trade["direction"]>("Long");
  const [sizeQty, setSizeQty] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [exitReasonChoice, setExitReasonChoice] = useState("");
  const [exitReasonCustom, setExitReasonCustom] = useState("");
  const [platform, setPlatform] = useState("Web");
  const [chartUrl, setChartUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const isEditing = Boolean(editingTrade);

  useEffect(() => {
    if (editingTrade) {
      setTradeId(editingTrade.tradeId);
      setDate(editingTrade.date || today);
      setInstrument(editingTrade.instrument || instruments[0] || "");
      setMarket(editingTrade.market || "Equity");
      setEntryTime(editingTrade.entryTime || "09:30");
      setExitTime(editingTrade.exitTime || "10:30");
      setStrategyChoice(editingTrade.strategy || "Unspecified");
      setDirection(editingTrade.direction || "Long");
      setSizeQty(String(editingTrade.sizeQty ?? 1));
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
      setPlatform(editingTrade.platform || "Web");
      setChartUrl(editingTrade.chartUrl || "");
      return;
    }

    if (!instruments.length) {
      if (!instrument) {
        setInstrument("");
      }
      return;
    }
    if (!instrument) {
      setInstrument(instruments[0]);
    }
  }, [editingTrade, instruments, instrument, today]);

  useEffect(() => {
    if (isEditing) return;
    if (!strategies.length) {
      setStrategyChoice("Unspecified");
      return;
    }
    if (!strategies.find((strategy) => strategy.name === strategyChoice)) {
      setStrategyChoice(strategies[0].name);
    }
  }, [isEditing, strategies, strategyChoice]);

  const instrumentValue = instrument.trim();
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const exitReasonValue =
      exitReasonChoice === "Custom"
        ? exitReasonCustom.trim()
        : exitReasonChoice;
    const chartUrlValue = normalizeUrl(chartUrl);

    if (
      !tradeId ||
      !date ||
      !instrumentValue ||
      !entryTime ||
      !exitTime ||
      !entryPrice ||
      !exitPrice ||
      !stopLoss ||
      !targetPrice ||
      !exitReasonValue
    ) {
      setError("Please fill all required fields.");
      return;
    }

    const qtyValue = Number(sizeQty);
    const entryValue = Number(entryPrice);
    const exitValue = Number(exitPrice);
    const stopValue = Number(stopLoss);
    const targetValue = Number(targetPrice);

    if (
      !Number.isFinite(qtyValue) ||
      !Number.isFinite(entryValue) ||
      !Number.isFinite(exitValue) ||
      !Number.isFinite(stopValue) ||
      !Number.isFinite(targetValue)
    ) {
      setError("Numeric fields must be valid numbers.");
      return;
    }

    const trade: Trade = {
      tradeId,
      date,
      instrument: instrumentValue,
      market,
      entryTime,
      exitTime,
      strategy: strategyChoice || "Unspecified",
      direction,
      sizeQty: qtyValue,
      entryPrice: entryValue,
      exitPrice: exitValue,
      stopLoss: stopValue,
      targetPrice: targetValue,
      exitReason: exitReasonValue,
      platform,
      chartUrl: chartUrlValue || undefined
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
      setTradeId(createTradeId());
      setInstrument(instruments[0] ?? "");
      setStrategyChoice(strategies[0]?.name ?? "Unspecified");
      setEntryPrice("");
      setExitPrice("");
      setStopLoss("");
      setTargetPrice("");
      setExitReasonChoice("");
      setExitReasonCustom("");
      setChartUrl("");
      setSuccess("Trade saved.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="trade-form" onSubmit={handleSubmit} className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">
            {isEditing ? "Edit trade" : "Add trade"}
          </h3>
          <p className="text-sm text-muted">
            Enter trade inputs — analytics update instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-muted"
              onClick={onCancelEdit}
            >
              Cancel edit
            </button>
          )}
          <button
            type="submit"
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
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

      <div className="mt-4 grid gap-3 text-xs md:grid-cols-3 lg:grid-cols-6">
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
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
        <div>
          <input
            list="instrument-options"
            placeholder="Instrument"
            value={instrument}
            onChange={(event) => setInstrument(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            required
          />
          <datalist id="instrument-options">
            {instruments.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>
        <select
          value={market}
          onChange={(event) => setMarket(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="Equity">Equity</option>
          <option value="F&O">F&O</option>
          <option value="Crypto">Crypto</option>
        </select>
        <input
          type="time"
          value={entryTime}
          onChange={(event) => setEntryTime(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
        <input
          type="time"
          value={exitTime}
          onChange={(event) => setExitTime(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
      </div>

      <div className="mt-3 grid gap-3 text-xs md:grid-cols-3 lg:grid-cols-6">
        <select
          value={strategyChoice}
          onChange={(event) => setStrategyChoice(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          {strategies.length === 0 && (
            <option value="Unspecified">Unspecified</option>
          )}
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.name}>
              {strategy.name}
            </option>
          ))}
          {strategies.length > 0 && (
            <option value="Unspecified">Unspecified</option>
          )}
        </select>
        <select
          value={direction}
          onChange={(event) =>
            setDirection(event.target.value as Trade["direction"])
          }
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="Long">Long</option>
          <option value="Short">Short</option>
        </select>
        <input
          placeholder="Size (Qty.)"
          value={sizeQty}
          onChange={(event) => setSizeQty(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          required
        />
        <input
          placeholder="Entry Price"
          value={entryPrice}
          onChange={(event) => setEntryPrice(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          required
        />
        <input
          placeholder="Exit Price"
          value={exitPrice}
          onChange={(event) => setExitPrice(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          required
        />
        <input
          placeholder="Stop Loss"
          value={stopLoss}
          onChange={(event) => setStopLoss(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          required
        />
      </div>

      <div className="mt-3 grid gap-3 text-xs md:grid-cols-3 lg:grid-cols-6">
        <input
          placeholder="Target Price"
          value={targetPrice}
          onChange={(event) => setTargetPrice(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          required
        />
        <div className="flex flex-col gap-2">
          <select
            value={exitReasonChoice}
            onChange={(event) => setExitReasonChoice(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
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
          placeholder="Platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
        <input
          placeholder="Chart link (optional)"
          value={chartUrl}
          onChange={(event) => setChartUrl(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
      </div>
    </form>
  );
}

export default function ClientDashboard({
  view = "overview",
  editStrategyId
}: {
  view?: DashboardView;
  editStrategyId?: string;
}) {
  const router = useRouter();
  const [tradeList, setTradeList] = useState<Trade[]>(() =>
    isSupabaseConfigured ? [] : seedTrades
  );
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [globalMarket, setGlobalMarket] = useState("all");
  const [globalInstrument, setGlobalInstrument] = useState("all");
  const [globalStrategy, setGlobalStrategy] = useState("all");
  const [globalStartDate, setGlobalStartDate] = useState("");
  const [globalEndDate, setGlobalEndDate] = useState("");
  const [dataSource, setDataSource] = useState(
    isSupabaseConfigured ? "supabase" : "local"
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const lastUserIdRef = useRef<string | null>(null);
  const [instruments, setInstruments] = useState<string[]>(DEFAULT_INSTRUMENTS);
  const [instrumentInput, setInstrumentInput] = useState("");
  const [strategies, setStrategies] = useState<StrategyDefinition[]>([]);
  const [strategyNameInput, setStrategyNameInput] = useState("");
  const [strategyRulesInput, setStrategyRulesInput] = useState("");
  const [strategyStatus, setStrategyStatus] = useState("");
  const [strategyEditName, setStrategyEditName] = useState("");
  const [strategyEditRules, setStrategyEditRules] = useState("");
  const [strategyEditStatus, setStrategyEditStatus] = useState("");
  const [activeSection, setActiveSection] =
    useState<DashboardView>("overview");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

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
    const stored = localStorage.getItem(instrumentStorageKey);
    if (!stored) {
      setInstruments(DEFAULT_INSTRUMENTS);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length) {
        const merged = Array.from(
          new Set([...DEFAULT_INSTRUMENTS, ...parsed])
        );
        setInstruments(merged);
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
    const sectionIds = ["overview", "performance", "strategy", "day", "behavior"];
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id as DashboardView);
          }
        });
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0.1 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    if (view !== "journal") {
      setEditingTrade(null);
    }
  }, [view]);

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

  const filteredTrades = useMemo(
    () =>
      tradeList.filter((trade) => {
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
      globalMarket,
      globalInstrument,
      globalStrategy,
      globalStartDate,
      globalEndDate
    ]
  );

  const derived = useMemo(() => deriveTrades(filteredTrades), [filteredTrades]);
  const summary = useMemo(() => computeSummary(derived), [derived]);
  const dayBreakdown = useMemo(() => breakdownByDay(derived), [derived]);
  const weekBreakdown = useMemo(() => breakdownByWeek(derived), [derived]);
  const monthBreakdown = useMemo(() => breakdownByMonth(derived), [derived]);
  const monthWinRate = useMemo(() => winRateByMonth(derived), [derived]);
  const dateRange = useMemo(() => getDateRange(filteredTrades), [filteredTrades]);
  const dayStats = useMemo(() => dayOfWeekStats(derived), [derived]);

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

  const overtradeDays = derived.reduce<Record<string, number>>((acc, trade) => {
    acc[trade.date] = (acc[trade.date] ?? 0) + 1;
    return acc;
  }, {});
  const overtradeList = Object.entries(overtradeDays)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  const bestStrategy = strategyStats[0];
  const worstStrategy = strategyStats[strategyStats.length - 1];

  const bestDay = [...dayStats].sort((a, b) => b.totalPl - a.totalPl)[0];
  const worstDay = [...dayStats].sort((a, b) => a.totalPl - b.totalPl)[0];

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

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
        instrument,
        market,
        entryTime,
        exitTime,
        strategy,
        direction,
        sizeQty,
        entryPrice,
        exitPrice,
        stopLoss,
        targetPrice,
        exitReason,
        platform
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

  function handleEditTrade(trade: Trade) {
    setEditingTrade(trade);
    requestAnimationFrame(() => {
      document
        .getElementById("trade-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  function handleAddInstrument() {
    const name = instrumentInput.trim();
    if (!name) return;
    setInstruments((prev) => {
      if (prev.some((item) => item.toLowerCase() === name.toLowerCase())) {
        return prev;
      }
      return [...prev, name];
    });
    setInstrumentInput("");
  }

  function handleRemoveInstrument(name: string) {
    setInstruments((prev) => prev.filter((item) => item !== name));
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

  const navItems = [
    { label: "Overview", href: "/dashboard", id: "overview" },
    { label: "Performance", href: "/dashboard#performance", id: "performance" },
    { label: "Strategy", href: "/dashboard#strategy", id: "strategy" },
    { label: "Day-wise", href: "/dashboard#day", id: "day" },
    { label: "Behavior", href: "/dashboard#behavior", id: "behavior" },
    { label: "Setup", href: "/dashboard/setup", id: "setup" },
    { label: "Journal", href: "/dashboard/journal", id: "journal" }
  ];

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
    <main className="min-h-screen bg-ink text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid opacity-70" />
        <div className="absolute inset-0 bg-candles opacity-30" />
        <div className="absolute -top-40 left-1/3 h-[420px] w-[420px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-white/10 blur-[120px]" />
      </div>
      <div className="relative flex items-start">
        <aside className="hidden h-screen w-60 flex-col border-r border-white/5 bg-panel/40 p-6 lg:flex lg:sticky lg:top-0 lg:self-start overflow-y-auto">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 border border-primary/40 text-xs font-semibold">
              TJ
            </div>
            <span className="text-lg font-semibold">Trade Journal</span>
          </Link>
          <nav className="mt-10 grid gap-1 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`w-full rounded-lg px-3 py-2 text-left transition ${
                  activeSection === item.id
                    ? "bg-primary/10 text-white"
                    : "text-muted hover:bg-primary/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto text-xs text-muted">
            Data source: {dataSourceLabel}
          </div>
        </aside>

        <div className="flex-1">
          <header className="sticky top-0 z-10 border-b border-white/5 bg-ink/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div>
                <h1 className="text-xl font-semibold">Trader cockpit</h1>
                <p className="text-xs text-muted">Review period: {dateRange}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href="/dashboard"
                  className="rounded-full border border-white/10 px-4 py-2 text-muted"
                >
                  Home
                </Link>
                <input
                  type="date"
                  value={globalStartDate}
                  onChange={(event) => setGlobalStartDate(event.target.value)}
                  className="rounded-full border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                />
                <input
                  type="date"
                  value={globalEndDate}
                  onChange={(event) => setGlobalEndDate(event.target.value)}
                  className="rounded-full border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                />
                <select
                  value={globalMarket}
                  onChange={(event) => setGlobalMarket(event.target.value)}
                  className="rounded-full border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
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
                  className="rounded-full border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
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
                  className="rounded-full border border-white/10 bg-ink px-3 py-2 text-xs text-muted"
                >
                  <option value="all">All strategies</option>
                  {strategyOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-full border border-white/10 px-3 py-2 text-xs text-muted"
                  onClick={() => {
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
                  className="rounded-full border border-white/10 bg-ink px-4 py-2 text-muted"
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
                  className="rounded-full bg-primary px-4 py-2 font-semibold"
                  onClick={handleExportCsv}
                >
                  Export CSV
                </button>
              </div>
            </div>
            <div className="lg:hidden border-t border-white/5">
              <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-2 text-xs sm:px-6">
                {navItems.map((item) => (
                  <Link
                    key={`mobile-${item.label}`}
                    href={item.href}
                    className={`rounded-full px-3 py-1 whitespace-nowrap ${
                      activeSection === item.id
                        ? "bg-primary/15 text-white"
                        : "text-muted hover:bg-primary/10 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </header>

          {view === "overview" && (
            <>
              <section
                id="overview"
                className="mx-auto max-w-6xl space-y-8 px-6 py-8 scroll-mt-24"
              >
            <div>
              <h2 className="section-title">Overview</h2>
              <p className="section-lead">
                High-signal KPIs for edge, risk, and execution.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {kpis.map((kpi) => (
                <div key={kpi.label} className="kpi">
                  <div className="text-xs text-muted">{kpi.label}</div>
                  <div className="mt-1 text-lg font-semibold">{kpi.value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="card">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Equity curve</h3>
                  <span
                    className={
                      summary.totalPl >= 0
                        ? "text-positive text-sm"
                        : "text-negative text-sm"
                    }
                  >
                    {signedMoney0.format(summary.totalPl)} total
                  </span>
                </div>
                <div className="mt-4 rounded-xl border border-white/5 bg-elevate p-4">
                  <Sparkline
                    data={summary.equityCurve.map((point) => point.equity)}
                  />
                </div>
                <div className="mt-4 grid gap-3 text-xs text-muted md:grid-cols-3">
                  <div>Profit factor: {profitFactorLabel}</div>
                  <div>Avg R:R: {avgRRLabel}</div>
                  <div>Max DD %: {maxDrawdownPct}</div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="card">
                  <h3 className="text-sm text-muted">Win/Loss mix</h3>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-3xl font-semibold">
                      {formatPercent(summary.winRate)}
                    </div>
                    <DonutChart value={summary.winRate} />
                  </div>
                  <div className="mt-4 text-xs text-muted">
                    {summary.wins} wins · {summary.losses} losses · {summary.breakeven} BE
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-sm text-muted">Expectancy</h3>
                  <div className="mt-4 text-2xl font-semibold">
                    {expectancyLabel}
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    Max profit {signedMoney2.format(summary.maxProfitTrade)} · Max loss {signedMoney2.format(summary.maxLossTrade)}
                  </div>
                </div>
              </div>
            </div>
              </section>

              <section
                id="performance"
                className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24"
              >
            <div>
              <h2 className="section-title">Performance</h2>
              <p className="section-lead">
                Daily, weekly, and monthly rhythm of P&L.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="card">
                <h3 className="text-sm text-muted">Daily P/L</h3>
                <div className="mt-4">
                  <BarList rows={dayBreakdown} formatValue={signedMoney0.format} />
                </div>
              </div>
              <div className="card">
                <h3 className="text-sm text-muted">Weekly P/L</h3>
                <div className="mt-4">
                  <BarList rows={weekBreakdown} formatValue={signedMoney0.format} />
                </div>
              </div>
              <div className="card">
                <h3 className="text-sm text-muted">Monthly P/L</h3>
                <div className="mt-4">
                  <BarList rows={monthBreakdown} formatValue={signedMoney0.format} />
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="card">
                <h3 className="text-lg font-semibold">Equity curve + drawdown</h3>
                <div className="mt-4 rounded-xl border border-white/5 bg-elevate p-4">
                  <Sparkline
                    data={summary.equityCurve.map((point) => point.equity)}
                  />
                </div>
                <div className="mt-4 rounded-xl border border-white/5 bg-elevate p-4">
                  <Sparkline
                    data={summary.drawdownSeries}
                    stroke="#EF4444"
                    fill="rgba(239, 68, 68, 0.15)"
                  />
                </div>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold">Monthly win rate</h3>
                <div className="mt-4 space-y-3 text-sm">
                  {monthWinRate.map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-muted">{row.label}</span>
                      <span>{formatPercent(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
              </section>

              <section
                id="strategy"
                className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24"
              >
            <div>
              <h2 className="section-title">Strategy analysis</h2>
              <p className="section-lead">
                Spot your strongest and weakest playbooks.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card">
                <h3 className="text-sm text-muted">Strategy-wise performance</h3>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="pb-2">Strategy</th>
                        <th className="pb-2">Trades</th>
                        <th className="pb-2">Win%</th>
                        <th className="pb-2">Net P/L</th>
                        <th className="pb-2">Avg R:R</th>
                        <th className="pb-2">Expectancy</th>
                        <th className="pb-2">Profit factor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategyStats.map((row) => (
                        <tr key={row.name} className="border-t border-white/5">
                          <td className="py-2 text-muted">{row.name}</td>
                          <td className="py-2">{row.trades}</td>
                          <td className="py-2">{formatPercent(row.winRate)}</td>
                          <td
                            className={`py-2 ${
                              row.totalPl >= 0 ? "text-positive" : "text-negative"
                            }`}
                          >
                            {signedMoney2.format(row.totalPl)}
                          </td>
                          <td className="py-2 text-muted">
                            {row.avgRR ? row.avgRR.toFixed(2) : "—"}
                          </td>
                          <td className="py-2 text-muted">
                            {row.expectancyR ? `${row.expectancyR.toFixed(2)}R` : "—"}
                          </td>
                          <td className="py-2 text-muted">
                            {row.profitFactor ? row.profitFactor.toFixed(2) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-6">
                <div className="card">
                  <h3 className="text-sm text-muted">Best & worst strategy</h3>
                  <div className="mt-4 space-y-3 text-sm">
                    {bestStrategy ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Best</span>
                        <span className="text-positive">
                          {bestStrategy.name} · {signedMoney2.format(bestStrategy.totalPl)}
                        </span>
                      </div>
                    ) : null}
                    {worstStrategy ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Worst</span>
                        <span className="text-negative">
                          {worstStrategy.name} · {signedMoney2.format(worstStrategy.totalPl)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-sm text-muted">Instrument-wise performance</h3>
                  <div className="mt-4 space-y-2 text-xs">
                    {instrumentStats.slice(0, 6).map((row) => (
                      <div key={row.name} className="flex items-center justify-between">
                        <span className="text-muted">{row.name}</span>
                        <span className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>
                          {signedMoney2.format(row.totalPl)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
              </section>

              <section
                id="day"
                className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24"
              >
            <div>
              <h2 className="section-title">Day-wise analysis</h2>
              <p className="section-lead">
                Identify which days consistently perform.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card">
                <h3 className="text-sm text-muted">P/L by day</h3>
                <div className="mt-4 space-y-2 text-sm">
                  {dayStats.map((row) => (
                    <div key={row.day} className="flex items-center justify-between">
                      <span className="text-muted">{row.day}</span>
                      <span className={row.totalPl >= 0 ? "text-positive" : "text-negative"}>
                        {signedMoney2.format(row.totalPl)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3 className="text-sm text-muted">Win rate by day</h3>
                <div className="mt-4 space-y-2 text-sm">
                  {dayStats.map((row) => (
                    <div key={row.day} className="flex items-center justify-between">
                      <span className="text-muted">{row.day}</span>
                      <span>{formatPercent(row.winRate)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 text-xs text-muted">
                  {bestDay ? (
                    <div>Best day: {bestDay.day}</div>
                  ) : null}
                  {worstDay ? (
                    <div>Worst day: {worstDay.day}</div>
                  ) : null}
                </div>
              </div>
            </div>
              </section>

              <section
                id="behavior"
                className="mx-auto max-w-6xl space-y-6 px-6 py-8 scroll-mt-24"
              >
            <div>
              <h2 className="section-title">Behavior & risk insights</h2>
              <p className="section-lead">
                Detect patterns that impact discipline and expectancy.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="card">
                <h3 className="text-sm text-muted">Exit reasons</h3>
                <div className="mt-4 space-y-2 text-sm">
                  {exitReasons.map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-muted">{row.label}</span>
                      <span>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3 className="text-sm text-muted">Risk flags</h3>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Low R:R trades (&lt; 1)</span>
                    <span className="text-negative">{lowRRCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Early exits</span>
                    <span className="text-negative">{earlyExitCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Stop hits</span>
                    <span>{stopHits}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Target hits</span>
                    <span>{targetHits}</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="text-sm text-muted">Overtrading days</h3>
                <div className="mt-4 space-y-2 text-sm">
                  {overtradeList.length === 0 && (
                    <div className="text-muted">No spikes yet</div>
                  )}
                  {overtradeList.map(([date, count]) => (
                    <div key={date} className="flex items-center justify-between">
                      <span className="text-muted">{date}</span>
                      <span className="text-negative">{count} trades</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
              </section>
            </>
          )}

          {view === "setup" && (
            <section
              id="setup"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
            <div>
              <h2 className="section-title">Setup</h2>
              <p className="section-lead">
                Maintain your instrument list and strategy playbook.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="card space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Instruments</h3>
                  <p className="text-sm text-muted">
                    Default: Nifty, B.Nifty, Sensex. Add your own names below.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <input
                    placeholder="Add instrument"
                    value={instrumentInput}
                    onChange={(event) => setInstrumentInput(event.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                  <button
                    className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
                    onClick={handleAddInstrument}
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {instruments.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1"
                    >
                      {item}
                      <button
                        className="text-[10px] text-muted hover:text-white"
                        onClick={() => handleRemoveInstrument(item)}
                        aria-label={`Remove ${item}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>

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

          {view === "journal" && (
            <section
              id="journal"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
            >
            <AddTradeForm
              instruments={instruments}
              strategies={strategies}
              editingTrade={editingTrade}
              onCancelEdit={() => setEditingTrade(null)}
              onAdd={async (trade) => {
                if (dataSource === "supabase") {
                  if (!supabase) return "Supabase is not configured.";
                  if (!session) return "Please sign in to save trades.";
                  const { error } = await supabase
                    .from("trades")
                    .insert(toSupabaseRow(trade, session.user.id));
                  if (error) {
                    setImportStatus(`Supabase insert failed: ${error.message}`);
                    return `Supabase error: ${error.message}`;
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
                    return `Supabase fetch error: ${fetchError.message}`;
                  }
                  if (data) {
                    setTradeList(data.map((row) => fromSupabaseRow(row)));
                  }
                  return null;
                }
                setTradeList((prev) => [trade, ...prev]);
                return null;
              }}
              onUpdate={async (trade) => {
                if (dataSource === "supabase") {
                  if (!supabase) return "Supabase is not configured.";
                  if (!session) return "Please sign in to save trades.";
                  const { error } = await supabase
                    .from("trades")
                    .update(toSupabaseRow(trade, session.user.id))
                    .eq("user_id", session.user.id)
                    .eq("trade_id", trade.tradeId);
                  if (error) {
                    setImportStatus(`Supabase update failed: ${error.message}`);
                    return `Supabase error: ${error.message}`;
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
                    return `Supabase fetch error: ${fetchError.message}`;
                  }
                  if (data) {
                    setTradeList(data.map((row) => fromSupabaseRow(row)));
                  }
                  return null;
                }
                setTradeList((prev) =>
                  prev.map((item) =>
                    item.tradeId === trade.tradeId ? trade : item
                  )
                );
                return null;
              }}
            />

            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">CSV import/export</h3>
                  <p className="text-sm text-muted">
                    Use the exact headers. Download the template if needed.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    className="rounded-full border border-white/10 px-4 py-2"
                    onClick={handleDownloadTemplate}
                  >
                    Download template
                  </button>
                  <button
                    className="rounded-full border border-white/10 px-4 py-2"
                    onClick={handleExportCsv}
                  >
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      handleImportFile(file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <label className="flex items-center gap-2 text-muted">
                  <input
                    type="checkbox"
                    checked={replaceOnImport}
                    onChange={(event) => setReplaceOnImport(event.target.checked)}
                  />
                  Replace existing trades on import
                </label>
                {importStatus && (
                  <span className="text-muted">{importStatus}</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span>
                {tradeList.length} trades · Data source:{" "}
                {dataSource === "supabase" ? "Supabase" : "Local"}
              </span>
              <div className="flex gap-3">
                <button
                  className="rounded-full border border-white/10 px-4 py-2"
                  onClick={() => setTradeList(seedTrades)}
                >
                  Restore demo data
                </button>
                <button
                  className="rounded-full border border-white/10 px-4 py-2"
                  onClick={() => {
                    if (window.confirm("Clear all trades? This cannot be undone.")) {
                      setTradeList([]);
                    }
                  }}
                >
                  Clear all
                </button>
                <Link
                  href="/"
                  className="rounded-full border border-white/10 px-4 py-2"
                >
                  Back to landing
                </Link>
              </div>
            </div>

            <TradeJournal
              trades={filteredTrades}
              currency={currency}
              onEdit={handleEditTrade}
            />
          </section>
          )}
        </div>
      </div>
    </main>
  );
}
