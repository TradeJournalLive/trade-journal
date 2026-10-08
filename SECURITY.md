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
