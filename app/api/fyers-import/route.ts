import { NextResponse } from "next/server";
import { recognize } from "tesseract.js";
import { buildFyersImportCandidate, extractFyersRowsFromText } from "../../lib/fyersImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstrumentDefinition = {
  id: string;
  name: string;
  lotSize: number;
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const rawInstruments = formData.get("instruments");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    const instruments: InstrumentDefinition[] = (() => {
      if (typeof rawInstruments !== "string") return [];
      try {
        const parsed = JSON.parse(rawInstruments);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await recognize(buffer, "eng");
    const rows = extractFyersRowsFromText(result.data.text || "");
    const candidate = buildFyersImportCandidate(rows, instruments);

    if (!candidate) {
      return NextResponse.json(
        {
          error:
            "Could not read a completed FYERS trade from this image. Try a clearer screenshot with the filled orders visible.",
          detectedRows: rows
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ candidate, detectedRows: rows });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "FYERS import failed. Please try again."
      },
      { status: 500 }
    );
  }
}
