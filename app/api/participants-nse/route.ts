import { NextResponse } from "next/server";

type ParticipantType = "FII" | "DII" | "Client" | "Pro";

type ParticipantFlow = {
  id: string;
  date: string;
  participant: ParticipantType;
  futureBoughtQty: number;
  futureSoldQty: number;
  callBoughtQty: number;
  putBoughtQty: number;
  callSoldQty: number;
  putSoldQty: number;
};

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNumber(value: string) {
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapParticipant(value: string): ParticipantType | null {
  const v = value.toLowerCase();
  if (v.includes("fii") || v.includes("fpi")) return "FII";
  if (v.includes("dii")) return "DII";
  if (v.includes("pro")) return "Pro";
  if (v.includes("client")) return "Client";
  return null;
}

function toDateStamp(date: Date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

function toIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function pickIndexes(
  header: string[],
  preferredTokens: string[],
  fallbackTokens: string[]
) {
  const preferredWithContracts = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        preferredTokens.every((token) => h.includes(token)) &&
        h.includes("contracts") &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (preferredWithContracts.length) return preferredWithContracts;

  const preferred = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        preferredTokens.every((token) => h.includes(token)) &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (preferred.length) return preferred;

  const fallbackWithContracts = header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        fallbackTokens.every((token) => h.includes(token)) &&
        h.includes("contracts") &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
  if (fallbackWithContracts.length) return fallbackWithContracts;

  return header
    .map((h, idx) => ({ h, idx }))
    .filter(
      ({ h }) =>
        fallbackTokens.every((token) => h.includes(token)) &&
        !h.includes("value")
    )
    .map(({ idx }) => idx);
}

export async function GET(request: Request) {
  const bases = [
    "https://archives.nseindia.com/content/nsccl",
    "https://www1.nseindia.com/content/nsccl"
  ];
  const errors: string[] = [];

  const requestDate = new URL(request.url).searchParams.get("date");
  const candidateDates: Date[] = [];
  if (requestDate) {
    const parsed = new Date(`${requestDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      candidateDates.push(parsed);
    }
  }
  if (!candidateDates.length) {
    for (let offset = 0; offset < 21; offset += 1) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      candidateDates.push(d);
    }
  }

  for (const d of candidateDates) {
    const stamp = toDateStamp(d);
    const isoDate = toIso(d);
    const filename = `fao_participant_oi_${stamp}.csv`;

    for (const base of bases) {
      const url = `${base}/${filename}`;
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            accept: "text/csv,*/*"
          },
          next: { revalidate: 1800 }
        });
        if (!response.ok) {
          errors.push(`${stamp}:${response.status}`);
          continue;
        }
        const csv = await response.text();
        const lines = csv
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length < 2) continue;

        let headerIndex = -1;
        let clientIdx = -1;
        let futureLongIndexes: number[] = [];
        let futureShortIndexes: number[] = [];
        let callLongIndexes: number[] = [];
        let putLongIndexes: number[] = [];
        let callShortIndexes: number[] = [];
        let putShortIndexes: number[] = [];

        for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
          const header = parseCsvLine(lines[i]).map(normalize);
          const cIdx = header.findIndex((h) => h.includes("clienttype"));
          // Prefer index derivatives columns to match the compact activity view.
          const futLongIdxs = pickIndexes(
            header,
            ["future", "index", "long"],
            ["future", "long"]
          );
          const futShortIdxs = pickIndexes(
            header,
            ["future", "index", "short"],
            ["future", "short"]
          );
          const callLongIdxs = pickIndexes(
            header,
            ["option", "index", "call", "long"],
            ["option", "call", "long"]
          );
          const putLongIdxs = pickIndexes(
            header,
            ["option", "index", "put", "long"],
            ["option", "put", "long"]
          );
          const callIdxs = pickIndexes(
            header,
            ["option", "index", "call", "short"],
            ["option", "call", "short"]
          );
          const putIdxs = pickIndexes(
            header,
            ["option", "index", "put", "short"],
            ["option", "put", "short"]
          );
          if (
            cIdx >= 0 &&
            futLongIdxs.length &&
            futShortIdxs.length &&
            callLongIdxs.length &&
            putLongIdxs.length &&
            callIdxs.length &&
            putIdxs.length
          ) {
            headerIndex = i;
            clientIdx = cIdx;
            futureLongIndexes = futLongIdxs;
            futureShortIndexes = futShortIdxs;
            callLongIndexes = callLongIdxs;
            putLongIndexes = putLongIdxs;
            callShortIndexes = callIdxs;
            putShortIndexes = putIdxs;
            break;
          }
        }

        if (headerIndex < 0) {
          errors.push(`${stamp}:header-not-found`);
          continue;
        }

        const items: ParticipantFlow[] = [];
        for (let i = headerIndex + 1; i < lines.length; i += 1) {
          const row = parseCsvLine(lines[i]);
          const participant = mapParticipant(row[clientIdx] ?? "");
          if (!participant) continue;
          const futureBoughtQty = futureLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const futureSoldQty = futureShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const callBoughtQty = callLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const putBoughtQty = putLongIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const callSoldQty = callShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          const putSoldQty = putShortIndexes.reduce(
            (sum, idx) => sum + toNumber(row[idx] ?? "0"),
            0
          );
          items.push({
            id: `NSE-${stamp}-${participant}`,
            date: isoDate,
            participant,
            futureBoughtQty,
            futureSoldQty,
            callBoughtQty,
            putBoughtQty,
            callSoldQty,
            putSoldQty
          });
        }

        if (items.length) {
          return NextResponse.json({
            source: "NSE",
            date: isoDate,
            items
          });
        }
        errors.push(`${stamp}:no-mapped-items`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown-fetch-error";
        errors.push(`${stamp}:${message}`);
        continue;
      }
    }
  }

  return NextResponse.json(
    {
      error: "Could not fetch participant data from NSE right now.",
      details: errors.slice(0, 6)
    },
    { status: 503 }
  );
}
