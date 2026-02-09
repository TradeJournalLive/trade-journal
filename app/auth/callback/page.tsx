"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Completing sign in...");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorDesc =
      params.get("error_description") || params.get("error") || "";

    if (errorDesc) {
      setError(errorDesc);
      return;
    }

    if (!code) {
      setError("Missing auth code. Please try signing in again.");
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        setStatus("Signed in. Redirecting...");
        router.replace("/dashboard");
      })
      .catch(() => {
        setError("Unable to complete sign in. Please try again.");
      });
  }, [router]);

  return (
    <main className="min-h-screen bg-ink text-white flex items-center justify-center">
      <div className="card text-sm text-muted">
        {error ? `Sign-in failed: ${error}` : status}
      </div>
    </main>
  );
}
