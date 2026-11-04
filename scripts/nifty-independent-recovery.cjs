function quarantineInterruptedPosition(state, at) {
  const position=state.checkpoint?.rulesV2?.position;
  if(!position)return false;
  state.recoveryIncidents ||= [];
  const id=`${position.signalId}:${position.openedAt}`;
  if(!state.recoveryIncidents.some(i=>i.id===id))state.recoveryIncidents.push({id,signalId:position.signalId,at,status:'UNVERIFIED_AWAITING_NEXT_SIGNAL',position:structuredClone(position)});
  return true;
}
function recoverOnNextSignal(state, events, at) {
  const unresolved=(state.recoveryIncidents||[]).filter(i=>!i.acknowledgedAt);
  if(!unresolved.length)return false;
  const event=events.find(e=>e.signal?.symbol==='NSE:NIFTY' && e.signal?.timeframe==='1' && ['BUY','SELL'].includes(e.signal?.action) && e.signal?.metadata?.niftyPaper?.kind==='SIGNAL' && e.raw?.automation?.mode==='PAPER' && !e.signal.metadata.diagnostic && !e.signal.id.startsWith('panel-test-') && unresolved.every(i=>e.signal.id!==i.signalId&&Date.parse(e.receivedAt)>Date.parse(i.at)));
  if(!event)return false;
  const s=state.checkpoint.rulesV2;
  if(s.position&&!unresolved.some(i=>i.signalId===s.position.signalId))return false;
  for(const i of unresolved){i.acknowledgedAt=at;i.status='EXCLUDED_UNVERIFIED';i.resumedBySignalId=event.signal.id;}
  const ids=new Set(unresolved.map(i=>i.signalId));
  s.decisions=s.decisions.map(d=>ids.has(d.id)?{...d,status:'EXCLUDED_UNVERIFIED',reason:'Interrupted paper position excluded on a newer signal; no exit or P&L assumed.',decidedAt:at}:d);
  s.position=null;s.pendingExit=null;s.setup=null;s.mark=null;s.status=s.enabled?'WAITING_FOR_SIGNAL':'DISABLED';
  Object.assign(state.checkpoint,{position:null,pendingExit:null,setup:null,mark:null,decisions:s.decisions,status:s.status});
  return true;
}
module.exports={quarantineInterruptedPosition,recoverOnNextSignal};
