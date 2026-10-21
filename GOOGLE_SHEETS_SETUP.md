# Private signal reports

This is separate from Supabase Google sign-in and broker credentials. Never
replace the existing sign-in client with the Sheets client.

## Server settings

Create a Google OAuth **Web application** with the Sheets API enabled and the
`https://www.googleapis.com/auth/drive.file` scope. Register this exact callback:

`https://trade-journal-flax-seven.vercel.app/api/integrations/google-sheets/callback`

Set `GOOGLE_SHEETS_CLIENT_ID` and `GOOGLE_SHEETS_CLIENT_SECRET` in the production
**trade-journal** Vercel project. They are server-only variables; do not use
`NEXT_PUBLIC_` names. Redeploy after changing them. OAuth JSON files must never
be committed. The existing server connection encryption key is also required.

While Google's app audience is Testing, add each test Google account under
Audience > Test users. Google may expire test refresh tokens after seven days;
publish/configure the production consent screen before claiming permanent
connections for other users. Follow Google's verification requirements.

## User flow

1. Sign into the panel and link the account's existing webhook if needed.
2. Signals > Google Sheets > Connect Google Sheets; approve the separate consent.
3. Click Create my private sheet and confirm. No sheet is created by login alone.
4. Open sheet, Sync now, pause/resume auto-sync, or disconnect from this section.

Creation makes no sharing-permission calls. Google Drive organizational sharing
policies still apply; check Drive's sharing settings before assuming privacy.
Disconnect stops this app using the token but does not delete the sheet or revoke
Google's entire project grant (which may also include the existing login app).
Users can manage Google's grant from their Google account permissions page.
Reconnect starts a fresh report so a new Google account cannot inherit another
Google account's sheet ID.

## Data and reliability

Reports include all durably stored **signals**, not paper-trade results, tokens,
raw webhook payloads or broker credentials. Separate NIFTY/BTC/GOLD/Other tabs
contain received time, signal time (IST), symbol, action, price, timeframe,
validation status, decision, reason, strategy and signal ID.

Supabase remains the source of truth. Writes use RAW values (no formula execution)
and deterministic snapshot ranges rather than append, avoiding duplicated rows on
retry. App-owned tabs are overwritten by sync; do not manually edit their data.

After a persisted webhook, a Vercel `waitUntil` task attempts sync outside the
signal response path. No change is made to trading rules or worker services.
Database leases serialize report create/sync/disconnect across instances. If a
reporting attempt fails, later signals, Sync now or the visible Signals panel's
one-minute retry can catch up from stored history. This is **not** an independent
always-on retry queue; a Google outage after the last signal needs one of those
retry triggers. Large histories may hit the function time limit and need a
dedicated incremental reporting worker before large-scale rollout.

Validate before rollout: real Google consent, create one sheet, inspect sharing,
sync twice without duplicate rows, pause, disconnect, test a different panel
account, and verify both paper workers remain unaffected. Mock tests are not a
substitute for this signed-in end-to-end acceptance check.
