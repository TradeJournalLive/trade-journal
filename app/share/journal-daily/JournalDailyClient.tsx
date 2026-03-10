"use client";

import { useEffect, useMemo, useState } from "react";
import type { SharedPayload } from "./types";

export default function JournalDailyClient({ payload }: { payload: SharedPayload }) {
  const [activeDate, setActiveDate] = useState(payload.days[0]?.date ?? "");
  const [topQuote, setTopQuote] = useState(
    "Protect capital first. Big days come from consistency."
  );

  const activeDay = useMemo(
    () => payload.days.find((day) => day.date === activeDate) ?? payload.days[0],
    [activeDate, payload.days]
  );

  const money = new Intl.NumberFormat(payload.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 2
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/motivation-quote", { cache: "no-store" });
        const data = (await response.json()) as { quote?: string };
        if (!cancelled && data.quote) {
          setTopQuote(data.quote);
        }
      } catch {
        // Keep local fallback.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-ink px-3 py-6 text-white sm:px-4 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/40 bg-primary/20 text-sm font-semibold">
            TJ
          </div>
          <div className="text-lg font-semibold tracking-tight">Trade Journal</div>
        </div>

        <div className="rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-black">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/70">
            Motivation
          </div>
          <div className="mt-1 text-base font-bold">{topQuote}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <h1 className="text-lg font-semibold sm:text-xl">
            Journal Summary - {payload.month}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Generated: {new Date(payload.generatedAt).toLocaleString()}
          </p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Trades: <span className="font-semibold">{payload.monthlySummary.totalTrades}</span>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Win Rate:{" "}
              <span className="font-semibold">{payload.monthlySummary.winRate.toFixed(1)}%</span>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Net P/L:{" "}
              <span className={payload.monthlySummary.totalPl >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>
                {money.format(payload.monthlySummary.totalPl)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Date Tabs
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {payload.days.map((day) => {
              const active = day.date === activeDay?.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setActiveDate(day.date)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-sky-500 text-white"
                      : "border border-white/15 bg-white/5 text-muted hover:bg-white/10"
                  }`}
                >
                  {day.date}
                </button>
              );
            })}
          </div>
        </div>

        {activeDay ? (
          <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold text-slate-100">Trades for {activeDay.date}</div>
              <div className="text-muted">
                {activeDay.summary.totalTrades} trades • Win rate {activeDay.summary.winRate.toFixed(1)}% •{" "}
                <span className={activeDay.summary.totalPl >= 0 ? "text-positive" : "text-negative"}>
                  {money.format(activeDay.summary.totalPl)}
                </span>
              </div>
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Pre-Market Checklist
                </div>
                <div className="grid gap-2 text-xs">
                  <div className="rounded-lg border border-white/10 px-3 py-2">
                    <span className="text-muted">Sentiment Today:</span>{" "}
                    <span className="font-semibold">
                      {activeDay.checklist.sentimentToday || "—"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-white/10 px-3 py-2">
                    <span className="text-muted">View Right/Wrong:</span>{" "}
                    <span className="font-semibold">
                      {activeDay.checklist.viewOutcome || "—"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-white/10 px-3 py-2">
                    <span className="text-muted">Previous Day Market:</span>{" "}
                    <span className="font-semibold">
                      {activeDay.checklist.previousDayMarket || "—"}
                    </span>
                  </div>
                  {activeDay.checklist.observations ? (
                    <div className="rounded-lg border border-white/10 px-3 py-2 text-muted">
                      <span className="font-semibold text-slate-100">Today's Observations:</span>{" "}
                      {activeDay.checklist.observations}
                    </div>
                  ) : null}
                  {activeDay.checklist.notes ? (
                    <div className="rounded-lg border border-white/10 px-3 py-2 text-muted">
                      {activeDay.checklist.notes}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  Market Snapshot
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold">Index</th>
                        <th className="px-2 py-1 text-right font-semibold">Yesterday</th>
                        <th className="px-2 py-1 text-right font-semibold">Today</th>
                        <th className="px-2 py-1 text-right font-semibold">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDay.marketSnapshot.map((row) => (
                        <tr key={row.label} className="border-t border-white/10">
                          <td className="px-2 py-1">{row.label}</td>
                          <td className="px-2 py-1 text-right">
                            {row.previous === null ? "—" : row.previous.toFixed(3)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {row.current === null ? "—" : row.current.toFixed(3)}
                          </td>
                          <td
                            className={`px-2 py-1 text-right font-semibold ${
                              (row.diffPct ?? 0) >= 0 ? "text-positive" : "text-negative"
                            }`}
                          >
                            {row.diffPct === null ? "—" : `${row.diffPct.toFixed(2)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1180px] text-xs">
                <thead className="bg-white/5 text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Trade ID</th>
                    <th className="px-3 py-2 text-left font-semibold">Instrument</th>
                    <th className="px-3 py-2 text-left font-semibold">Direction</th>
                    <th className="px-3 py-2 text-left font-semibold">Entry Time</th>
                    <th className="px-3 py-2 text-left font-semibold">Exit Time</th>
                    <th className="px-3 py-2 text-left font-semibold">Duration</th>
                    <th className="px-3 py-2 text-right font-semibold">Entry</th>
                    <th className="px-3 py-2 text-right font-semibold">Exit</th>
                    <th className="px-3 py-2 text-right font-semibold">P/L</th>
                    <th className="px-3 py-2 text-left font-semibold">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold">Chart</th>
                    <th className="px-3 py-2 text-left font-semibold">PnL SS</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDay.trades.map((trade) => (
                    <tr key={trade.tradeId} className="border-t border-white/10">
                      <td className="px-3 py-2 font-semibold">{trade.tradeId}</td>
                      <td className="px-3 py-2">{trade.instrument}</td>
                      <td className="px-3 py-2">{trade.direction}</td>
                      <td className="px-3 py-2">{trade.entryTime || "—"}</td>
                      <td className="px-3 py-2">{trade.exitTime || "—"}</td>
                      <td className="px-3 py-2">{trade.tradeDuration || "—"}</td>
                      <td className="px-3 py-2 text-right">{trade.entryPrice}</td>
                      <td className="px-3 py-2 text-right">{trade.exitPrice}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${trade.pl >= 0 ? "text-positive" : "text-negative"}`}>
                        {money.format(trade.pl)}
                      </td>
                      <td className="px-3 py-2">{trade.remarks || trade.exitReason || "—"}</td>
                      <td className="px-3 py-2">
                        {trade.chartUrl ? (
                          <a href={trade.chartUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                            Open
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {trade.pnlScreenshotUrl ? (
                          <a href={trade.pnlScreenshotUrl} target="_blank" rel="noreferrer" className="block w-fit">
                            <img
                              src={trade.pnlScreenshotUrl}
                              alt={`PnL ${trade.tradeId}`}
                              className="h-10 w-14 rounded border border-white/15 object-cover"
                            />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <div className="text-sm font-semibold">Final Monthly Summary</div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Wins: <span className="font-semibold text-positive">{payload.monthlySummary.wins}</span>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Losses: <span className="font-semibold text-negative">{payload.monthlySummary.losses}</span>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Best Day:{" "}
              <span className="font-semibold">
                {payload.monthlySummary.bestDay
                  ? `${payload.monthlySummary.bestDay.date} (${money.format(payload.monthlySummary.bestDay.totalPl)})`
                  : "—"}
              </span>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              Worst Day:{" "}
              <span className="font-semibold">
                {payload.monthlySummary.worstDay
                  ? `${payload.monthlySummary.worstDay.date} (${money.format(payload.monthlySummary.worstDay.totalPl)})`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
