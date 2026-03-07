import { NextResponse } from "next/server";

function randomId(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

export async function POST(request: Request) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase env is missing." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { payload?: unknown };
  if (!body.payload) {
    return NextResponse.json({ error: "Missing payload." }, { status: 400 });
  }

  const id = randomId(10);
  const response = await fetch(`${url}/rest/v1/shared_journal_links`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify([
      {
        id,
        payload: body.payload
      }
    ])
  });

  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: `Create failed: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ id });
}

export async function GET(request: Request) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return NextResponse.json(
      { error: "Supabase env is missing." },
      { status: 500 }
    );
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const response = await fetch(
    `${url}/rest/v1/shared_journal_links?select=payload&id=eq.${encodeURIComponent(
      id
    )}&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      cache: "no-store"
    }
  );
  if (!response.ok) {
    const message = await response.text();
    return NextResponse.json(
      { error: `Fetch failed: ${message}` },
      { status: 500 }
    );
  }
  const rows = (await response.json()) as Array<{ payload: unknown }>;
  if (!rows.length) {
    return NextResponse.json({ error: "Share link not found." }, { status: 404 });
  }
  return NextResponse.json({ payload: rows[0].payload });
}

