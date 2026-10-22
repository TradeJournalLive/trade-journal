export const goldRules = { lots: 0.03, targetR: 3, breakEvenR: 2, validMs: 600000 } as const;
export type GoldQuote = { symbol: string; server: string; demo: boolean; currency: string; tickAtMs: number; exportedAtMs: number; bid: number; ask: number; contractSize: number; volumeMin: number; volumeMax: number; volumeStep: number; tickSize: number; margin003: number; sellMargin003: number; leverage: number };
export type GoldSignal = { id: string; action: "BUY" | "SELL"; closedAt: string; receivedAt: string; high: number; low: number };
type GoldPosition = { id: string; side: "LONG" | "SHORT"; lots: number; units: number; entry: number; openedAt: string; stop: number; initialRisk: number; target: number; breakEven: boolean; margin: number; signalClosedAt: string; signalReceivedAt: string; unverified?: boolean };
export type GoldTrade = GoldPosition & { exit: number; closedAt: string; reason: string; pnl: number };
export type GoldState = { enabled: boolean; status: string; quote: GoldQuote | null; previousAt: number; history: { at: number; price: number }[]; setup: GoldSignal | null; position: GoldPosition | null; trades: GoldTrade[]; decisions: { id: string; receivedAt: string; decidedAt: string; status: string; reason: string }[]; seen: string[]; pendingExit: boolean };
export function emptyGoldState(): GoldState { return { enabled: false, status: "WAITING_FOR_MT5", quote: null, previousAt: 0, history: [], setup: null, position: null, trades: [], decisions: [], seen: [], pendingExit: false }; }
export function validGoldQuote(q: GoldQuote, now: number) {
  return q?.symbol === "XAUUSD" && q.server === "VantageMarkets-Demo" && q.demo === true && q.currency === "USD"
    && [q.tickAtMs, q.exportedAtMs, q.bid, q.ask, q.contractSize, q.volumeMin, q.volumeMax, q.volumeStep, q.tickSize, q.margin003, q.sellMargin003, q.leverage].every(v => Number.isFinite(v) && v > 0)
    && q.ask >= q.bid && now - q.tickAtMs >= -2000 && now - q.tickAtMs <= 5000 && now - q.exportedAtMs >= -2000 && now - q.exportedAtMs <= 5000
    && goldRules.lots >= q.volumeMin && goldRules.lots <= q.volumeMax && Math.abs(goldRules.lots / q.volumeStep - Math.round(goldRules.lots / q.volumeStep)) < 1e-7;
}
function decision(s: GoldState, v: GoldSignal, at: string, status: string, reason: string) {
  const d = { id: v.id, receivedAt: v.receivedAt, decidedAt: at, status, reason }, i = s.decisions.findIndex(d => d.id === v.id);
  if (i < 0) s.decisions.push(d); else s.decisions[i] = d;
}
export function goldSignal(state: GoldState, signal: GoldSignal): GoldState {
  const s = structuredClone(state), at = signal.receivedAt;
  if (s.seen.includes(signal.id)) return s;
  s.seen.push(signal.id);
  if (s.position && (s.position.side === "LONG") === (signal.action === "BUY")) {
    decision(s, signal, at, "ALREADY_OPEN", "Same-direction position is already open; no queued re-entry."); return s;
  }
  if (s.position && (s.position.side === "LONG") !== (signal.action === "BUY")) s.pendingExit = true;
  if (s.setup) decision(s, s.setup, at, "SUPERSEDED", "A newer gold signal replaced this setup.");
  s.setup = null;
  if (!s.enabled) { decision(s, signal, at, "ENTRIES_OFF", "Gold paper entries are off."); return s; }
  const closed = Date.parse(signal.closedAt), received = Date.parse(at);
  if (![signal.high, signal.low, closed, received].every(Number.isFinite) || signal.low <= 0 || signal.high <= signal.low || received < closed || received - closed >= goldRules.validMs) {
    decision(s, signal, at, "INVALID_SIGNAL", "Invalid or expired confirmed candle."); return s;
  }
  const processed = Math.max(received, s.previousAt);
  const ticks = s.history.filter(t => t.at >= closed && t.at <= processed);
  const coverage = ticks.length && ticks[0].at - closed <= 2000 && processed - ticks[ticks.length - 1].at <= 2000 && ticks.every((t, i) => !i || t.at - ticks[i - 1].at <= 5000);
  if (!coverage) { decision(s, signal, at, "UNVERIFIABLE_HISTORY", "Continuous Vantage quotes were unavailable during alert delivery."); return s; }
  if (ticks.some(t => signal.action === "BUY" ? t.price > signal.high : t.price < signal.low)) {
    decision(s, signal, at, "MISSED_BREAKOUT", "Signal level was already crossed before alert receipt; no later re-entry."); return s;
  }
  s.setup = signal; s.status = "WAITING_FOR_BREAKOUT";
  decision(s, signal, at, s.status, "Waiting up to ten candles for a fresh Vantage bid-price crossing."); return s;
}
export function goldTick(state: GoldState, q: GoldQuote, now: number): GoldState {
  const s = structuredClone(state);
  if (!validGoldQuote(q, now)) { s.status = "MT5_QUOTES_STALE_OR_INVALID"; return s; }
  if (s.quote && q.tickAtMs < s.quote.tickAtMs) return s;
  const at = new Date(now).toISOString(), previous = s.quote;
  const gap = s.previousAt > 0 && now - s.previousAt > 5000;
  if (gap) {
    if (s.position) s.position.unverified = true;
    if (s.setup) decision(s, s.setup, at, "UNVERIFIABLE_HISTORY", "Quote monitoring was interrupted before entry.");
    s.setup = null; s.history = [];
  }
  s.quote = q; s.previousAt = now;
  s.history = [...s.history.filter(t => now - t.at <= 660000), { at: now, price: q.bid }];
  let exited = false;
  if (s.position) {
    const p = s.position, long = p.side === "LONG", price = long ? q.bid : q.ask;
    const stopHit = long ? price <= p.stop : price >= p.stop, targetHit = long ? price >= p.target : price <= p.target;
    const reason = stopHit ? p.breakEven ? "BREAK_EVEN_STOP" : "SIGNAL_CANDLE_SL" : targetHit ? "TARGET_3R" : s.pendingExit ? "OPPOSITE_SIGNAL" : null;
    if (reason) {
      s.trades.push({ ...p, exit: price, closedAt: at, reason, pnl: (price - p.entry) * p.units * (long ? 1 : -1) });
      s.position = null; s.pendingExit = false; s.status = "WAITING_FOR_SIGNAL"; exited = true;
    } else if (!p.breakEven && (price - p.entry) * (long ? 1 : -1) >= goldRules.breakEvenR * p.initialRisk) {
      p.stop = p.entry; p.breakEven = true;
    }
  }
  if (s.setup && now - Date.parse(s.setup.closedAt) >= goldRules.validMs) {
    decision(s, s.setup, at, "SETUP_EXPIRED", "No fresh breakout within ten candles."); s.setup = null;
  }
  if (s.enabled && !s.position && !exited && s.setup && previous && !gap) {
    const v = s.setup, long = v.action === "BUY", crossed = long ? previous.bid <= v.high && q.bid > v.high : previous.bid >= v.low && q.bid < v.low;
    if (crossed) {
      const entry = long ? q.ask : q.bid, stop = long ? v.low : v.high, risk = (entry - stop) * (long ? 1 : -1);
      if (risk > 0) {
        s.position = { id: v.id, side: long ? "LONG" : "SHORT", lots: goldRules.lots, units: goldRules.lots * q.contractSize, entry, openedAt: at, stop, initialRisk: risk, target: entry + (long ? 1 : -1) * goldRules.targetR * risk, breakEven: false, margin: long ? q.margin003 : q.sellMargin003, signalClosedAt: v.closedAt, signalReceivedAt: v.receivedAt };
        s.status = "OPEN"; decision(s, v, at, "ENTERED", `Simulated ${goldRules.lots} lots at observed ${long ? "ask" : "bid"} ${entry}. Quote-fill model, not broker-confirmed liquidity.`);
      } else decision(s, v, at, "INVALID_RISK", "Entry is beyond its protective stop.");
      s.setup = null;
    }
  }
  if (!s.position && !s.setup) s.status = s.enabled ? "WAITING_FOR_SIGNAL" : "ENTRIES_OFF";
  return s;
}
export function goldView(s: GoldState, now = Date.now()) {
  const fresh = !!s.quote && validGoldQuote(s.quote, now), p = s.position;
  const mark = fresh && p ? p.side === "LONG" ? s.quote!.bid : s.quote!.ask : null;
  return { enabled: s.enabled, status: s.status, position: p, trades: s.trades, decisions: s.decisions, quote: s.quote, stale: !fresh, realized: s.trades.filter(t => !t.unverified).reduce((sum, t) => sum + t.pnl, 0), unrealized: mark !== null && p && !p.unverified ? (mark - p.entry) * p.units * (p.side === "LONG" ? 1 : -1) : null };
}
