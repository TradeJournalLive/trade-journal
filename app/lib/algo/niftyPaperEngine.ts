import type { PaperEvent } from "./paperEngine";
import { nextNiftySize, niftyBreakout, niftyExit, niftyTargets, niftyEntryFill, premiumStopDistance, type NiftySetup, type NiftyDepthLevel } from "./niftyRules";

type Contract = { id: string; expiry: string; strike: number; side: "CE" | "PE"; lotSize: number; bid: number; ask: number; timestamp: string; bidSize?: number; askSize?: number; asks?: NiftyDepthLevel[]; depthAt?: string };
type Setup = NiftySetup & { id: string; closedAt: string; intervalMinutes: number; indexSymbol: string };
type Position = { contract: Contract; lots: number; quantity: number; entry: number; openedAt: string; signalId: string; indexSymbol: string; targets?: ReturnType<typeof niftyTargets>; initialLots?: number; initialQuantity?: number; realizedPnl?: number; entryFill?: NonNullable<ReturnType<typeof niftyEntryFill>>; exitFills?: { price: number; quantity: number; at: string; reason: string }[] };
type Trade = Position & { exit: number; closedAt: string; reason: string; pnl: number };
type Tick = { indexSymbol: string; timestamp: string; price: number; nearestExpiry: string; chainComplete: boolean; executionVersion?: 2; previous15m?: { high: number; low: number; closedAt: string }; contracts: Contract[] };
export type NiftyPaperCheckpoint = { enabled: boolean; setup: Setup | null; position: Position | null; previousTick: Tick | null; size: { lots: number; consecutiveLosses: number }; pendingExit: string | null; status: string; lastTickAt: string | null; mark: number | null; trades: Trade[]; seen: string[]; realizedBase?: number; tradeCountBase?: number };

