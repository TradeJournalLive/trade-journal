import Link from "next/link";

const features = [
  {
    title: "Structured trade log",
    description: "Capture every entry with strategy, risk, and outcome tags."
  },
  {
    title: "Win rate & expectancy",
    description: "See what your edge really looks like by setup."
  },
  {
    title: "Equity curve",
    description: "Track growth, drawdowns, and streaks over time."
  },
  {
    title: "Strategy analytics",
    description: "Benchmark performance across playbooks."
  },
  {
    title: "Risk-reward clarity",
    description: "Reveal average R:R and consistency of execution."
  },
  {
    title: "Filters & export",
    description: "Slice by date, symbol, or strategy. Export anytime."
  }
];

const faq = [
  {
    q: "Do I need to connect a broker?",
    a: "No. Add trades manually or import CSV/Google Sheets in v1."
  },
  {
    q: "How is P&L calculated?",
    a: "P&L is based on entry/exit prices, qty, side, and optional fees."
  },
  {
    q: "Can I track multiple strategies?",
    a: "Yes. Tag each trade and view strategy-wise performance."
  },
  {
    q: "Will there be mobile access?",
    a: "The UI is fully responsive and works on mobile browsers."
  },
  {
    q: "Is there a free plan?",
    a: "Yes. A free tier is available with core journaling features."
  }
];

