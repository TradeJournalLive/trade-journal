import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { markets } from "../../../lib/algo/paperEngine";
import { loadPaperBooks as load } from "../../../lib/algo/paperHistory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

export async function GET() {
  const secret = await connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect TradingView in Integrations first." }, { status: 401 });
  try { return NextResponse.json({ books: await load(secret) }, { headers: privateHeaders }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Paper history unavailable." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const secret = await connectionSecret();
  if (!secret) return NextResponse.json({ error: "Connect TradingView first." }, { status: 401 });
  try {
    const body = await request.json();
    if (body.goldBreakoutEnabled !== undefined && (body.market !== "GOLD" || typeof body.goldBreakoutEnabled !== "boolean")) return NextResponse.json({ error: "Invalid gold switch." }, { status: 400 });
    if (body.stopAndClose !== undefined && (body.market !== "BTC" || body.stopAndClose !== true)) return NextResponse.json({ error: "Invalid close request." }, { status: 400 });
    if (body.deleteTrade !== undefined && (body.market !== "BTC" || typeof body.deleteTrade !== "string" || body.deleteTrade.length > 300)) return NextResponse.json({ error: "Invalid trade deletion." }, { status: 400 });
    if (body.nextCandle !== undefined && typeof body.nextCandle !== "boolean") return NextResponse.json({ error: "Invalid execution rule." }, { status: 400 });
    if (body.niftyOptionsEnabled !== undefined && (body.market !== "NIFTY" || typeof body.niftyOptionsEnabled !== "boolean")) return NextResponse.json({ error: "Invalid options switch." }, { status: 400 });
    if (body.btcBreakoutEnabled !== undefined && (body.market !== "BTC" || typeof body.btcBreakoutEnabled !== "boolean")) return NextResponse.json({ error: "Invalid BTC breakout switch." }, { status: 400 });
    if (!markets.includes(body.market) || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Invalid market or switch." }, { status: 400 });
    if (body.symbol !== undefined && (typeof body.symbol !== "string" || !/^[A-Z0-9_]+:[A-Z0-9_.!]+$/.test(body.symbol))) return NextResponse.json({ error: "Invalid price feed." }, { status: 400 });
    if (body.slippage !== undefined && (typeof body.slippage !== "number" || !Number.isFinite(body.slippage) || body.slippage < 0 || body.slippage > 100000)) return NextResponse.json({ error: "Invalid slippage assumption." }, { status: 400 });
    const db = getServerSupabase();
    if (!db) throw new Error("Saved paper trading is unavailable.");
    if (body.goldBreakoutEnabled === true) {
      const { data, error } = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__gold_mt5_worker__").eq("signal_id", "state").maybeSingle();
      const { validGoldQuote } = await import("../../../lib/algo/goldPaperEngine");
      if (error || !data || Date.now() - Date.parse(data.received_at) > 15000 || !validGoldQuote(data.raw_payload?.state?.quote, Date.now())) return NextResponse.json({ error: "Attach GoldPriceBridge in the Vantage demo MT5 terminal and wait for fresh quotes before arming entries." }, { status: 409 });
    }
    if (body.deleteTrade !== undefined) {
      const { data, error } = await db.from("tradingview_signal_events").select("raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__btc_delta_trade__").eq("signal_id", hashWebhookSecret(body.deleteTrade)).maybeSingle();
      if (error || !data) return NextResponse.json({ error: "Completed paper trade not found." }, { status: 404 });
    }
    if (body.stopAndClose) {
      const { data } = await db.from("tradingview_signal_events").select("received_at").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__btc_delta_worker__").eq("signal_id", "state").maybeSingle();
      const age = Date.now() - Date.parse(data?.received_at || "");
      if (!Number.isFinite(age) || age < 0 || age > 15000) return NextResponse.json({ error: "Worker offline. Keep the Mac awake and reconnect before closing paper positions." }, { status: 409 });
    }
    if (body.btcBreakoutEnabled === true) {
      const { data } = await db.from("tradingview_signal_events").select("received_at,raw_payload").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__btc_delta_worker__").eq("signal_id", "state").maybeSingle();
      const heartbeatAge = Date.now() - Date.parse(data?.received_at || ""), quoteAge = Date.now() - Date.parse(data?.raw_payload?.saved?.state?.previousTick?.timestamp || "");
      if (![heartbeatAge, quoteAge].every(age => Number.isFinite(age) && age >= 0 && age <= 15000) || String(data?.raw_payload?.workerStatus).startsWith("STOPPED_")) return NextResponse.json({ error: "Fresh Delta BTC data is required before arming entries." }, { status: 409 });
    }
    if (body.niftyOptionsEnabled === true) {
      const { data } = await db.from("tradingview_signal_events").select("received_at").eq("secret_hash", hashWebhookSecret(secret)).eq("strategy_id", "__nifty_paper_worker__").eq("signal_id", "state").maybeSingle();
      if (!data || Date.now() - Date.parse(data.received_at) > 15000) return NextResponse.json({ error: "Options worker is offline. Start the Mac worker before arming paper entries." }, { status: 409 });
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const { error } = await db.from("tradingview_signal_events").insert({
      secret_hash: hashWebhookSecret(secret), strategy_id: "__paper_control__", signal_id: id, symbol: body.market,
      action: "EXIT", received_at: now, signal_timestamp: now, status: "VALIDATED", accepted: false,
      execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", reason: body.enabled ? "Paper enabled" : "Paper paused",
      signal: { id, strategyId: "__paper_control__", source: "TRADINGVIEW", symbol: body.market, action: "EXIT", timestamp: now, createdAt: now, metadata: {}, status: "VALIDATED" },
      decision: {}, raw_payload: { paperControl: { market: body.market, enabled: body.enabled, ...(body.stopAndClose ? { stopAndClose: true } : {}), ...(body.deleteTrade ? { deleteTrade: body.deleteTrade } : {}), ...(body.goldBreakoutEnabled !== undefined ? { goldBreakoutEnabled: body.goldBreakoutEnabled } : {}), ...(body.btcBreakoutEnabled !== undefined ? { btcBreakoutEnabled: body.btcBreakoutEnabled } : {}), ...(body.niftyOptionsEnabled !== undefined ? { niftyOptionsEnabled: body.niftyOptionsEnabled } : {}), ...(body.nextCandle !== undefined ? { nextCandle: body.nextCandle } : {}), ...(body.symbol ? { symbol: body.symbol } : {}), ...(body.slippage !== undefined ? { slippage: body.slippage } : {}) } }
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ books: await load(secret) }, { headers: privateHeaders });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save switch." }, { status: 503 }); }
}
