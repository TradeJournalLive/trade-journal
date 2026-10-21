# Delta India BTC Paper Trial

This worker only consumes public market data. It has no order API or broker keys.

- TradingView symbol: `DELTAIN:BTCUSD.P`, 1-minute confirmed BUY/SELL alerts.
- Strategy ID: `btc_delta_breakout_v1`; automation mode `PAPER`.
- Candle metadata: `btcPaper: {kind: "SIGNAL", high: "{{high}}", low: "{{low}}", barOpen: "{{time}}"}`.
- Use `{{exchange}}:{{ticker}}` for symbol, `{{close}}` for price, `{{timenow}}` for timestamp.
- Enter on a crossing of the signal high/low within the next ten candles.
- Request 1 BTC per entry; 100x initial-margin assumption; no time or candle-range filter.
- New version-two entries sweep observed prices up to $5 adverse from the initial
  ask (buy) or bid (sell). Quantities must be whole Delta contracts. Manage any
  partial fill and cancel the unfilled entry remainder; never top up later.
- Store individual fills, weighted-average entry, actual quantity, canceled
  quantity and slippage relative to the first quote. Margin and gross P&L use
  the actual filled BTC amount, not the requested 1 BTC.
- Stop at the opposite signal-candle end; full target 3 times actual average
  entry-to-stop risk. At 2R, move the stop to actual average entry.
- Other exits: opposite signal and estimated isolated-margin breach. No 15m trail.
- Delta's public `ob_updates` feed is maintained with strict sequence checks and
  CRC32 validation using the built-in Node zlib API (worker requires Node >=22.15).
  Clear the book on reconnect or validation failure. A fresh matching depth book
  supplies up to 50 levels; otherwise only the independently fresh L1 quantity
  is available, never synthetic deeper levels.
- Exits consume observed liquidity, without imposing the entry-only $5 cap on
  protective exits. Partially filled exits remain pending; do not consume the
  same snapshot again. Persist remaining exposure and booked P&L across restart.
- Existing positions without an `entryFill` retain their prior execution model.
  Historical trade records are never rewritten to the new rules.
- New signal outcomes are stored in a separate owner-scoped decision ledger,
  updated by stable signal ID. Paper history shows date-wise entry, partial fill,
  expiry, superseding signal, pre-processing breakout, and rejection reasons.
- Results are gross USD, excluding fees and funding. Estimated liquidation is not a broker guarantee.

Run `npm run paper:btc` from the project directory. The Mac deployment uses the separate
`com.1to2.btc-paper` launch agent. It does not restart or share runtime state with NIFTY.
The Mac must remain awake and connected for continuous 24/7 operation.

Private runtime files are under ignored `.paper-worker/btc/`; production credentials remain
in ignored `.env.production.local`. Trades are idempotently saved to the database ledger,
separately from the heartbeat checkpoint. Old signal-price test trades remain unchanged.
Entries default off. Arm the Delta-specific switch only after its exact-feed alerts are connected.

Normal tick audits retain prices and depth sequence/time references to avoid
duplicating the full book on every frame. `EXECUTION_SNAPSHOT` audits retain the
full depth context when a setup is consumed or position quantity changes.
These are observed-book simulations, not a guarantee of broker fills or an
estimate of the strategy's own market impact. Fees and funding remain excluded.
