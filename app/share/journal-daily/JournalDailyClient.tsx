"use client";

import { useEffect, useMemo, useState } from "react";
import type { SharedPayload } from "./types";

export default function JournalDailyClient({ payload }: { payload: SharedPayload }) {
  const [activeDate, setActiveDate] = useState(payload.days[0]?.date ?? "");
  const [activeMediaTrade, setActiveMediaTrade] =
    useState<SharedPayload["days"][number]["trades"][number] | null>(null);
  const [mediaZoom, setMediaZoom] = useState(1);

  const activeDay = useMemo(
    () => payload.days.find((day) => day.date === activeDate) ?? payload.days[0],
    [activeDate, payload.days]
  );

  useEffect(() => {
    setMediaZoom(1);
  }, [activeMediaTrade?.tradeId]);

  const money = new Intl.NumberFormat(payload.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 2
  });

  const normalizeMediaUrl = (value?: string) => {
    const raw = (value ?? "").trim();
    if (!raw) return "";
    if (raw.startsWith("https://data:")) return raw.replace("https://", "");
    if (raw.startsWith("http://data:")) return raw.replace("http://", "");
    return raw;
  };

  const hasMedia = (trade: SharedPayload["days"][number]["trades"][number]) =>
    Boolean(normalizeMediaUrl(trade.chartUrl) || normalizeMediaUrl(trade.pnlScreenshotUrl));

  const linkifyText = (value: string) => {
    const source = value || "";
    const regex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const parts = source.split(regex);
    return parts.map((part, index) => {
      if (/^(https?:\/\/|www\.)/i.test(part)) {
        const href = part.startsWith("http") ? part : `https://${part}`;
        return (
          <a
            key={`${part}-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline"
          >
            {part}
          </a>
        );
      }
      return <span key={`${part}-${index}`}>{part}</span>;
    });
  };

  return (
    <main className="min-h-screen bg-ink px-3 py-6 text-white sm:px-4 sm:py-10">
      <div className="mx-auto w-full max-w-[92rem] space-y-4">
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
          <div className="mt-1 text-base font-bold">{activeDay?.motivationQuote || "Protect capital first. Big days come from consistency."}</div>
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
                      {linkifyText(activeDay.checklist.observations)}
                    </div>
                  ) : null}
                  {activeDay.checklist.notes ? (
                    <div className="rounded-lg border border-white/10 px-3 py-2 text-muted">
                      {linkifyText(activeDay.checklist.notes)}
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

            <div className="hidden md:block">
              <table className="w-full table-fixed text-xs">
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
                    <th className="px-3 py-2 text-left font-semibold">Entry Reason</th>
                    <th className="px-3 py-2 text-left font-semibold">Exit Reason</th>
                    <th className="px-3 py-2 text-left font-semibold">Media</th>
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
                      <td className="px-3 py-2">{trade.remarks || "—"}</td>
                      <td className="px-3 py-2">{trade.exitReason || "—"}</td>
                      <td className="px-3 py-2">
                        {hasMedia(trade) ? (
                          <button
                            type="button"
                            onClick={() => setActiveMediaTrade(trade)}
                            className="rounded-full border border-cyan-300 bg-cyan-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 hover:bg-cyan-200 dark:border-cyan-300/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
                          >
                            Open
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {activeDay.trades.map((trade) => (
                <div key={trade.tradeId} className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">{trade.tradeId}</div>
                    <div className={trade.pl >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>
                      {money.format(trade.pl)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-muted">
                    <div>Instrument: <span className="text-white">{trade.instrument}</span></div>
                    <div>Direction: <span className="text-white">{trade.direction}</span></div>
                    <div>Entry: <span className="text-white">{trade.entryPrice}</span></div>
                    <div>Exit: <span className="text-white">{trade.exitPrice}</span></div>
                    <div>Entry Time: <span className="text-white">{trade.entryTime || "—"}</span></div>
                    <div>Exit Time: <span className="text-white">{trade.exitTime || "—"}</span></div>
                    <div>Duration: <span className="text-white">{trade.tradeDuration || "—"}</span></div>
                    <div>Exit Reason: <span className="text-white">{trade.exitReason || "—"}</span></div>
                  </div>
                  <div className="mt-2 text-muted">
                    Entry Reason: <span className="text-white">{trade.remarks || "—"}</span>
                  </div>
                  {hasMedia(trade) ? (
                    <button
                      type="button"
                      onClick={() => setActiveMediaTrade(trade)}
                      className="mt-3 rounded-full border border-cyan-300 bg-cyan-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-800 hover:bg-cyan-200 dark:border-cyan-300/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
                    >
                      Open Media
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeMediaTrade ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
            <div className="w-full max-w-3xl rounded-2xl border border-white/15 bg-[#0b1220] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">
                  Trade Media · {activeMediaTrade.tradeId}
                </div>
                <button
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/20 dark:bg-white/10 dark:text-white"
                  onClick={() => setActiveMediaTrade(null)}
                >
                  Close
                </button>
              </div>
              <div className="space-y-4">
                {!normalizeMediaUrl(activeMediaTrade.chartUrl) &&
                !normalizeMediaUrl(activeMediaTrade.pnlScreenshotUrl) ? (
                  <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    No media found in this shared record. Generate a new share link after saving screenshot.
                  </div>
                ) : null}
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Chart</div>
                  {normalizeMediaUrl(activeMediaTrade.chartUrl) ? (
                    <a
                      href={normalizeMediaUrl(activeMediaTrade.chartUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-cyan-300 underline"
                    >
                      Open Chart Link
                    </a>
                  ) : (
                    <div className="text-xs text-muted">No chart link</div>
                  )}
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">PnL Screenshot</div>
                    {normalizeMediaUrl(activeMediaTrade.pnlScreenshotUrl) ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setMediaZoom((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(2))))}
                          className="rounded border border-sky-700 bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700"
                        >
                          Zoom -
                        </button>
                        <button
                          type="button"
                          onClick={() => setMediaZoom(1)}
                          className="rounded border border-slate-500 bg-slate-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-700"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => setMediaZoom((prev) => Math.min(3, Number((prev + 0.1).toFixed(2))))}
                          className="rounded border border-sky-700 bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700"
                        >
                          Zoom +
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {normalizeMediaUrl(activeMediaTrade.pnlScreenshotUrl) ? (
                    <div className="max-h-[420px] overflow-auto rounded-lg border border-white/15">
                      <img
                        src={normalizeMediaUrl(activeMediaTrade.pnlScreenshotUrl)}
                        alt={`PnL ${activeMediaTrade.tradeId}`}
                        className="mx-auto w-full rounded-lg object-contain transition-transform duration-150"
                        style={{ transform: `scale(${mediaZoom})`, transformOrigin: "top center" }}
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-muted">No PnL screenshot</div>
                  )}
                </div>
              </div>
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
