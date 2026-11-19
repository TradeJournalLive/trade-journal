# Paper Incident Reporting

The on-demand Incidents and interruptions section reads only the signed-in account's Current or HAMS history. It does not require an open position or a FYERS history request. Closed/reconstructed incidents remain visible.

The API combines dedicated __paper_incident__ archive rows with original checkpoint incidents. Older incidents without request evidence are explicitly labelled incomplete. A reporting failure returns an error, not a successful empty list. Responses are private/no-store; known secrets, authorization fields, bearer tokens, JWTs and URL queries are redacted. No automatic polling is added.

New worker captures identify actual HTTP service/route/method, returned status and request ID where supplied, pending request age, nested error causes, local free storage/inodes and worker memory/CPU. A panel credential-bridge timeout is labelled VERCEL_PANEL rather than being inferred to be a FYERS rejection. Provider fault remains UNCONFIRMED unless independent evidence supports attribution.

This reporting release does not remove the existing Supabase ownership dependency or deploy the independent shadow runner. It is not a zero-missed-trade guarantee.
