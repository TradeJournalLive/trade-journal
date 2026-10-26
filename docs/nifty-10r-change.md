# Authorized NIFTY Exit Change

User requested removal of the 15-minute trailing SL and premium-multiple partial targets, replacing them with a single 1:10 risk/reward target. Normal premium SL, opposite signal exit and existing time cutoff remain unchanged. The unrelated completed-15-minute entry-history gate is retained because only trailing exits were requested to change.

Initial risk per unit remains min(20 premium points, 20% of entry). Target = actual average entry + 10 times that initial risk. All remaining lots share the target; observed exit liquidity is still required. An entry of 100 has stop 80 and target 300, not 1000.

Closed checkpoint trades and booked partial fills are preserved. Loading an open checkpoint with old target allocations recalculates its remaining target at 10R without changing its entry, remaining quantity, stop basis or realized P&L. Historical raw-event replay uses the new rules; it must not be presented as the original historical execution. Activate only after a reviewed flat-position handover, not by silently restarting a worker with an open position.

The earlier source snapshot `.paper-worker/releases/nifty/271a98328b22d994` and rollback branch remain available. The freeze manifest is advanced explicitly for this user-authorized rule revision, not to permit unrelated changes. No BTC files are part of this rule change.
