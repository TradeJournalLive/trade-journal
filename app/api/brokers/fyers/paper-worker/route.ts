import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readAccountConnection, webhookAccountOwner } from "../../../../lib/algo/accountConnections";
import { readFyers } from "../../../../lib/algo/fyersConnection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const reply = (value: object, status: number) => NextResponse.json(value, { status, headers });

export async function POST(request: Request) {
  const expected = process.env.PAPER_WORKER_ACCESS_KEY_HASH;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return reply({}, 404);

  const accessKey = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!accessKey || !timingSafeEqual(createHash("sha256").update(accessKey).digest(), Buffer.from(expected, "hex"))) {
    return reply({ code: "PAPER_WORKER_ACCESS_DENIED" }, 401);
  }

  const webhookSecret = request.headers.get("x-paper-webhook-secret");
  if (!webhookSecret || webhookSecret.length > 2048) return reply({ code: "PAPER_WORKER_WEBHOOK_REQUIRED" }, 400);

  try {
    const user = await webhookAccountOwner(webhookSecret);
    if (!user) return reply({ code: "LINK_WEBHOOK_TO_ACCOUNT_FIRST" }, 409);
    const device = await readAccountConnection(user, "fyers");
    const connection = device ? await readFyers(device) : null;
    if (!connection?.accessToken || !/^[A-Za-z0-9]{5,76}-100$/.test(connection.appId)) {
      return reply({ code: "FYERS_LOGIN_REQUIRED" }, 409);
    }
    return reply({ appId: connection.appId, accessToken: connection.accessToken }, 200);
  } catch {
    return reply({ code: "PAPER_WORKER_CONNECTION_UNAVAILABLE" }, 503);
  }
}
