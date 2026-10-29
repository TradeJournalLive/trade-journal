# HAMS-only state-loss repair

## Failure

The legacy worker initialized memory with an empty disabled book, then called
`save()` in its top-level catch even when the initial database read had failed.
That could replace a valid JSON checkpoint with a newer empty checkpoint.
Subsequent startup preferred the empty checkpoint by timestamp and overwrote
the heartbeat. Trades existed only inside that mutable snapshot.

## Repair

- Only a restored state with an acquired HAMS lease can be saved. Startup
  failures and duplicate-worker attempts cannot save a default book.
- Dedicated `hams-final/state.sqlite` uses WAL + FULL synchronous commits.
  Each entry/exit and its resulting book are committed in one transaction.
  The JSON checkpoint is a cache, not the authority. Owner identity is checked.
- Checkpoint revision and transition checks reject missing positions, shortened
  trade history and switch changes without an explicit control record.
- Immutable entry, trade, decision, control and incident records are uploaded
  idempotently under `__hams_final_worker__` with `ledger:` IDs. This namespace
  is already excluded from the existing NIFTY/BTC readers. No shared reader or
  existing strategy needs to be changed for this repair.
- Lost heartbeat acknowledgements are checked by exact worker ID and timestamp.
  A failed check does not extend ownership or authorize execution.
- Transient credential/subscription refresh errors retain current state and
  retry; they no longer reset or silently disable the strategy.
- An open position found after restart is preserved and flagged for review.
  Its unobserved price path is not converted into a fabricated exit/P&L.
- The HAMS API merges durable records with the heartbeat, so a delayed or empty
  snapshot cannot hide already uploaded fills. Failed reads return an error,
  not a successful empty history.

## Previously lost entry

The 29 October 2026 audit records a BUY entry at 09:21:05 IST, but contains no
full fill details or confirmed exit. Migration preserves this as
`ENTRY_RECORD_LOST`, excludes unknown P&L and blocks new HAMS execution pending
review. It does not flip the user's entry switch to OFF.

The user can explicitly choose **Exclude unverified result and continue** in
HAMS Final. This retains the incident, does not create a closed trade or price,
and resumes from the last verified balance/size. Known interrupted positions
are retained in the incident when explicitly excluded. BTC and current NIFTY
are not paused, edited or restarted by this action.

## Verification

Tests cover uninitialized saves, process death, reopen, account mismatch,
position/history regression, switch preservation, lost upload acknowledgements,
heartbeat read-back, ledger reconstruction, review exclusion and startup
database failure. These are failure-recovery guarantees, not a promise of
continuous market data or zero infrastructure outages.
