const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const ts=require('typescript');
const {IndependentPaperStore,hash,issue}=require('./independent-paper-store.cjs');
function load(name){const file=path.resolve(__dirname,'../app/lib/algo/'+name+'.ts'),m=new Module(file,module);m.require=id=>id.startsWith('./')?load(id.slice(2)):require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const core=load('niftyLimitPaper'),cycle=load('niftyLossCycle'),{niftySignalCandle}=load('niftySignal');
const stamp=at=>new Date(at).toISOString();
const ids={current:'nifty_paper_feed_v1',hams:'nifty_hams_final_3m_v1'};
function changedRecords(before,after,strategy,at){
  const records=[],add=(kind,key,value)=>records.push({id:hash([strategy,kind,key]),kind,at,value});
  const key=p=>p&&p.signalId+':'+p.openedAt;
  if(after.rules.position&&key(after.rules.position)!==key(before.rules.position))add('ENTRY',key(after.rules.position),after.rules.position);
  for(const t of after.rules.trades)if(!before.rules.trades.some(p=>key(p)===key(t)))add('EXIT',key(t),t);
  for(const d of after.rules.decisions)if(!before.rules.decisions.some(p=>JSON.stringify(p)===JSON.stringify(d)))add('DECISION',[d.id,d.status,d.decidedAt],d);
  if(after.review&&!before.review)add('INCIDENT',after.review.id,after.review);
  return records;
}
function createIndependentPaperEngine({file,owner,clock=Date.now,workerId=crypto.randomUUID(),initialStates={},currentStrategyId=ids.current}){
  const store=new IndependentPaperStore(file,owner,{clock}),writer=store.claim(workerId),startedAt=stamp(clock());
  for(const strategy of ['current','hams']){
    const rules=initialStates[strategy]||core.newLimitState(startedAt,strategy==='current'?1:3,strategy==='current',false);
    // Explicitly isolated shadow accounts; production balances are never imported implicitly.
    rules.lossCycleFrom??=cycle.niftyFreshSessionAt;cycle.startNiftyLossCycle(rules,startedAt);
    store.initialize(strategy,{rules,review:null,feedAt:null,activeQuoteAt:null,sessionInterrupted:false});
    const saved=store.read(strategy).state;
    if(saved.rules.position||saved.rules.setup)pause(strategy,'WORKER_RESTART','The worker restarted with a position or pending setup. The unobserved price path requires review.',startedAt);
  }
  function step(strategy,fn,signal=false){return store.advance(strategy,writer,(state,input)=>{const before=structuredClone(state),next=fn(state,input);return {state:next,records:changedRecords(before,next,strategy,stamp(clock()))};},{signal});}
  function pause(strategy,code,message,at=stamp(clock())){
    return step(strategy,state=>{
      if(state.review)return state;
      state.sessionInterrupted=true;
      state.review={id:hash([strategy,code,at,state.rules.position?.signalId,state.rules.setup?.id]),at,code,message,step:'PRICE_PATH_VERIFICATION',service:code==='WORKER_RESTART'?'EXECUTION_WORKER':'FYERS_DATA_PATH',providerFault:'UNCONFIRMED',signalId:state.rules.position?.signalId||state.rules.setup?.id||null,lastFeedAt:state.feedAt,lastActiveQuoteAt:state.activeQuoteAt,positionOpen:Boolean(state.rules.position),tradeEffect:'No exit or P&L is assumed; this run is interrupted.',nextAction:'Review the missing price interval before resuming. Do not invent a fill.'};
      state.rules.status='RECOVERY_REVIEW_REQUIRED';return state;
    });
  }
  function normalize(strategy,payload){
    if(!ids[strategy]||payload?.strategyId!==(strategy==='current'?currentStrategyId:ids.hams)||payload.symbol!=='NSE:NIFTY'||!['BUY','SELL'].includes(payload.action)||String(payload.timeframe)!==(strategy==='current'?'1':'3')||typeof payload.signalId!=='string'||!payload.signalId.trim()||payload.signalId.length>200||payload.signalId.startsWith('panel-test-')||payload.metadata?.diagnostic||payload.metadata?.btcPaper||payload.metadata?.ribbonPaper||payload.metadata?.[strategy==='current'?'hamsFinalPaper':'niftyPaper'])throw issue('INVALID_DIRECT_SIGNAL');
    const data=niftySignalCandle(payload.metadata?.[strategy==='current'?'niftyPaper':'hamsFinalPaper'],payload.timeframe),now=clock();
    if(!data||Date.parse(data.closedAt)>now||now-Date.parse(data.closedAt)>86400000)throw issue('INVALID_SIGNAL_CANDLE_TIME');
    return {id:payload.signalId,strategyId:payload.strategyId,symbol:'NSE:NIFTY',action:payload.action,interval:Number(payload.timeframe),closedAt:data.closedAt,high:data.high,low:data.low,receivedAt:stamp(now)};
  }
  function signal(strategy,payload){return store.receive(strategy,normalize(strategy,payload));}
  function process(strategy){
    if(store.read(strategy).state.review)return null;
    return step(strategy,(state,input)=>{if(!input)return state;state.rules=core.receiveLimitSignal(state.rules,input,stamp(clock()),20000,true);return state;},true);
  }
  function tick(tick){
    const now=clock(),at=Date.parse(tick?.at);
    if(!Number.isFinite(at)||at>now||now-at>5000||!Number.isFinite(tick.spot)||tick.spot<=0||!Array.isArray(tick.chain))throw issue('STALE_OR_INVALID_MARKET_TICK');
    for(const strategy of ['current','hams']){
      const saved=store.read(strategy).state,position=saved.rules.position;
      const q=position&&tick.chain.find(q=>q.id===position.contract.id&&Date.parse(q.at)<=now&&now-Date.parse(q.at)<=5000);
      if(!saved.review&&((saved.feedAt&&at-Date.parse(saved.feedAt)>5000)||(position&&saved.activeQuoteAt&&!q&&now-Date.parse(saved.activeQuoteAt)>5000)))pause(strategy,'MARKET_PRICE_GAP','Fresh market observations were missing for more than five seconds. The exact intervening price path is unknown.',stamp(now));
      step(strategy,state=>{
        if(state.review){state.rules.ticks=core.observeLimitIndex(state.rules.ticks,tick.at,tick.spot);return state;}
        state.feedAt=tick.at;if(q)state.activeQuoteAt=q.at;
        state.rules=core.markLimitPaper(state.rules,tick,20000,true);
        if(!position&&state.rules.position)state.activeQuoteAt=state.rules.position.contract.at;
        if(!state.rules.position)state.activeQuoteAt=null;
        return state;
      });
      for(let i=0;i<100&&process(strategy);i++);
    }
  }
  function control(strategy,{enabled,id,at=stamp(clock())}){
    if(typeof enabled!=='boolean'||typeof id!=='string'||!id||!Number.isFinite(Date.parse(at)))throw issue('INVALID_EXECUTION_CONTROL');
    return step(strategy,state=>{
      if(state.review&&enabled)throw issue('RECOVERY_REVIEW_REQUIRED');
      if(state.rules.seen.includes('control:'+id))return state;
      if(enabled&&!core.canArmNifty(state.rules,at))throw issue('EMERGENCY_EXIT_PENDING');
      state.rules.seen.push('control:'+id);state.rules.enabled=enabled;if(!enabled)state.rules.setup=null;
      state.rules.status=state.rules.position?'OPEN':enabled?'WAITING_FOR_SIGNAL':'DISABLED';return state;
    });
  }
  function watchdog(){for(const s of ['current','hams']){const state=store.read(s).state;if(state.review||!state.feedAt||(!state.rules.position&&!state.rules.setup))continue;if(clock()-Date.parse(state.feedAt)>5000||(state.rules.position&&state.activeQuoteAt&&clock()-Date.parse(state.activeQuoteAt)>5000))pause(s,'MARKET_PRICE_GAP','The index or open-option price stream became stale. The unobserved price path requires review.');}}
  return {signal,process,tick,pause,control,watchdog,renew:()=>store.renew(writer),read:s=>store.read(s),flush:t=>store.flush(t),health:()=>({...store.health(),strategies:Object.fromEntries(['current','hams'].map(s=>{const v=store.read(s);return [s,{revision:v.revision,enabled:v.state.rules.enabled,positionOpen:Boolean(v.state.rules.position),reviewRequired:Boolean(v.state.review),sessionInterrupted:v.state.sessionInterrupted}];}))}),close(){try{store.release(writer);}finally{store.close();}},store};
}
module.exports={createIndependentPaperEngine,changedRecords,load};
