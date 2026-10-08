# Security

## Rules
- Never expose Dhan tokens or broker credentials to the browser.
- Use encrypted server-side secret storage.
- Authenticate TradingView webhooks with a per-strategy secret.
- Enforce idempotency for all external signals.
- Log risk rejections and emergency actions.
- Keep EXIT ALL visible and require confirmation.

## Current State
The UI is scaffolded. Live broker execution must wait for server-side adapter and secure credential storage.


## TradingView Webhook Security

TradingView must never execute directly against a broker. The webhook receiver only validates, normalizes and queues a signal for risk and execution processing.

Required production controls:
- HTTPS only;
- per-strategy webhook secret;
- optional HMAC signature;
- timestamp validation;
- idempotency and duplicate signal detection;
- audit logging for received, rejected and duplicate signals;
- async processing to avoid webhook timeouts;
- rate limiting where practical.
