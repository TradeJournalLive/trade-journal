// Versioned paper-only execution. No broker order endpoint is imported here.
export const limitRules = Object.freeze({ version: 2, capital: 1000000, maxLots: 20, start: 557, end: 890, allowance: 4, entryWaitMs: 1500 });
export type LimitQuote = { id: string; expiry: string; strike: number; side: "CE" | "PE"; lotSize: number; at: string; bid: number; ask: number; bidSize: number; askSize: number; depthAt?: string; asks?: Level[]; bids?: Level[] };
type Level = { price: number; quantity: number };
export type LimitSignal = { id: string; action: "BUY" | "SELL"; closedAt: string; receivedAt: string; high: number; low: number; interval: number };
type Attempt = { contractId: string; reference: number; at: string };
type Setup = LimitSignal & { triggered?: boolean; attempt?: Attempt; prepared?: { contractId: string; ask: number; bid: number; at: string } };
export type LimitPosition = { contract: LimitQuote; signalId: string; signalClosedAt: string; receivedAt: string; openedAt: string; entry: number; stop: number; target: number; quantity: number; lots: number; ruleVersion: 2; orderType: "LIMIT"; entryLimit: number };
export type LimitTrade = LimitPosition & { exit: number; closedAt: string; reason: string; pnl: number; grossPnl: number; costs: ReturnType<typeof optionCosts>; exitLimit: number };
export type LimitState = { version: 2; startedAt: string; enabled: boolean; balance: number; nextLots: number; position: LimitPosition | null; trades: LimitTrade[]; setup: Setup | null; seen: string[]; decisions: { id: string; receivedAt: string; decidedAt: string; status: string; reason: string }[]; ticks: { at: string; price: number; high?:number; low?:number }[]; pendingExit: { reason: string; limit: number } | null; status: string; mark: number | null; rangeFilter: boolean; interval: number };
const time = (at: string) => Date.parse(at);
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const positive = (n: number) => Number.isFinite(n) && n > 0;
export function istSession(at: string) { const d = new Date(time(at) + 330 * 60000); return { day: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
const fresh = (at: string, now: string) => Number.isFinite(time(at)) && time(now) >= time(at) && time(now) - time(at) <= 5000;
// FYERS published NSE options rates, checked 2026-10-29. Contract-note rounding may differ.
// https://fyers.in/charges-list ; STT effective 2026-04-01.
export function optionCosts(entry: number, exit: number, quantity: number) {
  if (![entry, exit, quantity].every(positive)) throw Error("INVALID_COST_INPUT");
  const buy = entry * quantity, sell = exit * quantity, turnover = buy + sell;
  const brokerage = 40, exchange = turnover * 0.000355299, clearing = turnover * 0.00009;
  const sebi = turnover * 0.000001, ipft = turnover * 0.000000001;
  const stt = sell * 0.0015, stamp = buy * 0.00003;
  const gst = (brokerage + exchange + clearing + sebi + ipft) * 0.18;
  return { schedule: "FYERS_NSE_OPTIONS_2026_10_29", brokerage, exchange, clearing, sebi, ipft, stt, stamp, gst, total: round(brokerage + exchange + clearing + sebi + ipft + stt + stamp + gst) };
}
export function newLimitState(at: string, interval: number, rangeFilter: boolean, enabled: boolean): LimitState {
  return { version: 2, startedAt: at, enabled, balance: limitRules.capital, nextLots: 1, position: null, trades: [], setup: null, seen: [], decisions: [], ticks: [], pendingExit: null, status: enabled ? "WAITING_FOR_SIGNAL" : "DISABLED", mark: null, rangeFilter, interval };
}
export function limitFill(q: LimitQuote, quantity: number, side: "BUY" | "SELL", limit: number, at: string) {
  if (!fresh(q.at, at) || !positive(q.bid) || q.ask < q.bid || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  const buy = side === "BUY", best = buy ? q.ask : q.bid;
  const depth = q.depthAt && fresh(q.depthAt, at) ? buy ? q.asks : q.bids : undefined;
  const levels = depth?.length ? [...depth].sort((a,b) => buy ? a.price-b.price : b.price-a.price) : [{ price: best, quantity: buy ? q.askSize : q.bidSize }];
  if (levels[0]?.price !== best || new Set(levels.map(l=>l.price)).size !== levels.length) return null;
  let remaining = quantity, total = 0;
  const fills: Level[] = [];
  for (const l of levels) {
    if (!positive(l.price) || !Number.isSafeInteger(l.quantity) || l.quantity <= 0) return null;
    if (buy ? l.price > limit : l.price < limit) break;
    const take = Math.min(remaining,l.quantity); fills.push({price:l.price,quantity:take});total += take*l.price;remaining -= take;
    if (!remaining) return { price: total/quantity, fills, orderType: "LIMIT" as const, limit };
  }
  return null; // Paper FOK: never invent a partial fill or missing depth.
}
export function atmContract(spot: number, side: "CE" | "PE", chain: LimitQuote[], at: string) {
  const expiry = chain.filter(q=>q.expiry>=istSession(at).day).map(q=>q.expiry).sort()[0];
  const strikes = [...new Set(chain.filter(q=>q.expiry===expiry&&positive(q.strike)).map(q=>q.strike))].sort((a,b)=>a-b);
  const atm = strikes.reduce((best,k)=>Math.abs(k-spot)<Math.abs(best-spot)?k:best,strikes[0]);
  return chain.find(q=>q.expiry===expiry&&q.strike===atm&&q.side===side&&fresh(q.at,at)&&positive(q.bid)&&q.ask>=q.bid&&Number.isSafeInteger(q.lotSize)&&q.lotSize>0) ?? null;
}
function decision(s: LimitState, signal: LimitSignal, at: string, status: string, reason: string) {
  const d = { id:signal.id,receivedAt:signal.receivedAt,decidedAt:at,status,reason };
  const index=s.decisions.findIndex(v=>v.id===signal.id);if(index<0)s.decisions.push(d);else s.decisions[index]=d;
  s.status=status;
}
function eligible(s: LimitState, setup: LimitSignal, at: string) {
  const session=istSession(at);
  return session.day===istSession(setup.closedAt).day && session.minute>=limitRules.start && session.minute<limitRules.end
    && time(at)>=time(setup.closedAt) && time(at)-time(setup.closedAt)<10*setup.interval*60000;
}
export function receiveLimitSignal(previous: LimitState, signal: LimitSignal, processedAt=signal.receivedAt): LimitState {
  // Webhook receipt and worker processing are different clocks. Prices captured
  // between them must be checked against processing time, not rejected as future.
  const s=structuredClone(previous),at=processedAt;
  if(s.seen.includes(signal.id))return s;
  s.seen.push(signal.id);
  if(![signal.high,signal.low].every(positive)||signal.high<signal.low||!["BUY","SELL"].includes(signal.action)||signal.interval!==s.interval||!Number.isFinite(time(signal.closedAt))||!Number.isFinite(time(signal.receivedAt))||!Number.isFinite(time(at))||time(signal.closedAt)>time(signal.receivedAt)||time(at)<time(signal.receivedAt)) {
    decision(s,signal,at,"INVALID_SIGNAL","Invalid confirmed signal candle.");return s;
  }
  if(time(signal.closedAt)<time(s.startedAt)||!eligible(s,signal,at)){decision(s,signal,at,"SETUP_EXPIRED","Signal predates this rule session or its ten-candle/session window expired.");return s;}
  if(s.rangeFilter&&signal.high-signal.low>35){decision(s,signal,at,"CANDLE_RANGE_EXCEEDED","Signal index candle exceeds 35 points.");return s;}
  if(!s.enabled){decision(s,signal,at,"DISABLED","Entries are switched off.");return s;}
  if(s.setup)decision(s,s.setup,at,"SUPERSEDED","A newer confirmed signal replaced this setup.");
  s.setup=null;
  const side=signal.action==="BUY"?"CE":"PE";
  if(s.position?.contract.side===side){decision(s,signal,at,"ALREADY_OPEN","The same option side is already open.");return s;}
  const history=s.ticks.filter(t=>time(t.at)>=time(signal.closedAt)&&time(t.at)<=time(at));
  if(history.some(t=>signal.action==="BUY"?(t.high??t.price)>signal.high:(t.low??t.price)<signal.low)) {
    decision(s,signal,at,"MISSED_BREAKOUT","The signal level already broke before alert processing; wait for the next signal.");return s;
  }
  const last=s.ticks.at(-1);
  if(!last||!fresh(last.at,at)||time(last.at)<time(signal.closedAt)) {
    decision(s,signal,at,"UNVERIFIABLE_BREAKOUT_HISTORY","No fresh index observation establishes an unbroken level at alert processing.");return s;
  }
  s.setup=signal;decision(s,signal,at,"WAITING_FOR_INDEX_BREAK","Prepared ATM side; waiting for the confirmed signal high/low breakout within ten candles.");return s;
}
export function markLimitPaper(previous: LimitState, tick: { at: string; spot: number; chain: LimitQuote[] }): LimitState {
  const s=structuredClone(previous),at=tick.at,session=istSession(at),last=s.ticks.at(-1);
  if(!positive(tick.spot)||!Number.isFinite(time(at))||(last&&time(at)<=time(last.at)))return s;
  // Bound checkpoint size without losing an intra-second pre-delivery breakout.
  if(last&&Math.floor(time(last.at)/1000)===Math.floor(time(at)/1000))s.ticks[s.ticks.length-1]={at,price:tick.spot,high:Math.max(last.high??last.price,tick.spot),low:Math.min(last.low??last.price,tick.spot)};
  else s.ticks.push({at,price:tick.spot,high:tick.spot,low:tick.spot});
  s.ticks=s.ticks.filter(t=>time(at)-time(t.at)<=35*60000);
  let setup=s.setup;
  if(setup&&!eligible(s,setup,at)){decision(s,setup,at,"SETUP_EXPIRED","No fill inside the ten-candle/session window.");s.setup=null;setup=null;}
  if(setup&&!setup.triggered){
    const q=atmContract(tick.spot,setup.action==="BUY"?"CE":"PE",tick.chain,at);
    if(q)setup.prepared={contractId:q.id,ask:q.ask,bid:q.bid,at};
  }
  if(setup&&!setup.triggered&&last&&fresh(last.at,at)) {
    if(setup.action==="BUY"?last.price<=setup.high&&tick.spot>setup.high:last.price>=setup.low&&tick.spot<setup.low)setup.triggered=true;
  }
  const p=s.position;
  if(p){
    const q=tick.chain.find(q=>q.id===p.contract.id&&fresh(q.at,at));s.mark=q?.bid??null;
    const opposite=setup?.triggered&&(setup.action==="BUY"?"CE":"PE")!==p.contract.side;
    const reason=session.day!==istSession(p.openedAt).day||session.minute>=limitRules.end?"TIME_EXIT":q&&q.bid<=p.stop?"PREMIUM_SL":q&&q.bid>=p.target?"PREMIUM_TARGET":opposite?"OPPOSITE_BREAKOUT":null;
    if(reason&&q&&!s.pendingExit)s.pendingExit={reason,limit:Math.max(0.05,round(q.bid-limitRules.allowance))};
    if(s.pendingExit&&q){
      const fill=limitFill(q,p.quantity,"SELL",s.pendingExit.limit,at);
      if(fill){
        const costs=optionCosts(p.entry,fill.price,p.quantity),grossPnl=(fill.price-p.entry)*p.quantity,pnl=round(grossPnl-costs.total);
        const trade:LimitTrade={...p,exit:fill.price,closedAt:at,reason:s.pendingExit.reason,pnl,grossPnl,costs,exitLimit:s.pendingExit.limit};
        s.trades.push(trade);s.balance=round(s.balance+pnl);
        const cumulative=round(s.balance-limitRules.capital);
        s.nextLots=pnl>0&&cumulative>0?1:Math.min(limitRules.maxLots,p.lots+1);
        s.position=null;s.pendingExit=null;s.mark=null;s.status="WAITING_FOR_SIGNAL";
      }else s.status="EXIT_LIMIT_UNFILLED";
    }
  }
  setup=s.setup;
  if(!s.position&&s.enabled&&setup?.triggered&&eligible(s,setup,at)){
    if(setup.action==="BUY"?tick.spot<=setup.high:tick.spot>=setup.low){decision(s,setup,at,"BREAKOUT_REVERSED","Index returned inside the signal level before a complete limit fill.");s.setup=null;return s;}
    const contract=setup.attempt?tick.chain.find(q=>q.id===setup!.attempt!.contractId&&fresh(q.at,at)):atmContract(tick.spot,setup.action==="BUY"?"CE":"PE",tick.chain,at);
    if(!contract){decision(s,setup,at,"MISSING_FRESH_ATM_QUOTE","No fresh nearest-weekly ATM premium is available.");s.setup=null;return s;}
    setup.attempt??={contractId:contract.id,reference:contract.ask,at};
    const quantity=s.nextLots*contract.lotSize,limit=round(setup.attempt.reference+limitRules.allowance);
    const fill=limitFill(contract,quantity,"BUY",limit,at);
    if(fill){
      if(fill.price*quantity+20>s.balance){decision(s,setup,at,"INSUFFICIENT_VIRTUAL_CAPITAL","The full premium exceeds available virtual cash.");s.setup=null;return s;}
      s.position={contract,signalId:setup.id,signalClosedAt:setup.closedAt,receivedAt:setup.receivedAt,openedAt:at,entry:fill.price,stop:round(fill.price-Math.min(20,fill.price*0.25)),target:round(fill.price+Math.min(100,fill.price)),quantity,lots:s.nextLots,ruleVersion:2,orderType:"LIMIT",entryLimit:limit};
      s.mark=contract.bid;decision(s,setup,at,"ENTERED",`ATM ${contract.side} limit filled: ${s.nextLots} lot(s) at ₹${fill.price.toFixed(2)}, limit ₹${limit.toFixed(2)}.`);s.setup=null;
    }else if(time(at)-time(setup.attempt.at)>=limitRules.entryWaitMs){decision(s,setup,at,"ENTRY_LIMIT_UNFILLED","Full observed quantity was unavailable within the original ask + ₹4 limit during the 1.5-second attempt.");s.setup=null;}
    else decision(s,setup,at,"WAITING_FOR_ENTRY_DEPTH","Bounded limit order awaiting observed quantity; no fill assumed.");
  }
  if(s.position&&!s.pendingExit)s.status="OPEN";
  return s;
}
