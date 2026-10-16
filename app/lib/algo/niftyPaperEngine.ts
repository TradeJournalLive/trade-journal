import type { PaperEvent } from "./paperEngine";
import { nextNiftySize, niftyBreakout, niftyExit, premiumStopDistance, type NiftySetup } from "./niftyRules";

type Contract = { id: string; expiry: string; strike: number; side: "CE" | "PE"; lotSize: number; bid: number; ask: number; timestamp: string; bidSize?: number; askSize?: number };
type Setup = NiftySetup & { id: string; closedAt: string; intervalMinutes: number; indexSymbol: string };
type Position = { contract: Contract; lots: number; quantity: number; entry: number; openedAt: string; signalId: string; indexSymbol: string };
type Trade = Position & { exit: number; closedAt: string; reason: string; pnl: number };
type Tick = { indexSymbol: string; timestamp: string; price: number; nearestExpiry: string; chainComplete: boolean; previous15m?: { high: number; low: number; closedAt: string }; contracts: Contract[] };
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
        || Date.parse(closedAt) > Date.parse(event.receivedAt) || Date.parse(event.receivedAt) - Date.parse(closedAt) > 5000) {
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
      if (quote && (quote.bidSize === undefined || (Number.isFinite(quote.bidSize) && quote.bidSize >= position.quantity))) {
        // Missing trail history blocks new entries, never premium or timed exits.
        const reason = dayIST(tick.timestamp) > dayIST(position.openedAt) ? "DELAYED_SESSION_EXIT" : pendingExit || niftyExit({ side: position.contract.side, entryPremium: position.entry, premium: quote.bid, index: tick.price, previous15m: completed15m ? tick.previous15m! : { high: Infinity, low: -Infinity }, oppositeSignal: false, minutesIST: minutesIST(tick.timestamp) });
        if (reason) {
          const pnl = (quote.bid - position.entry) * position.quantity;
          trades.push({ ...position, exit: quote.bid, closedAt: tick.timestamp, reason, pnl });
          size = nextNiftySize(size, { points: pnl, stopLoss: reason === "PREMIUM_SL" });
          position = null; pendingExit = null; mark = null; status = enabled ? "WAITING_FOR_SIGNAL" : "DISABLED";
        }
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
            if (contract && (contract.askSize === undefined || (Number.isFinite(contract.askSize) && contract.askSize >= size.lots * contract.lotSize))) {
              position = { contract, lots: size.lots, quantity: size.lots * contract.lotSize, entry: contract.ask, openedAt: tick.timestamp, signalId: setup.id, indexSymbol: tick.indexSymbol };
              mark = contract.bid; setup = null; status = "OPEN";
            } else { status = "MISSING_NEAREST_EXPIRY_OTM_CONTRACT"; setup = null; }
          }
        }
      }
    }
    previousTick = tick;
  }
  const stale = !lastTickAt || Date.parse(now) - Date.parse(lastTickAt) > 5000;
  if (position && (dayIST(now) > dayIST(position.openedAt) || minutesIST(now) >= 895)) pendingExit = pendingExit || "TIME_EXIT_AWAITING_VERIFIED_QUOTE";
  const realizedBase = saved?.realizedBase ?? 0, tradeCountBase = saved?.tradeCountBase ?? 0;
  const realized = realizedBase + trades.reduce((sum, trade) => sum + trade.pnl, 0);
  return { enabled, status, position, setup, size, trades, mark, lastTickAt, stale, pendingExit, realized,
    tradeCount: tradeCountBase + trades.length,
    checkpoint: { enabled, setup, position, previousTick, size, pendingExit, status, lastTickAt, mark, trades, seen: [...seen], realizedBase, tradeCountBase } satisfies NiftyPaperCheckpoint,
    unrealized: position && mark !== null ? (mark - position.entry) * position.quantity : null,
    stopDistance: position ? premiumStopDistance(position.entry) : null };
}
