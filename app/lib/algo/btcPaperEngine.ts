export const btcRules = { feed: "DELTA_INDIA_BTCUSD", timeframe: "1", quantityBtc: 0.1, leverage: 100, targetR: 3, validCandles: 10, maxEntrySlippageUsd: 5 } as const;
export type BtcLevel = { price: number; quantityBtc: number };
export type BtcFill = { price: number; quantityBtc: number; initialQuote: number; slippage: number; fills: BtcLevel[]; liquidityId: string };
export type BtcDecision = { id: string; action: string; receivedAt: string; signalClosedAt: string; decidedAt: string; status: string; reason: string; filledBtc?: number; canceledBtc?: number; entry?: number; slippage?: number };
function decision(s: BtcState, signal: BtcSignal, status: string, reason: string, at = signal.receivedAt, fill?: BtcFill) {
  s.decisions ??= [];
  const value: BtcDecision = { id: signal.id, action: signal.action, receivedAt: signal.receivedAt, signalClosedAt: signal.closedAt, decidedAt: at, status, reason,
    ...(fill ? { filledBtc: fill.quantityBtc, canceledBtc: Math.max(0, Math.round((btcRules.quantityBtc - fill.quantityBtc) * 1e12) / 1e12), entry: fill.price, slippage: fill.slippage } : {}) };
  const index = s.decisions.findIndex(item => item.id === signal.id);
  if (index < 0) s.decisions.push(value); else s.decisions[index] = value;
}
// Consume one observed snapshot only; never fabricate levels or fractional contracts.
export function btcDepthFill(levels: BtcLevel[], buy: boolean, requested: number, contractBtc: number, initialQuote: number, liquidityId: string, limit = Infinity): BtcFill | null {
  if (![requested, contractBtc, initialQuote].every(v => Number.isFinite(v) && v > 0) || !levels.length || !liquidityId) return null;
  const units = Math.round(requested / contractBtc);
  if (units < 1 || Math.abs(units * contractBtc - requested) > 1e-9) return null;
  const sorted = [...levels].sort((a, b) => buy ? a.price - b.price : b.price - a.price);
  if (sorted[0].price !== initialQuote || sorted.some((l, i) => !Number.isFinite(l.price) || l.price <= 0 || !Number.isFinite(l.quantityBtc) || l.quantityBtc <= 0 || Math.abs(Math.round(l.quantityBtc / contractBtc) * contractBtc - l.quantityBtc) > 1e-9 || (i > 0 && l.price === sorted[i - 1].price))) return null;
  let remaining = units, cost = 0, takenUnits = 0;
  const fills: BtcLevel[] = [];
  for (const level of sorted) {
    if ((buy ? level.price - initialQuote : initialQuote - level.price) > limit + 1e-9) break;
    const taken = Math.min(remaining, Math.round(level.quantityBtc / contractBtc));
    if (taken <= 0) continue;
    const quantityBtc = Math.round(taken * contractBtc * 1e12) / 1e12;
    fills.push({ price: level.price, quantityBtc }); cost += level.price * quantityBtc; takenUnits += taken; remaining -= taken;
    if (!remaining) break;
  }
  if (!takenUnits) return null;
  const quantityBtc = Math.round(takenUnits * contractBtc * 1e12) / 1e12, price = cost / quantityBtc;
  return { price, quantityBtc, initialQuote, slippage: buy ? price - initialQuote : initialQuote - price, fills, liquidityId };
}
function executionFill(tick: BtcTick, buy: boolean, quantity: number, limit = Infinity) {
  const initial = buy ? tick.ask : tick.bid, depth = tick.depth;
  const matches = depth && fresh(depth.at, tick.timestamp) && depth.asks[0]?.price === tick.ask && depth.bids[0]?.price === tick.bid;
  const levels = matches ? buy ? depth.asks : depth.bids : [{ price: initial, quantityBtc: buy ? tick.askBtc : tick.bidBtc }];
  const id = matches ? `depth:${depth.at}:${depth.sequence}` : `quote:${tick.quoteAt}`;
  return btcDepthFill(levels, buy, quantity, tick.contractBtc ?? NaN, initial, id, limit);
}
export type BtcSignal = { id: string; action: "BUY" | "SELL"; symbol: string; receivedAt: string; closedAt: string; high: number; low: number; signalPrice: number; breakoutVerified?: boolean };
type PriceWindow = { second: number; first: number; last: number; low: number; high: number; gap: number };
export type BtcTick = { timestamp: string; tradeAt: string; quoteAt: string; price: number; bid: number; ask: number; bidBtc: number; askBtc: number; mark: number; markAt: string; maintenanceRate: number; executionVersion?: 2; contractBtc?: number; depth?: { at: string; sequence: number; bids: BtcLevel[]; asks: BtcLevel[] }; previous15m?: { high: number; low: number; closedAt: string } };
export type BtcPosition = { id: string; side: "LONG" | "SHORT"; quantityBtc: number; leverage: number; entry: number; openedAt: string; stop: number; initialRisk?: number; breakEven?: boolean; monitoringGap?: { from: string; to: string }; target: number; trigger: number; signalPrice: number; signalClosedAt: string; signalReceivedAt: string; entryDifference: number; initialMargin: number; estimatedLiquidation: number; entryFill?: BtcFill; entryQuantityBtc?: number; canceledEntryBtc?: number; realizedPnl?: number; lastExitLiquidityId?: string; exitFills?: (BtcLevel & { at: string; reason: string; liquidityId?: string })[] };
export type BtcTrade = BtcPosition & { exit: number; closedAt: string; reason: string; pnl: number; exitReference: number | null; exitDifference: number | null };
export type BtcState = { enabled: boolean; setup: BtcSignal | null; position: BtcPosition | null; previousTick: BtcTick | null; priceHistory?: PriceWindow[]; status: string; pendingExit: string | null; seen: string[]; trades: BtcTrade[]; realizedBase: number; tradeCountBase: number; lastSignalAt: string | null; decisions?: BtcDecision[] };
export function emptyBtcState(): BtcState { return { enabled: false, setup: null, position: null, previousTick: null, status: "DISABLED", pendingExit: null, seen: [], trades: [], realizedBase: 0, tradeCountBase: 0, lastSignalAt: null }; }
export function btcCancelSetup(state: BtcState, at: string) {
  const s = structuredClone(state);
  if (s.setup) decision(s, s.setup, "CANCELED", "Paper entries were switched off before entry.", at);
  s.setup = null; return s;
}
const positive = (v: number) => Number.isFinite(v) && v > 0;
const fresh = (at: string, now: string) => { const age = Date.parse(now) - Date.parse(at); return Number.isFinite(age) && age >= -1000 && age <= 5000; };
export function btcSignal(state: BtcState, signal: BtcSignal, processedAt = signal.receivedAt) {
  const s = structuredClone(state);
  if (s.seen.includes(signal.id)) return s;
  s.seen.push(signal.id);
  if (signal.symbol !== "DELTAIN:BTCUSD.P") { s.status = "REJECTED_DIFFERENT_PRICE_FEED"; decision(s, signal, s.status, "Signal is not from Delta India BTCUSD perpetual.", processedAt); return s; }
  const deliveryAge = Date.parse(signal.receivedAt) - Date.parse(signal.closedAt);
  if (!Number.isFinite(deliveryAge) || deliveryAge < 0 || ![signal.high, signal.low, signal.signalPrice].every(positive) || signal.high <= signal.low) { s.status = "INVALID_SIGNAL_CANDLE"; decision(s, signal, s.status, "Invalid signal candle or close timestamp.", processedAt); return s; }
  if (s.setup) decision(s, s.setup, "SUPERSEDED", "A newer signal replaced this setup before entry.", processedAt);
  if (s.position && ((signal.action === "BUY") !== (s.position.side === "LONG"))) s.pendingExit = "OPPOSITE_SIGNAL";
  s.lastSignalAt = signal.receivedAt;
  s.setup = s.enabled && (!s.position || s.pendingExit === "OPPOSITE_SIGNAL") ? signal : null;
  s.status = s.position ? "OPEN" : s.enabled ? "WAITING_FOR_BREAKOUT" : "DISABLED";
  if (s.setup) {
    const start = Date.parse(signal.closedAt), end = Date.parse(s.previousTick?.timestamp || "");
    const rows = (s.priceHistory || []).filter(row => row.last >= start && row.first <= end);
    const broken = rows.some(row => signal.action === "BUY" ? row.high > signal.high : row.low < signal.low);
    const covered = Number.isFinite(end) && end >= Date.parse(signal.receivedAt) - 5000 && rows.length > 0
      && rows[0].first <= start + 1000 && rows[rows.length - 1].last >= end
      && rows.every((row, i) => Number.isFinite(row.gap) && row.gap <= 5000 && (!i || row.first - rows[i - 1].last <= 5000));
    if (broken || !covered || end - start >= 600000) {
      s.setup = null; s.status = broken ? "MISSED_BREAKOUT" : end - start >= 600000 ? "SETUP_EXPIRED" : "UNVERIFIABLE_BREAKOUT_HISTORY";
    } else s.setup.breakoutVerified = true;
  }
  decision(s, signal, s.setup ? "WAITING_FOR_BREAKOUT" : s.status === "OPEN" ? "POSITION_ALREADY_OPEN" : s.status,
    s.setup ? "Waiting for the first eligible high/low crossing." : s.status === "MISSED_BREAKOUT" ? "The level broke before the worker processed this signal; no late entry." : s.status === "SETUP_EXPIRED" ? "The ten-candle entry window expired." : s.status === "UNVERIFIABLE_BREAKOUT_HISTORY" ? "Continuous price history during alert delivery is unavailable." : s.position ? "Existing position managed; no additional same-direction entry." : "Paper entries are off.", processedAt);
  return s;
}
export function btcTick(state: BtcState, tick: BtcTick): BtcState {
  const s = structuredClone(state);
  if (!positive(tick.price) || !fresh(tick.quoteAt, tick.timestamp)
    || !positive(tick.bid) || !positive(tick.ask) || tick.ask < tick.bid
    || (s.previousTick && Date.parse(tick.timestamp) <= Date.parse(s.previousTick.timestamp))) {
    if (s.setup && positive(tick.price) && fresh(tick.tradeAt, tick.timestamp)
      && Date.parse(tick.timestamp) >= Date.parse(s.setup.closedAt)
      && (!s.previousTick || Date.parse(tick.timestamp) > Date.parse(s.previousTick.timestamp))
      && (s.setup.action === "BUY" ? tick.price > s.setup.high : tick.price < s.setup.low)) {
      decision(s, s.setup, "MISSED_BREAKOUT_UNFILLED", "Breakout occurred without a fresh executable quote; no later re-entry.", tick.timestamp);
      s.setup = null; s.status = "MISSED_BREAKOUT_UNFILLED";
    }
    return s;
  }
  const at = Date.parse(tick.timestamp), second = Math.floor(at / 1000);
  const history = (s.priceHistory || []).filter(row => row.second >= second - 660);
  const last = history[history.length - 1], gap = s.previousTick ? at - Date.parse(s.previousTick.timestamp) : Infinity;
  if (last?.second === second) { last.last = at; last.low = Math.min(last.low, tick.price); last.high = Math.max(last.high, tick.price); last.gap = Math.max(last.gap, gap); }
  else history.push({ second, first: at, last: at, low: tick.price, high: tick.price, gap });
  s.priceHistory = history;
  if (s.status === "STORAGE_LEASE_UNVERIFIED") s.status = s.position ? "OPEN" : s.setup ? "WAITING_FOR_BREAKOUT" : s.enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
  if (s.pendingExit === "COMPLETED_15M_TRAIL" || s.pendingExit === "MONITORING_INTERRUPTED") s.pendingExit = null;
  if (s.previousTick && Date.parse(tick.timestamp) - Date.parse(s.previousTick.timestamp) > 15000) {
    if (s.setup) decision(s, s.setup, "MONITORING_INTERRUPTED", "Price monitoring was interrupted before entry.", tick.timestamp);
    s.setup = null;
    if (s.position) {
      s.position.monitoringGap ??= { from: s.previousTick.timestamp, to: tick.timestamp };
    }
    s.status = "MONITORING_INTERRUPTED";
  }
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
      // Only new version-two entries use depth/partial fills; stored old positions keep their rules.
      const fill = p.entryFill ? executionFill(tick, !long, p.quantityBtc) : null;
      if (p.entryFill ? !fill || fill.liquidityId === p.lastExitLiquidityId || fill.liquidityId === p.entryFill.liquidityId || p.exitFills?.some(f => f.liquidityId === fill.liquidityId) : !Number.isFinite(depth) || depth < p.quantityBtc) { s.status = "INSUFFICIENT_EXIT_DEPTH"; s.pendingExit = reason; }
      else {
        const reference = (reason === "SIGNAL_CANDLE_STOP" || reason === "COST_TO_COST_STOP") ? p.stop : (reason === "TARGET_1_5R" || reason === "TARGET_3R") ? p.target : null;
        const actualPrice = fill?.price ?? price, quantity = fill?.quantityBtc ?? p.quantityBtc;
        const pnl = (p.realizedPnl ?? 0) + (actualPrice - p.entry) * quantity * (long ? 1 : -1);
        const exitFills = [...(p.exitFills ?? []), ...(fill?.fills ?? [{ price, quantityBtc: quantity }]).map(level => ({ ...level, at: tick.timestamp, reason, liquidityId: fill?.liquidityId }))];
        if (quantity < p.quantityBtc - 1e-9) {
          const remaining = Math.round((p.quantityBtc - quantity) * 1e12) / 1e12;
          s.position = { ...p, quantityBtc: remaining, initialMargin: p.entry * remaining / p.leverage, realizedPnl: pnl, lastExitLiquidityId: fill!.liquidityId, exitFills };
          s.pendingExit = reason; s.status = "PARTIAL_EXIT_PENDING";
        } else {
          const original = p.entryQuantityBtc ?? p.quantityBtc;
          const exit = exitFills.reduce((sum, level) => sum + level.price * level.quantityBtc, 0) / original;
          s.trades.push({ ...p, quantityBtc: original, initialMargin: p.entry * original / p.leverage, exit, exitFills, closedAt: tick.timestamp, reason, pnl, exitReference: reference, exitDifference: reference === null ? null : (long ? reference - exit : exit - reference) });
          s.position = null; s.pendingExit = null; exited = true; s.status = s.enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
        }
      }
    }
  }
  if (!s.position && s.enabled && s.setup && !exited) {
    const setup = s.setup, age = Date.parse(tick.timestamp) - Date.parse(setup.closedAt);
    if (!setup.breakoutVerified) { decision(s, setup, "UNVERIFIABLE_BREAKOUT_HISTORY", "Delivery-period price history is unavailable.", tick.timestamp); s.setup = null; s.status = "UNVERIFIABLE_BREAKOUT_HISTORY"; }
    else if (age >= 10 * 60000) { decision(s, setup, "SETUP_EXPIRED", "No entry within ten candles.", tick.timestamp); s.setup = null; s.status = "SETUP_EXPIRED"; }
    else if (age >= 0 && fresh(tick.tradeAt, tick.timestamp) && s.previousTick && fresh(s.previousTick.timestamp, tick.timestamp)) {
      const long = setup.action === "BUY", trigger = long ? setup.high : setup.low;
      const crossed = long ? s.previousTick.price <= trigger && tick.price > trigger : s.previousTick.price >= trigger && tick.price < trigger;
      if (crossed) {
        const fill = tick.executionVersion === 2 ? executionFill(tick, long, btcRules.quantityBtc, btcRules.maxEntrySlippageUsd) : null;
        const entry = fill?.price ?? (long ? tick.ask : tick.bid), stop = long ? setup.low : setup.high, risk = long ? entry - stop : stop - entry;
        const depth = long ? tick.askBtc : tick.bidBtc, mm = tick.maintenanceRate;
        let skipReason = "";
        if (!positive(risk) || !Number.isFinite(mm) || mm < 0 || mm >= 1 / 100 || !positive(tick.mark) || !fresh(tick.markAt, tick.timestamp)) { s.status = "MISSING_CONTRACT_OR_MARK_DATA"; skipReason = "Invalid stop distance or missing fresh mark/contract data."; }
        else if (tick.executionVersion === 2 ? !fill : !Number.isFinite(depth) || depth < btcRules.quantityBtc) { s.status = "INSUFFICIENT_ENTRY_DEPTH"; skipReason = "No executable contract quantity within the entry price limit."; }
        else {
          const quantity = fill?.quantityBtc ?? btcRules.quantityBtc;
          s.position = { id: setup.id, side: long ? "LONG" : "SHORT", quantityBtc: quantity, leverage: 100, entry, openedAt: tick.timestamp, stop, initialRisk: risk, breakEven: false, target: entry + (long ? 1 : -1) * btcRules.targetR * risk, trigger, signalPrice: setup.signalPrice, signalClosedAt: setup.closedAt, signalReceivedAt: setup.receivedAt, entryDifference: long ? entry - trigger : trigger - entry, initialMargin: entry * quantity / 100, estimatedLiquidation: long ? entry * (1 - 1 / 100) / (1 - mm) : entry * (1 + 1 / 100) / (1 + mm),
            ...(fill ? { entryFill: fill, entryQuantityBtc: quantity, canceledEntryBtc: Math.max(0, Math.round((btcRules.quantityBtc - quantity) * 1e12) / 1e12) } : {}) };
          decision(s, setup, quantity < btcRules.quantityBtc ? "PARTIALLY_FILLED" : "ENTERED", quantity < btcRules.quantityBtc ? "Filled available quantity within $5; unfilled entry remainder canceled." : "Filled requested quantity at observed prices within the entry limit.", tick.timestamp, fill ?? undefined);
          s.setup = null; s.status = "OPEN";
        }
        if (!s.position) { decision(s, setup, "MISSED_BREAKOUT_UNFILLED", `${skipReason} First breakout skipped; no later re-entry.`, tick.timestamp); s.setup = null; s.status = "MISSED_BREAKOUT_UNFILLED"; }
      }
    }
  }
  s.previousTick = tick;
  if (!s.position && !s.setup && s.enabled && !["MISSED_BREAKOUT", "MISSED_BREAKOUT_UNFILLED", "UNVERIFIABLE_BREAKOUT_HISTORY", "SETUP_EXPIRED"].includes(s.status)) s.status = "WAITING_FOR_SIGNAL";
  return s;
}

