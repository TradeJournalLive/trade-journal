"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    setSuccess("Account created. Please check your email to confirm.");
    setTimeout(() => router.push("/sign-in"), 1500);
  }

  async function handleGoogleSignUp() {
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setOauthLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`
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
              Create your trading workspace
            </h1>
            <p className="mt-4 text-sm text-muted max-w-sm">
              Separate accounts keep strategies and results isolated for each trader.
            </p>
            <div className="mt-8 flex gap-3 text-xs text-muted">
              <span>Private analytics</span>
              <span>Secure storage</span>
              <span>Multi-user ready</span>
            </div>
          </div>

          <div className="card">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Create account</h2>
                <p className="text-sm text-muted">Start your journal.</p>
              </div>
              <Link href="/" className="text-xs text-muted hover:text-white">
                Home
              </Link>
            </div>

            <form className="space-y-4" onSubmit={handleSignUp}>
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
              {error && <p className="text-xs text-negative">{error}</p>}
              {success && <p className="text-xs text-positive">{success}</p>}
              <button
                type="submit"
                className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create account"}
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-white/10 py-3 text-sm font-semibold"
                onClick={handleGoogleSignUp}
                disabled={oauthLoading}
              >
                {oauthLoading ? "Connecting..." : "Sign up with Google"}
              </button>
              <p className="text-xs text-muted">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-white">
                  Sign in
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
