import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

type ChainPayload = {
  clientId?: string;
  accessToken?: string;
  underlying?: string;
  optionType?: string;
  expiry?: string;
  strikesEachSide?: number;
};

type ChainLeg = {
  security_id?: number | string;
  last_price?: number;
  top_bid_price?: number;
  top_ask_price?: number;
  oi?: number;
  volume?: number;
};

type ChainStrike = {
  ce?: ChainLeg;
  pe?: ChainLeg;
};

const underlyings: Record<string, { scrip: number; segment: string; orderSegment: string; step: number; lotSize: number }> = {
  NIFTY: { scrip: 13, segment: "NSE", orderSegment: "NSE_FNO", step: 50, lotSize: 65 },
  BANKNIFTY: { scrip: 25, segment: "NSE", orderSegment: "NSE_FNO", step: 100, lotSize: 35 },
  FINNIFTY: { scrip: 27, segment: "NSE", orderSegment: "NSE_FNO", step: 50, lotSize: 65 },
  SENSEX: { scrip: 51, segment: "BSE", orderSegment: "BSE_FNO", step: 100, lotSize: 20 }
};

async function postDhan(path: string, headers: HeadersInit, body: Record<string, unknown>) {
  const response = await fetch(`${DHAN_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

function messageFrom(data: unknown) {
  if (typeof data === "string") return data.slice(0, 240);
  if (data && typeof data === "object" && "message" in data) return String((data as { message?: unknown }).message).slice(0, 240);
  if (data && typeof data === "object" && "errorMessage" in data) return String((data as { errorMessage?: unknown }).errorMessage).slice(0, 240);
  return "Dhan option chain request failed.";
}

export async function POST(request: Request) {
  let body: ChainPayload;
  try {
    body = (await request.json()) as ChainPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const clientId = body.clientId?.trim();
  const accessToken = body.accessToken?.trim();
  const key = (body.underlying || "NIFTY").toUpperCase().replace(/\s+/g, "");
  const config = underlyings[key];
  const requestedType = (body.optionType || "CE").toUpperCase() === "PE" ? "pe" : "ce";
  const strikesEachSide = Math.min(Math.max(Number(body.strikesEachSide || 10), 1), 20);

  if (!clientId || !accessToken) {
    return NextResponse.json({ error: "Dhan client ID and access token are required for option-chain prices." }, { status: 400 });
  }
  if (!config) {
    return NextResponse.json({ error: "Unsupported underlying." }, { status: 400 });
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "access-token": accessToken,
    "client-id": clientId
  };

  let expiry = body.expiry?.trim();
  if (!expiry) {
    const expiryResult = await postDhan("/optionchain/expirylist", headers, {
      UnderlyingScrip: config.scrip,
      UnderlyingSeg: config.segment
    });
    if (!expiryResult.response.ok) {
      return NextResponse.json({ error: messageFrom(expiryResult.data), response: expiryResult.data }, { status: expiryResult.response.status });
    }
    const expiryData = expiryResult.data as { data?: string[] };
    expiry = expiryData.data?.[0];
  }

  if (!expiry) {
    return NextResponse.json({ error: "No active expiry returned by Dhan." }, { status: 502 });
  }

  const chainResult = await postDhan("/optionchain", headers, {
    UnderlyingScrip: config.scrip,
    UnderlyingSeg: config.segment,
    Expiry: expiry
  });

  if (!chainResult.response.ok) {
    return NextResponse.json({ error: messageFrom(chainResult.data), response: chainResult.data }, { status: chainResult.response.status });
  }

  const data = (chainResult.data as { data?: { last_price?: number; oc?: Record<string, ChainStrike> } }).data;
  const lastPrice = Number(data?.last_price || 0);
  const chain = data?.oc || {};
  const strikes = Object.keys(chain).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const atmStrike = strikes.reduce((nearest, strike) => Math.abs(strike - lastPrice) < Math.abs(nearest - lastPrice) ? strike : nearest, strikes[0] || 0);
  const atmIndex = strikes.findIndex((strike) => strike === atmStrike);
  const lower = Math.max(atmIndex - strikesEachSide, 0);
  const upper = Math.min(atmIndex + strikesEachSide, strikes.length - 1);

  const matches = strikes.slice(lower, upper + 1).map((strike) => {
    const chainKey = Object.keys(chain).find((key) => Number(key) === strike) || String(strike);
    const strikeData = chain[chainKey];
    const leg = strikeData?.[requestedType] || strikeData?.[requestedType.toUpperCase() as keyof ChainStrike];
    const distance = Math.round((strike - atmStrike) / config.step);
    const moneyness = distance === 0 ? "ATM" : requestedType === "ce"
      ? distance < 0 ? `${Math.abs(distance)} ITM` : `${distance} OTM`
      : distance > 0 ? `${distance} ITM` : `${Math.abs(distance)} OTM`;
    return {
      securityId: leg?.security_id ? String(leg.security_id) : "",
      displayName: `${key} ${expiry} ${strike} ${requestedType.toUpperCase()}`,
      tradingSymbol: `${key}-${expiry}-${strike}-${requestedType.toUpperCase()}`,
      exchangeSegment: config.orderSegment,
      underlying: key,
      expiry,
      strike: String(strike),
      optionType: requestedType.toUpperCase(),
      lotSize: config.lotSize,
      lastPrice: leg?.last_price ?? null,
      bid: leg?.top_bid_price ?? null,
      ask: leg?.top_ask_price ?? null,
      oi: leg?.oi ?? null,
      volume: leg?.volume ?? null,
      moneyness
    };
  }).filter((item) => item.securityId);

  if (!strikes.length) {
    return NextResponse.json({ error: "Dhan returned an empty option chain. Check expiry, Data API access, and underlying segment.", response: chainResult.data }, { status: 502 });
  }

  return NextResponse.json({
    matches,
    underlying: key,
    underlyingLastPrice: lastPrice,
    atmStrike,
    expiry,
    count: matches.length,
    source: "Dhan Option Chain"
  });
}
