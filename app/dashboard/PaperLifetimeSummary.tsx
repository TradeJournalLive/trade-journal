export default function PaperLifetimeSummary({ realized, openPnl, closedTrades }: { realized: string; openPnl: string; closedTrades: number | undefined }) {
  return <div className="grid gap-4 border-y border-slate-200 py-4 sm:grid-cols-3">{[["Lifetime realized", realized], ["Open P&L", openPnl], ["Lifetime closed trades", closedTrades ?? "--"]].map(([label, value]) => <div key={label} className="space-y-2"><span className="block text-xs text-slate-500">{label}</span><strong className="block text-xl">{value}</strong></div>)}</div>;
}
