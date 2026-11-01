# Supabase Egress Optimization

This change keeps Supabase, existing records, trading rules, execution checks,
signal polling intervals and price-feed processing unchanged.

## Reporting Reads

- NIFTY panel reads the existing public book and balance, not the full checkpoint.
- BTC panel projects the public book, pending trade/decision outbox and health.
- HAMS publishes a separate public view alongside the complete recovery snapshot.
  The public view omits tick history and deduplication sets; recovery retains them.
- Signal execution reporting projects decisions, positions and trades only.
- History reads are owner-scoped and coalesced per owner/project/query scope.
  Immutable ledgers use a count check followed by incremental ID reads when changed.
  Mutable receipts and decisions include a 60-second update overlap. Every five
  minutes a complete reconciliation replaces the cache. Failures reject rather
  than returning partial history. Returned records are cloned.

Workers never use the reporting cache for leases, recovery or execution decisions.
The HAMS worker's recovery ledger continues using its original uncached path.

## Execution Query

NIFTY's existing poll interval is unchanged. Its database filter now returns
paper controls and signals with `metadata.niftyPaper.kind = SIGNAL`, excluding
other instruments' large mutable worker snapshots before network transfer.
The existing execution validation still runs after retrieval.

## Verification And Rollback

Run `node --test tests/*.test.cjs`, TypeScript checking and the production build.
Tests cover owner isolation, cached-record mutation, incremental inserts,
late-committing IDs, fetch failures, mutable updates and HAMS recovery preservation.
The complete pre-change checkpoints remain valid. Reverting this commit restores
the previous reporting queries; public-view fields are additive and ignored by
older workers. Never delete historical trades or recovery data to reduce egress.

Observed NIFTY JSON payload: 199,018 bytes full snapshot versus 672 bytes for the
projected response, including heartbeat and balance. These are serialized bytes,
not compressed billing measurements or a guarantee of monthly quota compliance.
Already-consumed bandwidth is not reversed by this change.
