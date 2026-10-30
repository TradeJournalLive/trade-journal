# NIFTY paper rules v2

Effective only after a flat-position upgrade. Current NIFTY and HAMS retain
separate state, trade ledgers and signals. BTC is unchanged. Prior results are
retained with their original accounting; new trades are tagged ruleVersion 2.

- Capital: INR 1,000,000 per strategy, new rule-session net P&L starts at zero.
- Current NIFTY: confirmed 1-minute signals; reject index range above 35 points.
- HAMS: confirmed 3-minute signals; no 35-point range filter.
- BUY high breakout buys ATM CE; SELL low breakout buys ATM PE, nearest listed
  NIFTY weekly expiry. Valid for ten subsequent candles of the signal timeframe.
- A pre-delivery breakout is missed, never reconstructed as a historical fill.
- Session: 09:17 inclusive to 14:50 exclusive IST. Exit at 14:50.
- Premium stop: entry minus min(20 points, 25% of actual average entry).
- Premium target: entry plus min(100 points, 100% of average entry).
- No trailing stop, 15-minute entry gate or R-multiple partial targets.
- Entry BUY limit = initial best ask + INR 4. Up to 1.5 seconds for synchronized
  observed full quantity; no later re-cross retry. Exit SELL limit = initial best
  bid - INR 4 (floor INR 0.05). Never move that limit further to chase price.
- Fills are PAPER FOK/all-or-none using observed quote/depth only. They are not
  broker acknowledgements or guarantees of exchange fills. Unfilled exits remain
  open and visibly pending, including at 14:50. No automatic market-order fallback.
  The separate two-answer emergency control can explicitly request market paper exits.
- Opposite setups preselect an ATM quote while waiting. Recheck after trigger;
  exit must fill completely before submitting the opposite entry. Update lots
  from the completed net exit result first. No double exposure.
- Start one lot. A loss adds one lot. A profitable exit resets to one only when
  cumulative new-rule net P&L is positive; otherwise add one. Flat net follows
  the non-profitable branch (+1). No lot cap and no daily size reset. No daily
  risk stop, but sufficient virtual premium capital is still required.
- New closed trades store gross P&L, cost breakdown and net P&L. Estimated FYERS
  NSE options costs checked 2026-10-29: INR 20 each executed order, exchange
  0.0355299%, clearing 0.009%, SEBI INR 10/crore, IPFT INR 0.01/crore,
  sell STT 0.15%, buy stamp duty 0.003%, GST 18% on taxable fees.
  Sources: https://fyers.in/charges-list and
  https://fyers.in/notice-board/revision-in-securities-transaction-tax-stt-effective-april-01-2026
  Contract-note rounding and broker-specific discounts may differ.

Rollback: restore the Git version and private pre-upgrade runtime backups only
under review. Never restore a checkpoint over newer fills or silently erase a
v2 trade. A downgrade must reconcile the current position first.
