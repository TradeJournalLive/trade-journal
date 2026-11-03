# HAMS Scheduler And Publish Retry Fix

## Scope

Only HAMS worker orchestration changes. No price/SL/target/size/grace rules,
broker orders, HTTP timeouts or ownership-age thresholds are changed. Current
NIFTY and BTC are not modified. Existing recovery incidents remain untouched.

## Independent Credential Refresh

Credential/subscription refresh runs as one background task, at the existing
one-minute cadence. The main 250 ms scheduler continues scheduling signal polls,
snapshot publishes, ledger flushes and rule processing while that task waits.
Duplicate refresh tasks are prevented. Actual FYERS session changes retain the
existing stop/restart requirement; routine refresh failures remain retryable.

## Snapshot Reconciliation

An update uses compare-and-swap on the exact saved timestamp, account and worker ID.
After a failed or ambiguous write:

- Read back only this account's worker ID and timestamp.
- If this worker's exact attempted timestamp is present, accept the lost ack.
- If this worker's older timestamp remains, adopt that observed timestamp for
  the next CAS attempt. Do not update the acknowledgement age to the local clock.
- If storage is unreachable or ownership cannot be established, retry with
  backoff from 500 ms to 5 seconds. Do not restart merely for that timeout.
- If a different owner is confirmed, stop immediately.
- If the last verified timestamp becomes older than the existing 10-second
  ownership window, execution pauses through the original ownership check.
  Keep the process, socket observations, local state and enabled switch intact.
  Resume only when a valid fresh write/owned timestamp is confirmed. If a
  position was open when ownership expired, preserve a durable recovery incident
  and require review instead of silently treating the interrupted path as verified.

This removes needless restart/recovery-review cycles for temporary failures. It
does not guarantee uninterrupted execution during a prolonged storage outage.
Local journal failures, processing errors and true ownership conflicts are still
fatal, with the original cause recorded by diagnostics.

## Failure Tests

The actual worker harness holds credential refresh unresolved for 30 simulated
seconds while renewing snapshots, receiving a new signal, entering and taking a
normal premium SL. Other tests cover one refresh in flight, a transient snapshot
timeout without process exit, execution pause on stale acknowledgement, confirmed
write recovery, missing/future timestamps, lost acknowledgements, and a confirmed
competing owner. Existing full engine and privacy regressions also run.

## Rollout And Recovery

Back up Git and the stopped SQLite journal before activation. Never restart a
verified active position just to roll out this change. A pre-existing unverified
position requires the user's separate review; this change does not exclude it,
invent a historical exit, reset capital or resume an incident-blocked strategy.
