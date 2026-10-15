# Next-candle paper execution

Existing trades stay unchanged. Enable Next-candle open execution in Paper Trading for each market. This resets assumed slippage to zero; fills use actual reported candle opens, not broker fills.

1. Add paper-candle-opens.pine in TradingView Pine Editor, save, and add it to a standard-candle chart. Use the exact same exchange, ticker and minute interval as the signal indicator.
2. Set its Webhook secret to your existing connection secret. Create an alert for this script using Any alert() function call, with your existing TradingView webhook URL. Keep it running alongside the BUY and SELL alerts.
3. Add these fields to both existing signal alert JSON messages (keep all existing fields):

```json
"timeframe": "{{interval}}",
"metadata": {
  "signalBarTime": "{{time}}"
}
```

Merge signalBarTime into the existing metadata object; do not create duplicate metadata keys. Use symbol "{{exchange}}:{{ticker}}" on both signal alerts. Set signals to Once per bar close. Only numeric minute intervals are currently supported.

The engine matches the candle whose opening timestamp equals the signal candle timestamp plus its interval. Missing or mismatched opens never fall back to the signal price. The companion starts reporting new bars only; it does not manufacture historical fills. Verify a real signal before relying on results. The Pine script needs compilation in TradingView before use.
