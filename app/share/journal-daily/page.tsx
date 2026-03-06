type SharedTrade = {
  tradeId: string;
  instrument: string;
  strategy: string;
  direction: "Long" | "Short";
  entryPrice: number;
  exitPrice: number;
  pl: number;
  exitReason: string;
  chartUrl: string;
  remarks: string;
};

type SharedJournalPayload = {
  date: string;
  quote: string;
  generatedAt: string;
  trades: SharedTrade[];
};

function decodePayload(input: string): SharedJournalPayload | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as SharedJournalPayload;
    if (!parsed || !Array.isArray(parsed.trades)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function JournalDailySharePage({
  searchParams
}: {
  searchParams?: { data?: string };
}) {
  const payload = searchParams?.data ? decodePayload(searchParams.data) : null;

  if (!payload) {
    return (
      <main className="min-h-screen bg-ink px-4 py-12 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">Shared journal unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            This journal summary link is invalid or expired.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink px-4 py-10 text-white">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-2xl border border-amber-300/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(59,130,246,0.1))] p-5">
          <div className="text-xs text-amber-200">Daily Motivation</div>
          <div className="mt-1 text-lg font-semibold text-white">“{payload.quote}”</div>
          <div className="mt-2 text-[11px] text-muted">
            Journal date: {payload.date} · Generated:{" "}
            {new Date(payload.generatedAt).toLocaleString()}
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-panel/60 p-4">
          <table className="min-w-full text-xs">
            <thead className="bg-white/5 text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Trade ID</th>
                <th className="px-3 py-2 text-left font-semibold">Instrument</th>
                <th className="px-3 py-2 text-left font-semibold">Direction</th>
                <th className="px-3 py-2 text-right font-semibold">Entry</th>
                <th className="px-3 py-2 text-right font-semibold">Exit</th>
                <th className="px-3 py-2 text-right font-semibold">P/L</th>
                <th className="px-3 py-2 text-left font-semibold">Exit Reason</th>
                <th className="px-3 py-2 text-left font-semibold">Trade Notes</th>
                <th className="px-3 py-2 text-left font-semibold">Chart Link</th>
              </tr>
            </thead>
            <tbody>
              {payload.trades.map((trade) => (
                <tr key={trade.tradeId} className="border-t border-white/10">
                  <td className="px-3 py-2 font-semibold">{trade.tradeId}</td>
                  <td className="px-3 py-2">{trade.instrument}</td>
                  <td className="px-3 py-2">{trade.direction}</td>
                  <td className="px-3 py-2 text-right">{trade.entryPrice}</td>
                  <td className="px-3 py-2 text-right">{trade.exitPrice}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${trade.pl >= 0 ? "text-positive" : "text-negative"}`}>
                    {trade.pl.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{trade.exitReason}</td>
                  <td className="px-3 py-2">{trade.remarks || "—"}</td>
                  <td className="px-3 py-2">
                    {trade.chartUrl ? (
                      <a href={trade.chartUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                        Open
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
    </main>
  );
}
