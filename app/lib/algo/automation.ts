export type AlgoAction = "BUY" | "SELL" | "EXIT" | "CLOSE_LONG" | "CLOSE_SHORT";

export type AlgoSignal = {
  id: string;
  strategyId: string;
  strategyVersionId?: string;
  source: "TRADINGVIEW";
  symbol: string;
  action: AlgoAction;
  timestamp: string;
  price?: number;
  timeframe?: string;
  quantity?: number;
  metadata: Record<string, unknown>;
  status: "RECEIVED" | "VALIDATED" | "REJECTED" | "EXECUTED" | "IGNORED";
  createdAt: string;
};

export type AlgoAutomationPayload = {
  enabled?: boolean;
  mode?: "PAPER" | "LIVE";
  underlying?: "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "SENSEX";
  optionDepth?: 1 | 2;
  maxTradesPerDay?: number;
  cutoffTime?: string;
  stopLoss?: number;
  target?: number;
  productType?: "INTRADAY" | "CNC" | "MARGIN";
  orderType?: "MARKET" | "LIMIT";
};

export type AlgoDecision = {
  accepted: boolean;
  executionMode: "PAPER" | "LIVE" | "BLOCKED";
  stage: "SIGNAL_RECEIVED" | "CONDITIONS_FAILED" | "READY_FOR_PAPER" | "READY_FOR_LIVE" | "EXIT_SIGNAL";
  reasons: string[];
  checks: { label: string; ok: boolean; message: string }[];
  optionIntent?: {
    underlying: string;
    side: "CE" | "PE";
    depth: 1 | 2;
    selection: "ITM";
    source: "OPTION_CHAIN_REQUIRED";
  };
  orderPlan?: {
    action: "ENTER" | "EXIT";
    productType: string;
    orderType: string;
    quantityLots: number;
    stopLoss?: number;
    target?: number;
    cutoffTime: string;
  };
};

export type StoredAlgoEvent = {
  receivedAt: string;
  signal: AlgoSignal;
  decision: AlgoDecision;
};

const signalEvents: StoredAlgoEvent[] = [];
const MAX_EVENTS = 200;

function getIstParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
}

function isBeforeCutoff(timestamp: string, cutoffTime: string) {
  const [cutoffHour, cutoffMinute] = cutoffTime.split(":").map(Number);
  const { hour, minute } = getIstParts(new Date(timestamp));
  return hour < cutoffHour || (hour === cutoffHour && minute < cutoffMinute);
}

function normalizeUnderlying(signal: AlgoSignal, automation: AlgoAutomationPayload) {
  const fromAutomation = automation.underlying;
  const fromMetadata = typeof signal.metadata.underlying === "string" ? signal.metadata.underlying.toUpperCase() : "";
  const fromSymbol = signal.symbol.toUpperCase();
  if (fromAutomation) return fromAutomation;
  if (fromMetadata.includes("BANK")) return "BANKNIFTY";
  if (fromMetadata.includes("FIN")) return "FINNIFTY";
  if (fromMetadata.includes("SENSEX")) return "SENSEX";
  if (fromSymbol.includes("BANK")) return "BANKNIFTY";
  if (fromSymbol.includes("FIN")) return "FINNIFTY";
  if (fromSymbol.includes("SENSEX")) return "SENSEX";
  return "NIFTY";
}

function getOptionSide(action: AlgoAction) {
  if (action === "BUY") return "CE";
  if (action === "SELL") return "PE";
  return null;
}

export function evaluateAlgoSignal(signal: AlgoSignal, automation: AlgoAutomationPayload = {}): AlgoDecision {
  const enabled = automation.enabled !== false;
  const cutoffTime = automation.cutoffTime || "15:00";
  const mode = automation.mode === "LIVE" ? "LIVE" : "PAPER";
  const reasons: string[] = [];
  const checks: AlgoDecision["checks"] = [];
  const isExit = signal.action === "EXIT" || signal.action === "CLOSE_LONG" || signal.action === "CLOSE_SHORT";

  checks.push({ label: "Automation enabled", ok: enabled, message: enabled ? "Enabled" : "Disabled" });
  checks.push({ label: "Before cutoff", ok: isBeforeCutoff(signal.timestamp, cutoffTime) || isExit, message: `Cutoff ${cutoffTime} IST` });
  checks.push({ label: "Unique signal", ok: Boolean(signal.id), message: signal.id ? signal.id : "Missing signal ID" });
  checks.push({ label: "Action supported", ok: Boolean(getOptionSide(signal.action) || isExit), message: signal.action });

  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    reasons.push(...failed.map((check) => `${check.label}: ${check.message}`));
    return { accepted: false, executionMode: "BLOCKED", stage: "CONDITIONS_FAILED", reasons, checks };
  }

  if (isExit) {
    return {
      accepted: true,
      executionMode: mode,
      stage: "EXIT_SIGNAL",
      reasons: ["Exit signal accepted. Open-position lookup is required before sending broker exit order."],
      checks,
      orderPlan: {
        action: "EXIT",
        productType: automation.productType || "INTRADAY",
        orderType: automation.orderType || "MARKET",
        quantityLots: signal.quantity || 1,
        cutoffTime
      }
    };
  }

  const optionSide = getOptionSide(signal.action);
  const underlying = normalizeUnderlying(signal, automation);
  const optionDepth = automation.optionDepth === 2 ? 2 : 1;

  return {
    accepted: true,
    executionMode: mode,
    stage: mode === "LIVE" ? "READY_FOR_LIVE" : "READY_FOR_PAPER",
    reasons: ["Signal passed automation checks. Option chain selector must resolve the exact 1-2 ITM contract before execution."],
    checks,
    optionIntent: optionSide ? {
      underlying,
      side: optionSide,
      depth: optionDepth,
      selection: "ITM",
      source: "OPTION_CHAIN_REQUIRED"
    } : undefined,
    orderPlan: {
      action: "ENTER",
      productType: automation.productType || "INTRADAY",
      orderType: automation.orderType || "MARKET",
      quantityLots: signal.quantity || 1,
      stopLoss: automation.stopLoss || (typeof signal.metadata.stopLoss === "number" ? signal.metadata.stopLoss : undefined),
      target: automation.target || (typeof signal.metadata.target === "number" ? signal.metadata.target : undefined),
      cutoffTime
    }
  };
}

export function recordAlgoEvent(event: StoredAlgoEvent) {
  signalEvents.unshift(event);
  if (signalEvents.length > MAX_EVENTS) signalEvents.length = MAX_EVENTS;
}

export function listAlgoEvents() {
  return signalEvents;
}
