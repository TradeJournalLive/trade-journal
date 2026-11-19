import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { reconstructionId, reconstructionHash, signReconstruction } from "../../../lib/algo/paperReconciliation";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { fyersDevice, readFyers } from "../../../lib/algo/fyersConnection";
import { normalizeRecoveryCandles, recoverySessionEnd, reviewRecoveryCandles, type RecoveryPosition } from "../../../lib/algo/paperRecoveryReview";
import { optionCosts } from "../../../lib/algo/niftyLimitPaper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const reply = (body: object, status=200) => NextResponse.json(body,{status,headers});
export async function GET(request: Request) {
  try {
    const strategy = new URL(request.url).searchParams.get("strategy");
    if (strategy !== "current" && strategy !== "hams") return reply({error:"Unknown paper strategy."},400);
    const secret = await connectionSecret();
    if (!secret) return reply({error:"Sign in and link your existing TradingView connection."},401);
    const db = getServerSupabase(); if(!db) throw Error("Storage unavailable.");
    const current = strategy === "current", owner = hashWebhookSecret(secret);
    const selection = current ? "received_at,position:raw_payload->state->checkpoint->rulesV2->position,incidents:raw_payload->state->recoveryIncidents" : "received_at,position:raw_payload->state->position,incidents:raw_payload->incidents";
    const result = await db.from("tradingview_signal_events").select(selection).eq("secret_hash",owner).eq("strategy_id",current?"__nifty_paper_worker__":"__hams_final_worker__").eq("signal_id","state").maybeSingle();
    if(result.error) throw Error("Saved recovery position unavailable.");
    const saved = result.data as unknown as {received_at:string;position:RecoveryPosition|null;incidents:{at:string;signalId:string;acknowledgedAt?:string;reason?:string;position?:RecoveryPosition;diagnostic?:Record<string,unknown>}[]} | null;
    const position = saved?.position, incident = saved?.incidents?.filter(i=>!i.acknowledgedAt && i.signalId===position?.signalId).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
    if(!position || !incident) return reply({error:"There is no matching unresolved open paper position. No record changed."},409);
    if(!/^NSE:NIFTY[A-Z0-9]+(?:CE|PE)$/.test(position.contract.id) || !Number.isFinite(Date.parse(position.openedAt)) || Date.now()-Date.parse(position.openedAt)>7*86400000) throw Error("Position is outside the supported seven-day recovery review.");
    const connection = await readFyers(await fyersDevice());
    if(!connection?.accessToken) return reply({error:"Reconnect FYERS to review historical prices."},401);
    const cutoff = recoverySessionEnd(position.openedAt), end = Math.min(Date.now(),Date.parse(cutoff)+60000);
    const url = new URL("https://api-t1.fyers.in/data/history");
    url.search = new URLSearchParams({symbol:position.contract.id,resolution:"1",date_format:"0",range_from:String(Math.floor(Date.parse(position.openedAt)/60000)*60),range_to:String(Math.floor(end/1000)),cont_flag:"1"}).toString();
    const response = await fetch(url,{headers:{Authorization:`${connection.appId}:${connection.accessToken}`},cache:"no-store",signal:AbortSignal.timeout(12000)});
    const body = await response.json();
    if(!response.ok || body.s!=="ok") return reply({error:"FYERS historical data unavailable. No trade result was changed.",code:"FYERS_HISTORY_UNAVAILABLE"},502);
    const candles = normalizeRecoveryCandles(body.candles,Date.now());
    const signals = await db.from("tradingview_signal_events").select("received_at,signal").eq("secret_hash",owner).eq(current?"signal->metadata->niftyPaper->>kind":"signal->metadata->hamsFinalPaper->>kind","SIGNAL").gte("received_at",incident.at).lte("received_at",cutoff).order("received_at").limit(101);
    if(signals.error || (signals.data?.length??0)>100) throw Error("Signal history could not be fully verified; no outcome assumed.");
    const opposite = (signals.data??[]).filter(r=>r.signal?.action===(position.contract.side==="CE"?"SELL":"BUY")).map(r=>r.received_at);
    const review = reviewRecoveryCandles(position,incident.at,candles,opposite,Date.now());
    const chargesEstimate = review.exitEstimate === null ? null : optionCosts(position.entry,review.exitEstimate,position.quantity).total;
    const netEstimate = review.grossEstimate === null || chargesEstimate === null ? null : Math.round((review.grossEstimate-chargesEstimate)*100)/100;
    return reply({strategy,position,incident:{at:incident.at,reason:incident.reason??"Verified ownership expired; position retained for review.",diagnostic:incident.diagnostic??null},snapshotAt:saved?.received_at,checkedAt:new Date().toISOString(),review:{...review,chargesEstimate,netEstimate},candles:candles.filter(c=>Date.parse(c.at)+60000>Date.parse(incident.at)),oppositeSignals:opposite,realOrdersEnabled:false,recordsChanged:false});
  } catch {
    return reply({error:"Recovery review unavailable. The original position and audit history remain unchanged."},503);
  }
}

