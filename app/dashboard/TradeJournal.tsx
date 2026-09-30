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

function getAlignmentLabel(trade: Trade) {
  const emotion = trade.emotionTag?.trim().toLowerCase() ?? "";
  const state = trade.emotionalState?.trim().toLowerCase() ?? "";
  if (!emotion || !state) return "Unspecified";

  const negative = ["fomo", "fear", "fearful", "anxious", "frustrated", "hesitant"];
  const positive = ["calm", "focused", "confident"];
  const disciplined = ["disciplined", "patient", "neutral"];
  const impulsive = ["impulsive", "distracted", "fatigued"];

  const isNegative = negative.includes(emotion);
  const isPositive = positive.includes(emotion);
  const isDisciplined = disciplined.includes(state);
  const isImpulsive = impulsive.includes(state);

  if (isNegative && isDisciplined) return "Process-driven";
  if (isNegative && isImpulsive) return "Emotion-driven";
  if (isPositive && isDisciplined) return "Aligned";
  if (isPositive && isImpulsive) return "Emotion-driven";
  if (isDisciplined) return "Aligned";
  if (isImpulsive) return "Emotion-driven";
  return "Unspecified";
}

export default function TradeJournal({
  trades,
  currency,
  onEdit,
  onDelete,
  onReview
}: {
  trades: Trade[];
  currency: "INR" | "USD";
  onEdit?: (trade: Trade) => void;
  onDelete?: (tradeIds: string[]) => void;
  onReview?: (trade: Trade) => void;
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

  const [search, setSearch] = useState("");
  const [instrument, setInstrument] = useState("all");
  const [strategy, setStrategy] = useState("all");
  const [market, setMarket] = useState("all");
  const [direction, setDirection] = useState("all");
  const [result, setResult] = useState("all");
  const [tradeType, setTradeType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
    const query = search.trim().toLowerCase();
    if (query) {
      const haystack = `${trade.instrument} ${trade.strategy} ${trade.market} ${trade.tradeId}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (instrument !== "all" && trade.instrument !== instrument) return false;
    if (strategy !== "all" && trade.strategy !== strategy) return false;
    if (market !== "all" && trade.market !== market) return false;
    if (direction !== "all" && trade.direction !== direction) return false;
    if (result !== "all" && trade.winLoss !== result) return false;
    if (tradeType !== "all" && (trade.tradeType ?? "Unspecified") !== tradeType)
      return false;
    if (startDate && trade.date < startDate) return false;
    if (endDate && trade.date > endDate) return false;
    return true;
  });

  const selectedCount = selectedIds.size;
  const allSelected =
    filtered.length > 0 && selectedIds.size === filtered.length;

  function toggleSelect(tradeId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tradeId)) {
        next.delete(tradeId);
      } else {
        next.add(tradeId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(() => {
      if (allSelected) return new Set();
      return new Set(filtered.map((trade) => trade.tradeId));
    });
  }

  function handleDeleteSelected() {
    if (!onDelete || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    onDelete(ids);
    setSelectedIds(new Set());
    setSelectMode(false);
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <input
          placeholder="Search instrument or setup..."
          value={search}
          className="h-9 min-w-[220px] rounded-lg border border-[#e1e7f0] bg-white px-3 text-[#40516e]"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={instrument} onChange={(event) => setInstrument(event.target.value)} className="h-9 rounded-lg border border-[#e1e7f0] bg-white px-3 text-[#40516e]">
          <option value="all">All instruments</option>
          {instruments.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={strategy} onChange={(event) => setStrategy(event.target.value)} className="h-9 rounded-lg border border-[#e1e7f0] bg-white px-3 text-[#40516e]">
          <option value="all">All strategies</option>
          {strategies.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={result} onChange={(event) => setResult(event.target.value)} className="h-9 rounded-lg border border-[#e1e7f0] bg-white px-3 text-[#40516e]">
          <option value="all">All outcomes</option>
          <option value="Win">Win</option>
          <option value="Loss">Loss</option>
          <option value="BE">Breakeven</option>
        </select>
        <button
          className="h-9 rounded-lg border border-[#e1e7f0] bg-white px-3 text-xs font-bold text-[#425370]"
          onClick={() => {
            setSearch("");
            setInstrument("all");
            setStrategy("all");
            setMarket("all");
            setDirection("all");
            setResult("all");
            setTradeType("all");
            setStartDate("");
            setEndDate("");
          }}
        >
          Reset
        </button>
        <span className="rounded-lg bg-[#f1f5fb] px-3 py-2 text-[11px] font-bold text-muted">{filtered.length} trades</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 text-[11px] font-bold text-[#425370]"
            onClick={() => {
              setSelectMode((prev) => !prev);
              setSelectedIds(new Set());
            }}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          {selectMode && (
            <button
              type="button"
              className="rounded-lg bg-[#df4747] px-3 py-2 text-[11px] font-bold text-white"
              onClick={handleDeleteSelected}
              disabled={selectedCount === 0}
            >
              Delete selected
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto">
        <table>
          <thead>
            <tr>
              {selectMode ? <th>Select</th> : null}
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((trade) => (
              <tr key={trade.tradeId}>
                {selectMode ? (
                  <td><input type="checkbox" checked={selectedIds.has(trade.tradeId)} onChange={() => toggleSelect(trade.tradeId)} /></td>
                ) : null}
                <td>{trade.date}</td>
                <td className="font-bold text-[#132342]">{trade.instrument}</td>
                <td>{trade.strategy}</td>
                <td><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trade.direction === "Long" ? "bg-[#e5f7f0] text-[#07966c]" : "bg-[#fff0ef] text-[#df4747]"}`}>{trade.direction}</span></td>
                <td>{trade.entryPrice}</td>
                <td>{trade.exitPrice}</td>
                <td>{trade.sizeQty}</td>
                <td className={trade.pl >= 0 ? "text-positive" : "text-negative"}>{signedMoney.format(trade.pl)}</td>
                <td>{trade.rMultiple === null ? "—" : `${Math.abs(trade.rMultiple).toFixed(1)}R`}</td>
                <td><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trade.winLoss === "Win" ? "bg-[#e5f7f0] text-[#07966c]" : trade.winLoss === "Loss" ? "bg-[#fff0ef] text-[#df4747]" : "bg-[#e9f2ff] text-[#1767e8]"}`}>{trade.winLoss}</span></td>
                <td>
                  <div className="flex items-center gap-2">
                    <button type="button" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 text-[11px] font-bold text-[#425370]" onClick={() => onReview?.(trade)}>Review</button>
                    {onEdit ? <button type="button" className="rounded-lg border border-[#e1e7f0] bg-white px-3 py-2 text-[11px] font-bold text-[#425370]" onClick={() => onEdit(trade)}>Edit</button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr><td colSpan={selectMode ? 12 : 11} className="text-center text-muted">No trades match the selected filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[11px] text-muted">Select a row to open the full trade review, chart and notes.</p>
    </div>
  );
}
