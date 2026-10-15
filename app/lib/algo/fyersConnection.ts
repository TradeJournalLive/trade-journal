import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getServerSupabase, hashWebhookSecret } from "./signalStore";

const COOKIE = "fyers_device";
const STRATEGY = "__fyers_connection__";
export type FyersConnection = { appId: string; secret: string; accessToken?: string; state?: string; stateExpires?: number };
function key() {
  const value = process.env.ALGO_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Connection encryption is unavailable.");
  return createHash("sha256").update(`fyers:${value}`).digest();
}
export function sealFyers(value: FyersConnection) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openFyers(value: string): FyersConnection {
  const data = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"));
}
export function fyersDevice(create = false) {
  const previous = cookies().get(COOKIE)?.value;
  if (previous && /^[a-f0-9]{64}$/.test(previous)) return previous;
  if (!create) return "";
  const id = randomBytes(32).toString("hex");
  cookies().set(COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/brokers/fyers", maxAge: 30 * 86400 });
  return id;
}
export function clearFyersDevice() {
  cookies().set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/brokers/fyers", maxAge: 0 });
}
export async function readFyers(id: string) {
  if (!id) return null;
  const db = getServerSupabase();
  if (!db) throw new Error("Connection storage is unavailable.");
  const { data, error } = await db.from("tradingview_signal_events").select("raw_payload").eq("secret_hash", hashWebhookSecret(id)).eq("strategy_id", STRATEGY).eq("signal_id", "credentials").maybeSingle();
  if (error) throw new Error("Unable to read saved connection.");
  return data?.raw_payload?.sealed ? openFyers(data.raw_payload.sealed) : null;
}
export async function writeFyers(id: string, value: FyersConnection | null) {
  const db = getServerSupabase();
  if (!db) throw new Error("Connection storage is unavailable.");
  const now = new Date().toISOString();
  const { error } = await db.from("tradingview_signal_events").upsert({
    secret_hash: hashWebhookSecret(id), strategy_id: STRATEGY, signal_id: "credentials", symbol: "FYERS", action: "EXIT",
    received_at: now, signal_timestamp: now, status: "VALIDATED", accepted: false, execution_mode: "PAPER", stage: "SIGNAL_RECEIVED", reason: "Read-only broker connection",
    signal: { id: "credentials", strategyId: STRATEGY, source: "TRADINGVIEW", symbol: "FYERS", action: "EXIT", timestamp: now, createdAt: now, metadata: {}, status: "VALIDATED" },
    decision: {}, raw_payload: value ? { sealed: sealFyers(value) } : {}
  }, { onConflict: "secret_hash,strategy_id,signal_id" });
  if (error) throw new Error("Unable to save encrypted connection.");
}
export const fyersCallback = () => `${process.env.APP_ORIGIN || "https://trade-journal-flax-seven.vercel.app"}/api/brokers/fyers/callback`;
