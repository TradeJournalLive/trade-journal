import { NextResponse } from "next/server";
import { listAlgoEvents } from "../../../lib/algo/automation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ events: listAlgoEvents() });
}
