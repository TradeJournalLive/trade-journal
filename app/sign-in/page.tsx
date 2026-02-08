import Link from "next/link";

export default function SignInPage() {
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
              <Link href="/" className="text-xs text-muted hover:text-white">
                Home
              </Link>
            </div>

            <form className="space-y-4">
              <div>
                <label className="text-xs text-muted">Email</label>
                <input
                  type="email"
                  placeholder="you@domain.com"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-muted">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm text-white"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" />
                  Remember me
                </label>
                <button type="button" className="text-xs text-muted hover:text-white">
                  Forgot password?
                </button>
              </div>
              <button
                type="button"
                className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white"
              >
                Sign in
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-white/10 py-3 text-sm font-semibold"
              >
                Continue with Google
              </button>
              <p className="text-xs text-muted">
                New here?{" "}
                <Link href="/sign-up" className="text-white">
                  Create an account
                </Link>
              </p>
              <p className="text-[11px] text-muted">
                Demo only. Authentication wiring can be added next.
              </p>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
