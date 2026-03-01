type SharePayload = {
  currency: "INR" | "USD";
  totalPl: number;
  generatedAt: string;
  months: Array<{ label: string; value: number }>;
};

function decodePayload(input: string): SharePayload | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as SharePayload;
    if (!parsed || !Array.isArray(parsed.months)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function MonthlySharePage({
  searchParams
}: {
  searchParams?: { data?: string };
}) {
  const raw = searchParams?.data ?? "";
  const payload = raw ? decodePayload(raw) : null;

  if (!payload) {
    return (
      <main className="min-h-screen bg-ink px-4 py-12 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">Shared report unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            This monthly P&amp;L link is invalid or expired.
          </p>
        </div>
      </main>
    );
  }

  const money = new Intl.NumberFormat(payload.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: payload.currency,
    maximumFractionDigits: 0
  });

  return (
    <main className="min-h-screen bg-ink px-4 py-12 text-white">
      <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-panel/60 p-6">
        <h1 className="text-xl font-semibold">Monthly P&amp;L Report</h1>
        <p className="mt-1 text-xs text-muted">
          Generated: {new Date(payload.generatedAt).toLocaleString()}
        </p>
        <div className="mt-4 space-y-2">
          {payload.months.map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm">
              <span>{row.label}</span>
              <span className={row.value >= 0 ? "text-positive font-semibold" : "text-negative font-semibold"}>
                {money.format(row.value)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm">
          <span className="font-semibold">Total</span>
          <span className={payload.totalPl >= 0 ? "text-positive font-semibold" : "text-negative font-semibold"}>
            {money.format(payload.totalPl)}
          </span>
        </div>
      </div>
    </main>
  );
}

