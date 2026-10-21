import { OAuth2Client } from "google-auth-library";
import { readAccountConnection, webhookAccountOwner } from "./accountConnections";
import { listPersistedAlgoSignalEvents } from "./signalStore";
import { readSheets, writeSheets, withSheetsLock, type SheetsConnection } from "./googleSheetsStore";
import type { StoredAlgoEvent } from "./automation";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const sheetsCallback = () => `${process.env.APP_ORIGIN || "https://trade-journal-flax-seven.vercel.app"}/api/integrations/google-sheets/callback`;
export const sheetsConfigured = () => Boolean(process.env.GOOGLE_SHEETS_CLIENT_ID && process.env.GOOGLE_SHEETS_CLIENT_SECRET);
export function sheetsOAuth() {
  if (!sheetsConfigured()) throw new Error("Google Sheets server settings are not configured yet.");
  return new OAuth2Client({ clientId: process.env.GOOGLE_SHEETS_CLIENT_ID, clientSecret: process.env.GOOGLE_SHEETS_CLIENT_SECRET, redirectUri: sheetsCallback(), transporterOptions: { timeout: 10000, retry: false } });
}
const tabs = ["NIFTY", "BTC", "GOLD", "Other"] as const;
export function signalTab(symbol: string) { return /NIFTY/i.test(symbol) ? "NIFTY" : /BTC/i.test(symbol) ? "BTC" : /GOLD|XAU/i.test(symbol) ? "GOLD" : "Other"; }
const columns = ["Received at (IST)", "Signal time (IST)", "Instrument", "Action", "Signal price", "Timeframe", "Status", "Accepted", "Stage", "Reason", "Strategy", "Signal ID"];
const date = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });
export function signalRows(events: StoredAlgoEvent[]) {
  return events.map(event => [date(event.receivedAt), date(event.signal.timestamp), event.signal.symbol, event.signal.action, event.signal.price ?? "", event.signal.timeframe ?? "", event.signal.status, event.decision.accepted ? "Yes" : "No", event.decision.stage, event.decision.reasons.join("; "), event.signal.strategyId, event.signal.id]);
}
const requests = new WeakMap<SheetsConnection, { auth: OAuth2Client; deadline: number }>();
export class SheetsRequestError extends Error {
  constructor(message: string, public readonly safeToRetryCreate = false) { super(message); Object.setPrototypeOf(this, new.target.prototype); }
}
function responseError(status: number, data: { error?: { message?: string; details?: { reason?: string }[] } }) {
  const disabled = data.error?.details?.some(detail => detail.reason === "SERVICE_DISABLED");
  const hint = status === 400 ? "Google rejected the sheet settings."
    : status === 401 ? "Google authorization expired. Reconnect Google Sheets."
    : status === 403 && disabled ? "Enable Google Sheets API in the OAuth client's Google Cloud project."
    : status === 403 ? "Google denied access. Check the granted file permission and Drive storage."
    : status === 404 ? "The Google sheet is missing or access was removed."
    : status === 429 ? "Google's request limit was reached. Wait a minute, then retry."
    : "Google Sheets is temporarily unavailable. Retry sync later.";
  return new SheetsRequestError(`${hint} (SHEETS_HTTP_${status})`, [400, 401, 403, 404, 429].includes(status));
}
async function google(connection: SheetsConnection, path: string, method: string, body?: unknown) {
  let context = requests.get(connection);
  if (!context) { const auth = sheetsOAuth(); auth.setCredentials({ refresh_token: connection.refreshToken }); context = { auth, deadline: Date.now() + 45000 }; requests.set(connection, context); }
  let token: { token?: string | null };
  try { token = await context.auth.getAccessToken(); }
  catch { throw new SheetsRequestError("Google authorization could not be refreshed. Check access or reconnect Google Sheets. (SHEETS_AUTH_REFRESH)", true); }
  if (!token.token) throw new SheetsRequestError("Reconnect Google Sheets. (SHEETS_AUTH_MISSING)", true);
  try {
    if (Date.now() > context.deadline) throw new SheetsRequestError("Report time limit reached. Retry sync. (SHEETS_TIME_LIMIT)", true);
    const result = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, { method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw responseError(result.status, await result.json().catch(() => ({})));
    return await result.json();
  } catch (error) {
    if (error instanceof SheetsRequestError) throw error;
    throw new SheetsRequestError("Google Sheets connection was interrupted. Retry sync; check Drive before retrying creation. (SHEETS_NETWORK)");
  }
}
async function syncUnlocked(user: string, connection: SheetsConnection) {
  if (!connection.sheetId) throw new Error("Create your private sheet first.");
  const secret = await readAccountConnection(user, "webhook");
  if (!secret) throw new Error("Connect your account's signal webhook first.");
  const history = await listPersistedAlgoSignalEvents(secret, 0);
  if (!history.ok) throw new Error("Signal history is unavailable. Previous sheet data was retained.");
  const events = [...history.events].reverse();
  // Rebuild deterministic ranges, rather than append: retries never duplicate signals.
  const reports = tabs.map((tab, sheetId) => ({ tab, sheetId, rows: [columns, ...signalRows(events.filter(e => signalTab(e.signal.symbol) === tab))] }));
  await google(connection, `/${connection.sheetId}:batchUpdate`, "POST", { requests: reports.map(({ sheetId, rows }) => ({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: Math.max(1000, rows.length + 100) } }, fields: "gridProperties.rowCount" } })) });
  const height = Math.max(...reports.map(r => r.rows.length));
  for (let offset = 0; offset < height; offset += 1000) {
    const data = reports.filter(r => r.rows.length > offset).map(r => ({ range: `'${r.tab}'!A${offset + 1}`, values: r.rows.slice(offset, offset + 1000) }));
    await google(connection, `/${connection.sheetId}/values:batchUpdate`, "POST", { valueInputOption: "RAW", data });
  }
  connection.lastSyncedAt = new Date().toISOString(); connection.signalCount = events.length; delete connection.error;
  await writeSheets(user, connection);
}
export async function createSignalSheet(user: string) {
  return withSheetsLock(user, async () => {
    const connection = await readSheets(user);
    if (!connection) throw new Error("Connect Google first.");
    if (!await readAccountConnection(user, "webhook")) throw new Error("Connect your account's signal webhook first.");
    if (!connection.sheetId) {
      if (connection.creationPending) throw new Error("An earlier sheet creation could not be confirmed. Check your Google Drive before disconnecting and reconnecting to try again.");
      connection.creationPending = true;
      await writeSheets(user, connection);
      let sheet;
      try {
        sheet = await google(connection, "", "POST", { properties: { title: "1to2 Trading - Signal Log", locale: "en_US", timeZone: "Asia/Kolkata" }, sheets: tabs.map((title, sheetId) => ({ properties: { title, sheetId, gridProperties: { frozenRowCount: 1, columnCount: columns.length } } })) });
      } catch (error) {
        if (error instanceof SheetsRequestError && error.safeToRetryCreate) delete connection.creationPending;
        connection.error = error instanceof Error ? error.message : "Sheet creation failed.";
        await writeSheets(user, connection);
        throw error;
      }
      if (typeof sheet.spreadsheetId !== "string" || !/^[\w-]+$/.test(sheet.spreadsheetId)) throw new Error("Invalid spreadsheet response.");
      connection.sheetId = sheet.spreadsheetId; connection.enabled = true; delete connection.creationPending;
      // Persist ownership before initial sync, so retry does not create another sheet.
      await writeSheets(user, connection);
    }
    try { await syncUnlocked(user, connection); }
    catch (error) { connection.error = error instanceof Error ? error.message : "Initial sync failed."; await writeSheets(user, connection); throw error; }
  });
}
export async function syncSignalSheet(user: string) {
  return withSheetsLock(user, async () => {
    const connection = await readSheets(user);
    if (!connection?.enabled || !connection.sheetId) return;
    try { await syncUnlocked(user, connection); }
    catch (error) { connection.error = error instanceof Error ? error.message : "Sheet sync failed."; await writeSheets(user, connection); throw error; }
  });
}
export async function syncWebhookSheet(secret: string) {
  try { const user = await webhookAccountOwner(secret); if (user) await syncSignalSheet(user); }
  catch { /* Reporting must never change the outcome of signal delivery. Status is saved for retry. */ }
}
