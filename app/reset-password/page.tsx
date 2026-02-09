"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export default function ResetPasswordPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setChecking(false);
    });
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function handleUpdate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }

    if (!session) {
      setError("Reset link expired. Request a new one.");
      return;
    }

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setStatus("Password updated. You can sign in now.");
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
              <h2 className="text-2xl font-semibold">Set a new password</h2>
              <p className="text-sm text-muted">
                Choose a secure password for your account.
              </p>
            </div>
            <Link href="/sign-in" className="text-xs text-muted hover:text-white">
              Back to sign in
            </Link>
          </div>

          {checking && (
            <p className="text-xs text-muted">Validating reset link...</p>
          )}

          {!checking && !session && (
            <div className="space-y-2 text-xs text-muted">
              <p>Reset link expired or invalid.</p>
              <Link href="/forgot-password" className="text-white">
                Request a new reset link
              </Link>
            </div>
          )}

          {!checking && session && (
            <form className="space-y-4" onSubmit={handleUpdate}>
              <div>
                <label className="text-xs text-muted">New password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm text-white"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted">Confirm password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
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
                {loading ? "Updating..." : "Update password"}
              </button>
              {!isSupabaseConfigured && (
                <p className="text-[11px] text-muted">
                  Supabase keys are missing. Add them to use auth.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