// Preserve observed history while ownership is uncertain, without simulating fills.
export function btcObserveTick(state: BtcState, tick: BtcTick): BtcState {
  const observed = btcTick({ ...emptyBtcState(), previousTick: state.previousTick, priceHistory: state.priceHistory }, tick);
  if (observed.previousTick?.timestamp !== tick.timestamp) return state;
  const s = { ...state, previousTick: observed.previousTick, priceHistory: observed.priceHistory };
  if (s.position) s.position = { ...s.position, monitoringGap: { from: s.position.monitoringGap?.from ?? state.previousTick?.timestamp ?? tick.timestamp, to: tick.timestamp } };
  if (s.setup && (s.setup.action === "BUY" ? tick.price > s.setup.high : tick.price < s.setup.low)) {
    s.decisions = [...(s.decisions || [])];
    decision(s, s.setup, "MISSED_BREAKOUT_EXECUTION_PAUSED", "The level crossed while worker ownership could not be verified; no late entry.", tick.timestamp);
    s.setup = null;
  }
  s.status = "STORAGE_LEASE_UNVERIFIED";
  return s;
}
export function btcCompactTrades(state: BtcState, persisted: Set<string>): BtcState {
  const flushed = state.trades.filter(t => persisted.has(`${t.id}:${t.openedAt}`));
  if (!flushed.length) return state;
  const verified = flushed.filter(t => !t.monitoringGap);
  return { ...state, trades: state.trades.filter(t => !persisted.has(`${t.id}:${t.openedAt}`)), realizedBase: state.realizedBase + verified.reduce((sum, t) => sum + t.pnl, 0), tradeCountBase: state.tradeCountBase + verified.length };
}
export function btcView(s: BtcState, now = new Date().toISOString()) {
  const t = s.previousTick, age = t ? Date.parse(now) - Date.parse(t.timestamp) : NaN;
  const stale = !Number.isFinite(age) || age < 0 || age > 15000;
  const mark = t && s.position ? s.position.side === "LONG" ? t.bid : t.ask : null;
  return { ...s, seen: undefined, previousTick: undefined, priceHistory: undefined, stale, mark, lastTickAt: t?.timestamp ?? null,
    realized: s.realizedBase + s.trades.filter(v => !v.monitoringGap).reduce((sum, v) => sum + v.pnl, 0) + (s.position && !s.position.monitoringGap ? s.position.realizedPnl ?? 0 : 0), tradeCount: s.tradeCountBase + s.trades.filter(v => !v.monitoringGap).length,
    unrealized: mark !== null && s.position && !s.position.monitoringGap ? (mark - s.position.entry) * s.position.quantityBtc * (s.position.side === "LONG" ? 1 : -1) : null,
    model: "Gross USD; fees/funding excluded; isolated liquidation estimate, not broker liquidation", rules: btcRules };
}