export async function POST(request: Request) {
  if(!sameOrigin(request))return reply({error:"Invalid origin."},403);
  try {
    const body=await request.json();
    if(body.acceptCandleEstimate!==true)return reply({error:"Explicit approval of the estimated result is required."},400);
    const reviewed=await GET(request);
    if(!reviewed.ok)return reviewed;
    const evidence=await reviewed.json(), {position,incident,review,strategy}=evidence;
    if(body.signalId!==position.signalId || body.openedAt!==position.openedAt || body.expectedNet!==review.netEstimate)return reply({error:"The position or estimate changed. Review it again before approving."},409);
    if(review.status!=="CANDLE_RECONSTRUCTION_AVAILABLE" || review.reason!=="TIME_EXIT" || !Number.isFinite(review.exitEstimate) || !Number.isFinite(review.netEstimate))return reply({error:"This evidence does not support an unambiguous candle time-exit estimate."},409);
    const secret=await connectionSecret(),db=getServerSupabase();if(!secret||!db)throw Error("Storage unavailable.");
    const owner=hashWebhookSecret(secret),at=new Date().toISOString(),id=reconstructionId(owner,strategy,position);
    const candleEvidence={candles:evidence.candles,oppositeSignals:evidence.oppositeSignals,review};
    const reconstruction=signReconstruction({version:1,owner,strategy,id,position,incidentAt:incident.at,approvedAt:at,source:"FYERS_1M_OHLC",fillVerified:false,reason:"TIME_EXIT",exit:review.exitEstimate,windowStart:review.windowStart,windowEnd:review.windowEnd,net:review.netEstimate,evidenceHash:reconstructionHash(candleEvidence),evidence:candleEvidence},process.env.ALGO_CONNECTION_ENCRYPTION_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"");
    const result=await db.from("tradingview_signal_events").upsert({secret_hash:owner,strategy_id:strategy==="current"?"__paper_control__":"__hams_final_control__",signal_id:id,symbol:"NIFTY",action:"EXIT",received_at:at,signal_timestamp:at,status:"VALIDATED",accepted:false,execution_mode:"PAPER",stage:"SIGNAL_RECEIVED",signal:{},decision:{},raw_payload:strategy==="current"?{paperControl:{market:"NIFTY",niftyOptionsEnabled:false,reconstruction}}:{enabled:false,reconstruction}},{onConflict:"secret_hash,strategy_id,signal_id",ignoreDuplicates:true});
    if(result.error)throw Error("Approval storage unavailable.");
    return reply({queued:true,id,fillVerified:false,netEstimate:review.netEstimate,realOrdersEnabled:false,note:"Worker correction queued. Entries remain paused until the corrected journal and balances are confirmed."});
  } catch { return reply({error:"Unable to queue the paper correction. Do not assume the position is closed."},503); }
}
