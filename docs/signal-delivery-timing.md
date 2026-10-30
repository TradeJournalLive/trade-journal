# Signal delivery timing

Add a top-level `"alertFiredAt": "{{timenow}}"` to the existing TradingView alert JSON. Keep `timestamp`, IDs, conditions, frequency, candle metadata, webhook URL and secret unchanged.

The webhook handler already captures `receivedAt` on its first executable line, before reading the body. New requests save server-owned `signal.metadata.deliveryTiming`: the optional TradingView-reported fire time, handler start, and validation completion. Client-provided deliveryTiming metadata is replaced. Invalid/missing optional fire times never reject an otherwise valid signal.

Signals > Timing displays candle close, TV fire, handler start, validation duration and arrival-to-recorded-decision duration. The latter includes persistence and worker polling, not just computation. These are diagnostics only: no execution checks, worker code, fill prices or signal eligibility are changed.

Important limits:

- TradingView `{{timenow}}` has one-second precision. Derived fire-related durations are approximate, even when handler timestamps include milliseconds.
- Handler start happens after any platform/region/network queue and cold initialization. Fire-to-handler is not a measurement of network transit alone. Use Vercel request logs to investigate that interval further.
- Fire time is reported by the alert payload, not independently authenticated exchange time. Clock-order discrepancies stay visible; negative durations are not clamped to zero.
- Older signal timestamps can be bar-open timestamps. Show them separately as legacy/unverified rather than claiming they prove firing time. Do not backfill or rewrite historical receipts.
- Existing HAMS messages were inspected and already used `timestamp: {{timenow}}`. The explicit new field removes ambiguity for future data.

Read-only audit of two Oct 30 HAMS alerts, IST:

| Close | Existing TV timestamp | Handler start | Close-to-fire (approx) | Fire-to-handler (approx) |
| --- | --- | --- | --- | --- |
| 10:57:00 | 10:57:01 | 10:57:04.814 | 1 second | 3.814 seconds |
| 14:45:00 | 14:45:02 | 14:45:17.697 | 2 seconds | 15.697 seconds |

These show most elapsed time was after the reported alert firing, but do not isolate TradingView dispatch, network transit, Vercel routing or cold start individually.

Reference: https://www.tradingview.com/support/solutions/43000531021-how-to-use-a-variable-value-in-alert/
