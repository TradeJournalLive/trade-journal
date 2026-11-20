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

### Existing Cloudways Staging App
The separate entry `scripts/cloudways-independent-stage.cjs` reuses the stopped staging app's existing private `RIBBON_STAGE_TOKEN` through domain-separated HMAC credentials. It never starts Ribbon or imports production state. It ignores the old `/tmp/ribbon-local-staging.sqlite`, creates `worker-private-storage/independent-shadow/shadow.sqlite` under the runtime user's non-temporary HOME, and requires 1 GiB free before starting. Verify the installation ID survives a redeployment; a non-temporary path alone is not proof of durable storage.

Each boot runs an isolated synthetic self-test of both strategy entries, reporting outage/exit, duplicate receipts, lost acknowledgements and flat/open-position restarts. This makes no external requests and does not simulate a real Supabase network outage. Public health distinguishes these synthetic results from a configured live FYERS feed and shows feed freshness, processing latency, memory and installation boot count. Both shadow entry switches start disabled. Fresh FYERS credentials, actual Current strategy ID and direct test alerts are separate release gates; an online HTTP process is not a running live-feed paper trial.

The isolated app also has `/stage`, protected by `INDEPENDENT_STAGE_ADMIN_PASSWORD` (minimum 20 characters), with bounded short-lived HttpOnly/Secure sessions, origin and CSRF checks. A separate non-trading FYERS app may use `/stage/fyers/callback` on the staging origin. Set only its `INDEPENDENT_FYERS_APP_ID` and `INDEPENDENT_FYERS_SECRET` privately. OAuth can begin only while both shadow strategies are disabled and flat; its state is one-use and session-bound. The access token is atomically saved mode 0600 under the private staging directory and never returned in HTML or health. Restart only the staging app after authorizing to load it. Token expiry still requires reconnecting; automatic token refresh is not implemented. Do not change the production FYERS app or callback. Arming through this page requires a fresh live feed, running candidate and explicit Current strategy ID. Shadow direct alerts and reporting transport still require separate verification.

## Tests And Remaining Release Gates
Automated checks cover durable receipts, duplicate delivery, database-reporting outage, hanging reporting, lost reporting acknowledgement, local writer competition, restart with open position, missing index/option prices, a hard process exit before COMMIT and genuine SQLite capacity exhaustion. These are local tests, not a completed Cloudways live-feed trial.

Before changing production: verify persistent storage through a Cloudways redeployment; supply/refresh local FYERS credentials without relying on Vercel during execution; benchmark state-write latency and resource usage under real feed load; configure and verify a namespace-isolated reporting transport; repeat the failure tests on Cloudways including actual host restart; migrate the exact existing balances/trades/recovery state; implement authenticated control forwarding and reviewed recovery; verify the actual Current alert strategy ID and direct webhook delivery; pause/stop legacy workers and prove only one execution owner before switching alerts. No automatic historical entry or assumed recovery P&L is allowed.

Production cutover is intentionally blocked until these gates pass. A broker outage and Cloudways outage cannot be eliminated by this single-server candidate. Real orders remain disabled.

## Forward-Test Alerts
The private staging page exposes only its dedicated webhook secret, never broker tokens. Copy production alert conditions into separately named SHADOW alerts, preserve their strategy payloads, and replace only the destination and shared secret. Current's verified alert strategy ID is `nifty_breakout_options_v1`; configure `INDEPENDENT_CURRENT_STRATEGY_ID` explicitly before arming. HAMS remains `nifty_hams_final_3m_v1`.

A no-trade check uses the same webhook endpoint with `strategyId=independent_delivery_check_v1`, an ID beginning `shadow-check-`, and `metadata.diagnostic=true`. Authenticated checks are committed into a separate, capped 100-row table; they never enter a strategy inbox, alter state, or create fills/P&L. Mixed diagnostic/trading metadata is rejected. The private entry controls require at least one durable check, fresh feed and verified strategy configuration. Match the TradingView check firing to its received timestamp before enabling copied strategy alerts. Staging results and receipts stay in its local database; production dashboards and balances are not updated by this trial.
