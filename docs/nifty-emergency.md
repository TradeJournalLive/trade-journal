# NIFTY Paper Emergency Control

Scope: current NIFTY and HAMS Final version-2 paper strategies only. BTC and real broker orders are unchanged.

- No configured lot maximum. Virtual capital, safe integer quantities and observed liquidity still constrain fills.
- Size persists across dates and worker restarts. Existing net-profit reset rules remain.
- Configure two different private security questions in Paper Trading. Answers are salted with independent random salts and hashed with scrypt on the server. They never enter worker commands, signal exports or browser storage.
- Emergency exit requires both answers. Five failed attempts lock verification for five minutes. Verification updates use owner-scoped compare-and-swap to serialize attempts. There is no public answer-reset endpoint.
- The server atomically inserts commands for both workers after verification. A saved command is not an execution acknowledgement.
- Workers cancel pending setups and turn entries off, then simulate selling the full option quantity into fresh observed bids without the normal bid-minus-four limit. Recorded exits are marked MARKET / EMERGENCY_MARKET_EXIT. No real broker API is called.
- If quotes/depth are stale or insufficient for the whole position, keep the position open and show EMERGENCY_MARKET_EXIT_PENDING. Do not invent a fill or silently mark the position flat. Pending commands survive checkpoints and cannot be cleared by switching entries on.
- Emergency premium exits can process fresh option quotes even if the separate index feed is stale. Normal entries retain the existing index-freshness checks.
- After confirmed closure, entries remain off until explicitly re-armed. Security questions are manual verification, not an automatic missed-SL detector.

Do not reload an open HAMS position casually: restart reconciliation still protects unverified history. Roll out worker changes while flat, keeping a backup of code and checkpoints. Existing historical lot caps/results are not rewritten.
