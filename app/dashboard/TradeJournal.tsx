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

export default function TradeJournal({
  trades,
  currency
}: {
  trades: Trade[];
  currency: "INR" | "USD";
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
          <option value="all">All directions</option>
          <option value="Long">Long</option>
          <option value="Short">Short</option>
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

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-[1600px] text-left text-xs whitespace-nowrap">
          <thead className="text-muted">
            <tr>
              <th className="pb-2">Trade ID</th>
              <th className="pb-2">Date</th>
              <th className="pb-2">Day</th>
              <th className="pb-2">Instrument</th>
              <th className="pb-2">Market</th>
              <th className="pb-2">Entry Time</th>
              <th className="pb-2">Exit Time</th>
              <th className="pb-2">Strategy</th>
              <th className="pb-2">Direction</th>
              <th className="pb-2">Size (Qty.)</th>
              <th className="pb-2">Entry Price</th>
              <th className="pb-2">Exit Price</th>
              <th className="pb-2">Stop Loss</th>
              <th className="pb-2">Target Price</th>
              <th className="pb-2">Risk</th>
              <th className="pb-2">Reward</th>
              <th className="pb-2">Risk-Reward</th>
              <th className="pb-2">P/L</th>
              <th className="pb-2">Win/Loss</th>
              <th className="pb-2">Exit Reason</th>
              <th className="pb-2">Platform</th>
              <th className="pb-2">R:R</th>
              <th className="pb-2">Trade Duration</th>
              <th className="pb-2">Total Investment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((trade) => (
              <tr key={trade.tradeId} className="border-t border-white/5">
                <td className="py-2 text-muted">{trade.tradeId}</td>
                <td className="py-2 text-muted">{trade.date}</td>
                <td className="py-2 text-muted">{trade.day}</td>
                <td className="py-2">{trade.instrument}</td>
                <td className="py-2 text-muted">{trade.market}</td>
                <td className="py-2 text-muted">{trade.entryTime}</td>
                <td className="py-2 text-muted">{trade.exitTime}</td>
                <td className="py-2 text-muted">{trade.strategy}</td>
                <td className="py-2 text-muted">{trade.direction}</td>
                <td className="py-2">{trade.sizeQty}</td>
                <td className="py-2">{trade.entryPrice}</td>
                <td className="py-2">{trade.exitPrice}</td>
                <td className="py-2">{trade.stopLoss}</td>
                <td className="py-2">{trade.targetPrice}</td>
                <td className="py-2">{money.format(trade.risk)}</td>
                <td className="py-2">{money.format(trade.reward)}</td>
                <td className="py-2 text-muted">
                  {trade.riskReward ? `1:${trade.riskReward.toFixed(2)}` : "—"}
                </td>
                <td
                  className={`py-2 ${
                    trade.pl >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {signedMoney.format(trade.pl)}
                </td>
                <td className="py-2 text-muted">{trade.winLoss}</td>
                <td className="py-2 text-muted">{trade.exitReason}</td>
                <td className="py-2 text-muted">{trade.platform}</td>
                <td className="py-2 text-muted">
                  {trade.rr ? trade.rr.toFixed(2) : "—"}
                </td>
                <td className="py-2 text-muted">
                  {formatMinutes(trade.tradeDuration)}
                </td>
                <td className="py-2">{money.format(trade.totalInvestment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
