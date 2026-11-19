# Paper Monitoring Incident, 19 November 2026

## Confirmed Timeline
- NIFTY Current paused at 09:02:30.600 UTC (14:32:30 IST).
- HAMS paused at 09:02:33.035 UTC (14:32:33 IST).
- Both processes remained running; local checkpoints continued advancing.
- Confirmed database PATCH acknowledgements stopped reaching the execution ownership guard within its 10-second deadline.
- Supabase gateway records inspected for 14:31-14:34 IST showed no 4xx/5xx; one selected response took 114 ms at origin.
- Worker errors included 8-second snapshot aborts and signal-storage fetch failures.
- A later credential/feed refresh path recorded ETIMEDOUT. That path includes a panel credential bridge, so this alone does not identify FYERS as the failed service.

## What Is Not Established
Provider fault is UNCONFIRMED. No evidence currently proves a Supabase quota failure, a Cloudways outage or a FYERS outage at the pause. The worker-to-Supabase acknowledgement boundary failed. Historical provider/network evidence is required to assign the cause.

The existing 10-second ownership dependency is unchanged. Recovery and diagnostic improvements do not remove it or guarantee uninterrupted execution. Do not disable fencing or assume exclusive ownership during a database outage. A future independent execution-ownership design requires split-brain, restart and duplicate-fill tests before production.

## Approved Reconstruction
The user explicitly approved two candle-reconstructed paper results, not verified executable fills. FYERS one-minute history supports a 14:50 IST TIME_EXIT candidate at 213.35, without a recorded post-pause SL/target touch or intervening opposite signal.
- Current: estimated net after charges +10781.16.
- HAMS: estimated net after charges +3578.51.

Each correction is signed server-side, bound to the account owner, strategy, exact position and unresolved incident. Its ID is deterministic; duplicate delivery cannot book it twice. Historical candles, charges, approval timestamp, evidence hash and unverified-fill quality are retained. The worker owns the correction and durable checkpoint/journal update. No broker order API is involved.

## Recovery Procedure
1. Read health and the authenticated paper session. Separate process liveness from ownership confirmation and quote freshness.
2. Preserve the open position and incident. Pause new entries; do not assume a stop or target fill across an unobserved gap.
3. Inspect incident run ID, failed/pending operations, last check-in timing, feed timing and resource sample. Provider fault remains unconfirmed unless evidence establishes it.
4. Correlate UTC timestamps with Cloudways and Supabase request/network logs. Share no credentials or raw trade data.
5. Review owner-scoped FYERS history on demand. Missing bars, same-bar SL/target ambiguity and intervening opposite signals cannot be silently resolved.
6. Only with explicit user approval, queue a clearly labelled paper estimate. Confirm worker application, one ledger close, no remaining open position, exact fees, balances and loss cycle.
7. Restore only the previous entry switches after verification. BTC and Ribbon remain disabled.
8. If persistence fails or ownership transfers, do not force a second active worker or overwrite snapshots manually.

## Diagnostic Footprint
On a newly detected ownership pause, a bounded incident snapshot is retained with the original incident: run ID, last operations, active request ages, last 12 errors and process resources. HAMS also emits failures to stderr for host visibility. No new periodic dashboard polling or full-chain tick logging is added.

