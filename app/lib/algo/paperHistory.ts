import { getServerSupabase, hashWebhookSecret } from "./signalStore";
import { buildPaperBooks, paperValuation, activeMarkets, type PaperEvent } from "./paperEngine";
import { buildNiftyOptionsPaper } from "./niftyPaperEngine";
import { btcView, type BtcTrade } from "./btcPaperEngine";
import { tradeSignalTimes } from "./reportDates";
import { paperCapital } from "./paperCapital";
import { readHistory } from "./historyReads";

async function ledger(secret: string, strategy: string) {
  const db = getServerSupabase(); if (!db) throw new Error("Saved paper trading is unavailable.");
  try{return await readHistory(db,hashWebhookSecret(secret),strategy,q=>q.eq("strategy_id",strategy),strategy.endsWith("decision__")?"raw_payload->decision->>decidedAt":undefined);}
  catch{throw Error("Unable to load the complete paper trade ledger.");}
}
export async function loadPaperBooks(secret: string) {
  const db = getServerSupabase();
  if (!db) throw new Error("Saved paper trading is unavailable.");
  const events: PaperEvent[] = [];
  const { data: summaryRow, error: workerError } = await db.from("tradingview_signal_events").select("received_at,public_book:raw_payload->book,balance:raw_payload->state->checkpoint->rulesV2->balance").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__nifty_paper_worker__").eq("signal_id", "state").maybeSingle();
  if (workerError) throw new Error("Unable to verify options worker status.");
  type Summary=Omit<ReturnType<typeof buildNiftyOptionsPaper>,"checkpoint"> & {balance?:number;initialCapital?:number};
  const summary=summaryRow as any;
  const publicBook=summary?.public_book&&typeof summary.public_book.enabled==="boolean"&&Array.isArray(summary.public_book.trades)?{...summary.public_book,balance:summary.balance} as Summary:null;
  let worker:any=summaryRow;
  if(summaryRow&&!publicBook){const fallback=await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash",hashWebhookSecret(secret)).eq("strategy_id","__nifty_paper_worker__").eq("signal_id","state").maybeSingle();if(fallback.error)throw Error("Unable to load legacy options snapshot.");worker=fallback.data;}
  const niftyLedger = await ledger(secret, "__nifty_paper_trade__");
  const { data: btcSummary, error: btcError } = await db.from("tradingview_signal_events").select("received_at,book:raw_payload->book,pending_trades:raw_payload->saved->state->trades,pending_decisions:raw_payload->saved->state->decisions,worker_status:raw_payload->workerStatus,health:raw_payload->health,trial_started:raw_payload->saved->startedAt,trial_ends:raw_payload->saved->endsAt").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__btc_delta_worker__").eq("signal_id", "state").maybeSingle();
  if (btcError) throw new Error("Unable to load Delta BTC paper state.");
  const btcProjection=btcSummary as any;
  const compactBtc=btcProjection?.book&&typeof btcProjection.book.enabled==="boolean"&&typeof btcProjection.book.realized==="number"?btcProjection:null;
  let btcWorker:any=btcSummary;
  if(btcSummary&&!compactBtc){const fallback=await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash",hashWebhookSecret(secret)).eq("strategy_id","__btc_delta_worker__").eq("signal_id","state").maybeSingle();if(fallback.error)throw Error("Unable to load legacy Delta state.");btcWorker=fallback.data;}
  const btcLedger = await ledger(secret, "__btc_delta_trade__");
  const btcDecisionLedger = await ledger(secret, "__btc_delta_decision__");
  const data=await readHistory(db,hashWebhookSecret(secret),"paper-events",q=>q
      .neq("strategy_id", "__hams_final_worker__").neq("strategy_id", "__hams_final_control__").neq("strategy_id", "nifty_hams_final_3m_v1")
      .neq("strategy_id", "__nifty_ribbon_worker__").neq("strategy_id", "__nifty_ribbon_control__").neq("strategy_id", "nifty_ribbon_test_3m_v1")
      .neq("strategy_id", "__nifty_emergency_security__")
      .neq("strategy_id", "__nifty_paper_worker__").neq("strategy_id", "__nifty_paper_trade__").neq("strategy_id", "__btc_delta_worker__").neq("strategy_id", "__btc_delta_trade__").neq("strategy_id", "__btc_delta_decision__").neq("strategy_id", "__nifty_paper_decision__").neq("strategy_id", "__gold_mt5_worker__").neq("strategy_id", "__gold_mt5_trade__").neq("strategy_id", "__gold_mt5_decision__"),"received_at");
    events.push(...(data ?? []).map(row => ({ receivedAt: row.received_at, signal: row.signal, raw: row.raw_payload || {} })));
    {
      const now = new Date().toISOString();
      const books = buildPaperBooks(events, now);
      const options=publicBook?{...publicBook,stale:!publicBook.lastTickAt||Date.parse(now)<Date.parse(publicBook.lastTickAt)||Date.parse(now)-Date.parse(publicBook.lastTickAt)>15000,checkpoint:null}:worker?.raw_payload?.state?.checkpoint ? buildNiftyOptionsPaper([], now, worker.raw_payload.state.checkpoint) : buildNiftyOptionsPaper(events, now);
      const { checkpoint: _checkpoint, ...optionView } = options;
      const capitalState=_checkpoint&&"rulesV2" in _checkpoint?_checkpoint.rulesV2:undefined;
      const capital=paperCapital(publicBook&&typeof publicBook.balance==="number"?{initial:publicBook.initialCapital??1000000,balance:publicBook.balance,position:options.position,mark:options.mark,fresh:!options.stale}:capitalState?{initial:1000000,balance:capitalState.balance,position:capitalState.position,mark:options.mark,fresh:!options.stale}:null);
      const publicOptions={...optionView,capital};
      const trial=(publicBook?(publicBook as Summary&{trial?:unknown}).trial:worker?.raw_payload?.book?.trial??null) as {startedAt:string;endsAt:string;workerStatus?:string}|null;
      const workerAge=Date.parse(now)-Date.parse(worker?.received_at??"");
      const workerOnline = Boolean(worker && workerAge>=0&&workerAge < 15000 && !String((trial as {workerStatus?:string}|null)?.workerStatus || "").startsWith("STOPPED_"));
      const ledgerTrades = niftyLedger.map(row => row.raw_payload?.trade).filter(Boolean) as typeof options.trades;
      const optionTrades = (ledgerTrades.length ? ledgerTrades : options.trades).map(trade => ({ ...trade, ...tradeSignalTimes(events, trade.signalId, trade.indexSymbol, trade.openedAt) }));
      const optionPosition = options.position ? { ...options.position, ...tradeSignalTimes(events, options.position.signalId, options.position.indexSymbol, options.position.openedAt) } : null;
      const deleted = new Set(events.map(event => (event.raw.paperControl as { deleteTrade?: string } | undefined)?.deleteTrade).filter(Boolean));
      const recordedBtcTrades = [...(compactBtc?.pending_trades??btcWorker?.raw_payload?.saved?.state?.trades??[]), ...btcLedger.map(row => row.raw_payload?.trade).filter(Boolean)] as BtcTrade[];
      const btcTrades = [...new Map(recordedBtcTrades.map(trade => [`${trade.id}:${trade.openedAt}`, trade])).values()];
      const removed = btcTrades.filter(trade => deleted.has(`${trade.id}:${trade.openedAt}`) && !trade.monitoringGap);
      const compactView=compactBtc?.book as ReturnType<typeof btcView>|undefined;
      const view = compactView?{...compactView,decisions:compactBtc!.pending_decisions??[],stale:!compactView.lastTickAt||Date.parse(now)<Date.parse(compactView.lastTickAt)||Date.parse(now)-Date.parse(compactView.lastTickAt)>15000}:btcWorker?.raw_payload?.saved?.state ? btcView(btcWorker.raw_payload.saved.state, now) : null;
      const decisions = new Map<string, NonNullable<ReturnType<typeof btcView>["decisions"]>[number]>();
      for (const value of [...btcDecisionLedger.map(row => row.raw_payload?.decision), ...(view?.decisions || [])]) {
        const d = value as NonNullable<ReturnType<typeof btcView>["decisions"]>[number];
        if (d?.id && (!decisions.has(d.id) || Date.parse(d.decidedAt) >= Date.parse(decisions.get(d.id)!.decidedAt))) decisions.set(d.id, d);
      }
      const btcStatus=compactBtc?.worker_status??btcWorker?.raw_payload?.workerStatus;
      const btcAge=Date.parse(now)-Date.parse(btcWorker?.received_at??"");
      const delta = view ? { ...view, decisions: [...decisions.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)), realized: view.realized - removed.reduce((sum, trade) => sum + trade.pnl, 0), tradeCount: view.tradeCount - removed.length, trades: btcTrades.filter(trade => !deleted.has(`${trade.id}:${trade.openedAt}`)), workerOnline: btcAge>=0&&btcAge < 15000 && !String(btcStatus).startsWith("STOPPED_"), workerStatus: btcStatus, health: (compactBtc?.health??btcWorker?.raw_payload?.health) as { databaseStatus: string; snapshotAt: string; lastSignalPollAt: string | null; lastLedgerSyncAt: string | null; reconnects: number } | undefined, trial: { startedAt: compactBtc?.trial_started??btcWorker?.raw_payload?.saved?.startedAt, endsAt: compactBtc?.trial_ends??btcWorker?.raw_payload?.saved?.endsAt } } : null;
      return Object.fromEntries(activeMarkets.map(market => [market, { ...books[market], trades: books[market].trades.map(trade => ({ ...trade, ...tradeSignalTimes(events, trade.signalId, trade.symbol, trade.openedAt) })), valuation: paperValuation(books[market], events, now), ...(market === "BTC" ? { delta } : {}), ...(market === "NIFTY" ? { options: { ...publicOptions, trades: optionTrades, position: optionPosition, workerOnline, trial } } : {}) }]));
    }
}
