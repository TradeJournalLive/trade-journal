import { getServerSupabase, hashWebhookSecret } from "./signalStore";
import { buildPaperBooks, paperValuation, markets, type PaperEvent } from "./paperEngine";
import { buildNiftyOptionsPaper } from "./niftyPaperEngine";
import { btcView, type BtcTrade } from "./btcPaperEngine";
import { tradeSignalTimes } from "./reportDates";

async function ledger(secret: string, strategy: string) {
  const db = getServerSupabase(); if (!db) throw new Error("Saved paper trading is unavailable.");
  const rows: { raw_payload: { trade?: unknown; decision?: unknown } }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db.from("tradingview_signal_events").select("raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", strategy).order("received_at", { ascending: false }).order("signal_id", { ascending: false }).range(offset, offset + 999);
    if (page.error) throw new Error("Unable to load the complete paper trade ledger.");
    rows.push(...(page.data || []));
    if (!page.data || page.data.length < 1000) return rows.reverse();
  }
}
export async function loadPaperBooks(secret: string) {
  const db = getServerSupabase();
  if (!db) throw new Error("Saved paper trading is unavailable.");
  const events: PaperEvent[] = [];
  const { data: worker, error: workerError } = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__nifty_paper_worker__").eq("signal_id", "state").maybeSingle();
  if (workerError) throw new Error("Unable to verify options worker status.");
  const niftyLedger = await ledger(secret, "__nifty_paper_trade__");
  const { data: btcWorker, error: btcError } = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__btc_delta_worker__").eq("signal_id", "state").maybeSingle();
  if (btcError) throw new Error("Unable to load Delta BTC paper state.");
  const btcLedger = await ledger(secret, "__btc_delta_trade__");
  const btcDecisionLedger = await ledger(secret, "__btc_delta_decision__");
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await db.from("tradingview_signal_events").select("received_at,signal,raw_payload,id")
      .eq("secret_hash", hashWebhookSecret(secret)).neq("strategy_id", "__nifty_paper_worker__").neq("strategy_id", "__nifty_paper_trade__").neq("strategy_id", "__btc_delta_worker__").neq("strategy_id", "__btc_delta_trade__").neq("strategy_id", "__btc_delta_decision__").order("received_at").order("id").range(offset, offset + 999);
    if (error) throw new Error("Unable to load the complete paper event history.");
    events.push(...(data ?? []).map(row => ({ receivedAt: row.received_at, signal: row.signal, raw: row.raw_payload || {} })));
    if (!data || data.length < 1000) {
      const now = new Date().toISOString();
      const books = buildPaperBooks(events, now);
      const options = worker?.raw_payload?.state?.checkpoint ? buildNiftyOptionsPaper([], now, worker.raw_payload.state.checkpoint) : buildNiftyOptionsPaper(events, now);
      const { checkpoint: _checkpoint, ...publicOptions } = options;
      const workerOnline = Boolean(worker && Date.parse(now) - Date.parse(worker.received_at) < 15000 && !String(worker.raw_payload?.book?.trial?.workerStatus || "").startsWith("STOPPED_"));
      const ledgerTrades = niftyLedger.map(row => row.raw_payload?.trade).filter(Boolean) as typeof options.trades;
      const optionTrades = (ledgerTrades.length ? ledgerTrades : options.trades).map(trade => ({ ...trade, ...tradeSignalTimes(events, trade.signalId, trade.indexSymbol, trade.openedAt) }));
      const optionPosition = options.position ? { ...options.position, ...tradeSignalTimes(events, options.position.signalId, options.position.indexSymbol, options.position.openedAt) } : null;
      const deleted = new Set(events.map(event => (event.raw.paperControl as { deleteTrade?: string } | undefined)?.deleteTrade).filter(Boolean));
      const btcTrades = btcLedger.map(row => row.raw_payload?.trade).filter(Boolean) as BtcTrade[];
      const removed = btcTrades.filter(trade => deleted.has(`${trade.id}:${trade.openedAt}`) && !trade.monitoringGap);
      const view = btcWorker?.raw_payload?.saved?.state ? btcView(btcWorker.raw_payload.saved.state, now) : null;
      const decisions = new Map<string, NonNullable<ReturnType<typeof btcView>["decisions"]>[number]>();
      for (const value of [...btcDecisionLedger.map(row => row.raw_payload?.decision), ...(view?.decisions || [])]) {
        const d = value as NonNullable<ReturnType<typeof btcView>["decisions"]>[number];
        if (d?.id && (!decisions.has(d.id) || Date.parse(d.decidedAt) >= Date.parse(decisions.get(d.id)!.decidedAt))) decisions.set(d.id, d);
      }
      const delta = view ? { ...view, decisions: [...decisions.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)), realized: view.realized - removed.reduce((sum, trade) => sum + trade.pnl, 0), tradeCount: view.tradeCount - removed.length, trades: btcTrades.filter(trade => !deleted.has(`${trade.id}:${trade.openedAt}`)), workerOnline: Date.parse(now) - Date.parse(btcWorker!.received_at) < 15000 && !String(btcWorker!.raw_payload.workerStatus).startsWith("STOPPED_"), workerStatus: btcWorker!.raw_payload.workerStatus, trial: { startedAt: btcWorker!.raw_payload.saved.startedAt, endsAt: btcWorker!.raw_payload.saved.endsAt } } : null;
      return Object.fromEntries(markets.map(market => [market, { ...books[market], trades: books[market].trades.map(trade => ({ ...trade, ...tradeSignalTimes(events, trade.signalId, trade.symbol, trade.openedAt) })), valuation: paperValuation(books[market], events, now), ...(market === "BTC" ? { delta } : {}), ...(market === "NIFTY" ? { options: { ...publicOptions, trades: optionTrades, position: optionPosition, workerOnline, trial: worker?.raw_payload?.book?.trial ?? null } } : {}) }]));
    }
  }
  throw new Error("History exceeds the paper engine limit; archive is required before continuing.");
}
