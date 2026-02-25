import Link from "next/link";

const features = [
  {
    title: "India-first trade log",
    description: "Capture Nifty, Bank Nifty, Sensex and stock trades with clean structure."
  },
  {
    title: "Win rate & expectancy",
    description: "Measure your real edge by setup, timeframe, and instrument."
  },
  {
    title: "Equity curve",
    description: "Track account growth, drawdowns, and recovery phases clearly."
  },
  {
    title: "Strategy analytics",
    description: "Benchmark option buying and intraday playbooks side by side."
  },
  {
    title: "Psychology tracking",
    description: "Tag trigger emotion and behavioral state to reduce emotional mistakes."
  },
  {
    title: "Filters & export",
    description: "Filter by date, strategy, market, and export reports in seconds."
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
    q: "Do I need broker integration to start?",
    a: "No. You can start with manual entries immediately and keep your workflow simple."
  },
  {
    q: "How is P&L calculated?",
    a: "Net P&L is calculated from entry/exit and quantity after brokerage deduction."
  },
  {
    q: "Can I track multiple strategies?",
    a: "Yes. Each trade can be tagged and reviewed strategy-wise with win rate and expectancy."
  },
  {
    q: "Does this support Indian markets?",
    a: "Yes. The platform is optimized for Indian traders and INR-first workflows."
  },
  {
    q: "Is my data private?",
    a: "Yes. Your trades are private to your account with authentication and row-level access control."
  }
];

