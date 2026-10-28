# HAMS Final: separate NIFTY paper strategy

## Confirmed rules

- Strategy ID: `nifty_hams_final_3m_v1`.
- Dedicated payload namespace: `hamsFinalPaper`. Never use `niftyPaper` or
  `btcPaper`; the existing engines must not consume these signals.
- Indicator: user's saved HAMS Final script. Confirm exact alert conditions
  before creating BUY/SELL alerts, with Once per bar close on a 3-minute chart.
- BUY purchases CE; SELL purchases PE, nearest expiry, adjacent strictly ITM
  strike relative to current index value. No breakout wait.
- Entry is the observed available option ask after webhook receipt, not a
  backdated historical candle-close fill.
- Stop is the selected option's completed, matching signal-time 3-minute
  candle low minus 5 premium points. Target is entry plus three times risk.
- Start with INR 500,000 virtual capital, independent of all other books.
  Premium debit must fit remaining cash; no leverage or fabricated borrowing.
- Start one lot. After SL: 1, 2, 4, 8, 16, 20, then remain capped at 20.
  Reset to one after target. Opposite-signal and time exits preserve size.
- Opposite-signal exit and 14:55 IST square-off remain; no 15-minute trail.
- Gross simulated P&L, before fees. Fills require observed available quantity.
  Missing quotes/candles/depth must be reported, not invented.

## Implementation status

The independent reducer, account-scoped `/api/algo/hams-final` API, paper tab,
webhook isolation and `scripts/hams-final-worker.cjs` are implemented. Runtime
activation and alert creation must be verified separately; code presence is not
proof of a received indicator signal or a paper fill.

The worker resolves FYERS through the webhook owner's account binding, not by
searching other users' credentials. It uses dedicated `__hams_final_worker__`
and `__hams_final_control__` rows and `.paper-worker/hams-final/checkpoint.json`.
Start with `node scripts/hams-final-worker.cjs --arm`; omit `--arm` on routine
restarts to preserve the saved switch. `--check` performs read-only preflight.
No existing NIFTY process needs to be restarted.

## Required integration before arming

1. Add account-scoped isolated routing and storage. Exclude this strategy from
   the legacy index-price book and generic automation; never enable live orders.
2. Add a separate worker lease/checkpoint namespace; reuse authenticated FYERS
   market-data transport without sharing the existing strategy's execution state.
3. Resolve nearest-expiry 1-ITM contract and load its exact completed 3-minute
   option candle corresponding to the alert close. Normalize timestamps to UTC.
4. Entries use synchronized observed depth with a bounded 1.5-second attempt
   and INR4 initial-ask cap. Exits use available observed bids; an exit triggered
   without sufficient depth remains pending, never fabricates quantity.
5. Persist receipt, signal close, entry/exit, stop/target, sizing changes and
   rejection decisions per account. Reducer deduplication must survive restarts.
6. Add separate UI/book with cash, open premium debit, realized/open P&L,
   date filters, signal reasons and its own entry switch and worker health.
7. Opposite signals request closure, not an automatic delayed reversal. A later
   fresh signal is required for another position. An open position recovered
   after a process restart requires review rather than an invented catch-up exit.
8. Test quote/candle delay, duplicate delivery, restart and account isolation,
   then create separate TradingView alerts and verify end-to-end in PAPER only.

The reducer deliberately does not fabricate catch-up fills. Its one-bar stale
signal guard is an integration safeguard, not permission to delay entry. A late
webhook must be visible in execution diagnostics.
