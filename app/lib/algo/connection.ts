import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";

const NAME = "algo_connection";
function key() {
  const value = process.env.ALGO_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Connection encryption is not configured.");
  return createHash("sha256").update(value).digest();
}
export function saveConnection(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  cookies().set(NAME, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/api/algo", maxAge: 90 * 24 * 60 * 60
  });
}
export function connectionSecret() {
  try {
    const value = cookies().get(NAME)?.value;
    if (!value) return "";
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
  } catch { return ""; }
}
export function clearConnection() { cookies().delete(NAME); }
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
