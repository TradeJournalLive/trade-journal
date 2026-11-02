# BTC Uncapped Paper Sizing

Remove the old 0.8 BTC policy ceiling. The existing step remains 0.1 BTC after
a verified SIGNAL_CANDLE_STOP closure; a target resets the request to 0.1 BTC.
Break-even, opposite-signal and other exit sizing behavior is unchanged.
Unverified monitoring-gap trades do not advance size.

New positions use SL_STEP_0_1_UNCAPPED_V2. Existing tagged capped-policy positions
can finish normally and advance to the new uncapped size without rewriting old
trade records. Performance reporting includes valid new tagged requests above
0.8 BTC, while preserving the historical scope for earlier capped-policy records.

Finite-number/contract-size validation, observed depth, partial-fill handling,
slippage checks, stops, targets, liquidation checks and feed/ownership safeguards
are unchanged. Uncapped requested size does not guarantee available liquidity or
a full fill. No NIFTY strategy rule is changed by this commit.
