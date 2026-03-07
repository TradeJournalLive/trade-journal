"use client";

import { useEffect, useState } from "react";
import JournalDailyClient from "./JournalDailyClient";
import type { SharedPayload } from "./types";

export default function JournalDailyLoader({ id }: { id: string }) {
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/share-journal?id=${encodeURIComponent(id)}`, {
          cache: "no-store"
        });
        const data = (await response.json()) as {
          payload?: SharedPayload;
          error?: string;
        };
        if (!mounted) return;
        if (!response.ok || !data.payload) {
          setError(data.error || "Could not load shared journal.");
          return;
        }
        setPayload(data.payload);
      } catch {
        if (!mounted) return;
        setError("Could not load shared journal.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (!payload) {
    return (
      <main className="min-h-screen bg-ink px-4 py-12 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-panel/60 p-6">
          <h1 className="text-xl font-semibold">Shared journal</h1>
          <p className="mt-2 text-sm text-muted">
            {error || "Loading..."}
          </p>
        </div>
      </main>
    );
  }

  return <JournalDailyClient payload={payload} />;
}

