import { NextResponse } from "next/server";
import type { BrokerName } from "../../../lib/brokers";
import { normalizeBrokerPayloadToPreviewTrades } from "../../../lib/brokers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstrumentDefinition = {
  id: string;
  name: string;
  lotSize: number;
};

type RequestPayload = {
  brokerName: BrokerName;
  brokerAccountId: string;
  apiKey?: string;
  accessToken?: string;
  clientId?: string;
  fromDate?: string;
  toDate?: string;
  instruments?: InstrumentDefinition[];
};

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store"
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as Record<string, unknown>).message)
        : typeof data === "object" && data && "error" in data
          ? String((data as Record<string, unknown>).error)
          : text || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function syncZerodha(payload: RequestPayload) {
  if (!payload.apiKey || !payload.accessToken) {
    throw new Error("Zerodha needs API key and access token.");
  }

  const headers = {
    "X-Kite-Version": "3",
    Authorization: `token ${payload.apiKey}:${payload.accessToken}`
  };

  const [trades, orders] = await Promise.allSettled([
    fetchJson("https://api.kite.trade/trades", { headers }),
    fetchJson("https://api.kite.trade/orders", { headers })
  ]);

  const payloadData =
    trades.status === "fulfilled"
      ? trades.value
      : orders.status === "fulfilled"
        ? orders.value
        : null;

  if (!payloadData) {
    const tradeError = trades.status === "rejected" ? trades.reason : null;
    const orderError = orders.status === "rejected" ? orders.reason : null;
    throw new Error(
      `Zerodha sync failed. ${tradeError instanceof Error ? tradeError.message : ""} ${orderError instanceof Error ? orderError.message : ""}`.trim()
    );
  }

  return payloadData;
}

async function syncFyers(payload: RequestPayload) {
  const clientId = payload.clientId || payload.apiKey;
  if (!clientId || !payload.accessToken) {
    throw new Error("FYERS needs client ID/app ID and access token.");
  }

  const authVariants = [
    `${clientId}:${payload.accessToken}`,
    `Bearer ${clientId}:${payload.accessToken}`,
    `Bearer ${payload.accessToken}`
  ];
  const urls = [
    "https://api-t1.fyers.in/api/v3/tradebook",
    "https://api-t1.fyers.in/api/v3/orderbook"
  ];

  let lastError = "";
  for (const authorization of authVariants) {
    for (const url of urls) {
      try {
        const data = await fetchJson(url, {
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json"
          }
        });
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "FYERS sync failed.";
      }
    }
  }

  throw new Error(lastError || "FYERS sync failed.");
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RequestPayload;
    if (!payload.brokerName || !payload.brokerAccountId) {
      return NextResponse.json({ error: "Missing broker details." }, { status: 400 });
    }

    const instruments = Array.isArray(payload.instruments) ? payload.instruments : [];
    const brokerPayload =
      payload.brokerName === "ZERODHA"
        ? await syncZerodha(payload)
        : await syncFyers(payload);

    const previews = normalizeBrokerPayloadToPreviewTrades(
      payload.brokerName,
      brokerPayload,
      payload.brokerAccountId,
      instruments
    );

    return NextResponse.json({ previews, raw: brokerPayload });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Broker sync failed."
      },
      { status: 500 }
    );
  }
}
