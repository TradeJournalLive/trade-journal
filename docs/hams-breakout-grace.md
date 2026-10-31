# HAMS Final breakout entry grace

Scope: HAMS Final 3-minute paper strategy only. Its adapter explicitly opts into
a 20,000ms policy. Shared reducer defaults remain zero-grace, so Current NIFTY
retains its strict missed-breakout behavior. BTC is not modified or restarted.

- The ten-candle window still determines how long a signal may wait for its
  first breakout. The new 20-second window starts at that breakout, not at
  webhook receipt, processing or signal-candle close.
- A breakout seen before delivery can become a triggered setup when the current
  index is still outside the level and continuous observed index history verifies
  its timing. Require an unbroken observation within five seconds before the
  signal close, no delivery-period observation gaps over five seconds and a fresh
  latest observation. Missing evidence remains UNVERIFIABLE_BREAKOUT_HISTORY.
- A recorded return inside the level cancels the setup, including a later recross.
  The original first-break clock is never restarted.
- Historical index observations are compacted by second. For a pre-delivery break,
  use the START of the first crossed second bucket as the conservative clock;
  record precision SECOND_BUCKET. This can shorten grace by less than one second,
  never extend it. Newly observed post-delivery crosses use OBSERVED_TICK timing.
- A complete paper fill must occur on or before the original breakout deadline.
  Every evaluation rechecks it, including after JSON checkpoint restoration. Signal
  and session expiry can end eligibility sooner.
- Current-premium ATM selection, nearest weekly expiry, ask+4 price cap, full
  observed quantity, virtual capital and normal limit-only execution remain.
  A fresh premium can arrive later inside the remaining grace, but once the
  attempt starts its existing 1.5-second depth allowance is not extended.
- Opposite-breakout exits still reconcile before opposite entry. An expired or
  reversed grace setup cannot cause a new reversal entry or close a position
  solely from that rejected setup. Existing pending exits and normal stops remain.
- Positions record breakoutAt, breakoutDeadline and breakoutTimePrecision.
  Decisions distinguish BREAKOUT_GRACE_ACTIVE, BREAKOUT_GRACE_EXPIRED,
  BREAKOUT_REVERSED and WAITING_FOR_FRESH_ATM_QUOTE. No retrospective fills or
  rewrites of earlier MISSED_BREAKOUT decisions are performed.

Deployment: preserve the existing checkpoint and immutable journal, reload only
the HAMS worker while flat, and verify its balance, size and enabled switch survive.
Do not restart Current NIFTY or BTC. The shared-core freeze revision changes only
to record the explicit HAMS opt-in; default Current NIFTY behavior is regression-tested.
