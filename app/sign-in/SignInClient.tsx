"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export default function SignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const signupParam = searchParams.get("signup");
  const signupMessage =
    signupParam === "email"
      ? "Sign up successful. Please confirm your email, then sign in."
      : signupParam === "google"
      ? "Google sign up successful. Please sign in to continue."
      : "";

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/dashboard");
  }

  async function handleGoogleSignIn() {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }
    localStorage.removeItem("signup_provider");
    setOauthLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });
    if (oauthError) {
      setError(oauthError.message);
      setOauthLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid opacity-70" />
        <div className="absolute -top-40 left-1/3 h-[420px] w-[420px] rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-white/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <div className="grid w-full max-w-4xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden lg:flex flex-col justify-center">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/20 border border-primary/40 text-sm font-semibold">
                TJ
              </div>
              <span className="text-xl font-semibold">Trade Journal</span>
            </div>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight">
              Sign in to your trading cockpit
            </h1>
            <p className="mt-4 text-sm text-muted max-w-sm">
              Review KPIs, track risk, and log trades with a clean dashboard built for decisions.
            </p>
            <div className="mt-8 flex gap-3 text-xs text-muted">
              <span>Risk analytics</span>
              <span>Strategy breakdown</span>
              <span>Equity curve</span>
            </div>
          </div>

          <div className="card">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Welcome back</h2>
                <p className="text-sm text-muted">Sign in to continue.</p>
              </div>
              <Link href="/dashboard" className="text-xs text-muted hover:text-white">
                Home
              </Link>
            </div>

            <form className="space-y-4" onSubmit={handleSignIn}>
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
              <div>
                <label className="text-xs text-muted">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm text-white"
                  required
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-xs text-muted hover:text-white">
                  Forgot password?
                </Link>
              </div>
              {signupMessage && (
                <p className="text-xs text-positive">{signupMessage}</p>
              )}
              {error && <p className="text-xs text-negative">{error}</p>}
              <button
                type="submit"
                className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-white/10 py-3 text-sm font-semibold"
                onClick={handleGoogleSignIn}
                disabled={oauthLoading}
              >
                {oauthLoading ? "Connecting..." : "Continue with Google"}
              </button>
              <p className="text-xs text-muted">
                New here?{" "}
                <Link href="/sign-up" className="text-white">
                  Create an account
                </Link>
              </p>
              {!isSupabaseConfigured && (
                <p className="text-[11px] text-muted">
                  Supabase keys are missing. Add them to use auth.
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
