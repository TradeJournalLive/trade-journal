import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

type DhanOrderTicket = {
  exchangeSegment?: string;
  productType?: string;
  orderType?: string;
  transactionType?: string;
  validity?: string;
  securityId?: string;
  quantity?: string;
  price?: string;
  triggerPrice?: string;
  disclosedQuantity?: string;
  afterMarketOrder?: boolean;
};

type DhanOrderPayload = {
  clientId?: string;
  accessToken?: string;
  ticket?: DhanOrderTicket;
  dryRun?: boolean;
  liveConfirm?: string;
};

const allowed = {
  exchangeSegment: new Set(["NSE_EQ", "NSE_FNO", "BSE_EQ", "BSE_FNO", "MCX_COMM"]),
  productType: new Set(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]),
  orderType: new Set(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"]),
  transactionType: new Set(["BUY", "SELL"]),
  validity: new Set(["DAY", "IOC"])
};

function asNumber(value: string | undefined, fallback = 0) {
  if (!value?.trim()) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function buildOrder(clientId: string, ticket: DhanOrderTicket) {
  const quantity = asNumber(ticket.quantity);
  const price = asNumber(ticket.price);
  const triggerPrice = asNumber(ticket.triggerPrice);
  const disclosedQuantity = asNumber(ticket.disclosedQuantity);
  const correlationId = `tj${Date.now().toString(36)}`.slice(0, 30);

  const payload = {
    dhanClientId: clientId,
    correlationId,
    transactionType: ticket.transactionType,
    exchangeSegment: ticket.exchangeSegment,
    productType: ticket.productType,
    orderType: ticket.orderType,
    validity: ticket.validity,
    securityId: ticket.securityId?.trim(),
    quantity: String(quantity),
    disclosedQuantity: disclosedQuantity > 0 ? String(disclosedQuantity) : "",
    price: price > 0 ? String(price) : "",
    triggerPrice: triggerPrice > 0 ? String(triggerPrice) : "",
    afterMarketOrder: Boolean(ticket.afterMarketOrder),
    amoTime: "",
    boProfitValue: "",
    boStopLossValue: ""
  };

  return { payload, correlationId, quantity, price, triggerPrice, disclosedQuantity };
}

function validateTicket(ticket: DhanOrderTicket | undefined, clientId: string) {
  const checks: { label: string; ok: boolean; message: string }[] = [];
  const warnings: string[] = [];

  if (!ticket) {
    checks.push({ label: "Order ticket", ok: false, message: "Missing order ticket." });
    return { checks, warnings, payload: null, correlationId: "", estimatedValue: 0 };
  }

  const built = buildOrder(clientId, ticket);
  const { quantity, price, triggerPrice, disclosedQuantity, payload, correlationId } = built;

  checks.push({ label: "Security ID", ok: Boolean(ticket.securityId?.trim()), message: "Security ID is required." });
  checks.push({ label: "Quantity", ok: Number.isInteger(quantity) && quantity > 0, message: "Quantity must be a positive whole number." });
  checks.push({ label: "Exchange", ok: allowed.exchangeSegment.has(String(ticket.exchangeSegment)), message: "Unsupported exchange segment." });
  checks.push({ label: "Product", ok: allowed.productType.has(String(ticket.productType)), message: "Unsupported product type." });
  checks.push({ label: "Side", ok: allowed.transactionType.has(String(ticket.transactionType)), message: "Side must be BUY or SELL." });
  checks.push({ label: "Order type", ok: allowed.orderType.has(String(ticket.orderType)), message: "Unsupported order type." });
  checks.push({ label: "Validity", ok: allowed.validity.has(String(ticket.validity)), message: "Unsupported validity." });

  if (ticket.orderType === "LIMIT" || ticket.orderType === "STOP_LOSS") {
    checks.push({ label: "Price", ok: price > 0, message: "Limit and stop-loss limit orders need a price." });
  } else {
    checks.push({ label: "Price", ok: true, message: "Market order does not require a price." });
  }

  if (ticket.orderType === "STOP_LOSS" || ticket.orderType === "STOP_LOSS_MARKET") {
    checks.push({ label: "Trigger price", ok: triggerPrice > 0, message: "Stop-loss orders need a trigger price." });
  } else {
    checks.push({ label: "Trigger price", ok: true, message: "Trigger price not required." });
  }

  if (disclosedQuantity > 0 && disclosedQuantity < Math.ceil(quantity * 0.3)) {
    warnings.push("Dhan recommends disclosed quantity above 30% of total quantity.");
  }
  if (ticket.orderType === "MARKET") {
    warnings.push("Market orders can fill at a different price than expected. Start with the smallest test quantity.");
  }
  if (ticket.exchangeSegment?.includes("FNO")) {
    warnings.push("For F&O, quantity must match the contract lot size and security ID must be the exact option/future contract.");
  }

  const estimatedValue = price > 0 && quantity > 0 ? price * quantity : 0;
  return { checks, warnings, payload, correlationId, estimatedValue };
}

function compactError(value: unknown) {
  if (!value) return "Dhan returned an empty error response.";
  if (typeof value === "string") return value.slice(0, 240);
  if (typeof value === "object" && "message" in value) return String((value as { message?: unknown }).message).slice(0, 240);
  if (typeof value === "object" && "errorMessage" in value) return String((value as { errorMessage?: unknown }).errorMessage).slice(0, 240);
  return "Dhan rejected the order request.";
}

export async function POST(request: Request) {
  let body: DhanOrderPayload;

  try {
    body = (await request.json()) as DhanOrderPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const clientId = body.clientId?.trim();
  const accessToken = body.accessToken?.trim();

  if (!clientId || !accessToken) {
    return NextResponse.json({ ok: false, error: "Dhan client ID and access token are required." }, { status: 400 });
  }

  const preview = validateTicket(body.ticket, clientId);
  const ok = preview.checks.every((check) => check.ok);

  if (body.dryRun !== false) {
    return NextResponse.json({ ok, ...preview, error: ok ? undefined : "Fix failed checks before live placement." }, { status: ok ? 200 : 400 });
  }

  if (!ok || !preview.payload) {
    return NextResponse.json({ ok: false, ...preview, error: "Live order blocked because dry-run validation failed." }, { status: 400 });
  }

  if (body.liveConfirm !== "PLACE LIVE ORDER") {
    return NextResponse.json({ ok: false, error: "Live confirmation phrase is required." }, { status: 403 });
  }

  const response = await fetch(`${DHAN_BASE_URL}/orders`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId
    },
    body: JSON.stringify(preview.payload),
    cache: "no-store"
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      { ok: false, request: preview.payload, response: data, error: compactError(data) },
      { status: response.status }
    );
  }

  return NextResponse.json({ ok: true, request: preview.payload, response: data });
}
