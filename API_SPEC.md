# API Spec

Initial API surfaces.

## TradingView
`POST /api/v1/webhooks/tradingview`

Flow: authenticate secret, validate payload, idempotency check, map strategy, run risk, validate position, then execution. Never execute TradingView directly against Dhan.

## Future APIs
Strategies, backtests, broker connections, risk profiles, orders, positions, market data and admin audit logs.


## TradingView Indicator Performance

`POST /api/v1/webhooks/tradingview` accepts TradingView alert payloads and normalizes them into the universal Signal model.

Required fields: `secret`, `strategyId`, `signalId`, `symbol`, `action`, `timestamp`.

Supported actions: `BUY`, `SELL`, `EXIT`, `CLOSE_LONG`, `CLOSE_SHORT`.

Optional fields: `price`, `quantity`, `strike`, `optionType`, `expiry`, `underlying`, `stopLoss`, `target`, `confidence`, `indicatorValue`, `alertName`, `metadata`.

Security implemented in the route scaffold:
- shared secret validation through `TRADINGVIEW_WEBHOOK_SECRET`;
- optional HMAC validation through `TRADINGVIEW_WEBHOOK_HMAC_SECRET`;
- timestamp replay-window validation;
- request schema validation;
- in-process duplicate signal rejection.

Production persistence still needs WebhookEvent, Signal, RiskEvent and async queue storage so webhook handling stays fast.
