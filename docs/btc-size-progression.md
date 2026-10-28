# BTC Paper Size Progression

Requested policy: start at 0.1 BTC, add 0.1 BTC after a signal-candle stop loss, cap at 0.8 BTC, reset to 0.1 BTC after target completion. Opposite-signal and break-even exits leave size unchanged. Other exit reasons also leave size unchanged. Existing 3R target, 2R break-even movement, signal-candle stop, entry validity and liquidity rules are unchanged.

`nextQuantityBtc` is checkpoint state. New positions record `requestedQuantityBtc` and a sizing-policy identifier. Size changes exactly once, after the final recorded exit fill. An unverified monitoring-gap close cannot change progression. An old untagged position does not retroactively alter the new sizing state; an older checkpoint without the field starts the new progression at 0.1 BTC. No past loss streak is reconstructed from historical data.

Performance includes legacy 0.1 BTC requests plus explicitly tagged progression requests from 0.1 through 0.8 BTC. It does not include unrelated older sizes or rescale historical P&L. Partial entries are included using their original requested quantity, not mistaken for a smaller request.

BTC date-range controls use inclusive IST entry dates for closed trades, and receipt dates for signal decisions. Selected-period verified P&L, closed count and win rate are distinct from lifetime totals and current open P&L. All historical records remain saved.

This source revision does not itself deploy the panel, restart a live worker, change production database state or migrate the unfinished reliability engine. Activate with a reviewed worker handover; preserve existing checkpoints and do not run duplicate executing workers. Increasing size after losses increases dollar exposure even though the stop's price distance is unchanged.
