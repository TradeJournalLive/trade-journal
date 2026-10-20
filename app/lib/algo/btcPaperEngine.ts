export const btcRules = { feed: "DELTA_INDIA_BTCUSD", timeframe: "1", quantityBtc: 1, leverage: 100, targetR: 3, validCandles: 10 } as const;
export type BtcSignal = { id: string; action: "BUY" | "SELL"; symbol: string; receivedAt: string; closedAt: string; high: number; low: number; signalPrice: number };
export type BtcTick = { timestamp: string; tradeAt: string; quoteAt: string; price: number; bid: number; ask: number; bidBtc: number; askBtc: number; mark: number; markAt: string; maintenanceRate: number; previous15m?: { high: number; low: number; closedAt: string } };
export type BtcPosition = { id: string; side: "LONG" | "SHORT"; quantityBtc: number; leverage: number; entry: number; openedAt: string; stop: number; initialRisk?: number; breakEven?: boolean; target: number; trigger: number; signalPrice: number; signalClosedAt: string; signalReceivedAt: string; entryDifference: number; initialMargin: number; estimatedLiquidation: number };
export type BtcTrade = BtcPosition & { exit: number; closedAt: string; reason: string; pnl: number; exitReference: number | null; exitDifference: number | null };
export type BtcState = { enabled: boolean; setup: BtcSignal | null; position: BtcPosition | null; previousTick: BtcTick | null; status: string; pendingExit: string | null; seen: string[]; trades: BtcTrade[]; realizedBase: number; tradeCountBase: number; lastSignalAt: string | null };
export function emptyBtcState(): BtcState { return { enabled: false, setup: null, position: null, previousTick: null, status: "DISABLED", pendingExit: null, seen: [], trades: [], realizedBase: 0, tradeCountBase: 0, lastSignalAt: null }; }
const positive = (v: number) => Number.isFinite(v) && v > 0;
const fresh = (at: string, now: string) => { const age = Date.parse(now) - Date.parse(at); return Number.isFinite(age) && age >= 0 && age <= 5000; };
export function btcSignal(state: BtcState, signal: BtcSignal) {
  const s = structuredClone(state);
  if (s.seen.includes(signal.id)) return s;
  s.seen.push(signal.id);
  if (signal.symbol !== "DELTAIN:BTCUSD.P") { s.status = "REJECTED_DIFFERENT_PRICE_FEED"; return s; }
  const deliveryAge = Date.parse(signal.receivedAt) - Date.parse(signal.closedAt);
  if (!Number.isFinite(deliveryAge) || deliveryAge < 0 || ![signal.high, signal.low, signal.signalPrice].every(positive) || signal.high <= signal.low) { s.status = "INVALID_SIGNAL_CANDLE"; return s; }
  if (s.position && ((signal.action === "BUY") !== (s.position.side === "LONG"))) s.pendingExit = "OPPOSITE_SIGNAL";
  s.lastSignalAt = signal.receivedAt;
  s.setup = s.enabled && (!s.position || s.pendingExit === "OPPOSITE_SIGNAL") ? signal : null;
  s.status = s.position ? "OPEN" : s.enabled ? "WAITING_FOR_BREAKOUT" : "DISABLED";
  return s;
}
export function btcTick(state: BtcState, tick: BtcTick): BtcState {
  const s = structuredClone(state);
  if (!positive(tick.price) || !fresh(tick.tradeAt, tick.timestamp) || !fresh(tick.quoteAt, tick.timestamp)
    || !positive(tick.bid) || !positive(tick.ask) || tick.ask < tick.bid
    || (s.previousTick && Date.parse(tick.timestamp) <= Date.parse(s.previousTick.timestamp))) return s;
  if (s.pendingExit === "COMPLETED_15M_TRAIL") s.pendingExit = null;
  let exited = false;
  if (s.position) {
    const p = s.position, long = p.side === "LONG", price = long ? tick.bid : tick.ask;
    p.initialRisk ??= Math.abs(p.entry - p.stop);
    if (!p.breakEven && positive(p.initialRisk) && (long ? price - p.entry : p.entry - price) >= 2 * p.initialRisk) {
      p.stop = p.entry; p.breakEven = true;
    }
    const markFresh = positive(tick.mark) && fresh(tick.markAt, tick.timestamp);
    const marginBreach = markFresh && (long ? tick.mark <= p.estimatedLiquidation : tick.mark >= p.estimatedLiquidation);
    const reason = marginBreach ? "ESTIMATED_ISOLATED_MARGIN_EXIT" : s.pendingExit
      || ((long ? price <= p.stop : price >= p.stop) ? (p.breakEven ? "COST_TO_COST_STOP" : "SIGNAL_CANDLE_STOP") : null)
      || ((long ? price >= p.target : price <= p.target) ? (Math.abs(p.target - p.entry) > 2 * p.initialRisk ? "TARGET_3R" : "TARGET_1_5R") : null);
    if (reason) {
      const depth = long ? tick.bidBtc : tick.askBtc;
      if (!Number.isFinite(depth) || depth < p.quantityBtc) { s.status = "INSUFFICIENT_EXIT_DEPTH"; s.pendingExit = reason; }
      else {
        const reference = (reason === "SIGNAL_CANDLE_STOP" || reason === "COST_TO_COST_STOP") ? p.stop : (reason === "TARGET_1_5R" || reason === "TARGET_3R") ? p.target : null;
        s.trades.push({ ...p, exit: price, closedAt: tick.timestamp, reason, pnl: (price - p.entry) * p.quantityBtc * (long ? 1 : -1), exitReference: reference, exitDifference: reference === null ? null : (long ? reference - price : price - reference) });
        s.position = null; s.pendingExit = null; exited = true; s.status = s.enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
      }
    }
  }
  if (!s.position && s.enabled && s.setup && !exited) {
    const setup = s.setup, age = Date.parse(tick.timestamp) - Date.parse(setup.closedAt);
    if (age >= 10 * 60000) { s.setup = null; s.status = "SETUP_EXPIRED"; }
    else if (age >= 0 && s.previousTick && fresh(s.previousTick.timestamp, tick.timestamp)) {
      const long = setup.action === "BUY", trigger = long ? setup.high : setup.low;
      const crossed = long ? s.previousTick.price <= trigger && tick.price > trigger : s.previousTick.price >= trigger && tick.price < trigger;
      if (crossed) {
        const entry = long ? tick.ask : tick.bid, stop = long ? setup.low : setup.high, risk = long ? entry - stop : stop - entry;
        const depth = long ? tick.askBtc : tick.bidBtc, mm = tick.maintenanceRate;
        if (!positive(risk) || !Number.isFinite(mm) || mm < 0 || mm >= 1 / 100 || !positive(tick.mark) || !fresh(tick.markAt, tick.timestamp)) s.status = "MISSING_CONTRACT_OR_MARK_DATA";
        else if (!Number.isFinite(depth) || depth < 1) s.status = "INSUFFICIENT_ENTRY_DEPTH";
        else {
          s.position = { id: setup.id, side: long ? "LONG" : "SHORT", quantityBtc: 1, leverage: 100, entry, openedAt: tick.timestamp, stop, initialRisk: risk, breakEven: false, target: entry + (long ? 1 : -1) * btcRules.targetR * risk, trigger, signalPrice: setup.signalPrice, signalClosedAt: setup.closedAt, signalReceivedAt: setup.receivedAt, entryDifference: long ? entry - trigger : trigger - entry, initialMargin: entry / 100, estimatedLiquidation: long ? entry * (1 - 1 / 100) / (1 - mm) : entry * (1 + 1 / 100) / (1 + mm) };
          s.setup = null; s.status = "OPEN";
        }
      }
    }
  }
  s.previousTick = tick;
  if (!s.position && !s.setup && s.enabled) s.status = "WAITING_FOR_SIGNAL";
  return s;
}
export function btcView(s: BtcState, now = new Date().toISOString()) {
  const t = s.previousTick, age = t ? Date.parse(now) - Date.parse(t.timestamp) : NaN;
  const stale = !Number.isFinite(age) || age < 0 || age > 15000;
  const mark = t && s.position ? s.position.side === "LONG" ? t.bid : t.ask : null;
  return { ...s, seen: undefined, previousTick: undefined, stale, mark, lastTickAt: t?.timestamp ?? null,
    realized: s.realizedBase + s.trades.reduce((sum, v) => sum + v.pnl, 0), tradeCount: s.tradeCountBase + s.trades.length,
    unrealized: mark !== null && s.position ? (mark - s.position.entry) * s.position.quantityBtc * (s.position.side === "LONG" ? 1 : -1) : null,
    model: "Gross USD; fees/funding excluded; isolated liquidation estimate, not broker liquidation", rules: btcRules };
}
