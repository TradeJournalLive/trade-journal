import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

type DhanCheck = {
  name: string;
  ok: boolean;
  status?: number;
  message: string;
  count?: number;
  data?: unknown;
};

type DhanPayload = {
  clientId?: string;
  accessToken?: string;
};

function compactMessage(value: unknown) {
  if (!value) return "No response body";
  if (typeof value === "string") return value.slice(0, 180);
  if (typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return String((value as { message: string }).message).slice(0, 180);
  }
  if (typeof value === "object" && "errorMessage" in value && typeof (value as { errorMessage?: unknown }).errorMessage === "string") {
    return String((value as { errorMessage: string }).errorMessage).slice(0, 180);
  }
  return "Dhan returned a non-success response.";
}

async function readDhan(path: string, name: string, headers: HeadersInit): Promise<DhanCheck> {
  try {
    const response = await fetch(`${DHAN_BASE_URL}${path}`, {
      method: "GET",
      headers,
      cache: "no-store"
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    const count = Array.isArray(data) ? data.length : undefined;

    if (!response.ok) {
      return {
        name,
        ok: false,
        status: response.status,
        message: compactMessage(data),
        count
      };
    }

    return {
      name,
      ok: true,
      status: response.status,
      message: count === undefined ? "Read successfully" : `${count} record${count === 1 ? "" : "s"} returned`,
      count,
      data
    };
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : "Request failed"
    };
  }
}

export async function POST(request: Request) {
  let payload: DhanPayload;

  try {
    payload = (await request.json()) as DhanPayload;
  } catch {
    return NextResponse.json({ connected: false, error: "Invalid request body." }, { status: 400 });
  }

  const clientId = payload.clientId?.trim();
  const accessToken = payload.accessToken?.trim();

  if (!clientId || !accessToken) {
    return NextResponse.json(
      { connected: false, error: "Dhan client ID and access token are required." },
      { status: 400 }
    );
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "access-token": accessToken,
    "client-id": clientId
  };

  const checks = await Promise.all([
    readDhan("/profile", "Profile", headers),
    readDhan("/fundlimit", "Funds", headers),
    readDhan("/positions", "Positions", headers),
    readDhan("/orders", "Orders", headers)
  ]);

  const profileCheck = checks.find((check) => check.name === "Profile");
  const fundsCheck = checks.find((check) => check.name === "Funds");
  const positionsCheck = checks.find((check) => check.name === "Positions");
  const ordersCheck = checks.find((check) => check.name === "Orders");
  const connected = checks.every((check) => check.ok);

  return NextResponse.json(
    {
      connected,
      testedAt: new Date().toISOString(),
      checks: checks.map(({ data, ...check }) => check),
      profile: profileCheck?.ok ? profileCheck.data : undefined,
      funds: fundsCheck?.ok ? fundsCheck.data : undefined,
      positionsCount: positionsCheck?.count ?? 0,
      ordersCount: ordersCheck?.count ?? 0,
      error: connected ? undefined : "One or more Dhan read checks failed. Check token validity, API access, and IP restrictions."
    },
    { status: connected ? 200 : 502 }
  );
}
