# Account connection migration

## User Steps

1. Sign in to the new panel with the Supabase account that should own the setup.
2. Open TradingView connection and enter the existing webhook secret from the TradingView alert.
3. Select **Recover existing setup**. Recovery succeeds only when the secret matches saved Supabase signal history and the immutable ownership claim is available to this account.
4. Open the signal workspace; history loads from the existing Supabase records. TradingView alerts and the paused legacy panel are not changed.

The existing webhook secret, encrypted FYERS record and trade-history partition are retained. No worker is created or restarted by linking. A different email is a different account, even if both emails belong to the same person. An expired broker session still needs renewed authorization, but saved stats do not require broker login.

## Security Boundaries

- The server verifies Supabase identity for connection lookups. Client-supplied user IDs do not determine ownership.
- Algo/FYERS requests include the current Supabase access token. Explicit invalid authorization never falls back to a different account's cookie. Off-origin account requests are rejected before tokens are attached.
- Connection mappings are encrypted; internal partition identifiers use a server-keyed HMAC.
- Recovery requires an authenticated Supabase account, a same-origin POST, possession of the webhook secret, and matching existing Supabase signal history. It does not rely on the old browser cookie.
- Immutable unique ownership claims prevent cross-account reuse. Disconnecting does not transfer ownership.
- Same-account concurrent linking is first-writer-wins. A second device cannot silently replace a connection.
- Account changes remount the protected workspace. Sign-out clears the server session cookie.
- Linking endpoints return status only, never broker credentials or webhook secrets.
- Database encryption keys and service-role credentials must never be exposed to browsers or committed.

## Operational Notes

Account records use the existing service-role-only `tradingview_signal_events` table under a reserved internal strategy and keyed partitions. No new database schema is required. Preserve its RLS restrictions: browser roles must not access or modify these records directly.

The Mac paper workers still use their existing configuration. This change enables account-based viewing and broker connection access; it does not provide independent online workers for other users.

Rollback consists of deploying the previous application revision. Do not delete trade history, credential rows or ownership claims. Original-browser cookies are retained for compatibility; new-device access requires the account-aware release.

Tests cover account isolation, forged identity, CSRF, concurrent claims, encryption tampering, explicit migration and logout. A signed-in two-device production check is still required after the owner completes linking. No security implementation can promise zero risk; independent review is recommended before public multi-user trading deployment.
