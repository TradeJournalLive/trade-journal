import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectionSecret, sameOrigin } from "../../../lib/algo/connection";
import { getServerSupabase, hashWebhookSecret } from "../../../lib/algo/signalStore";
import { hashEmergencyAnswer, validEmergencyAnswers, verifyEmergencyAnswers } from "../../../lib/algo/emergencySecurity";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const table="tradingview_signal_events",strategy="__nifty_emergency_security__";
const headers={"Cache-Control":"private, no-store",Vary:"Authorization, Cookie"};
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers});
function row(owner:string,id:string,strategyId:string,raw:object,at:string){
  return {secret_hash:owner,strategy_id:strategyId,signal_id:id,symbol:"NIFTY",action:"EXIT",received_at:at,signal_timestamp:at,status:"VALIDATED",accepted:false,execution_mode:"PAPER",stage:"SIGNAL_RECEIVED",signal:{id,strategyId:strategyId,symbol:"NSE:NIFTY",action:"EXIT",timestamp:at,metadata:{internal:true}},decision:{},raw_payload:raw};
}
async function context(){
  const secret=await connectionSecret();if(!secret)return null;
  const db=getServerSupabase();if(!db)throw Error("Storage unavailable");
  const owner=hashWebhookSecret(secret);
  const r=await db.from(table).select("id,raw_payload").eq("secret_hash",owner).eq("strategy_id",strategy).eq("signal_id","profile").maybeSingle();
  if(r.error)throw Error("Security configuration unavailable");
  return {db,owner,profile:r.data};
}
export async function GET(){
  try{const c=await context();if(!c)return reply({error:"Sign in and connect TradingView first."},401);
    return reply({configured:Boolean(c.profile),questions:c.profile?.raw_payload.questions??[]});
  }catch{return reply({error:"Unable to load emergency security."},503);}
}
export async function POST(request:Request){
  if(!sameOrigin(request))return reply({error:"Invalid origin."},403);
  try{
    const c=await context();if(!c)return reply({error:"Sign in and connect TradingView first."},401);
    const b=await request.json();
    if(!validEmergencyAnswers(b.answers))return reply({error:"Use two different answers, each 8-256 characters."},400);
    const at=new Date().toISOString();
    if(b.action==="setup"){
      if(c.profile)return reply({error:"Security questions are already configured."},409);
      if(!Array.isArray(b.questions)||b.questions.length!==2||!b.questions.every((q:unknown)=>typeof q==="string"&&q.trim().length>=8&&q.length<=180)||b.questions[0].trim()===b.questions[1].trim())return reply({error:"Enter two different security questions."},400);
      const credentials=await Promise.all(b.answers.map(hashEmergencyAnswer));
      const r=await c.db.from(table).insert(row(c.owner,"profile",strategy,{questions:b.questions.map((q:string)=>q.trim()),credentials,version:randomUUID(),failures:0,lockedUntil:0},at));
      if(r.error)return reply({error:"Unable to save security questions. Refresh before retrying."},409);
      return reply({configured:true});
    }
    if(b.action!=="exit"||!c.profile)return reply({error:"Configure emergency security first."},400);
    const p=c.profile.raw_payload;
    if(Number(p.lockedUntil)>Date.now())return reply({error:"Too many attempts. Retry in 5 minutes."},429);
    if(Number(p.verifyingUntil)>Date.now())return reply({error:"Another verification is in progress. Retry shortly."},409);
    // Reserve an attempt atomically before hashing. Concurrent requests cannot bypass throttling.
    const version=randomUUID(),failures=(Number(p.failures)||0)+1;
    const reserved={...p,version,failures,verifyingUntil:Date.now()+15000,lockedUntil:failures>=5?Date.now()+300000:0};
    const lock=await c.db.from(table).update({raw_payload:reserved}).eq("secret_hash",c.owner).eq("id",c.profile.id).eq("raw_payload->>version",p.version).select("id");
    if(lock.error||lock.data?.length!==1)return reply({error:"Another verification is in progress. Retry."},409);
    if(!await verifyEmergencyAnswers(b.answers,p.credentials)){
      await c.db.from(table).update({raw_payload:{...reserved,verifyingUntil:0}}).eq("secret_hash",c.owner).eq("id",c.profile.id).eq("raw_payload->>version",version);
      return reply({error:"Security answers did not match."},403);
    }
    const id=randomUUID();
    // One database insert commits both worker commands together, or neither.
    const commandAt=new Date().toISOString();
    const commands=[row(c.owner,id,"__paper_control__",{paperControl:{market:"NIFTY",niftyOptionsEnabled:false,enabled:false,emergencyId:id}},commandAt),row(c.owner,id,"__hams_final_control__",{enabled:false,emergencyId:id},commandAt)];
    const r=await c.db.from(table).insert(commands);
    if(r.error)throw Error("Emergency command could not be saved");
    await c.db.from(table).update({raw_payload:{...p,version:randomUUID(),failures:0,lockedUntil:0,verifyingUntil:0}}).eq("secret_hash",c.owner).eq("id",c.profile.id).eq("raw_payload->>version",version);
    return reply({queued:true,commandId:id,message:"Emergency request saved for both NIFTY workers. New entries will stop when processed; market paper exits remain pending until fresh executable depth is available. This is not a fill confirmation."});
  }catch{return reply({error:"Unable to save emergency request. No exit is confirmed; check worker status before retrying."},503);}
}
