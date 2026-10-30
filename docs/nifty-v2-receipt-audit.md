# NIFTY rule-upgrade receipt audit

Baseline: 660ea19 (before ATM limit-rules v2). Rule rollout: e1f1881.
Processing-clock correction: df89a19.

## Unchanged receipt and connection paths

Git comparison confirms no changes to the TradingView webhook route, signal
normalizers (`niftySignal.ts`, `hamsSignal.ts`), signal persistence, account
connection binding, or FYERS authentication endpoints during this rollout.
The existing 1-minute current-NIFTY and 3-minute HAMS alert namespaces remain
separate. No alert URL, secret or indicator condition is changed by these fixes.

The depth adapter gained bid levels for limit exits; its quote/depth parsing and
freshness checks were not replaced. The old 15-minute history request was removed
because the new strategy explicitly removes that entry gate and trailing rule.

## Regression and correction

The new execution reducer initially compared the latest captured price against
webhook receipt time. An asynchronous poll can have newer price observations by
the time it handles that receipt. Negative age then incorrectly failed the
freshness check. Worker processing time now drives freshness, eligibility and
decision timestamps; original receipt time remains intact for latency analysis.
An already missed breakout or genuinely stale data still cannot create an entry.

The HAMS v2 path also evaluated the whole option universe on every subscribed
message. Evaluation now runs on index updates, the active position, and the
prepared/pending entry contract. Other quotes are still cached, not discarded.
Quotes passed to the reducer cover nearest-expiry strikes around the index plus
any active/prepared contract. Idle timer evaluations are skipped; active position
and pending entry checks remain scheduled. No strategy threshold is altered.

## Regression coverage

`tests/nifty-worker-pipeline.test.cjs` executes the actual worker source with an
isolated clock and synthetic SQL/feed fixtures. No production webhook or broker
order is submitted. It covers both worker poll paths, receipt before processing,
index high breakout, observed ATM limit entry, duplicate receipt idempotence,
premium stop fill, and next-size progression. A separate test ensures unrelated
option updates do not manufacture additional index-history observations.

Live receipt, feed health, and actual post-fix trading are different checks. A
healthy connection or successful replay alone does not prove that a future
indicator alert will fire or that a limit order will fill. Historical missed
trades must not be invented or backfilled into verified results.
