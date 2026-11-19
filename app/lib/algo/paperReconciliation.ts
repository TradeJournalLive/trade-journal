import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { optionCosts, type LimitPosition, type LimitState, type LimitTrade } from "./niftyLimitPaper";
import { finishNiftyCycleTrade } from "./niftyLossCycle";

export type Reconstruction = {
  version: 1; owner: string; strategy: "current" | "hams"; id: string;
  position: LimitPosition; incidentAt: string; approvedAt: string;
  source: "FYERS_1M_OHLC"; fillVerified: false; reason: "TIME_EXIT";
  exit: number; windowStart: string; windowEnd: string; net: number; evidenceHash: string; evidence: Record<string,unknown>;
};
export type SignedReconstruction = { payload: Reconstruction; signature: string };
export type ReconstructionEvidence = Pick<Reconstruction,"id"|"source"|"fillVerified"|"approvedAt"|"incidentAt"|"windowStart"|"windowEnd"|"evidenceHash">;
type Incident = { signalId: string; at: string; acknowledgedAt?: string; status?: string; [key: string]: unknown };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().filter(k => (value as Record<string,unknown>)[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonical((value as Record<string,unknown>)[k])).join(",") + "}";
}
export const reconstructionHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function reconstructionId(owner: string, strategy: string, position: LimitPosition) {
  return "reconstruction:" + reconstructionHash({owner,strategy,signalId:position.signalId,openedAt:position.openedAt});
}
export function signReconstruction(payload: Reconstruction, key: string): SignedReconstruction {
  if (!key) throw Error("RECONSTRUCTION_KEY_UNAVAILABLE");
  return {payload,signature:createHmac("sha256",key).update(canonical(payload)).digest("hex")};
}
const identity = (p: LimitPosition) => ({signalId:p.signalId,openedAt:p.openedAt,contract:p.contract.id,entry:p.entry,stop:p.stop,target:p.target,quantity:p.quantity,lots:p.lots});
export function applyReconstruction(state: LimitState, incidents: Incident[], command: SignedReconstruction, key: string, owner: string, strategy: "current"|"hams", at: string) {
  const p = command?.payload;
  if (!key || !p || !/^[a-f0-9]{64}$/.test(command.signature??"")) throw Error("INVALID_RECONSTRUCTION_SIGNATURE");
  const expected = signReconstruction(p,key).signature;
  if (!timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(command.signature,"hex"))) throw Error("INVALID_RECONSTRUCTION_SIGNATURE");
  if (p.version!==1 || p.owner!==owner || p.strategy!==strategy || p.id!==reconstructionId(owner,strategy,p.position) || p.source!=="FYERS_1M_OHLC" || p.fillVerified!==false || p.reason!=="TIME_EXIT") throw Error("INVALID_RECONSTRUCTION_SCOPE");
  if (state.trades.some(t => t.reconstruction?.id===p.id)) return {state,incidents,applied:false};
  if(!p.evidence || reconstructionHash(p.evidence)!==p.evidenceHash)throw Error("INVALID_RECONSTRUCTION_EVIDENCE");
  const position=state.position;
  if (!position || reconstructionHash(identity(position))!==reconstructionHash(identity(p.position)) || state.trades.some(t=>t.signalId===position.signalId&&t.openedAt===position.openedAt)) throw Error("RECONSTRUCTION_POSITION_CONFLICT");
  const incident=incidents.find(i=>i.signalId===position.signalId&&i.at===p.incidentAt&&!i.acknowledgedAt);
  const start=Date.parse(p.windowStart), end=Date.parse(p.windowEnd), approved=Date.parse(p.approvedAt), now=Date.parse(at);
  const local=new Date(start+330*60000);
  if (!incident || !Number.isFinite(now) || !Number.isFinite(approved) || approved>end+7*86400000 || approved<end || approved>now+5000 || end-start!==60000 || local.getUTCHours()!==14 || local.getUTCMinutes()!==50 || start%60000!==0 || start<Date.parse(position.openedAt) || Date.parse(p.incidentAt)>=end || !Number.isFinite(p.exit) || p.exit<=0 || !/^[a-f0-9]{64}$/.test(p.evidenceHash)) throw Error("INVALID_RECONSTRUCTION_EVIDENCE");
  const costs=optionCosts(position.entry,p.exit,position.quantity), grossPnl=Math.round((p.exit-position.entry)*position.quantity*100)/100, pnl=Math.round((grossPnl-costs.total)*100)/100;
  if (pnl!==p.net) throw Error("RECONSTRUCTION_NET_MISMATCH");
  const s=structuredClone(state);
  const reconstruction: ReconstructionEvidence={id:p.id,source:p.source,fillVerified:false,approvedAt:p.approvedAt,incidentAt:p.incidentAt,windowStart:p.windowStart,windowEnd:p.windowEnd,evidenceHash:p.evidenceHash};
  const trade: LimitTrade={...structuredClone(position),exit:p.exit,closedAt:p.windowStart,reason:p.reason,pnl,grossPnl,costs,exitLimit:p.exit,reconstruction};
  s.trades.push(trade);s.balance=Math.round((s.balance+pnl)*100)/100;
  finishNiftyCycleTrade(s,pnl,p.reason);
  s.enabled=false;s.position=null;s.setup=null;s.pendingExit=null;s.mark=null;s.status="DISABLED";
  s.decisions=s.decisions.map(d=>d.id===position.signalId?{...d,status:"CLOSED_RECONSTRUCTED_ESTIMATE",decidedAt:at,reason:"User-approved FYERS one-minute candle time-exit estimate; historical bid/depth fill is unavailable. Net after charges "+pnl.toFixed(2)+"."}:d);
  return {state:s,incidents:incidents.map(i=>i===incident?{...i,acknowledgedAt:at,status:"CLOSED_RECONSTRUCTED_ESTIMATE",reconstruction}:i),applied:true};
}

