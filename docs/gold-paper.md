# Vantage gold paper worker

**Retired:** Gold is disabled in the panel, webhook intake and worker launcher.
The implementation below is historical reference only. Existing records are retained.

This is simulated trading only. Neither the exporter nor the worker sends broker orders.

## Feed

Attach `GoldPriceBridge` to an MT5 chart while logged into a USD demo account on
`VantageMarkets-Demo`. The exporter selects XAUUSD itself and exports bid/ask,
the broker contract size, volume step and calculated margin for 0.03 lots.
Leave Algo Trading off. No DLL imports, network permissions or passwords are required.

The compiled exporter is installed in MT5's `MQL5/Experts` directory. Refresh
Expert Advisors in Navigator and drag it onto a chart. It writes to MT5 Common
Files as `1to2-gold-quote.json`, using a temporary file followed by replacement.
UTC conversion uses MT5's broker-server offset; future/stale timestamps fail closed.

The Mac worker runs as `com.1to2.gold-paper` and starts with entries off. Turn on
Gold MT5 paper entries only after the panel shows fresh Vantage demo prices.
Keep MT5 open, logged in and the Mac awake. Browser tabs need not remain open.

## Rules

- Consume only `gold_vantage_tracking_v1`, `VANTAGE:XAUUSD`, one-minute candles.
- Request a fixed 0.03 lots; multiply by the exported contract size for P&L units.
- After candle confirmation, buy on a bid-price crossing above its high; short
  below its low, within ten minutes. No retrospective or later re-cross entries.
- Long fills at observed ask and exits at bid; short fills at bid and exits at ask.
- SL is the signal candle's opposite extreme, target is 3R from simulated entry.
- After 2R using executable prices, move SL to the entry price. No 15-minute trail.
- Exit on an opposite signal; never reverse on the same tick.
- No daily cutoff. Fresh quotes are required; market breaks prevent fills.
- Quote gaps over five seconds cancel pending setups and mark held trades
  unverified. Affected P&L is excluded; no prices are invented during outages.

Observed bid/ask fills are a quote-based simulation, not proof of liquidity or a
broker-confirmed fill. Commission, swaps and additional execution slippage are
not modeled. Margin is MT5's estimate at entry, not a guaranteed required margin.

## Storage and separation

`.paper-worker/gold` contains ignored private checkpoints and audit files.
Owner-scoped `__gold_mt5_worker__`, `__gold_mt5_trade__` and
`__gold_mt5_decision__` records persist state in the existing Supabase table.
NIFTY and BTC worker processes and their settings are not changed.
Gold webhooks remain non-executable by the generic automation path; the separate
gold paper worker must be explicitly armed to simulate trades.
