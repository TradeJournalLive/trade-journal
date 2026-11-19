# Independent Paper Execution: Shadow Candidate

## Status
This candidate is not a production cutover. The existing host does not import its runner, no alert URL changes automatically, and SHADOW is the only permitted store/HTTP mode. There is no broker order API. No additional paid service is required for local testing. A single Cloudways server remains a single failure domain; local fencing is not cross-server failover.

## Implemented
- Local SQLite WAL/FULL durability, owner identity and strategy isolation.
- Acknowledged direct HTTP receipts only after durable inbox commit.
- Stable receipt IDs, conflicting-duplicate rejection and original receipt-time retention.
- Fenced local writer epochs: a second writer cannot execute or renew an expired token.
- Atomic state, consumed signal and immutable outbox records.
- Current and HAMS use the existing receiveLimitSignal/markLimitPaper and loss-cycle implementations, not a rewritten strategy.
- Reporting is an asynchronous transport interface; failed, hanging or lost acknowledgements cannot block local tick processing. Destinations must verify immutable record identity and acknowledge IDs; a production reporting transport has not yet been configured.
- Read-only FYERS socket adapter, stale quote rejection, cache clearing, correct missing-ATM placeholders and preservation of open/attempted subscriptions.
- Open position/pending setup restart review, silent-feed watchdog and active-option price-gap detection. No gap-crossed SL/target is invented.
- Private state/control endpoints, bounded HTTP bodies and synthetic input disabled in live-feed mode.

## Running An Isolated Test
Use a dedicated absolute database path outside production .paper-worker storage. Set INDEPENDENT_PAPER_MODE=SHADOW, INDEPENDENT_PAPER_DB, INDEPENDENT_PAPER_WEBHOOK_SECRET and INDEPENDENT_PAPER_ADMIN_TOKEN through a private environment. Do not commit secrets. Supply INDEPENDENT_CURRENT_STRATEGY_ID matching the actual Current alert; the default is a fixture ID, not a verified production alert ID.

Run node scripts/independent-paper-runner.cjs. The runner binds localhost on PORT (default 3019). It is not externally exposed by the existing Cloudways host. A synthetic test requires INDEPENDENT_SYNTHETIC_INPUT=1. Read-only live data requires both INDEPENDENT_FYERS_APP_ID and INDEPENDENT_FYERS_TOKEN and forbids synthetic input. Local HTTP signal receipts alone do not prove an entry; inspect the durable decisions.

## Tests And Remaining Release Gates
Automated checks cover durable receipts, duplicate delivery, database-reporting outage, hanging reporting, lost reporting acknowledgement, local writer competition, restart with open position, missing index/option prices, a hard process exit before COMMIT and genuine SQLite capacity exhaustion. These are local tests, not a completed Cloudways live-feed trial.

Before changing production: verify persistent storage through a Cloudways redeployment; supply/refresh local FYERS credentials without relying on Vercel during execution; benchmark state-write latency and resource usage under real feed load; configure and verify a namespace-isolated reporting transport; repeat the failure tests on Cloudways including actual host restart; migrate the exact existing balances/trades/recovery state; implement authenticated control forwarding and reviewed recovery; verify the actual Current alert strategy ID and direct webhook delivery; pause/stop legacy workers and prove only one execution owner before switching alerts. No automatic historical entry or assumed recovery P&L is allowed.

Production cutover is intentionally blocked until these gates pass. A broker outage and Cloudways outage cannot be eliminated by this single-server candidate. Real orders remain disabled.
