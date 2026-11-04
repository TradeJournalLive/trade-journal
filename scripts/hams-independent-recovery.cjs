/* Paper-only: preserve interrupted-position evidence before accepting a new signal. */
function recoverForFreshSignal(snapshot, signal, at) {
  const unresolved = snapshot.incidents.filter(i => !i.acknowledgedAt);
  if (!unresolved.length) return null;
  const received = Date.parse(signal.receivedAt);
  if (!Number.isFinite(received) || unresolved.some(i => !Number.isFinite(Date.parse(i.at)) || received <= Date.parse(i.at) || i.signalId === signal.id)) return null;
  const next = structuredClone(snapshot), ids = new Set(unresolved.map(i => i.signalId));
  if (next.state.position && !ids.has(next.state.position.signalId)) return null;
  const reason = 'Interrupted paper setup automatically excluded on a newer signal; no exit or P&L assumed.';
  next.incidents = next.incidents.map(i => i.acknowledgedAt ? i : {...i, acknowledgedAt: at, status: 'EXCLUDED_UNVERIFIED', resolution: 'NEXT_SIGNAL_INDEPENDENT', resumedBySignalId: signal.id});
  next.decisions = next.decisions.map(d => ids.has(d.id) ? {...d, status: 'EXCLUDED_UNVERIFIED', reason, decidedAt: at} : d);
  next.state.position = null;
  next.state.pendingExit = null;
  next.state.status = next.state.enabled ? 'WAITING_FOR_SIGNAL' : 'DISABLED';
  if (next.state.rulesV2) Object.assign(next.state.rulesV2, {position: null, pendingExit: null, setup: null, mark: null, status: next.state.status, decisions: structuredClone(next.decisions)});
  return next;
}
module.exports = {recoverForFreshSignal};
