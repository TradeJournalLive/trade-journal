# FYERS Live Testing Workspace

## Current scope

`/dashboard/algo?section=live` is an authenticated preparation workspace, not a live execution service. Real orders are unconditionally disabled in the new rehearsal module. No new placement, modification, cancellation, worker-control or credential endpoint is introduced. Existing paper workers and their strategy rules are unchanged.

The Readiness view performs one index-quote read and two compact paper-worker reads only when requested. The Order rehearsal view performs one cached contract-master read and one quote read per user request. Local validation, draft calculations and JSON export run in the browser. Drafts and test results are temporary, strategy-separated component state, not database records. Navigating away clears them. There are no background network timers in this workspace.

## Rehearsal boundaries

- Uses `niftyLotsForLoss` from the existing sheet-based recovery logic. Recovery loss and today's net P&L are manual draft inputs, not imported live balances.
- Contract quantities come from the current FYERS contract master; never assume a fixed exchange lot size.
- Requires a matching contract, positive non-crossed bid/ask and a dated quote no older than five seconds. Future or ambiguous time-only quotes fail validation.
- Production read-only verification on 19 November returned a midnight timestamp (`tt`) for the option REST quote. This does not establish a fresh tick even while bid/ask values change. The planner reports that limitation and stays blocked; it never substitutes HTTP receipt time for market tick time. Timestamped streaming verification is an outstanding integration gate, not a change to the current paper workers.
- Checks long-option stop < limit < target, spread, limit slippage, lot cap, capital including estimated round-trip charges, and remaining daily loss allowance. A cap violation blocks rather than silently resizing.
- Planned risk is an estimate, not guaranteed stop execution or a broker margin/funds check. Charges are user estimates. A limit below the ask can remain unfilled. Signal conditions, tick size, freeze quantity and broker protection support are not certified by this manual planner.
- Local fixture checks exercise this validator only. Passing them does not verify actual fills, duplicate-order handling, restart recovery, durable persistence, Supabase outage independence, static IP, order permissions or broker-side protection.

## Required before broker orders

1. Confirm FYERS' current regulatory, static-IP, authentication and permitted order/protection requirements.
2. Audit/patch framework and dependency security, with regression tests separate from the ongoing paper trial.
3. Build an isolated server-side order adapter with durable idempotency, broker reconciliation, partial-fill handling and a protected-position state machine.
4. Verify actual funds, positions, orders and trades without confusing paper balances with broker funds.
5. Prove protective-order failure handling, ambiguous request outcomes, duplicate alerts, reporting outages and restart/price-gap recovery in a broker-approved test environment.
6. Agree account-wide and per-strategy risk limits plus an emergency policy and live approval process. Never treat a frontend switch as authorization.
7. Obtain explicit approval for each controlled real-money pilot through the appropriate user-operated broker flow. Start with agreed restricted size only after the paper trial and operational acceptance checks pass.

The current module is deliberately client-only and cannot serve as the authoritative live risk engine. Its calculations must be independently revalidated on the server before any future order submission.
