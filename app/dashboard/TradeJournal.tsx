"use client";

import { useMemo, useState } from "react";
import type { Trade } from "../data/trades";
import { deriveTrades } from "../data/analytics";

function formatMinutes(minutes: number) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function formatDirectionLabel(direction: Trade["direction"]) {
  return direction === "Short" ? "Put (Buy)" : "Call (Buy)";
}

export default function TradeJournal({
  trades,
  currency,
  onEdit
}: {
  trades: Trade[];
  currency: "INR" | "USD";
  onEdit?: (trade: Trade) => void;
}) {
  const derived = useMemo(() => deriveTrades(trades), [trades]);
  const instruments = useMemo(
    () => Array.from(new Set(derived.map((t) => t.instrument))).sort(),
    [derived]
  );
  const strategies = useMemo(
    () => Array.from(new Set(derived.map((t) => t.strategy))).sort(),
    [derived]
  );
  const markets = useMemo(
    () => Array.from(new Set(derived.map((t) => t.market))).sort(),
    [derived]
  );

  const [instrument, setInstrument] = useState("all");
  const [strategy, setStrategy] = useState("all");
  const [market, setMarket] = useState("all");
  const [direction, setDirection] = useState("all");
  const [result, setResult] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const locale = currency === "INR" ? "en-IN" : "en-US";
  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency, locale]
  );
  const signedMoney = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: "always"
      }),
    [currency, locale]
  );

  const filtered = derived.filter((trade) => {
    if (instrument !== "all" && trade.instrument !== instrument) return false;
    if (strategy !== "all" && trade.strategy !== strategy) return false;
    if (market !== "all" && trade.market !== market) return false;
    if (direction !== "all" && trade.direction !== direction) return false;
    if (result !== "all" && trade.winLoss !== result) return false;
    if (startDate && trade.date < startDate) return false;
    if (endDate && trade.date > endDate) return false;
    return true;
  });

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Trade journal</h3>
          <p className="text-sm text-muted">
            Filter by date, instrument, market, or strategy.
          </p>
        </div>
        <button
          className="rounded-full border border-white/10 px-4 py-2 text-xs"
          onClick={() => {
            setInstrument("all");
            setStrategy("all");
            setMarket("all");
            setDirection("all");
            setResult("all");
            setStartDate("");
            setEndDate("");
          }}
        >
          Reset filters
        </button>
      </div>

      <div className="mt-4 grid gap-3 text-xs md:grid-cols-3 lg:grid-cols-6">
        <select
          value={instrument}
          onChange={(event) => setInstrument(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="all">All instruments</option>
          {instruments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={strategy}
          onChange={(event) => setStrategy(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="all">All strategies</option>
          {strategies.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={market}
          onChange={(event) => setMarket(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="all">All markets</option>
          {markets.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="all">All sides</option>
          <option value="Long">Call (Buy)</option>
          <option value="Short">Put (Buy)</option>
        </select>

        <select
          value={result}
          onChange={(event) => setResult(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        >
          <option value="all">All outcomes</option>
          <option value="Win">Win</option>
          <option value="Loss">Loss</option>
          <option value="BE">Breakeven</option>
        </select>

        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />

        <input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
        />
      </div>

      <div className="mt-6 space-y-4">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-panel/30 p-6 text-sm text-muted">
            No trades match the selected filters.
          </div>
        )}

        {filtered.map((trade) => (
          <div
            key={trade.tradeId}
            className="rounded-xl border border-white/10 bg-panel/30 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="text-sm font-semibold text-white">
                  {trade.tradeId}
                </span>
                <span>{trade.date}</span>
                <span>· {trade.day}</span>
                <span>· {trade.entryTime} → {trade.exitTime}</span>
              </div>
              <div className="flex items-center gap-2">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(trade)}
                    className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-muted hover:text-white"
                  >
                    Edit
                  </button>
                )}
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                  {formatDirectionLabel(trade.direction)}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                  {trade.winLoss}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    trade.pl >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {signedMoney.format(trade.pl)}
                </span>
                {trade.chartUrl && (
                  <a
                    href={trade.chartUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:underline"
                  >
                    Chart
                  </a>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-4 text-xs md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  Instrument
                </div>
                <div className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Symbol</span>
                    <span className="font-semibold">{trade.instrument}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Market</span>
                    <span>{trade.market}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Lots</span>
                    <span>
                      {trade.lots ?? 1} × {trade.lotSize ?? trade.sizeQty}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Qty</span>
                    <span>{trade.sizeQty}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Platform</span>
                    <span>{trade.platform}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  Strategy
                </div>
                <div className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Name</span>
                    <span className="font-semibold">{trade.strategy}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Exit</span>
                    <span>{trade.exitReason}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Duration</span>
                    <span>{formatMinutes(trade.tradeDuration)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Invested</span>
                    <span>{money.format(trade.totalInvestment)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  Prices
                </div>
                <div className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Entry</span>
                    <span>{trade.entryPrice}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Exit</span>
                    <span>{trade.exitPrice}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Stop</span>
                    <span>{trade.stopLoss}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Target</span>
                    <span>{trade.targetPrice}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  Risk &amp; Reward
                </div>
                <div className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Risk</span>
                    <span>{money.format(trade.risk)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Reward</span>
                    <span>{money.format(trade.reward)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">R:R</span>
                    <span>
                      {trade.riskReward ? `1:${trade.riskReward.toFixed(2)}` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
