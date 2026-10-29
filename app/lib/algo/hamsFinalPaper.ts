// Independent paper-only reducer. No existing NIFTY state or broker-order path is used.
import type { LimitState } from "./niftyLimitPaper";
export const hamsFinalRules = Object.freeze({
  strategyId: "nifty_hams_final_3m_v1", namespace: "hamsFinalPaper",
  initialCapital: 500000, intervalMinutes: 3, stopBuffer: 5, targetR: 3,
  initialLots: 1, maxLots: 20, cutoffMinutesIST: 14 * 60 + 55,
});
type Side = "CE" | "PE";
export type HamsSignal = { strategyId: string; id: string; action: "BUY" | "SELL"; symbol: string; timeframe: string; closedAt: string; receivedAt: string };
export type HamsQuote = { id: string; expiry: string; strike: number; side: Side; lotSize: number; at: string; bid: number; ask: number; bidSize: number; askSize: number; asks?: { price: number; quantity: number }[]; bids?: { price: number; quantity: number }[]; depthAt?: string };
export type HamsCandle = { contractId: string; openedAt: string; closedAt: string; low: number };
export type HamsPosition = { contract: HamsQuote; signalId: string; signalClosedAt: string; receivedAt: string; openedAt: string; entry: number; stop: number; target: number; quantity: number; lots: number };
export type HamsTrade = HamsPosition & { ruleVersion?: number; grossPnl?:number; costs?:{total:number}; exit: number; closedAt: string; reason: string; pnl: number };
export type HamsState = { rulesV2?:LimitState; enabled: boolean; balance: number; nextLots: number; position: HamsPosition | null; trades: HamsTrade[]; seen: string[]; status: string; pendingExit: HamsTrade["reason"] | null; lastQuoteAt: string | null };
export function emptyHamsState(): HamsState {
  return { enabled: false, balance: hamsFinalRules.initialCapital, nextLots: 1, position: null, trades: [], seen: [], status: "DISABLED", pendingExit: null, lastQuoteAt: null };
}
const positive = (n: number) => Number.isFinite(n) && n > 0;
const ms = (s: string) => Date.parse(s);
function session(at: string) {
  const d = new Date(ms(at) + 330 * 60000);
  return { day: Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "", minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function fresh(at: string, now: string) { const age = ms(now) - ms(at); return Number.isFinite(age) && age >= 0 && age <= 5000; }
function quoteValid(q: HamsQuote, at: string) {
  return Boolean(q.id && /^\d{4}-\d{2}-\d{2}$/.test(q.expiry) && q.expiry >= session(at).day && positive(q.strike)
    && ["CE", "PE"].includes(q.side) && Number.isSafeInteger(q.lotSize) && q.lotSize > 0
    && positive(q.bid) && positive(q.ask) && q.ask >= q.bid && fresh(q.at, at)
    && Number.isSafeInteger(q.bidSize) && q.bidSize >= 0 && Number.isSafeInteger(q.askSize) && q.askSize >= 0);
}
function depthFill(q: HamsQuote, quantity: number, side: "ask" | "bid", at: string) {
  const levels = q.depthAt && fresh(q.depthAt, at) ? side === "ask" ? q.asks : q.bids : undefined;
  const ordered = levels?.length ? [...levels].sort((a, b) => side === "ask" ? a.price-b.price : b.price-a.price) : [{ price: q[side], quantity: side === "ask" ? q.askSize : q.bidSize }];
  if (ordered[0]?.price !== q[side] || new Set(ordered.map(l => l.price)).size !== ordered.length) return null;
  let remaining = quantity, cost = 0;
  for (const level of ordered) {
    if (!positive(level.price) || !Number.isSafeInteger(level.quantity) || level.quantity <= 0) return null;
    if (side === "ask" && level.price > q.ask + 4) break;
    const taken = Math.min(remaining, level.quantity); cost += taken * level.price; remaining -= taken;
    if (!remaining) return cost / quantity;
  }
  return null;
}
export function nextHamsLots(lots: number, reason: HamsTrade["reason"]) {
  if (!Number.isSafeInteger(lots) || lots < 1 || lots > 20) throw new Error("Invalid HAMS lot size");
  return reason === "SL" ? Math.min(20, lots * 2) : reason === "TARGET_3R" ? 1 : lots;
}
// Select the adjacent strictly in-the-money strike, even when spot is between strikes.
export function hamsContract(spot: number, side: Side, chain: HamsQuote[], at: string) {
  const valid = chain.filter(q => quoteValid(q, at));
  const expiry = chain.filter(q => /^\d{4}-\d{2}-\d{2}$/.test(q.expiry) && q.expiry >= session(at).day).map(q => q.expiry).sort()[0];
  const strikes = [...new Set(chain.filter(q => q.expiry === expiry && positive(q.strike)).map(q => q.strike))];
  const strike = side === "CE" ? Math.max(...strikes.filter(k => k < spot)) : Math.min(...strikes.filter(k => k > spot));
  return valid.find(q => q.expiry === expiry && q.side === side && q.strike === strike) ?? null;
}
export function setHamsEnabled(previous: HamsState, enabled: boolean): HamsState {
  if(previous.rulesV2){const copy=structuredClone(previous);copy.enabled=enabled;copy.rulesV2!.enabled=enabled;if(!enabled)copy.rulesV2!.setup=null;copy.status=copy.position?"OPEN":enabled?"WAITING_FOR_SIGNAL":"DISABLED";return copy;}
  return { ...structuredClone(previous), enabled, status: previous.position ? "OPEN" : enabled ? "WAITING_FOR_SIGNAL" : "DISABLED" };
}
export function enterHams(previous: HamsState, signal: HamsSignal, data: { at: string; spot: number; chain: HamsQuote[]; candle: HamsCandle | null }): HamsState {
  const state = structuredClone(previous);
  if (signal.strategyId !== hamsFinalRules.strategyId) return state;
  const key = `${signal.strategyId}:${signal.id}`;
  if (state.seen.includes(key)) return state;
  state.seen.push(key);
  if (signal.symbol !== "NSE:NIFTY" || signal.timeframe !== "3" || !["BUY", "SELL"].includes(signal.action)
    || !Number.isFinite(ms(signal.closedAt)) || !Number.isFinite(ms(signal.receivedAt)) || ms(signal.closedAt) > ms(signal.receivedAt)
    || !signal.id || !Number.isFinite(ms(data.at)) || ms(data.at) < ms(signal.receivedAt)
    || ms(signal.closedAt) % 180000 !== 0 || !positive(data.spot)) { state.status = "INVALID_SIGNAL"; return state; }
  if (state.position) {
    if ((signal.action === "BUY" ? "CE" : "PE") !== state.position.contract.side) {
      state.pendingExit ??= "OPPOSITE_SIGNAL"; state.status = "EXIT_AWAITING_QUOTE";
    } else state.status = "ALREADY_OPEN";
    return state;
  }
  if (!state.enabled) { state.status = "DISABLED"; return state; }
  const current = session(data.at), closed = session(signal.closedAt);
  if (current.day !== closed.day || closed.minutes < 555 || current.minutes >= hamsFinalRules.cutoffMinutesIST) { state.status = "OUTSIDE_SESSION"; return state; }
  // Never turn a late alert into a new entry several candles after its signal.
  if (ms(data.at) - ms(signal.closedAt) >= 180000) { state.status = "MISSED_SIGNAL_CLOSE"; return state; }
  const contract = hamsContract(data.spot, signal.action === "BUY" ? "CE" : "PE", data.chain, data.at);
  if (!contract) { state.status = "MISSING_1_ITM_CONTRACT"; return state; }
  const candle = data.candle;
  if (!candle || candle.contractId !== contract.id || candle.closedAt !== signal.closedAt
    || ms(candle.closedAt) - ms(candle.openedAt) !== 180000 || !positive(candle.low)) { state.status = "MISSING_MATCHING_PREMIUM_CANDLE"; return state; }
  const stop = Math.round((candle.low - 5) * 100) / 100;
  if (!positive(stop) || stop >= contract.ask) { state.status = "INVALID_PREMIUM_STOP"; return state; }
  if (!Number.isSafeInteger(state.nextLots) || state.nextLots < 1 || state.nextLots > 20 || !Number.isFinite(state.balance)) { state.status = "INVALID_CHECKPOINT"; return state; }
  const quantity = state.nextLots * contract.lotSize;
  if (contract.ask * quantity > state.balance) { state.status = "INSUFFICIENT_VIRTUAL_CAPITAL"; return state; }
  const entry = depthFill(contract, quantity, "ask", data.at);
  if (entry === null) { state.status = "INSUFFICIENT_OBSERVED_ASK_DEPTH"; return state; }
  if (entry * quantity > state.balance) { state.status = "INSUFFICIENT_VIRTUAL_CAPITAL"; return state; }
  state.position = { contract, signalId: signal.id, signalClosedAt: signal.closedAt, receivedAt: signal.receivedAt,
    openedAt: data.at, entry, stop, target: Math.round((entry + 3 * (entry - stop)) * 100) / 100, quantity, lots: state.nextLots };
  state.lastQuoteAt = contract.at; state.status = "OPEN";
  return state;
}
export function markHams(previous: HamsState, quote: HamsQuote, at: string): HamsState {
  const state = structuredClone(previous), p = state.position;
  if (!p || !quoteValid(quote, at) || quote.id !== p.contract.id || quote.expiry !== p.contract.expiry
    || quote.side !== p.contract.side || quote.strike !== p.contract.strike || quote.lotSize !== p.contract.lotSize
    || ms(quote.at) < ms(p.openedAt) || (state.lastQuoteAt && ms(quote.at) <= ms(state.lastQuoteAt))) return state;
  state.lastQuoteAt = quote.at;
  const reason: HamsTrade["reason"] | null = quote.bid <= p.stop ? "SL" : state.pendingExit
    || (session(at).day !== session(p.openedAt).day || session(at).minutes >= hamsFinalRules.cutoffMinutesIST ? "TIME_EXIT" : quote.bid >= p.target ? "TARGET_3R" : null);
  if (!reason) { state.status = "OPEN"; return state; }
  const exit = depthFill(quote, p.quantity, "bid", at);
  if (exit === null) { state.pendingExit = reason; state.status = "EXIT_AWAITING_DEPTH"; return state; }
  const pnl = (exit - p.entry) * p.quantity;
  state.trades.push({ ...p, exit, closedAt: quote.at, reason, pnl });
  state.balance += pnl; state.nextLots = nextHamsLots(p.lots, reason);
  state.position = null; state.pendingExit = null; state.status = state.enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
  return state;
}