function minutesIST(timestamp: string) {
  const date = new Date(Date.parse(timestamp) + 330 * 60000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
function dayIST(timestamp: string) { return new Date(Date.parse(timestamp) + 330 * 60000).toISOString().slice(0, 10); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function fresh(timestamp: string, now: string) { const age = Date.parse(now) - Date.parse(timestamp); return Number.isFinite(age) && age >= 0 && age <= 5000; }

function readTick(value: unknown): Tick | null {
  if (!value || typeof value !== "object") return null;
  const tick = value as Tick;
  if (tick.indexSymbol !== "NSE:NIFTY" || !Number.isFinite(Date.parse(tick.timestamp)) || !positive(tick.price)
    || typeof tick.nearestExpiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tick.nearestExpiry)
    || tick.nearestExpiry < dayIST(tick.timestamp) || tick.chainComplete !== true || !Array.isArray(tick.contracts)) return null;
  return tick;
}
function validQuote(contract: Contract, tick: Tick) {
  return typeof contract.id === "string" && contract.id.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(contract.expiry)
    && contract.expiry >= dayIST(tick.timestamp) && positive(contract.strike)
    && (contract.side === "CE" || contract.side === "PE") && Number.isSafeInteger(contract.lotSize) && contract.lotSize > 0
    && positive(contract.bid) && positive(contract.ask) && contract.ask >= contract.bid && fresh(contract.timestamp, tick.timestamp);
}

// This reducer has no broker-order path. It replays persisted, timestamped market snapshots.
export function buildNiftyOptionsPaper(events: PaperEvent[], now = new Date().toISOString(), initial?: NiftyPaperCheckpoint) {
  const saved = initial ? structuredClone(initial) : undefined;
  let enabled = saved?.enabled ?? false;
  let setup: Setup | null = saved?.setup ?? null;
  let position: Position | null = saved?.position ?? null;
  let previousTick: Tick | null = saved?.previousTick ?? null;
  let size = saved?.size ?? { lots: 1, consecutiveLosses: 0 };
  let pendingExit: string | null = saved?.pendingExit ?? null;
  let status = saved?.status ?? "DISABLED";
  let lastTickAt: string | null = saved?.lastTickAt ?? null;
  let mark: number | null = saved?.mark ?? null;
  const trades: Trade[] = saved?.trades ?? [];
  const seen = new Set<string>(saved?.seen ?? []);
  for (const event of [...events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.signal.id.localeCompare(b.signal.id))) {
    const control = event.raw.paperControl;
    if (control?.market === "NIFTY" && typeof control.niftyOptionsEnabled === "boolean") {
      enabled = control.niftyOptionsEnabled;
      if (!enabled) setup = null;
      status = enabled ? "WAITING_FOR_SIGNAL_AND_DATA" : "DISABLED";
      continue;
    }
    if (event.raw.automation?.mode !== "PAPER" || event.signal.metadata?.diagnostic || event.signal.id.startsWith("panel-test-")) continue;
    const key = `${event.signal.strategyId}:${event.signal.id}`;
    const data = event.signal.metadata?.niftyPaper;
    if (!data || typeof data !== "object") continue;
    const payload = data as Record<string, unknown>;
    if (payload.kind === "SIGNAL") {
      if (seen.has(key)) continue;
      seen.add(key);
      if ((!enabled && !position) || event.signal.symbol !== "NSE:NIFTY" || !["BUY", "SELL"].includes(event.signal.action)) continue;
      const opposite = position && ((position.contract.side === "CE" && event.signal.action === "SELL") || (position.contract.side === "PE" && event.signal.action === "BUY"));
      if (opposite) pendingExit = "OPPOSITE_SIGNAL";
      // An invalid opposite setup still closes the old position, but cannot create a new entry.
      setup = null;
      const interval = Number(event.signal.timeframe);
      const closedAt = String(payload.closedAt ?? "");
      if (!positive(payload.high) || !positive(payload.low) || payload.high < payload.low || payload.high - payload.low > 35
        || interval !== 1 || !Number.isFinite(Date.parse(closedAt))
        || Date.parse(closedAt) > Date.parse(event.receivedAt)) {
        status = "INVALID_SIGNAL_CANDLE"; continue;
      }
      if (enabled) setup = { id: event.signal.id, action: event.signal.action as "BUY" | "SELL", high: payload.high, low: payload.low, closedAt, intervalMinutes: interval, indexSymbol: event.signal.symbol };
      status = "WAITING_FOR_INDEX_BREAK";
      continue;
    }
    if (payload.kind !== "TICK") continue;
    const tick = readTick(payload);
    if (!tick || !fresh(tick.timestamp, event.receivedAt) || (lastTickAt && Date.parse(tick.timestamp) <= Date.parse(lastTickAt))) continue;
    lastTickAt = tick.timestamp;
    const completed15m = Boolean(tick.previous15m && positive(tick.previous15m.high) && positive(tick.previous15m.low)
      && tick.previous15m.high >= tick.previous15m.low && Date.parse(tick.previous15m.closedAt) <= Date.parse(tick.timestamp)
      && Date.parse(tick.timestamp) - Date.parse(tick.previous15m.closedAt) < 15 * 60000);
    const quotes = tick.contracts.filter(contract => validQuote(contract, tick));
    if (position) {
      const quote = quotes.find(contract => contract.id === position!.contract.id && contract.expiry === position!.contract.expiry && contract.side === position!.contract.side && contract.strike === position!.contract.strike);
      mark = quote?.bid ?? null;
      if (quote) {
        // Missing trail history blocks new entries, never premium or timed exits.
        let reason = dayIST(tick.timestamp) > dayIST(position.openedAt) ? "DELAYED_SESSION_EXIT" : pendingExit || niftyExit({ side: position.contract.side, entryPremium: position.entry, premium: quote.bid, index: tick.price, previous15m: completed15m ? tick.previous15m! : { high: Infinity, low: -Infinity }, oppositeSignal: false, minutesIST: minutesIST(tick.timestamp), premiumTargets: Boolean(position.targets) });
        let available = quote.bidSize ?? 0;
        const reached = !reason ? position.targets?.filter(target => {
          if (target.filled || quote.bid < target.price || available < target.quantity) return false;
          available -= target.quantity; return true;
        }) ?? [] : [];
        const exitQuantity = reason ? position.quantity : reached.reduce((sum, target) => sum + target.quantity, 0);
        if (!reason && reached.length) reason = reached.length > 1 || reached[0].price === position.entry * 2.5 ? "TARGET_2_5X" : "TARGET_2X";
        const enough = quote.bidSize === undefined ? !position.targets : Number.isFinite(quote.bidSize) && quote.bidSize >= exitQuantity;
        if (reason && exitQuantity > 0 && enough) {
          const pnl = (position.realizedPnl ?? 0) + (quote.bid - position.entry) * exitQuantity;
          const exitFills = [...(position.exitFills ?? []), { price: quote.bid, quantity: exitQuantity, at: tick.timestamp, reason }];
          if (exitQuantity < position.quantity) {
            reached.forEach(target => { target.filled = true; });
            position = { ...position, quantity: position.quantity - exitQuantity, lots: (position.quantity - exitQuantity) / position.contract.lotSize, realizedPnl: pnl, exitFills };
            status = "PARTIAL_TARGET_FILLED";
          } else {
            const quantity = position.initialQuantity ?? position.quantity;
            const exit = exitFills.reduce((sum, fill) => sum + fill.price * fill.quantity, 0) / quantity;
            trades.push({ ...position, lots: position.initialLots ?? position.lots, quantity, exit, exitFills, closedAt: tick.timestamp, reason, pnl });
            size = nextNiftySize(size, { points: pnl, stopLoss: reason === "PREMIUM_SL" });
            position = null; pendingExit = null; mark = null; status = enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
          }
        } else if (reason && !enough) status = "WAITING_FOR_EXIT_LIQUIDITY";
      } else status = "WAITING_FOR_POSITION_PREMIUM";
    }
    if (!completed15m && !position) status = "WAITING_FOR_COMPLETED_15M_CANDLE";
    if (!position && enabled && setup && completed15m) {
      const elapsed = Date.parse(tick.timestamp) - Date.parse(setup.closedAt);
      const candle = Math.floor(elapsed / (setup.intervalMinutes * 60000)) + 1;
      if (candle > 10 || dayIST(tick.timestamp) !== dayIST(setup.closedAt) || minutesIST(tick.timestamp) >= 895) { setup = null; status = "SETUP_EXPIRED"; }
      else if (elapsed >= 0 && previousTick && fresh(previousTick.timestamp, tick.timestamp)) {
        const side = niftyBreakout(setup, previousTick.price, tick.price, candle, minutesIST(tick.timestamp));
        if (side) {
          {
            const chain = quotes.filter(contract => contract.expiry === tick.nearestExpiry);
            // Quote freshness must not change the ATM reference or strike selection.
            const strikes = [...new Set(tick.contracts.filter(contract => contract.expiry === tick.nearestExpiry && positive(contract.strike)).map(contract => contract.strike))].sort((a, b) => a - b);
            const atm = strikes.reduce((best, strike) => Math.abs(strike - tick.price) < Math.abs(best - tick.price) ? strike : best, strikes[0]);
            const index = strikes.indexOf(atm) + (side === "CE" ? 1 : -1);
            const contract = chain.find(item => item.side === side && item.strike === strikes[index]);
            const quantity = contract ? size.lots * contract.lotSize : 0;
            const fill = contract && tick.executionVersion === 2 ? niftyEntryFill(contract.ask, quantity,
              contract.asks && contract.depthAt && fresh(contract.depthAt, tick.timestamp) ? contract.asks :
              Number.isSafeInteger(contract.askSize) && contract.askSize! > 0 ? [{ price: contract.ask, quantity: contract.askSize! }] : []) : null;
            if (contract && (tick.executionVersion === 2 ? Boolean(fill) : contract.askSize === undefined || (Number.isFinite(contract.askSize) && contract.askSize >= quantity))) {
              const entry = fill?.price ?? contract.ask;
              position = { contract, lots: size.lots, quantity, entry, openedAt: tick.timestamp, signalId: setup.id, indexSymbol: tick.indexSymbol,
                ...(fill ? { targets: niftyTargets(entry, size.lots, contract.lotSize), initialLots: size.lots, initialQuantity: quantity, entryFill: fill } : {}) };
              mark = contract.bid; setup = null; status = "OPEN";
            } else { status = contract ? "ENTRY_SKIPPED_INSUFFICIENT_DEPTH_WITHIN_4_POINTS" : "MISSING_NEAREST_EXPIRY_OTM_CONTRACT"; setup = null; }
          }
        }
      }
    }
    previousTick = tick;
  }
  const lastTrailClose = previousTick?.previous15m?.closedAt;
  if (status === "WAITING_FOR_COMPLETED_15M_CANDLE" && lastTrailClose && Date.parse(now) >= Date.parse(lastTrailClose) && Date.parse(now) - Date.parse(lastTrailClose) < 15 * 60000) {
    status = setup ? "WAITING_FOR_INDEX_BREAK" : enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
  }
  // Display checkpoints refresh every five seconds; execution still uses fresh()'s five-second limit.
  const age = lastTickAt ? Date.parse(now) - Date.parse(lastTickAt) : NaN;
  const stale = !Number.isFinite(age) || age < 0 || age > 15000;
  if (position && (dayIST(now) > dayIST(position.openedAt) || minutesIST(now) >= 895)) pendingExit = pendingExit || "TIME_EXIT_AWAITING_VERIFIED_QUOTE";
  const realizedBase = saved?.realizedBase ?? 0, tradeCountBase = saved?.tradeCountBase ?? 0;
  const realized = realizedBase + trades.reduce((sum, trade) => sum + trade.pnl, 0) + (position?.realizedPnl ?? 0);
  return { enabled, status, position, setup, size, trades, mark, lastTickAt, stale, pendingExit, realized,
    tradeCount: tradeCountBase + trades.length,
    checkpoint: { enabled, setup, position, previousTick, size, pendingExit, status, lastTickAt, mark, trades, seen: [...seen], realizedBase, tradeCountBase } satisfies NiftyPaperCheckpoint,
    unrealized: position && mark !== null ? (mark - position.entry) * position.quantity : null,
    stopDistance: position ? premiumStopDistance(position.entry) : null };
}
