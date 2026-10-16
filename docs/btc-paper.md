# Delta India BTC Paper Trial

This worker only consumes public market data. It has no order API or broker keys.

- TradingView symbol: `DELTAIN:BTCUSD.P`, 1-minute confirmed BUY/SELL alerts.
- Strategy ID: `btc_delta_breakout_v1`; automation mode `PAPER`.
- Candle metadata: `btcPaper: {kind: "SIGNAL", high: "{{high}}", low: "{{low}}", barOpen: "{{time}}"}`.
- Use `{{exchange}}:{{ticker}}` for symbol, `{{close}}` for price, `{{timenow}}` for timestamp.
- Enter on a crossing of the signal high/low within the next ten candles.
- Fixed 1 BTC; 100x initial-margin assumption; no time or candle-range filter.
- Stop at the opposite signal-candle end; full target 1.5 times actual fill-to-stop risk.
- Other exits: opposite signal, completed 15-minute low/high trail, estimated isolated-margin breach.
- Buys use executable ask, sells use bid, with fresh quotes and sufficient displayed depth.
- Results are gross USD, excluding fees and funding. Estimated liquidation is not a broker guarantee.

Run `npm run paper:btc` from the project directory. The Mac deployment uses the separate
`com.1to2.btc-paper` launch agent. It does not restart or share runtime state with NIFTY.
The Mac must remain awake and connected for continuous 24/7 operation.

Private runtime files are under ignored `.paper-worker/btc/`; production credentials remain
in ignored `.env.production.local`. Trades are idempotently saved to the database ledger,
separately from the heartbeat checkpoint. Old signal-price test trades remain unchanged.
Entries default off. Arm the Delta-specific switch only after its exact-feed alerts are connected.
