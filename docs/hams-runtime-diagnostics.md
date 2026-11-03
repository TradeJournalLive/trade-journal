# HAMS Runtime Diagnostic Review: 2026-11-03

## What The Evidence Establishes

- The 12:12 SELL webhook arrived at 12:12:04.835 IST. Its recorded execution
  decision was made at 12:12:35.135: a 30.300-second receipt-to-decision delay.
  Its exact decision was absence of a fresh recorded index observation.
- The 12:30 BUY was entered at 12:30:50.222 (23700 CE, 2 lots, 33.30 premium).
  A recovered open-position incident was recorded at 12:53:00.046.
- macOS service logs show HAMS inactive at 12:51:55.768 and 12:51:57.965.
  LaunchAgent state records unsuccessful exits and automatic relaunches.
- Existing stderr contains generic HAMS_WORKER_STOPPED, storage and lease
  failures. Without timestamped original causes, these cannot conclusively be
  matched to the particular 12:51 failure.

## Software Failure Paths Found

The main loop can await credentials/subscription refresh. Credentials make four
sequential database reads, each with an 8-second HTTP timeout, then request a
FYERS chain with a 10-second timeout. The theoretical wait can approach 42
seconds, not counting local work. While awaiting refresh, the main loop does not
schedule its next poll or snapshot publish. Socket callbacks can still run.

Owned execution requires a cloud acknowledgement younger than 10 seconds. A
long refresh/publish wait can therefore suppress rule processing even while
socket messages arrive. This is a concrete architectural risk, not proof that it
caused the observed 30.300-second delay.

Snapshot confirmation failure stops the worker. Message-processing exceptions
also stop it. The old final exception overwrote these with HAMS_WORKER_STOPPED.
Startup owner/lease guards then delay retry. Any recovered open position enters
review because a verified exit cannot be inferred from an unobserved price path.

SQLite writes and JSON checkpoint fsync are synchronous. They can delay the Node
event loop; the old logs did not measure their duration. Do not assume they are
the cause without runtime measurements.

## Bounded Current Probes

At investigation time, DNS resolved Supabase in 7 ms and FYERS in 10 ms. The first
two tiny database reads took 441 and 400 ms and succeeded. These observations
show present connectivity only; they cannot establish conditions at 12:12/12:51.
Worker process snapshots were approximately 15.7% CPU/223 MiB RSS for HAMS,
15.4%/187 MiB for Current NIFTY, and 8.4%/112 MiB for BTC. These snapshots do not
prove the entire Mac was free of memory/CPU pressure earlier.

## New Local Logging

`.paper-worker/hams-final/YYYY-MM-DD-diagnostics.jsonl` records:

- Worker/run ID, PID, UTC timestamp (convert to IST for comparison).
- First stopping operation, original error name/code/stack and nested cause.
- HTTP failures and slow request-header durations; whole poll/publish/refresh
  spans also cover response-body parsing and local work.
- Signal receipt-to-processing duration, index age and last refresh/poll times.
- Every 30 seconds: process CPU/RSS, event-loop timer lag, pending task ages,
  task maxima/counters, lease age and feed age.
- Graceful termination versus an internally requested stop.

Known webhook/access/service secrets, URL query strings, bearer values and JWTs
are redacted. No credentials, headers, request bodies, or full state are logged.
Files use mode 0600. Diagnostics are local, not streamed to Supabase. Logging
failure must not throw into execution. SIGKILL, OS crashes and total disk failure
may prevent a final log; correlate run IDs with the Mac service/power logs then.

## How To Diagnose The Next Event

1. Locate SIGNAL_PROCESSING and inspect receipt delay/index age.
2. Compare an active credentials.refresh or signal.poll against timer lag.
   A long task with low timer lag suggests asynchronous service waiting or a
   stalled scheduler; high timer lag suggests blocked local execution/sleep.
3. Inspect request codes: ENOTFOUND/EAI_AGAIN (DNS), ECONNRESET (connection),
   timeout/abort (deadline exceeded, not proof of bad Wi-Fi), HTTP status (service
   response), SQLite code (local storage), or explicit lease mismatch.
4. Find the first STOP_REQUESTED, not just the later shutdown exception.
5. Compare across workers and OS power logs before blaming shared internet.

## Next Reliability Fixes, In Order

1. Remove awaited credential/chain refresh from the poll/heartbeat scheduler,
   with one in-flight refresh and explicit session-change handling. Test with
   30-second service stalls while quotes/polls/ownership checks continue.
2. Separate transient storage errors from a confirmed ownership change. Never
   bypass the ownership guard or invent exits to keep a green indicator.
3. Profile journal fsync/serialization under realistic quote bursts. Preserve
   durable entry/exit writes while reducing redundant checkpoint work if measured.
4. Add network-interruption, lost-acknowledgement, sleep/wake and broker-stall
   integration tests. A passing reducer suite alone does not prove uptime.

This diagnostics release changes no trading rules, timeouts, ownership thresholds,
poll intervals, execution conditions or recovery acknowledgements. It does not
resolve the existing unverified position or automatically resume HAMS trading.
