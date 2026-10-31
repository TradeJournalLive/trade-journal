import { newLimitState, markLimitPaper, receiveLimitSignal, requestNiftyEmergency, type LimitQuote, type LimitSignal } from "./niftyLimitPaper";
import type { HamsState } from "./hamsFinalPaper";
export const hamsBreakoutGraceMs=20000;
export function initializeHamsLimits(previous: HamsState, at: string): HamsState {
  if(previous.rulesV2)return previous;
  if(previous.position)throw Error("RULE_UPGRADE_REQUIRES_FLAT_POSITION");
  const next=newLimitState(at,3,false,previous.enabled);
  next.seen=previous.seen.map(id=>id.replace(/^nifty_hams_final_3m_v1:/,""));
  return {...previous,balance:1000000,nextLots:1,rulesV2:next,status:previous.enabled?"WAITING_FOR_SIGNAL":"DISABLED"};
}
function project(previous:HamsState,s:NonNullable<HamsState["rulesV2"]>):HamsState {
  return {...previous,rulesV2:s,enabled:s.enabled,balance:s.balance,nextLots:s.nextLots,position:s.position,trades:[...previous.trades.filter(t=>t.ruleVersion!==2),...s.trades],seen:s.seen.map(id=>`nifty_hams_final_3m_v1:${id}`),status:s.status,pendingExit:s.pendingExit?.reason??null,lastQuoteAt:s.ticks.at(-1)?.at??null};
}
export function receiveHamsLimit(previous:HamsState,signal:LimitSignal,processedAt=signal.receivedAt){return project(previous,receiveLimitSignal({...previous.rulesV2!,enabled:previous.enabled},signal,processedAt,hamsBreakoutGraceMs));}
export function markHamsLimit(previous:HamsState,tick:{at:string;spot:number;chain:LimitQuote[]}){return project(previous,markLimitPaper({...previous.rulesV2!,enabled:previous.enabled},tick,hamsBreakoutGraceMs));}
export function emergencyHamsLimit(previous:HamsState,id:string,at:string){return project(previous,requestNiftyEmergency(previous.rulesV2!,id,at));}
