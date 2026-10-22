# NIFTY Paper Trial

This worker consumes native TradingView BUY/SELL alerts and read-only FYERS
quotes. It cannot submit broker orders. The trial ends one calendar month after
its first start; its persisted end date does not reset on restart.

## Runtime

Run `npm run paper:nifty` from the repository. The Mac must stay awake, connected
to the internet and powered during market hours. Broker authentication must be
renewed when FYERS expires it; saved credentials do not imply a valid session.

The ignored `.env.production.local` supplies server storage/encryption settings.
The private `.paper-worker/config.json` supplies `webhookSecret` and
`fyersAppId`. Neither file belongs in Git. Local audit/checkpoint files are under
`.paper-worker`; retain these for the trial's audit and recovery.

## Execution

- Confirmed 1-minute signal high/low; crossing entry, valid for ten candles.
- Ignore ranges above 35 index points. Nearest-expiry, one-strike OTM CE/PE.
- New entries consume fresh observed ask levels, up to four premium points above
  the initial best ask. Require the full entry quantity within that bound; record
  each fill, weighted-average entry, initial ask and per-unit slippage. Missing
  depth never fabricates liquidity. Fresh top-of-book quantity alone can fill
  an entry only when it covers the entire quantity.
- FYERS five-level depth is streamed alongside symbol updates. Depth messages
  have local receipt timestamps (not invented exchange timestamps); only fresh
  depth matching the current best bid/ask is joined to a quote.
- Premium stop: smaller of 20 points and 20% of average entry.
- Premium targets for new entries: one lot exits at 2x entry; two lots exit one
  at 2x and one at 2.5x. Larger positions exit rounded 80% at 2x and the rest at
  2.5x, preserving at least one whole lot for the second target. Sell at observed
  fresh bids with sufficient quantity. Stops and other exits close the remainder.
- Partial exits persist remaining quantity, target progress, fills and booked
  gross P&L. Sizing updates once on final closure, not once per target. Final
  history has one record with weighted-average exit and the individual fills.
- Version-2 feed snapshots opt new entries into these rules. Existing positions
  without a stored target plan and historical version-1 fills retain 1.5R.
- Previous completed 15-minute index low/high trail; opposite signal exit.
- No new entry from 15:15 IST; close at the first verified quote at/after 15:15.
- Missing quote at cutoff leaves an explicitly unresolved exit. A next-day
  recovery exit is labelled delayed, never backdated to the prior session.
- Start one lot; increase one after SL or two consecutive other losses.
- No new entries after trial end; existing positions remain managed.

Missing/stale prices block entries. At the session opening, the strategy waits
for a completed current-session 15-minute candle before new entries. A browser
refresh is not required to run the worker. The panel reads its saved heartbeat
and distinguishes an offline worker from stale market data.

## Results

P&L is gross INR using actual contract quantity. Fees/taxes and market impact
beyond the observed quoted depth are not included. These are simulated
fills, not evidence that a live broker would fill at exactly the same price.
No past missed trades are fabricated. Each audit record includes receipt time;
price snapshots retain exchange quote timestamps.
