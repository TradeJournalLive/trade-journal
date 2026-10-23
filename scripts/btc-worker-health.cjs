// Database retries must never extend ownership beyond the worker's lease.
function retryablePoll(error) {
  return error.message === 'BTC_SIGNAL_STORAGE_UNAVAILABLE';
}
function canRetryPublish(error, lease, now = Date.now()) {
  return ['BTC_LEDGER_UNAVAILABLE', 'BTC_DECISION_STORAGE_UNAVAILABLE', 'BTC_HEARTBEAT_STORAGE_UNAVAILABLE'].includes(error.message)
    && now - Date.parse(lease) < 10000;
}
function feedNeedsReconnect({ readyState, openState, connectingState, quoteAt, lastFrame, connectedAt }, now = Date.now()) {
  if (readyState === connectingState) return now - connectedAt > 10000;
  if (readyState !== openState) return true;
  if (quoteAt) return now - Date.parse(quoteAt) > 5000;
  return now - (lastFrame || connectedAt) > 10000;
}
function reconcileHeartbeat(row, workerId, attemptedAt, previousLease) {
  if (!row || row.raw_payload?.workerId !== workerId) return 'LOST';
  if ([attemptedAt].flat().some(at => Date.parse(row.received_at) === Date.parse(at))) return 'COMMITTED';
  if (Date.parse(row.received_at) === Date.parse(previousLease)) return 'UNCHANGED';
  return 'LOST';
}
module.exports = { retryablePoll, canRetryPublish, feedNeedsReconnect, reconcileHeartbeat };