const testimonials = [
  {
    name: "Index Options Trader",
    role: "NSE Derivatives",
    quote:
      "I stopped guessing and started tracking. My weekly review now shows exactly where discipline breaks."
  },
  {
    name: "Working Professional",
    role: "Part-time Swing Trader",
    quote:
      "The strategy and day-wise breakdown made my weak days obvious. I trade less now, but much better."
  },
  {
    name: "Price Action Learner",
    role: "Equity Intraday",
    quote:
      "Emotion tags changed my process. I can clearly see where FOMO is costing me money."
  }
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_12%,rgba(59,130,246,0.18),transparent_35%),radial-gradient(circle_at_82%_14%,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_35%_85%,rgba(245,158,11,0.14),transparent_38%),rgb(var(--color-ink))] text-white">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-20%] h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-primary/20 blur-[150px]" />
        <div className="absolute right-[10%] top-[10%] h-[420px] w-[420px] rounded-full bg-[rgba(16,185,129,0.16)] blur-[90px]" />
        <div className="absolute left-[8%] bottom-[5%] h-[360px] w-[360px] rounded-full bg-[rgba(245,158,11,0.18)] blur-[120px]" />
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
            className="rounded-full bg-[linear-gradient(135deg,#2563eb,#14b8a6)] px-5 py-2 text-sm font-semibold text-on-primary shadow-soft"
          >
            Open demo
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <span className="inline-flex items-center rounded-full bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] px-4 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
            Trade smarter, not harder
          </span>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
            India's high-clarity journal for disciplined traders.
          </h1>
          <p className="text-muted text-lg">
            Built for traders tracking NSE/BSE performance. Log faster, review
            deeper, and improve decision quality with data-driven insights.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-[linear-gradient(135deg,#2563eb,#14b8a6)] px-6 py-3 text-sm font-semibold text-white shadow-soft"
            >
              Start free
            </Link>
            <Link
              href="#dashboard"
              className="rounded-full border border-blue-200 bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-blue-50"
            >
              View dashboard
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Indian markets", value: "Nifty, B.Nifty, Sensex" },
              { label: "Execution quality", value: "Psychology tagged" },
              { label: "Review cycle", value: "Daily / Weekly / Monthly" }
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
        <div className="hero-float card relative border border-blue-200/50 bg-[linear-gradient(155deg,rgba(238,242,255,0.95),rgba(236,253,245,0.85))]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[rgba(59,130,246,0.2)] blur-[42px]" />
          <div className="absolute -left-8 bottom-6 h-24 w-24 rounded-full bg-[rgba(16,185,129,0.18)] blur-[38px]" />
          <div className="rounded-2xl border border-white/70 bg-white/75 p-5">
            <div className="flex items-center gap-3">
              <span className="hero-dot h-4 w-4 rounded-full bg-amber-400" />
              <span className="hero-dot h-4 w-4 rounded-full bg-pink-500 [animation-delay:0.3s]" />
              <span className="hero-dot h-4 w-4 rounded-full bg-emerald-500 [animation-delay:0.6s]" />
            </div>
            <div className="mt-6 h-40 rounded-xl border border-blue-100 bg-[linear-gradient(180deg,rgba(239,246,255,0.75),rgba(255,255,255,0.95))] p-4">
              <svg
                viewBox="0 0 340 130"
                className="h-full w-full"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 98 L38 62 L76 74 L112 48 L148 82 L184 36 L220 68 L256 30 L302 56 L340 44"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="hero-line"
                />
              </svg>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs font-semibold">
              <div className="rounded-xl bg-[linear-gradient(135deg,#4f46e5,#6366f1)] px-2 py-3 text-white">Win Rate</div>
              <div className="rounded-xl bg-[linear-gradient(135deg,#2563eb,#3b82f6)] px-2 py-3 text-white">P/L</div>
              <div className="rounded-xl bg-[linear-gradient(135deg,#10b981,#14b8a6)] px-2 py-3 text-white">Trades</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="card border border-blue-200/50 bg-[linear-gradient(145deg,rgba(239,246,255,0.95),rgba(255,255,255,0.92))]">
            <div className="text-3xl font-semibold text-blue-600">160k+</div>
            <div className="mt-1 text-sm text-muted">Trades logged and reviewed</div>
          </div>
          <div className="card border border-emerald-200/50 bg-[linear-gradient(145deg,rgba(236,253,245,0.95),rgba(255,255,255,0.92))]">
            <div className="text-3xl font-semibold text-emerald-600">2.5x</div>
            <div className="mt-1 text-sm text-muted">Better discipline over time</div>
          </div>
          <div className="card border border-rose-200/50 bg-[linear-gradient(145deg,rgba(255,241,242,0.95),rgba(255,255,255,0.92))]">
            <div className="text-3xl font-semibold text-rose-500">-63%</div>
            <div className="mt-1 text-sm text-muted">Emotion-driven mistakes</div>
          </div>
          <div className="card border border-amber-200/50 bg-[linear-gradient(145deg,rgba(255,251,235,0.95),rgba(255,255,255,0.92))]">
            <div className="text-3xl font-semibold text-amber-500">6k+</div>
            <div className="mt-1 text-sm text-muted">Active Indian users</div>
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
              desc: "Record entry, exit, lots, setup, and execution notes in under a minute."
            },
            {
              title: "Tag behavior",
              desc: "Track trigger emotion and behavioral state for every trade."
            },
            {
              title: "Review edge",
              desc: "Use strategy, day-wise, and risk analytics to improve consistency."
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

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10">
          <h2 className="section-title">Trusted by focused traders</h2>
          <p className="section-lead">
            Practical journaling feedback from Indian trading workflows.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((item) => (
            <div className="card" key={item.name}>
              <p className="text-sm leading-6 text-muted">"{item.quote}"</p>
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="text-sm font-semibold">{item.name}</div>
                <div className="text-xs text-muted">{item.role}</div>
              </div>
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
          <p className="section-lead">
            INR-first pricing for individual and growing trading desks.
          </p>
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
                {idx === 0 ? "Rs 0" : idx === 1 ? "Rs 499" : "Rs 1,499"}
              </div>
              <p className="mt-2 text-sm text-muted">
                {idx === 0
                  ? "Core journaling and review analytics"
                  : idx === 1
                  ? "Advanced analytics + export workflow"
                  : "Shared workspace + team-level insights"}
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
            <div className="text-xs">Built for disciplined Indian traders</div>
          </div>
          <div className="flex gap-6">
            <span>Product</span>
            <span>Company</span>
            <span>Legal</span>
          </div>
          <div className="text-xs">Educational journal. Not investment advice.</div>
        </div>
      </footer>
    </main>
  );
}
