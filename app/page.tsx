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

const featureIcons = [
  <svg
    key="log"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-primary"
  >
    <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" />
    <path d="M8 9h8M8 13h6" stroke="currentColor" strokeWidth="1.5" />
  </svg>,
  <svg
    key="expect"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-[rgb(var(--color-positive))]"
  >
    <path d="M5 14l4-4 4 4 6-6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M19 8h-4" stroke="currentColor" strokeWidth="1.5" />
  </svg>,
  <svg
    key="curve"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-primary"
  >
    <path d="M4 16c4-6 8-2 12-8 2-3 4-3 4-3" stroke="currentColor" strokeWidth="1.5" />
  </svg>,
  <svg
    key="strategy"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-[rgb(var(--color-warm))]"
  >
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" />
  </svg>,
  <svg
    key="risk"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-primary"
  >
    <path d="M12 4l8 14H4l8-14z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 10v4M12 18h.01" stroke="currentColor" strokeWidth="1.5" />
  </svg>,
  <svg
    key="filter"
    viewBox="0 0 24 24"
    fill="none"
    className="h-4 w-4 text-[rgb(var(--color-positive))]"
  >
    <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeWidth="1.5" />
  </svg>
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
          <Link href="#how" className="hover:text-primary">
            How it works
          </Link>
          <Link href="#features" className="hover:text-primary">
            Features
          </Link>
          <Link href="#dashboard" className="hover:text-primary">
            Dashboard
          </Link>
          <Link href="#pricing" className="hover:text-primary">
            Pricing
          </Link>
          <Link href="/sign-in" className="hover:text-primary">
            Sign in
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-full border border-white/10 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            Sign up
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary shadow-soft"
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
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-soft"
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
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "CSV + Sheets", value: "Fast import" },
              { label: "Strategy tags", value: "Playbook ready" },
              { label: "Equity curve", value: "Trend view" }
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-white/10 bg-white/70 px-4 py-3"
              >
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  {item.label}
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.value}
                </div>
              </div>
            ))}
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
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              { label: "Risk drift", value: "-0.6R", tone: "text-negative" },
              { label: "Discipline", value: "82%", tone: "text-positive" }
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-elevate/70 px-4 py-3 text-sm"
              >
                <span className="text-muted">{item.label}</span>
                <span className={`font-semibold ${item.tone}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "Momentum",
                value: "+12.4%",
                bg: "bg-[linear-gradient(135deg,rgba(20,184,166,0.25),rgba(14,116,144,0.05))]"
              },
              {
                label: "Risk guard",
                value: "1.4R",
                bg: "bg-[linear-gradient(135deg,rgba(245,158,11,0.25),rgba(245,158,11,0.05))]"
              },
              {
                label: "Focus",
                value: "78%",
                bg: "bg-[linear-gradient(135deg,rgba(37,99,235,0.2),rgba(22,37,64,0.05))]"
              }
            ].map((item) => (
              <div
                key={item.label}
                className={`rounded-xl border border-white/10 px-4 py-3 ${item.bg}`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted">
                  {item.label}
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.value}
                </div>
              </div>
            ))}
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
          {features.map((feature, index) => (
            <div className="card" key={feature.title}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-elevate">
                  {featureIcons[index % featureIcons.length]}
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
              </div>
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
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-soft"
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