export default function Home() {
  return (
    <main className="min-h-screen bg-ink text-white">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-20%] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute right-[10%] top-[10%] h-[420px] w-[420px] rounded-full bg-white/5 blur-[90px]" />
        <div className="absolute left-[8%] bottom-[5%] h-[360px] w-[360px] rounded-full bg-[rgb(var(--color-warm)/0.12)] blur-[120px]" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 border border-primary/40 text-sm font-semibold">
            TJ
          </div>
          <span className="text-lg font-semibold tracking-tight">Trade Journal</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <Link href="#how" className="hover:text-ink">
            How it works
          </Link>
          <Link href="#features" className="hover:text-ink">
            Features
          </Link>
          <Link href="#dashboard" className="hover:text-ink">
            Dashboard
          </Link>
          <Link href="#pricing" className="hover:text-ink">
            Pricing
          </Link>
          <Link href="/sign-in" className="hover:text-ink">
            Sign in
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold"
          >
            Sign up
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white shadow-soft"
          >
            Open demo
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <span className="badge">Trading journal</span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Trade with intention. Review with clarity.
          </h1>
          <p className="text-muted text-lg">
            PulseJournal is a minimal, analytics-first trading journal that
            surfaces what matters: edge, risk, and consistency.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-soft"
            >
              Start free
            </Link>
            <Link
              href="#dashboard"
              className="rounded-full border border-white/10 bg-white/70 px-6 py-3 text-sm font-semibold text-slate-900"
            >
              View dashboard
            </Link>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted">
            <span>CSV / Sheets import</span>
            <span>Strategy tags</span>
            <span>Equity curve</span>
          </div>
        </div>
        <div className="card relative">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[rgb(var(--color-warm)/0.12)] blur-[40px]" />
          <div className="absolute -left-8 bottom-6 h-24 w-24 rounded-full bg-primary/10 blur-[40px]" />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Overview</span>
            <span className="text-sm text-positive">+4.8% this month</span>
          </div>
          <div className="mt-6 grid gap-4">
            <div className="kpi">
              <div className="text-xs text-muted">Net P&L</div>
              <div className="text-2xl font-semibold">$4,320</div>
            </div>
            <div className="kpi">
              <div className="text-xs text-muted">Win rate</div>
              <div className="text-2xl font-semibold">58%</div>
            </div>
            <div className="kpi">
              <div className="text-xs text-muted">Expectancy</div>
              <div className="text-2xl font-semibold">0.42R</div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">How it works</h2>
          <p className="section-lead">
            Three focused steps from capture to review.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              title: "Log trades",
              desc: "Add each trade with entry, exit, size, and tags."
            },
            {
              title: "Tag strategy",
              desc: "Attach playbooks, timeframes, and risk levels."
            },
            {
              title: "Review edge",
              desc: "Analyze win rate, expectancy, and drawdowns."
            }
          ].map((step, index) => (
            <div className="card" key={step.title}>
              <div className="text-sm text-muted">Step {index + 1}</div>
              <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">Features built for review</h2>
          <p className="section-lead">
            The essentials for systematic trading feedback loops.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div className="card" key={feature.title}>
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="dashboard" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">Dashboard-first workflow</h2>
          <p className="section-lead">
            A single screen for performance, risk, and strategy breakdowns.
          </p>
        </div>
        <div className="card">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div className="kpi flex items-center justify-between">
                <span className="text-xs text-muted">Equity curve</span>
                <span className="text-positive text-sm">+12.4% YTD</span>
              </div>
              <div className="relative h-48 overflow-hidden rounded-xl bg-elevate border border-white/5">
                <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(15,23,42,0.08)_0%,rgba(15,23,42,0.0)_60%)]" />
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 400 200"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="curve" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgb(22,37,64)" />
                      <stop offset="100%" stopColor="rgb(20,184,166)" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 150 C60 120 120 160 180 110 C240 60 300 120 360 80 L400 70"
                    fill="none"
                    stroke="url(#curve)"
                    strokeWidth="3"
                  />
                </svg>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="kpi">
                  <div className="text-xs text-muted">Strategy alpha</div>
                  <div className="text-xl font-semibold">Breakout A+</div>
                </div>
                <div className="kpi">
                  <div className="text-xs text-muted">Risk discipline</div>
                  <div className="text-xl font-semibold">1.2R avg</div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="kpi">
                <div className="text-xs text-muted">Win/Loss ratio</div>
                <div className="text-2xl font-semibold">1.6</div>
              </div>
              <div className="kpi">
                <div className="text-xs text-muted">Day-wise performance</div>
                <div className="text-2xl font-semibold">Mon + Thu best</div>
              </div>
              <div className="kpi">
                <div className="text-xs text-muted">Expectancy</div>
                <div className="text-2xl font-semibold">0.37R</div>
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-6">
            <div className="text-sm text-muted">
              Built to surface strengths and tighten weak spots.
            </div>
            <Link
              href="/dashboard"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-soft"
            >
              Launch demo
            </Link>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">Simple pricing</h2>
          <p className="section-lead">Start free, upgrade when you scale.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {["Free", "Pro", "Team"].map((tier, idx) => (
            <div className="card" key={tier}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{tier}</h3>
                {idx === 1 && (
                  <span className="badge">Most popular</span>
                )}
              </div>
              <div className="mt-4 text-3xl font-semibold">
                {idx === 0 ? "$0" : idx === 1 ? "$19" : "$49"}
              </div>
              <p className="mt-2 text-sm text-muted">
                {idx === 0
                  ? "Core journaling and analytics"
                  : idx === 1
                  ? "Advanced filters + exports"
                  : "Team-level insights"}
              </p>
              <button className="mt-6 w-full rounded-full bg-primary/10 text-primary py-2 text-sm font-semibold">
                Coming soon
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">FAQ</h2>
          <p className="section-lead">
            Everything you need to know before you start.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {faq.map((item) => (
            <div className="card" key={item.q}>
              <h3 className="text-lg font-semibold">{item.q}</h3>
              <p className="mt-2 text-sm text-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 text-sm text-muted">
          <div>
            <div className="text-white font-semibold">Trade Journal</div>
            <div className="text-xs">Minimal trading analytics</div>
          </div>
          <div className="flex gap-6">
            <span>Product</span>
            <span>Company</span>
            <span>Legal</span>
          </div>
          <div className="text-xs">© 2026 PulseJournal</div>
        </div>
      </footer>
    </main>
  );
}
