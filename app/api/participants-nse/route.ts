import { NextResponse } from "next/server";

type ParticipantType = "FII" | "DII" | "Client" | "Pro";

type ParticipantFlow = {
  id: string;
  date: string;
  participant: ParticipantType;
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

export async function GET() {
  const bases = [
    "https://nsearchives.nseindia.com/content/nsccl",
    "https://www1.nseindia.com/content/nsccl"
  ];

  for (let offset = 0; offset < 8; offset += 1) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
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
        if (!response.ok) continue;
        const csv = await response.text();
        const lines = csv
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length < 2) continue;

        const header = parseCsvLine(lines[0]).map(normalize);
        const clientIdx = header.findIndex((h) => h.includes("clienttype"));
        const callShortIndexes = header
          .map((h, idx) => ({ h, idx }))
          .filter(
            ({ h }) =>
              h.includes("option") && h.includes("call") && h.includes("short")
          )
          .map(({ idx }) => idx);
        const putShortIndexes = header
          .map((h, idx) => ({ h, idx }))
          .filter(
            ({ h }) =>
              h.includes("option") && h.includes("put") && h.includes("short")
          )
          .map(({ idx }) => idx);

        if (clientIdx < 0 || !callShortIndexes.length || !putShortIndexes.length) {
          continue;
        }

        const items: ParticipantFlow[] = [];
        for (let i = 1; i < lines.length; i += 1) {
          const row = parseCsvLine(lines[i]);
          const participant = mapParticipant(row[clientIdx] ?? "");
          if (!participant) continue;
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
      } catch {
        continue;
      }
    }
  }

  return NextResponse.json(
    { error: "Could not fetch participant data from NSE right now." },
    { status: 503 }
  );
}
