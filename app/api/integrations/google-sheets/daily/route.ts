import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSupabase } from "../../../../lib/algo/signalStore";
import { syncSignalSheet } from "../../../../lib/algo/googleSheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.SHEETS_DAILY_SYNC_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getServerSupabase();
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let failures = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 50 });
    if (error) return NextResponse.json({ error: "Account lookup failed" }, { status: 503 });
    for (const user of data.users) {
      try { await syncSignalSheet(user.id, date); }
      catch { failures++; }
    }
    if (data.users.length < 50) break;
  }
  return NextResponse.json({ failures }, { status: failures ? 502 : 200 });
}
