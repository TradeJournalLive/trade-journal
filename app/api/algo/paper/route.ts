import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { buildPaperBooks, paperValuation, markets, type PaperEvent } from "../../../lib/algo/paperEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function load(secret: string) {
  const db = getServerSupabase();
  if (!db) throw new Error("Saved paper trading is unavailable.");
  const events: PaperEvent[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await db.from("tradingview_signal_events").select("received_at,signal,raw_payload,id")
      .eq("secret_hash", hashWebhookSecret(secret)).order("received_at").order("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    events.push(...(data ?? []).map(row => ({ receivedAt: row.received_at, signal: row.signal, raw: row.raw_payload || {} })));
    if (!data || data.length < 1000) {
      const now = new Date().toISOString();
      const books = buildPaperBooks(events, now);
      return Object.fromEntries(markets.map(market => [market, { ...books[market], valuation: paperValuation(books[market], events, now) }]));
    }
  }
  throw new Error("History exceeds the paper engine limit; archive is required before continuing.");
}
export async function GET() {
  const secret = connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect TradingView in Integrations first." }, { status: 401 });
  try { return NextResponse.json({ books: await load(secret) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Paper history unavailable." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const secret = connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect TradingView first." }, { status: 401 });
  try {
    const body = await request.json();
    if (body.nextCandle !== undefined && typeof body.nextCandle !== "boolean") return NextResponse.json({ error: "Invalid execution rule." }, { status: 400 });
    if (!markets.includes(body.market) || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Invalid market or switch." }, { status: 400 });
    if (body.symbol !== undefined && (typeof body.symbol !== "string" || !/^[A-Z0-9_]+:[A-Z0-9_.!]+$/.test(body.symbol))) return NextResponse.json({ error: "Invalid price feed." }, { status: 400 });
    if (body.slippage !== undefined && (typeof body.slippage !== "number" || !Number.isFinite(body.slippage) || body.slippage < 0 || body.slippage > 100000)) return NextResponse.json({ error: "Invalid slippage assumption." }, { status: 400 });
    const db = getServerSupabase();
    if (!db) throw new Error("Saved paper trading is unavailable.");
    const now = new Date().toISOString();
    const id = randomUUID();
    const { error } = await db.from("tradingview_signal_events").insert({
      secret_hash: hashWebhookSecret(secret), strategy_id: "__paper_control__", signal_id: id, symbol: body.market,
      action: "EXIT", received_at: now, signal_timestamp: now, status: "VALIDATED", accepted: false,
      execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", reason: body.enabled ? "Paper enabled" : "Paper paused",
      signal: { id, strategyId: "__paper_control__", source: "TRADINGVIEW", symbol: body.market, action: "EXIT", timestamp: now, createdAt: now, metadata: {}, status: "VALIDATED" },
      decision: {}, raw_payload: { paperControl: { market: body.market, enabled: body.enabled, ...(body.nextCandle !== undefined ? { nextCandle: body.nextCandle } : {}), ...(body.symbol ? { symbol: body.symbol } : {}), ...(body.slippage !== undefined ? { slippage: body.slippage } : {}) } }
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ books: await load(secret) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save switch." }, { status: 503 }); }
}
