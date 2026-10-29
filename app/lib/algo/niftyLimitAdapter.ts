import { newLimitState, markLimitPaper, receiveLimitSignal, type LimitState, type LimitQuote } from "./niftyLimitPaper";
import type { NiftyPaperCheckpoint } from "./niftyPaperEngine";
import type { PaperEvent } from "./paperEngine";
export function buildNiftyLimitPaper(events: PaperEvent[], now: string, initial?: NiftyPaperCheckpoint) {
  if (!initial?.rulesV2 && initial?.position) throw Error("RULE_UPGRADE_REQUIRES_FLAT_POSITION");
  let s: LimitState = initial?.rulesV2 ? structuredClone(initial.rulesV2) : newLimitState(now,1,true,initial?.enabled??false);
  if(!initial?.rulesV2){s.decisions=structuredClone(initial?.decisions??[]);s.seen=s.decisions.map(d=>d.id);}
  for(const event of events){
    const control=event.raw.paperControl;
    if(control?.market==="NIFTY"&&typeof control.niftyOptionsEnabled==="boolean"){s.enabled=control.niftyOptionsEnabled;if(!s.enabled)s.setup=null;s.status=s.position?"OPEN":s.enabled?"WAITING_FOR_SIGNAL":"DISABLED";continue;}
    const data=event.signal.metadata?.niftyPaper as Record<string,unknown>|undefined;
    if(!data||event.signal.symbol!=="NSE:NIFTY"||event.raw.automation?.mode!=="PAPER"||event.signal.metadata?.diagnostic||event.signal.id.startsWith("panel-test-"))continue;
    if(data.kind==="SIGNAL") s=receiveLimitSignal(s,{id:event.signal.id,action:event.signal.action as "BUY"|"SELL",receivedAt:event.receivedAt,closedAt:String(data.closedAt),high:Number(data.high),low:Number(data.low),interval:Number(event.signal.timeframe)});
    if(data.kind==="TICK"&&event.signal.symbol==="NSE:NIFTY"&&Array.isArray(data.contracts)){
      const at=String(data.timestamp),age=Date.parse(event.receivedAt)-Date.parse(at);
      if(age<0||age>5000)continue;
      const chain=(data.contracts as (LimitQuote&{timestamp:string})[]).map(q=>({...q,at:q.timestamp}));
      s=markLimitPaper(s,{at,spot:Number(data.price),chain});
    }
  }
  const legacy=initial?.trades.filter(t=>(t as {ruleVersion?:number}).ruleVersion!==2)??[];
  const mapPosition=(p:NonNullable<LimitState["position"]>)=>({...p,indexSymbol:"NSE:NIFTY",contract:{...p.contract,timestamp:p.contract.at},initialLots:p.lots,initialQuantity:p.quantity,realizedPnl:0,entryFill:{price:p.entry,initialAsk:p.entryLimit-4,slippage:p.entry-(p.entryLimit-4),fills:[{price:p.entry,quantity:p.quantity}]}});
  const position=s.position?mapPosition(s.position):null;
  const trades=[...legacy,...s.trades.map(t=>({...mapPosition(t),exit:t.exit,closedAt:t.closedAt,reason:t.reason,pnl:t.pnl,grossPnl:t.grossPnl,costs:t.costs,exitLimit:t.exitLimit}))];
  const lastTickAt=s.ticks.at(-1)?.at??null;
  const setup=s.setup?{...s.setup,indexSymbol:"NSE:NIFTY",intervalMinutes:s.interval}:null;
  const size={lots:s.nextLots,consecutiveLosses:0};
  const checkpoint:NiftyPaperCheckpoint={rulesV2:s,enabled:s.enabled,setup,position,previousTick:null,size,pendingExit:s.pendingExit?.reason??null,status:s.status,lastTickAt,mark:s.mark,trades,seen:s.seen,decisions:s.decisions,realizedBase:initial?.realizedBase??0,tradeCountBase:initial?.tradeCountBase??0};
  const realized=(initial?.realizedBase??0)+trades.reduce((sum,t)=>sum+t.pnl,0);
  return {enabled:s.enabled,status:s.status,position,setup,size,trades,mark:s.mark,lastTickAt,stale:!lastTickAt||Date.parse(now)-Date.parse(lastTickAt)>15000,pendingExit:checkpoint.pendingExit,realized,tradeCount:(initial?.tradeCountBase??0)+trades.length,checkpoint,unrealized:position&&s.mark!==null?(s.mark-position.entry)*position.quantity:null,stopDistance:position?position.entry-position.stop:null,balance:s.balance,initialCapital:1000000};
}
