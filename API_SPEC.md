# API Spec

Initial API surfaces.

## TradingView
`POST /api/v1/webhooks/tradingview`

Flow: authenticate secret, validate payload, idempotency check, map strategy, run risk, validate position, then execution. Never execute TradingView directly against Dhan.

## Future APIs
Strategies, backtests, broker connections, risk profiles, orders, positions, market data and admin audit logs.
