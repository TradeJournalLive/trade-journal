import type { Trade } from "../data/trades";

export type BrokerName = "FYERS" | "ZERODHA";

export type BrokerConnection = {
  id: string;
  brokerName: BrokerName;
  label: string;
  apiKey: string;
  accessToken: string;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrokerImportBatch = {
  id: string;
  brokerAccountId: string;
  brokerName: BrokerName;
  startedAt: string;
  importedCount: number;
  notes?: string;
};

export type BrokerImportedTradeRecord = {
  id: string;
  brokerAccountId: string;
  brokerName: BrokerName;
  batchId?: string;
  externalRef: string;
  brokerTradeId?: string;
  brokerOrderId?: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  executedAt: string;
  rawPayload: unknown;
  importedToTradeId?: string;
};

export type BrokerPreviewTrade = {
  id: string;
  brokerAccountId: string;
  brokerName: BrokerName;
  externalRef: string;
  brokerTradeId?: string;
  brokerOrderId?: string;
  symbol: string;
  inferredInstrument: string;
  market: string;
  direction: Trade["direction"];
  quantity: number;
  lots: number | null;
  lotSize: number | null;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  date: string;
  platform: string;
  notes: string;
  rawPayload: unknown;
};

type BrokerExecution = {
  brokerTradeId?: string;
  brokerOrderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executedAt: string;
  product?: string;
  rawPayload: unknown;
};

type InstrumentLike = {
  id: string;
  name: string;
  lotSize: number;
};

export function buildBrokerConnectionId(name: BrokerName, label: string) {
  const slug = `${name}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "broker";
  return `BRK-${slug}-${Date.now()}`;
}

export function buildBrokerBatchId(name: BrokerName) {
  return `BATCH-${name}-${Date.now()}`;
}

function normalizeDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function normalizeTime(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(11, 16);
  }
  const match = String(value).match(/(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function normalizeTimestamp(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const custom = String(value).replace(" ", "T");
  const reparsed = new Date(custom);
  if (!Number.isNaN(reparsed.getTime())) return reparsed.toISOString();
  return "";
}

function inferInstrument(symbol: string, instruments: InstrumentLike[]) {
  const upper = symbol.toUpperCase();
  const match = instruments.find((item) =>
    upper.includes(item.name.toUpperCase().replace(/\./g, ""))
  );
  if (match) return match;
  if (upper.includes("BANKNIFTY") || upper.includes("BNIFTY")) {
    return (
      instruments.find((item) => item.name.toLowerCase().includes("b.nifty")) ??
      instruments.find((item) => item.name.toLowerCase().includes("bank")) ??
      null
    );
  }
  if (upper.includes("SENSEX")) {
    return instruments.find((item) => item.name.toLowerCase().includes("sensex")) ?? null;
  }
  if (upper.includes("NIFTY")) {
    return instruments.find((item) => item.name.toLowerCase().includes("nifty")) ?? null;
  }
  return null;
}

function inferDirection(symbol: string): Trade["direction"] {
  const upper = symbol.toUpperCase();
  if (upper.includes("PE")) return "Short";
  return "Long";
}

function pushIfValid(executions: BrokerExecution[], execution: Partial<BrokerExecution>) {
  const quantity = Number(execution.quantity ?? 0);
  const price = Number(execution.price ?? 0);
  const executedAt = normalizeTimestamp(execution.executedAt);
  if (!execution.symbol || !execution.side || !quantity || !price || !executedAt) return;
  executions.push({
    brokerTradeId: execution.brokerTradeId,
    brokerOrderId: execution.brokerOrderId,
    symbol: execution.symbol,
    side: execution.side,
    quantity,
    price,
    executedAt,
    product: execution.product,
    rawPayload: execution.rawPayload
  });
}

function parseFyersExecutions(payload: unknown): BrokerExecution[] {
  const root = payload as Record<string, unknown>;
  const data = Array.isArray(root.tradeBook)
    ? root.tradeBook
    : Array.isArray(root.tradebook)
      ? root.tradebook
      : Array.isArray(root.orderBook)
        ? root.orderBook
        : Array.isArray(root.orderbook)
          ? root.orderbook
          : Array.isArray(root.data)
            ? root.data
            : [];
  const executions: BrokerExecution[] = [];
  for (const item of data as Record<string, unknown>[]) {
    const sideValue = String(item.side ?? item.transactionType ?? item.transaction_type ?? "").toUpperCase();
    const side = sideValue === "-1" || sideValue === "SELL" ? "SELL" : sideValue === "1" || sideValue === "BUY" ? "BUY" : "";
    pushIfValid(executions, {
      brokerTradeId: item.tradeId ? String(item.tradeId) : item.id ? String(item.id) : undefined,
      brokerOrderId: item.orderNumber ? String(item.orderNumber) : item.orderId ? String(item.orderId) : undefined,
      symbol: item.symbol ? String(item.symbol) : item.tradingsymbol ? String(item.tradingsymbol) : "",
      side: side as "BUY" | "SELL",
      quantity: Number(item.qty ?? item.filledQty ?? item.quantity ?? 0),
      price: Number(item.tradedPrice ?? item.tradePrice ?? item.avgPrice ?? item.average_price ?? item.price ?? 0),
      executedAt: String(item.orderDateTime ?? item.tradeTime ?? item.updatedOn ?? item.orderTime ?? item.fill_timestamp ?? ""),
      product: item.productType ? String(item.productType) : item.product ? String(item.product) : undefined,
      rawPayload: item
    });
  }
  return executions;
}

function parseZerodhaExecutions(payload: unknown): BrokerExecution[] {
  const root = payload as Record<string, unknown>;
  const data = Array.isArray(root.data) ? root.data : [];
  const executions: BrokerExecution[] = [];
  for (const item of data as Record<string, unknown>[]) {
    const sideValue = String(item.transaction_type ?? item.side ?? "").toUpperCase();
    const side = sideValue === "SELL" ? "SELL" : sideValue === "BUY" ? "BUY" : "";
    pushIfValid(executions, {
      brokerTradeId: item.trade_id ? String(item.trade_id) : undefined,
      brokerOrderId: item.order_id ? String(item.order_id) : undefined,
      symbol: item.tradingsymbol ? String(item.tradingsymbol) : "",
      side: side as "BUY" | "SELL",
      quantity: Number(item.quantity ?? item.filled_quantity ?? 0),
      price: Number(item.average_price ?? item.fill_price ?? item.price ?? 0),
      executedAt: String(item.fill_timestamp ?? item.exchange_timestamp ?? item.order_timestamp ?? ""),
      product: item.product ? String(item.product) : undefined,
      rawPayload: item
    });
  }
  return executions;
}

export function normalizeBrokerPayloadToPreviewTrades(
  brokerName: BrokerName,
  payload: unknown,
  brokerAccountId: string,
  instruments: InstrumentLike[]
): BrokerPreviewTrade[] {
  const executions = brokerName === "ZERODHA"
    ? parseZerodhaExecutions(payload)
    : parseFyersExecutions(payload);

  const grouped = new Map<string, BrokerExecution[]>();
  executions
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())
    .forEach((execution) => {
      const key = `${execution.symbol}::${normalizeDate(execution.executedAt)}`;
      const current = grouped.get(key) ?? [];
      current.push(execution);
      grouped.set(key, current);
    });

  const previews: BrokerPreviewTrade[] = [];

  grouped.forEach((items) => {
    const openBuys: BrokerExecution[] = [];
    items.forEach((execution) => {
      if (execution.side === "BUY") {
        openBuys.push(execution);
        return;
      }
      const entry = openBuys.find((buy) => buy.quantity === execution.quantity) ?? openBuys[0];
      if (!entry) return;
      const instrument = inferInstrument(execution.symbol, instruments);
      const lotSize = instrument?.lotSize ?? null;
      const lots = lotSize && lotSize > 0 ? execution.quantity / lotSize : null;
      const date = normalizeDate(entry.executedAt) || normalizeDate(execution.executedAt);
      const entryTime = normalizeTime(entry.executedAt);
      const exitTime = normalizeTime(execution.executedAt);
      const externalRef = [
        brokerName,
        execution.symbol,
        date,
        entryTime,
        exitTime,
        entry.price,
        execution.price,
        execution.quantity
      ].join("|");

      previews.push({
        id: externalRef,
        brokerAccountId,
        brokerName,
        externalRef,
        brokerTradeId: execution.brokerTradeId ?? entry.brokerTradeId,
        brokerOrderId: execution.brokerOrderId ?? entry.brokerOrderId,
        symbol: execution.symbol,
        inferredInstrument: instrument?.name ?? execution.symbol,
        market: execution.symbol.toUpperCase().includes("NIFTY") || execution.symbol.toUpperCase().includes("SENSEX") ? "F&O" : "Equity",
        direction: inferDirection(execution.symbol),
        quantity: execution.quantity,
        lots: lots && Number.isFinite(lots) ? Number(lots.toFixed(2)) : null,
        lotSize,
        entryPrice: entry.price,
        exitPrice: execution.price,
        entryTime,
        exitTime,
        date,
        platform: brokerName,
        notes: `Imported from ${brokerName}`,
        rawPayload: {
          entry: entry.rawPayload,
          exit: execution.rawPayload
        }
      });
      const index = openBuys.indexOf(entry);
      if (index >= 0) openBuys.splice(index, 1);
    });
  });

  return previews.sort((a, b) => {
    const aTs = new Date(`${a.date}T${a.exitTime || a.entryTime || "00:00"}`).getTime();
    const bTs = new Date(`${b.date}T${b.exitTime || b.entryTime || "00:00"}`).getTime();
    return bTs - aTs;
  });
}
