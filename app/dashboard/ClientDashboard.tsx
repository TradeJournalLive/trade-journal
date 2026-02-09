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
  | "journal";

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
    platform: trade.platform
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
    platform: String(row.platform ?? "Web")
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
  instruments: string[];
  strategies: StrategyDefinition[];
};

function AddTradeForm({ onAdd, instruments, strategies }: AddTradeFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [tradeId, setTradeId] = useState(`T-${Date.now()}`);
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
  const [exitReason, setExitReason] = useState("Trailing SL");
  const [platform, setPlatform] = useState("Web");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!instruments.length) {
      if (!instrument) {
        setInstrument("");
      }
      return;
    }
    if (!instrument) {
      setInstrument(instruments[0]);
    }
  }, [instruments, instrument]);

  useEffect(() => {
    if (!strategies.length) {
      setStrategyChoice("Unspecified");
      return;
    }
    if (!strategies.find((strategy) => strategy.name === strategyChoice)) {
      setStrategyChoice(strategies[0].name);
    }
  }, [strategies, strategyChoice]);

  const instrumentValue = instrument.trim();
  const exitReasonValue = exitReason.trim() || "Trailing SL";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (
      !tradeId ||
      !date ||
      !instrumentValue ||
      !entryTime ||
      !exitTime ||
      !entryPrice ||
      !exitPrice ||
      !stopLoss ||
      !targetPrice
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
      platform
    };

    setSaving(true);
    try {
      const response = await onAdd(trade);
      if (response) {
        setError(response);
        return;
      }
      setTradeId(`T-${Date.now()}`);
      setInstrument(instruments[0] ?? "");
      setStrategyChoice(strategies[0]?.name ?? "Unspecified");
      setEntryPrice("");
      setExitPrice("");
      setStopLoss("");
      setTargetPrice("");
      setExitReason("Trailing SL");
      setSuccess("Trade saved.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Add trade</h3>
          <p className="text-sm text-muted">
            Enter trade inputs — analytics update instantly.
          </p>
        </div>
        <button
          type="submit"
          className="rounded-full bg-primary px-4 py-2 text-xs font-semibold"
          disabled={saving}
        >
          {saving ? "Saving..." : "Save trade"}
        </button>
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
        <div>
          <input
            list="exit-reason-options"
            placeholder="Exit Reason"
            value={exitReason}
            onChange={(event) => setExitReason(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
          />
          <datalist id="exit-reason-options">
            <option value="Trailing SL" />
            <option value="SL" />
            <option value="Target" />
          </datalist>
        </div>
        <input
          placeholder="Platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
      </div>
    </form>
  );
}

export default function ClientDashboard({
  view = "overview"
}: {
  view?: DashboardView;
}) {
  const router = useRouter();
  const [tradeList, setTradeList] = useState<Trade[]>(() =>
    isSupabaseConfigured ? [] : seedTrades
  );
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
        setInstruments(parsed);
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

  const activeSection = view;

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
    if (strategies.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
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

  const navItems = [
    { label: "Overview", href: "/dashboard", id: "overview" },
    { label: "Performance", href: "/dashboard/performance", id: "performance" },
    { label: "Strategy", href: "/dashboard/strategy", id: "strategy" },
    { label: "Day-wise", href: "/dashboard/day", id: "day" },
    { label: "Behavior", href: "/dashboard/behavior", id: "behavior" },
    { label: "Setup", href: "/dashboard/setup", id: "setup" },
    { label: "Journal", href: "/dashboard/journal", id: "journal" }
  ];

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
        <div className="absolute -top-40 left-1/3 h-[420px] w-[420px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-white/10 blur-[120px]" />
      </div>
      <div className="relative flex items-start">
        <aside className="hidden h-screen w-60 flex-col border-r border-white/5 bg-panel/40 p-6 lg:flex lg:sticky lg:top-0 lg:self-start overflow-y-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 border border-primary/40 text-xs font-semibold">
              TJ
            </div>
            <span className="text-lg font-semibold">Trade Journal</span>
          </div>
          <nav className="mt-10 grid gap-1 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`w-full rounded-lg px-3 py-2 text-left transition ${
                  activeSection === item.id
                    ? "bg-white/10 text-white"
                    : "text-muted hover:bg-white/10 hover:text-white"
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
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
              <div>
                <h1 className="text-xl font-semibold">Trader cockpit</h1>
                <p className="text-xs text-muted">Review period: {dateRange}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href="/"
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
                <button
                  className="rounded-full border border-white/10 px-4 py-2 text-muted"
                  onClick={() =>
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                  }
                >
                  {theme === "dark" ? "Light" : "Dark"} mode
                </button>
                {session?.user?.email && (
                  <span className="rounded-full border border-white/10 px-3 py-2 text-[11px] text-muted">
                    {session.user.email}
                  </span>
                )}
                {session && (
                  <button
                    className="rounded-full border border-white/10 px-4 py-2 text-muted"
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                )}
                <button
                  className="rounded-full bg-primary px-4 py-2 font-semibold"
                  onClick={handleExportCsv}
                >
                  Export CSV
                </button>
              </div>
            </div>
          </header>

          {view === "overview" && (
            <section
              id="overview"
              className="mx-auto max-w-6xl space-y-8 px-6 py-8"
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
          )}

          {view === "performance" && (
            <section
              id="performance"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
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
          )}

          {view === "strategy" && (
            <section
              id="strategy"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
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
          )}

          {view === "day" && (
            <section
              id="day"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
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
          )}

          {view === "behavior" && (
            <section
              id="behavior"
              className="mx-auto max-w-6xl space-y-6 px-6 py-8"
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
                {strategies.map((strategy) => (
                  <div
                    key={strategy.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold">{strategy.name}</div>
                      {strategy.rules && (
                        <div className="text-muted">{strategy.rules}</div>
                      )}
                    </div>
                    <button
                      className="text-[10px] text-muted hover:text-white"
                      onClick={() => handleRemoveStrategy(strategy.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
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

            <TradeJournal trades={filteredTrades} currency={currency} />
          </section>
          )}
        </div>
      </div>
    </main>
  );
}
