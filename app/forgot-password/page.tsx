"use client";

import { useState } from "react";
import Link from "next/link";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/reset-password`
      }
    );
    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setStatus("Password reset link sent. Check your inbox.");
  }

  return (
    <main className="min-h-screen bg-ink text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid opacity-70" />
        <div className="absolute -top-40 left-1/3 h-[420px] w-[420px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-white/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <div className="card w-full max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Reset password</h2>
              <p className="text-sm text-muted">We’ll email you a reset link.</p>
            </div>
            <Link href="/sign-in" className="text-xs text-muted hover:text-white">
              Back to sign in
            </Link>
          </div>

          <form className="space-y-4" onSubmit={handleReset}>
            <div>
              <label className="text-xs text-muted">Email</label>
              <input
                type="email"
                placeholder="you@domain.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm text-white"
                required
              />
            </div>
            {error && <p className="text-xs text-negative">{error}</p>}
            {status && <p className="text-xs text-positive">{status}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white"
              disabled={loading}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
            {!isSupabaseConfigured && (
              <p className="text-[11px] text-muted">
                Supabase keys are missing. Add them to use auth.
              </p>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
