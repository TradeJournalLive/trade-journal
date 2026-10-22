import { getServerSupabase, hashWebhookSecret } from "./signalStore";

export type SignalExecution = { status: string; reason: string; source: "Recorded" | "Rule check" | "Not recorded" | "Unavailable"; at?: string };
type Event = { receivedAt: string; signal: { id: string; symbol: string; metadata?: Record<string, unknown> } };
type Decision = { id: string; status: string; reason: string; decidedAt: string };
type Trade = { signalId?: string; id?: string; openedAt?: string; entry?: number; initialLots?: number; lots?: number; contract?: { id?: string }; entryQuantityBtc?: number; quantityBtc?: number };

export async function addSignalExecutions<T extends Event>(secret: string, events: T[]): Promise<(T & { execution: SignalExecution })[]> {
  if (!events.length) return [];
  const db = getServerSupabase(); if (!db) throw Error("Execution history unavailable.");
  const owner = hashWebhookSecret(secret);
  const decisions = new Map<string, Decision>(), entries = new Map<string, string>();
  const key = (market: string, id: string) => `${market}:${id}`;
  function readDecision(market: string, d: Decision) {
    if (!d?.id || !d.status || !d.reason) return;
    const k = key(market, d.id), old = decisions.get(k);
    if (!old || Date.parse(d.decidedAt) >= Date.parse(old.decidedAt)) decisions.set(k, d);
  }
  function readTrade(market: string, t: Trade) {
    if (market === "GOLD") return;
    const id = market === "NIFTY" ? t?.signalId : t?.id;
    if (!id || !t.openedAt || typeof t.entry !== "number" || !Number.isFinite(t.entry)) return;
    entries.set(key(market, id), market === "NIFTY" ? `Entered ${t.initialLots ?? t.lots} lot(s) of ${t.contract?.id ?? "NIFTY options"} at average premium ${t.entry.toFixed(2)}.` : `Entered ${t.entryQuantityBtc ?? t.quantityBtc} BTC at average price ${t.entry.toFixed(2)}.`);
  }
  const workers = await db.from("tradingview_signal_events").select("strategy_id,raw_payload").eq("secret_hash", owner).eq("signal_id", "state").in("strategy_id", ["__nifty_paper_worker__", "__btc_delta_worker__", "__gold_mt5_worker__"]);
  if (workers.error) throw Error("Execution history unavailable.");
  for (const row of workers.data || []) {
    const market = row.strategy_id === "__nifty_paper_worker__" ? "NIFTY" : row.strategy_id === "__gold_mt5_worker__" ? "GOLD" : "BTC";
    const state = market === "NIFTY" ? row.raw_payload?.state?.checkpoint : market === "GOLD" ? row.raw_payload?.state : row.raw_payload?.saved?.state;
    for (const d of state?.decisions || []) readDecision(market, d);
    if (state?.position) readTrade(market, state.position);
    for (const t of state?.trades || []) readTrade(market, t);
  }
  for (let offset = 0; ; offset += 1000) {
    const page = await db.from("tradingview_signal_events").select("strategy_id,raw_payload").eq("secret_hash", owner)
      .in("strategy_id", ["__nifty_paper_decision__", "__btc_delta_decision__", "__nifty_paper_trade__", "__btc_delta_trade__", "__gold_mt5_decision__"])
      .order("received_at").order("signal_id").range(offset, offset + 999);
    if (page.error) throw Error("Execution history unavailable.");
    for (const row of page.data || []) {
      const market = row.strategy_id.startsWith("__nifty") ? "NIFTY" : row.strategy_id.startsWith("__gold") ? "GOLD" : "BTC";
      if (row.raw_payload?.decision) readDecision(market, row.raw_payload.decision);
      if (row.raw_payload?.trade) readTrade(market, row.raw_payload.trade);
    }
    if (!page.data || page.data.length < 1000) break;
  }
  return events.map(event => {
    if (event.signal.metadata?.trackingOnly === true && event.signal.symbol !== "VANTAGE:XAUUSD") return { ...event, execution: { status: "TRACKING_ONLY", reason: "Saved for separate signal tracking. Paper and live execution are disabled.", source: "Recorded" as const } };
    const market = event.signal.symbol === "NSE:NIFTY" ? "NIFTY" : event.signal.symbol === "DELTAIN:BTCUSD.P" ? "BTC" : event.signal.symbol === "VANTAGE:XAUUSD" ? "GOLD" : "OTHER";
    const k = key(market, event.signal.id), d = decisions.get(k), entry = entries.get(k);
    let execution: SignalExecution;
    if (entry && (!d || !["ENTERED", "PARTIALLY_FILLED"].includes(d.status))) execution = { status: "ENTERED", reason: entry, source: "Recorded" };
    else if (d) execution = { status: d.status, reason: d.reason, source: "Recorded", at: d.decidedAt };
    else if (market === "GOLD" && event.signal.metadata?.trackingOnly === true) execution = { status: "TRACKING_ONLY", reason: "Gold signal saved. No MT5 paper execution decision has been recorded.", source: "Recorded" };
    else {
      const candle = event.signal.metadata?.niftyPaper as { high?: number; low?: number } | undefined;
      const range = Number(candle?.high) - Number(candle?.low);
      execution = market === "NIFTY" && Number.isFinite(range) && range > 35
        ? { status: "CANDLE_RANGE_EXCEEDED", reason: `Rule check: signal candle range ${range.toFixed(2)} points exceeds the configured 35-point maximum. No recorded execution decision is available.`, source: "Rule check" }
        : { status: "NOT_RECORDED", reason: "No execution decision recorded yet, or this signal predates execution logging. Webhook receipt alone does not confirm a trade.", source: "Not recorded" };
    }
    return { ...event, execution };
  });
}
