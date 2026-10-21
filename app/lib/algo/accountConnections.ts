import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { getServerSupabase } from "./signalStore";

export const ACCOUNT_COOKIE = "algo_account_session";
type Kind = "webhook" | "fyers";
const STRATEGY = "__account_connections__";
function db() { const value = getServerSupabase(); if (!value) throw new Error("Connection storage unavailable."); return value; }
export async function accountId() {
  const authorization = headers().get("authorization");
  const token = authorization !== null ? (/^Bearer ([^\s]+)$/.exec(authorization)?.[1] || "") : cookies().get(ACCOUNT_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}
function key() {
  const value = process.env.ALGO_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Encryption unavailable.");
  return createHash("sha256").update(`account:${value}`).digest();
}
function seal(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
function open(value: string) {
  const b = Buffer.from(value, "base64url"), cipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString("utf8");
}
function internalKey(value: string) { return createHmac("sha256", key()).update(value).digest("hex"); }
function owner(user: string) { return internalKey(`account:${user}`); }
function row(user: string, kind: Kind, payload: Record<string, unknown>) {
  const at = new Date().toISOString();
  return { secret_hash: owner(user), strategy_id: STRATEGY, signal_id: kind, symbol: "ACCOUNT", action: "EXIT", received_at: at, signal_timestamp: at, status: "VALIDATED", accepted: false, execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", signal: {}, decision: {}, raw_payload: payload };
}
export async function readAccountConnection(user: string, kind: Kind) {
  const { data, error } = await db().from("tradingview_signal_events").select("raw_payload").eq("secret_hash", owner(user)).eq("strategy_id", STRATEGY).eq("signal_id", kind).maybeSingle();
  if (error) throw new Error("Unable to read account connection.");
  return data?.raw_payload?.sealed ? open(data.raw_payload.sealed) : null;
}
export async function bindAccountConnection(user: string, kind: Kind, value: string) {
  // A unique immutable claim prevents two accounts from attaching the same legacy connection.
  const claim = { ...row(user, kind, { user }), secret_hash: internalKey(`claim:${kind}:${value}`) };
  const { error } = await db().from("tradingview_signal_events").upsert(claim, { onConflict: "secret_hash,strategy_id,signal_id", ignoreDuplicates: true });
  if (error) throw new Error("Unable to reserve connection ownership.");
  const { data, error: readError } = await db().from("tradingview_signal_events").select("raw_payload").eq("secret_hash", claim.secret_hash).eq("strategy_id", STRATEGY).eq("signal_id", kind).single();
  if (readError || data.raw_payload?.user !== user) throw new Error("This connection belongs to another account.");
  const existing = await readAccountConnection(user, kind);
  if (existing && existing !== value) throw new Error("Disconnect the account connection before replacing it.");
  const saved = await db().from("tradingview_signal_events").upsert(row(user, kind, { sealed: seal(value) }), { onConflict: "secret_hash,strategy_id,signal_id", ignoreDuplicates: true });
  if (saved.error) throw new Error("Unable to save account connection.");
  if (await readAccountConnection(user, kind) !== value) throw new Error("Another connection was linked first. Reload before continuing.");
}
export async function unlinkAccountConnection(user: string, kind: Kind) {
  const { error } = await db().from("tradingview_signal_events").delete().eq("secret_hash", owner(user)).eq("strategy_id", STRATEGY).eq("signal_id", kind);
  if (error) throw new Error("Unable to disconnect account connection.");
}

// Background reporting resolves only the current owner of an already-linked webhook.
export async function webhookAccountOwner(secret: string) {
  const claim = await db().from("tradingview_signal_events").select("raw_payload").eq("secret_hash", internalKey(`claim:webhook:${secret}`)).eq("strategy_id", STRATEGY).eq("signal_id", "webhook").maybeSingle();
  if (claim.error) throw new Error("Unable to resolve signal owner.");
  const user = claim.data?.raw_payload?.user;
  return typeof user === "string" && await readAccountConnection(user, "webhook") === secret ? user : null;
}
