# NIFTY Loss-Recovery Sizing

Applies independently to Current NIFTY and HAMS Final paper engines. BTC is unchanged.

At entry, the existing net-P&L lot progression remains the minimum size. Compute
the recovery amount as the maximum of zero, negative strategy balance relative to
its own initial capital, and the negative last closed trade's net P&L. Do not add
the last loss to cumulative losses. Profitable last trades do not erase a negative
cumulative result, and positive cumulative P&L does not erase a last-trade loss.

Use the selected contract's actual lot size and current premium. Estimate target
profit using the existing target distance (min of 100 points and entry premium),
less the existing round-trip charge schedule. Find the smallest integer lot count
covering the loss estimate, then take max(existing progression, recovery lots).
The profit estimate conservatively covers both the current ask and original
bounded limit. This is an estimate conditional on a target fill, not guaranteed
recovery or a change to exit conditions.

Depth must still cover the whole position within the original ask + 4 limit and
existing 1.5-second attempt. Available cash must cover the premium; never shrink
lots to fit cash or invent liquidity. Existing breakouts, SL, target, opposite
reversal, time exit and 20-second grace are unchanged. No daily reset or user lot
cap is introduced. Safe numerical representation is still required.

Each new position and trade stores a sizing explanation (base lots, recovery
amount/lots, selected lots, estimated target net and estimated stop exposure).
The ENTERED execution reason includes the calculation. Historical trades are not
rewritten. After closure, the original progression uses the actual filled lot
count; HAMS durable recovery already rebuilds this from recorded trades.

Recovery lots are calculated at entry because the contract price is not known
when the previous trade closes. An existing open position is never resized.
Use pre-change Git backups and complete paper checkpoints for rollback; do not
restore old balances over new trades or reset strategy history.
