import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TradingViewAction = "BUY" | "SELL" | "EXIT" | "CLOSE_LONG" | "CLOSE_SHORT";

type TradingViewWebhookPayload = {
  secret?: string;
  strategyId?: string;
  strategyVersionId?: string;
  signalId?: string;
  symbol?: string;
  timeframe?: string;
  action?: TradingViewAction;
  timestamp?: string;
  price?: number;
  quantity?: number;
  strike?: number;
  optionType?: "CE" | "PE";
  expiry?: string;
  underlying?: string;
  stopLoss?: number;
  target?: number;
  confidence?: number;
  indicatorValue?: number;
  alertName?: string;
  metadata?: Record<string, unknown>;
};

type NormalizedSignal = {
  id: string;
  strategyId: string;
  strategyVersionId?: string;
  source: "TRADINGVIEW";
  symbol: string;
  action: TradingViewAction;
  timestamp: string;
  price?: number;
  timeframe?: string;
  quantity?: number;
  metadata: Record<string, unknown>;
  status: "RECEIVED" | "VALIDATED" | "REJECTED" | "EXECUTED" | "IGNORED";
  createdAt: string;
};

const seenSignals = new Map<string, number>();
const MAX_SIGNAL_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 5000;
const VALID_ACTIONS = new Set(["BUY", "SELL", "EXIT", "CLOSE_LONG", "CLOSE_SHORT"]);

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function cleanupSeenSignals(now: number) {
  for (const [key, createdAt] of seenSignals.entries()) {
    if (now - createdAt > MAX_SIGNAL_AGE_MS) seenSignals.delete(key);
  }
  if (seenSignals.size <= MAX_CACHE_SIZE) return;
  const overflow = seenSignals.size - MAX_CACHE_SIZE;
  let removed = 0;
  for (const key of seenSignals.keys()) {
    seenSignals.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function verifySignature(request: Request, rawBody: string) {
  const hmacSecret = process.env.TRADINGVIEW_WEBHOOK_HMAC_SECRET;
  if (!hmacSecret) return { ok: true };

  const signature =
    request.headers.get("x-tradingos-signature") ??
    request.headers.get("x-tradingview-signature") ??
    "";

  if (!signature) {
    return { ok: false, error: "Missing webhook signature." };
  }

  const expected = createHmac("sha256", hmacSecret).update(rawBody).digest("hex");
  const normalized = signature.replace(/^sha256=/i, "");
  if (!safeEqual(normalized, expected)) {
    return { ok: false, error: "Invalid webhook signature." };
  }

  return { ok: true };
}

function validatePayload(payload: TradingViewWebhookPayload) {
  const errors: string[] = [];
  if (!payload.strategyId?.trim()) errors.push("strategyId is required");
  if (!payload.signalId?.trim()) errors.push("signalId is required");
  if (!payload.symbol?.trim()) errors.push("symbol is required");
  if (!payload.action || !VALID_ACTIONS.has(payload.action)) {
    errors.push("action must be BUY, SELL, EXIT, CLOSE_LONG or CLOSE_SHORT");
  }
  if (!payload.timestamp) errors.push("timestamp is required");

  const timestampMs = payload.timestamp ? Date.parse(payload.timestamp) : Number.NaN;
  if (payload.timestamp && !Number.isFinite(timestampMs)) {
    errors.push("timestamp must be an ISO date string");
  }

  if (typeof payload.price !== "undefined" && (!Number.isFinite(payload.price) || payload.price <= 0)) {
    errors.push("price must be a positive number");
  }
  if (typeof payload.quantity !== "undefined" && (!Number.isFinite(payload.quantity) || payload.quantity <= 0)) {
    errors.push("quantity must be a positive number");
  }

  return { errors, timestampMs };
}

function normalizeSignal(payload: TradingViewWebhookPayload): NormalizedSignal {
  return {
    id: payload.signalId ?? "",
    strategyId: payload.strategyId ?? "",
    strategyVersionId: payload.strategyVersionId,
    source: "TRADINGVIEW",
    symbol: payload.symbol ?? "",
    action: payload.action as TradingViewAction,
    timestamp: new Date(payload.timestamp ?? Date.now()).toISOString(),
    price: payload.price,
    timeframe: payload.timeframe,
    quantity: payload.quantity,
    metadata: {
      ...(payload.metadata ?? {}),
      strike: payload.strike,
      optionType: payload.optionType,
      expiry: payload.expiry,
      underlying: payload.underlying,
      stopLoss: payload.stopLoss,
      target: payload.target,
      confidence: payload.confidence,
      indicatorValue: payload.indicatorValue,
      alertName: payload.alertName
    },
    status: "VALIDATED",
    createdAt: new Date().toISOString()
  };
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  let rawBody = "";

  try {
    rawBody = await request.text();
    const signature = await verifySignature(request, rawBody);
    if (!signature.ok) return jsonError(signature.error ?? "Invalid signature.", 401);

    let payload: TradingViewWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as TradingViewWebhookPayload;
    } catch {
      return jsonError("Invalid JSON payload.");
    }

    const configuredSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
    if (configuredSecret && !safeEqual(String(payload.secret ?? ""), configuredSecret)) {
      return jsonError("Invalid webhook secret.", 401);
    }
    if (!configuredSecret && !payload.secret) {
      return jsonError("Webhook secret is required. Configure TRADINGVIEW_WEBHOOK_SECRET for production.", 401);
    }

    const { errors, timestampMs } = validatePayload(payload);
    if (errors.length) return jsonError("Webhook validation failed.", 422, errors);

    const skewMs = Math.abs(receivedAt - timestampMs);
    if (skewMs > MAX_SIGNAL_AGE_MS) {
      return jsonError("Webhook timestamp is outside the allowed replay window.", 422);
    }

    cleanupSeenSignals(receivedAt);
    const dedupeKey = `${payload.strategyId}:${payload.signalId}`;
    if (seenSignals.has(dedupeKey)) {
      return NextResponse.json(
        {
          status: "IGNORED",
          reason: "Duplicate signal.",
          signalId: payload.signalId
        },
        { status: 202 }
      );
    }
    seenSignals.set(dedupeKey, receivedAt);

    const signal = normalizeSignal(payload);

    // Production next step: persist WebhookEvent + Signal, enqueue risk/execution processing,
    // and return quickly so TradingView does not timeout.
    return NextResponse.json(
      {
        status: "ACCEPTED",
        signal,
        queued: false,
        nextStep: "Persist event and enqueue Signal -> Risk Engine -> Execution Engine."
      },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TradingView webhook failed." },
      { status: 500 }
    );
  }
}
