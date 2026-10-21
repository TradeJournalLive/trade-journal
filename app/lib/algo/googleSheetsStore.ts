import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "crypto";
import { getServerSupabase } from "./signalStore";

const strategy = "__google_sheets__";
export type SheetsConnection = { refreshToken: string; sheetId?: string; creationPending?: boolean; enabled: boolean; lastSyncedAt?: string; signalCount?: number; tradeCount?: number; error?: string };
function key() {
  const value = process.env.ALGO_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Connection encryption unavailable.");
  return createHash("sha256").update(`google-sheets:${value}`).digest();
}
export function sealSheets(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function openSheets<T>(value: string): T {
  const b = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString("utf8"));
}
function db() { const result = getServerSupabase(); if (!result) throw new Error("Reporting storage unavailable."); return result; }
function owner(user: string) { return createHmac("sha256", key()).update(user).digest("hex"); }
function row(user: string, id: string, payload: object) {
  const now = new Date().toISOString();
  return { secret_hash: owner(user), strategy_id: strategy, signal_id: id, symbol: "SHEETS", action: "EXIT", received_at: now, signal_timestamp: now, status: "VALIDATED", accepted: false, execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", signal: {}, decision: {}, raw_payload: payload };
}
function query(user: string, id: string) { return db().from("tradingview_signal_events").select("raw_payload").eq("secret_hash", owner(user)).eq("strategy_id", strategy).eq("signal_id", id); }
export async function readSheets(user: string) {
  const { data, error } = await query(user, "connection").maybeSingle();
  if (error) throw new Error("Unable to read Sheets connection.");
  return data?.raw_payload?.sealed ? openSheets<SheetsConnection>(data.raw_payload.sealed) : null;
}
export async function writeSheets(user: string, value: SheetsConnection | null) {
  const { error } = await db().from("tradingview_signal_events").upsert(row(user, "connection", value ? { sealed: sealSheets(value) } : {}), { onConflict: "secret_hash,strategy_id,signal_id" });
  if (error) throw new Error("Unable to save Sheets connection.");
}
export async function consumeSheetsState(user: string, nonce: string) {
  const { error } = await db().from("tradingview_signal_events").insert(row(user, `oauth:${nonce}`, {}));
  if (error) throw new Error("Google connection request expired or already used.");
}
// Database lease serializes create/sync/disconnect across devices and Vercel instances.
export async function withSheetsLock<T>(user: string, work: () => Promise<T>): Promise<T> {
  const lease = randomUUID(), payload = { lease, until: Date.now() + 180000 };
  const previous = await query(user, "lease").maybeSingle();
  if (previous.error) throw new Error("Unable to lock reporting connection.");
  if (previous.data?.raw_payload?.until > Date.now()) throw new Error("Sheets is busy. Retry shortly.");
  if (!previous.data) {
    const created = await db().from("tradingview_signal_events").insert(row(user, "lease", payload));
    if (created.error) throw new Error("Sheets is busy. Retry shortly.");
  } else {
    const updated = await db().from("tradingview_signal_events").update({ raw_payload: payload }).eq("secret_hash", owner(user)).eq("strategy_id", strategy).eq("signal_id", "lease").eq("raw_payload->>lease", previous.data.raw_payload.lease).select("signal_id");
    if (updated.error || !updated.data?.length) throw new Error("Sheets is busy. Retry shortly.");
  }
  try { return await work(); }
  finally {
    await db().from("tradingview_signal_events").update({ raw_payload: { lease, until: 0 } }).eq("secret_hash", owner(user)).eq("strategy_id", strategy).eq("signal_id", "lease").eq("raw_payload->>lease", lease);
  }
}
