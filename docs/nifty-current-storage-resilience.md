# NIFTY Current storage resilience

The previous signal poll combined a database failure and a full 1,000-row
response into `SIGNAL_BACKLOG_OR_STORAGE_ERROR`. Either terminated the
worker. A restart with an open position correctly quarantined that position,
but this made a transient signal-read error interrupt position monitoring.
The original database error was discarded, preventing reliable attribution.

## Changes

- Bound Supabase requests to eight seconds.
- Run single-flight signal reads, snapshot renewal, ledger reporting and
  credential refresh independently. FYERS ticks still use the serial engine.
- Retry signal reads with capped exponential backoff. Keep the cursor on error.
- Page full results within a fixed time boundary instead of terminating.
- Keep five-second snapshot cadence. Ledger retries cannot block renewal.
- Reconcile uncertain writes using the observed owner and timestamp, never a
  fabricated acknowledgement. Confirmed owner replacement remains fatal.
- Stop verified execution if confirmed ownership is ten seconds old. Startup
  claims still require the prior worker timestamp to be at least fifteen
  seconds old. An open position crossing that boundary remains unverified;
  restoring database access alone cannot retrospectively verify its exit.
- Fsync local checkpoints before continuing after a position transition.
- Record the failing operation and redacted original cause/details. Emit
  failures into the child error stream and expose sanitized causes in health.
- Track feed receipt separately from the paused engine timestamp. Do not
  publish a trusted mark for an unverified position.

## Boundaries

This is not fully database-independent execution. A long ownership-storage
outage, lost FYERS feed, process death or server failure can still interrupt
verified execution. Unknown fills and exits must not be invented. Existing
independent-next-signal recovery stays in place. No entry, sizing, stop,
target, depth, session or expiry rule is changed. No real order API is added.

Deploy with new entries paused and HAMS flat. Preserve any explicitly approved
unverified Current position and its incident history. Restore switches only
after checking the deployed commit, process health, fresh feed and review
state. Never infer trade readiness from `processRunning` alone.

## Recovery history follow-up

Review originally froze both trade execution and observed index history. The
first independent signal could therefore exclude the old position and then
reject itself against stale history two milliseconds later. Continue storing
validated FYERS index observations during review, without evaluating the old
position, its stop, target or P&L. The shared bounded observation function
retains intra-second high/low evidence and is also used by normal execution.
Genuine feed gaps remain rejected. Do not replay a historical rejected signal
or extend its original ten-candle window.
