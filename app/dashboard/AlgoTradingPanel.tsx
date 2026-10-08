"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type AlgoSection =
  | "dashboard"
  | "create"
  | "strategies"
  | "backtests"
  | "paper"
  | "live"
  | "templates"
  | "positions"
  | "orders"
  | "trades"
  | "riskProfiles"
  | "killSwitch"
  | "riskEvents"
  | "journal"
  | "analytics"
  | "dhan"
  | "tradingview"
  | "settings"
  | "admin";

type BacktestResult = {
  pnl: string;
  winRate: string;
  drawdown: string;
  trades: string;
};

type NavGroup = {
  label: string;
  items: { label: string; id: AlgoSection }[];
};

const navGroups: NavGroup[] = [
  { label: "Main", items: [{ label: "Dashboard", id: "dashboard" }] },
  {
    label: "Strategy Lab",
    items: [
      { label: "Create Strategy", id: "create" },
      { label: "My Strategies", id: "strategies" },
      { label: "Backtests", id: "backtests" },
      { label: "Paper Trading", id: "paper" },
      { label: "Live Strategies", id: "live" },
      { label: "Strategy Templates", id: "templates" }
    ]
  },
  {
    label: "Trading",
    items: [
      { label: "Positions", id: "positions" },
      { label: "Orders", id: "orders" },
      { label: "Trades", id: "trades" }
    ]
  },
  {
    label: "Risk",
    items: [
      { label: "Risk Profiles", id: "riskProfiles" },
      { label: "Kill Switch", id: "killSwitch" },
      { label: "Risk Events", id: "riskEvents" }
    ]
  },
  {
    label: "Review",
    items: [
      { label: "Journal", id: "journal" },
      { label: "Analytics", id: "analytics" }
    ]
  },
  {
    label: "Integrations",
    items: [
      { label: "Dhan", id: "dhan" },
      { label: "TradingView", id: "tradingview" }
    ]
  },
  {
    label: "System",
    items: [
      { label: "Settings", id: "settings" },
      { label: "Admin", id: "admin" }
    ]
  }
];

const navItems = navGroups.flatMap((group) => group.items);

const strategyRows = [
  { name: "NIFTY EMA 9/21", source: "NATIVE", version: "v1", stage: "DRAFT", instrument: "NIFTY ATM CE", risk: "Intraday Protected" },
  { name: "BANKNIFTY ORB", source: "NATIVE", version: "v2", stage: "PAPER", instrument: "BANKNIFTY Futures", risk: "Conservative" },
  { name: "VWAP Pullback TV", source: "TRADINGVIEW", version: "v1", stage: "BACKTESTED", instrument: "NIFTY 50", risk: "Intraday Protected" }
];

const orderRows = [
  { id: "ORD-PAPER-001", strategy: "NIFTY EMA 9/21", side: "BUY", qty: "50", status: "Simulated", time: "09:32" },
  { id: "ORD-RISK-002", strategy: "BANKNIFTY ORB", side: "SELL", qty: "15", status: "Blocked", time: "10:05" }
];

const riskRows = [
  ["Daily loss limit", "₹5,000"],
  ["Daily profit lock", "₹10,000"],
  ["Max trades", "10"],
  ["Max open positions", "2"],
  ["No entries after", "3:15 PM"],
  ["Consecutive losses", "3"]
];

const strategyJson = `{
  "version": "1.0",
  "name": "NIFTY VWAP EMA",
  "source": "NATIVE",
  "market": { "exchange": "NSE", "underlying": "NIFTY", "timeframe": "5m" },
  "entry": {
    "type": "CONDITION_TREE",
    "operator": "AND",
    "conditions": [
      { "type": "CROSS_ABOVE", "left": "CLOSE", "right": "VWAP" },
      { "type": "GREATER_THAN", "left": "EMA(9)", "right": "EMA(21)" },
      { "type": "GREATER_THAN", "left": "RSI(14)", "right": 55 }
    ]
  },
  "entryAction": { "side": "BUY", "instrument": "NIFTY ATM CE", "quantity": "1 LOT" },
  "exit": { "stopLoss": "20%", "target": "40%", "trailAfter": "30%" }
}`;

export default function AlgoTradingPanel() {
  const [activeSection, setActiveSection] = useState<AlgoSection>("dashboard");
  const [status, setStatus] = useState("TradingOS ready. Connect Dhan before live deployment.");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [paperModeActive, setPaperModeActive] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [savedStrategyName, setSavedStrategyName] = useState("NIFTY EMA Protection");
  const [webhookSecretVisible, setWebhookSecretVisible] = useState(false);

  const sectionTitle = useMemo(
    () => navItems.find((item) => item.id === activeSection)?.label ?? "Dashboard",
    [activeSection]
  );

  function selectSection(id: AlgoSection) {
    setActiveSection(id);
    setStatus(`${navItems.find((item) => item.id === id)?.label ?? "TradingOS"} opened.`);
  }

  function runBacktest() {
    setBacktestResult({ pnl: "+₹18,420", winRate: "62.8%", drawdown: "-₹3,250", trades: "48" });
    setActiveSection("backtests");
    setStatus("Backtest completed with brokerage, STT, GST, slippage and execution-delay assumptions.");
  }

  function activateKillSwitch() {
    setKillSwitchActive(true);
    setStatus("Kill switch active: live orders blocked, open orders marked for cancellation, strategies paused.");
  }

  function confirmExitAll() {
    setExitConfirmOpen(false);
    setKillSwitchActive(true);
    setStatus("EXIT ALL command queued. Dhan connection is required before real positions can be exited.");
  }

  function saveStrategy() {
    setBuilderOpen(false);
    setActiveSection("strategies");
    setStatus(`${savedStrategyName || "New strategy"} saved as Draft. The same definition can run in Backtest, Paper and Live.`);
  }

  function connectDhan() {
    setBrokerOpen(false);
    setActiveSection("dhan");
    setStatus("Dhan connection form saved locally. Encrypted server-side storage and API validation are next.");
  }

  const metricCards = (
    <div className="algo-os-grid five">
      {[
        ["P&L today", "₹0", "No broker feed connected"],
        ["Running strategies", "0", paperModeActive ? "Paper mode active" : "Start paper mode first"],
        ["Capital deployed", "₹0", "Dhan funds pending"],
        ["Open positions", "0", "No live exposure"],
        ["Risk state", killSwitchActive ? "Blocked" : "Ready", killSwitchActive ? "Orders stopped" : "Pre-trade checks armed"]
      ].map(([label, value, helper]) => (
        <div key={label} className="algo-os-card metric"><span>{label}</span><strong>{value}</strong><p>{helper}</p></div>
      ))}
    </div>
  );

  function StrategiesTable() {
    return <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Name</th><th>Source</th><th>Version</th><th>Lifecycle</th><th>Instrument</th><th>Risk</th><th>Action</th></tr></thead><tbody>{strategyRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.source}</td><td>{row.version}</td><td>{row.stage}</td><td>{row.instrument}</td><td>{row.risk}</td><td><button type="button" onClick={() => { setSavedStrategyName(row.name); setBuilderOpen(true); }} className="algo-mini-button">Edit</button></td></tr>)}</tbody></table></div>;
  }

  function renderCreate() {
    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.9fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Create Strategy</h3><p>Every UI action should update one broker-independent Strategy JSON definition.</p></div><button type="button" onClick={() => setBuilderOpen(true)} className="algo-action primary">Open builder</button></div><div className="algo-builder-grid"><label>Instrument<select><option>NIFTY</option><option>BANKNIFTY</option><option>FINNIFTY</option></select></label><label>Timeframe<select><option>5 Minutes</option><option>15 Minutes</option><option>1 Hour</option></select></label><label>Left value<select><option>Close</option><option>EMA(9)</option><option>RSI(14)</option></select></label><label>Operator<select><option>Crosses above</option><option>Greater than</option><option>Less than</option></select></label><label>Right value<select><option>VWAP</option><option>EMA(21)</option><option>55</option></select></label><label>Action<select><option>BUY ATM CE</option><option>BUY ATM PE</option><option>SELL Spread</option></select></label></div><div className="algo-modal-actions"><button type="button" onClick={runBacktest} className="algo-action secondary">Backtest</button><button type="button" onClick={() => { setPaperModeActive(true); setStatus("Paper trading started from current strategy definition."); }} className="algo-action secondary">Paper Trade</button><button type="button" onClick={saveStrategy} className="algo-action primary">Save</button></div></div><div className="algo-os-card"><h3>Strategy JSON</h3><pre className="algo-code-block">{strategyJson}</pre></div></div>;
  }

  function renderStrategies() {
    return <div className="algo-os-card"><div className="algo-card-head"><div><h3>My Strategies</h3><p>Manage versions and lifecycle. Never edit a live definition in-place.</p></div><button type="button" onClick={() => setBuilderOpen(true)} className="algo-action primary">+ New strategy</button></div><StrategiesTable /></div>;
  }

  function renderBacktests() {
    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Backtests</h3><p>Use normalized historical candles and actual option contracts where available.</p></div><button type="button" onClick={runBacktest} className="algo-action primary">Run backtest</button></div>{backtestResult ? <div className="result-row mt-4"><h3>Latest Result</h3><div><span>Net P&L</span><b className="good-text">{backtestResult.pnl}</b></div><div><span>Win rate</span><b>{backtestResult.winRate}</b></div><div><span>Drawdown</span><b className="bad-text">{backtestResult.drawdown}</b></div><div><span>Trades</span><b>{backtestResult.trades}</b></div></div> : <div className="algo-empty-state">No backtest yet. Run one to see equity, drawdown and trade distribution.</div>}</div><div className="algo-os-card"><h3>Assumptions</h3><div className="algo-rule-list"><div><span>Brokerage</span><b>Included</b></div><div><span>STT / GST / Exchange</span><b>Included</b></div><div><span>Slippage</span><b>Configurable</b></div><div><span>Options data</span><b>Actual contracts only</b></div></div></div></div>;
  }

  function renderPaper() {
    return <div className="grid gap-4 xl:grid-cols-3"><div className="algo-os-card metric"><span>Paper Mode</span><strong>{paperModeActive ? "On" : "Off"}</strong><p>Simulated broker, live market data later.</p><button type="button" onClick={() => { setPaperModeActive((prev) => !prev); setStatus(!paperModeActive ? "Paper trading started. No live orders will be sent." : "Paper trading stopped."); }} className="algo-action primary wide">{paperModeActive ? "Stop paper" : "Start paper"}</button></div><div className="algo-os-card metric"><span>Paper Capital</span><strong>₹1,00,000</strong><p>Sandbox allocation for strategy validation.</p></div><div className="algo-os-card metric"><span>Paper Trades</span><strong>0</strong><p>Paper fills store as executionMode = PAPER.</p></div></div>;
  }

  function renderLive() {
    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><h3>Live Strategies</h3><p>Native, TradingView and API signals all normalize to the same Signal object before risk and execution.</p><div className="algo-lifecycle-line">{["Draft", "Backtested", "Paper", "Ready", "Live"].map((item, index) => <span key={item} className={index === 0 || (backtestResult && index === 1) || (paperModeActive && index === 2) ? "active" : ""}>{item}</span>)}</div><button type="button" onClick={() => setStatus("Live deployment blocked until Dhan is connected and strategy passes risk validation.")} className="algo-action secondary wide">Check live readiness</button></div><div className="algo-os-card"><h3>Execution Guardrails</h3><div className="algo-rule-list"><div><span>Idempotency</span><b>Required</b></div><div><span>Risk validation</span><b>Before order</b></div><div><span>Broker status</span><b>Dhan pending</b></div><div><span>Kill switch</span><b>{killSwitchActive ? "Active" : "Ready"}</b></div></div></div></div>;
  }

  function renderTemplates() {
    return <div className="algo-os-grid three">{["EMA Crossover", "VWAP Pullback", "Opening Range", "Iron Condor", "Straddle Breakout", "Supertrend Trail"].map((name) => <div key={name} className="algo-os-card"><h3>{name}</h3><p>Start with a reusable template, then save as your own strategy version.</p><button type="button" onClick={() => { setSavedStrategyName(name); setBuilderOpen(true); }} className="algo-action secondary wide">Use template</button></div>)}</div>;
  }

  function renderPositions() { return <div className="algo-os-card"><div className="algo-card-head"><h3>Positions</h3><span className="algo-pill pending">Broker not connected</span></div><div className="algo-empty-state">No live positions. Dhan connection is required to fetch positions.</div></div>; }
  function renderOrders() { return <div className="algo-os-card"><div className="algo-card-head"><h3>Orders</h3><span className="algo-pill pending">Paper samples</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Order ID</th><th>Strategy</th><th>Side</th><th>Qty</th><th>Status</th><th>Time</th></tr></thead><tbody>{orderRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.strategy}</td><td>{row.side}</td><td>{row.qty}</td><td>{row.status}</td><td>{row.time}</td></tr>)}</tbody></table></div></div>; }
  function renderTrades() { return <div className="algo-os-card"><h3>Trades</h3><p>Automated paper/live fills will land here before syncing to journal analytics.</p><div className="algo-empty-state">No algo trades yet.</div></div>; }
  function renderRiskProfiles() { return <div className="grid gap-4 xl:grid-cols-2"><div className="algo-os-card"><h3>Intraday Protected</h3><div className="algo-rule-list">{riskRows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div></div><div className="algo-os-card"><h3>Conservative Options</h3><div className="algo-rule-list"><div><span>Max lots</span><b>1</b></div><div><span>Max loss</span><b>₹2,500</b></div><div><span>Allowed instruments</span><b>NIFTY / BANKNIFTY</b></div></div></div></div>; }
  function renderKillSwitch() { return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><h3>Kill Switch</h3><p>Visible emergency action for exit all, cancel orders, pause strategies and block new entries.</p><button type="button" onClick={activateKillSwitch} className="algo-action danger wide">Activate kill switch</button></div><div className="algo-os-card"><h3>Protection State</h3><div className="algo-alert-box"><b>{killSwitchActive ? "Blocked" : "Ready"}</b><span>{killSwitchActive ? "New orders are stopped." : "Risk checks are armed."}</span></div><button type="button" onClick={() => { setKillSwitchActive(false); setStatus("Kill switch reset. Risk checks remain armed."); }} className="algo-action secondary wide">Reset kill switch</button></div></div>; }
  function renderRiskEvents() { return <div className="algo-os-card"><h3>Risk Events</h3><div className="algo-alert-box"><b>{killSwitchActive ? "Kill switch active" : "No critical risk events"}</b><span>{killSwitchActive ? "Live deployment is blocked until reset." : "No rejected orders yet."}</span></div><div className="algo-alert-box"><b>Order rejected sample</b><span>BANKNIFTY ORB blocked because broker connection is pending.</span></div></div>; }
  function renderJournal() { return <div className="algo-os-card"><h3>Automated Journal</h3><p>Paper and live fills will create journal entries with strategy, version, signal ID, execution mode and risk decisions.</p><div className="algo-rule-list"><div><span>Execution mode</span><b>BACKTEST / PAPER / LIVE</b></div><div><span>Signal lineage</span><b>strategyId + version + signalId</b></div><div><span>Review loop</span><b>Feeds Analytics</b></div></div></div>; }
  function renderAnalytics() { return <div className="algo-os-grid three"><div className="algo-os-card metric"><span>Profit Factor</span><strong>--</strong><p>Requires completed algo trades.</p></div><div className="algo-os-card metric"><span>Expectancy</span><strong>--</strong><p>By strategy version.</p></div><div className="algo-os-card metric"><span>Max Drawdown</span><strong>--</strong><p>Backtest/paper/live separated.</p></div></div>; }
  function renderDhan() { return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Dhan Integration</h3><p>All Dhan access must go through DhanBrokerAdapter.</p></div><button type="button" onClick={() => setBrokerOpen(true)} className="algo-action primary">Connect Dhan</button></div><div className="algo-rule-list compact"><div><span>Profile</span><b>Pending</b></div><div><span>Funds</span><b>Pending</b></div><div><span>Orders</span><b>Adapter planned</b></div><div><span>WebSocket</span><b>Planned</b></div></div></div><div className="algo-os-card"><h3>Adapter Contract</h3><p>connect, funds, positions, orders, place/modify/cancel, exitAll, killSwitch, order updates.</p></div></div>; }
  function renderTradingView() { return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><h3>TradingView Webhook</h3><p>TradingView signals normalize to Signal, then pass idempotency, risk and execution checks.</p><div className="algo-rule-list"><div><span>Webhook URL</span><b>/api/v1/webhooks/tradingview</b></div><div><span>Secret</span><b>{webhookSecretVisible ? "tv_demo_secret_123" : "********"}</b></div><div><span>Actions</span><b>BUY / SELL / EXIT</b></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/api/v1/webhooks/tradingview`)} className="algo-action secondary">Copy URL</button><button type="button" onClick={() => setWebhookSecretVisible((prev) => !prev)} className="algo-action secondary">{webhookSecretVisible ? "Hide" : "Show"} Secret</button><button type="button" onClick={() => setStatus("Webhook secret regenerated locally. Backend persistence is next.")} className="algo-action primary">Regenerate Secret</button></div></div><div className="algo-os-card"><h3>Payload Mapping</h3><pre className="algo-code-block">{`{\n  "action": "BUY",\n  "symbol": "NIFTY",\n  "strategy": "VWAP Pullback",\n  "signalId": "{{strategy.order.id}}"\n}`}</pre></div></div>; }
  function renderSettings() { return <div className="grid gap-4 xl:grid-cols-2"><div className="algo-os-card"><h3>Platform Settings</h3><div className="algo-rule-list"><div><span>Default mode</span><b>Paper first</b></div><div><span>Market</span><b>India</b></div><div><span>Initial instruments</span><b>NIFTY, BANKNIFTY, FINNIFTY</b></div><div><span>Emergency control</span><b>Always visible</b></div></div></div><div className="algo-os-card"><h3>Security</h3><p>Live broker tokens must never be exposed in the frontend.</p><button type="button" onClick={() => setStatus("Security reminder: implement encrypted credential storage before live broker execution.")} className="algo-action secondary wide">Run security checklist</button></div></div>; }
  function renderAdmin() { return <div className="grid gap-4 xl:grid-cols-2"><div className="algo-os-card"><h3>Admin</h3><div className="algo-rule-list"><div><span>Users</span><b>Planned</b></div><div><span>Broker audit</span><b>Planned</b></div><div><span>Webhook audit</span><b>Planned</b></div></div></div><div className="algo-os-card"><h3>System Health</h3><div className="algo-rule-list"><div><span>Market data</span><b>Pending</b></div><div><span>Queue</span><b>Not configured</b></div><div><span>Execution service</span><b>Frontend scaffold</b></div></div></div></div>; }

  function renderDashboard() { return <>{metricCards}<div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">{renderCreate()}<div className="space-y-4">{renderKillSwitch()}</div></div></>; }
  function renderSection() {
    if (activeSection === "dashboard") return renderDashboard();
    if (activeSection === "create") return renderCreate();
    if (activeSection === "strategies") return renderStrategies();
    if (activeSection === "backtests") return renderBacktests();
    if (activeSection === "paper") return renderPaper();
    if (activeSection === "live") return renderLive();
    if (activeSection === "templates") return renderTemplates();
    if (activeSection === "positions") return renderPositions();
    if (activeSection === "orders") return renderOrders();
    if (activeSection === "trades") return renderTrades();
    if (activeSection === "riskProfiles") return renderRiskProfiles();
    if (activeSection === "killSwitch") return renderKillSwitch();
    if (activeSection === "riskEvents") return renderRiskEvents();
    if (activeSection === "journal") return renderJournal();
    if (activeSection === "analytics") return renderAnalytics();
    if (activeSection === "dhan") return renderDhan();
    if (activeSection === "tradingview") return renderTradingView();
    if (activeSection === "settings") return renderSettings();
    return renderAdmin();
  }

  return (
    <main className="algo-shell min-h-screen bg-[#f3f6fb] text-[#10203f]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[282px] shrink-0 border-r border-[#dce5f2] bg-[#091629] text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 p-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500 text-xs font-black">OS</span><div><b className="block text-sm">TradingOS</b><span className="text-[11px] text-slate-400">Build. Test. Trade. Protect.</span></div></div></div>
          <nav className="flex-1 overflow-y-auto px-3 py-4 text-sm">{navGroups.map((group) => <div key={group.label} className="mb-4"><div className="algo-nav-label">{group.label}</div><div className="space-y-1">{group.items.map((item) => <button key={item.id} type="button" onClick={() => selectSection(item.id)} className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left font-bold transition ${activeSection === item.id ? "bg-blue-500 text-white" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}><span>{item.label}</span>{activeSection === item.id ? <span className="text-[10px]">●</span> : null}</button>)}</div></div>)}</nav>
          <div className="border-t border-white/10 p-4 text-[11px] text-slate-400">Strategy definition runs in Backtest, Paper and Live.</div>
        </aside>
        <div className="min-w-0 flex-1"><header className="sticky top-0 z-20 border-b border-[#dce5f2] bg-white/95 backdrop-blur"><div className="flex min-h-[68px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-7"><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-black shadow-sm"><Link href="/dashboard" className="rounded-lg px-3 py-2 text-slate-600 hover:bg-white">Journal</Link><Link href="/dashboard/algo" className="rounded-lg bg-[#091629] px-3 py-2 text-white shadow-sm">Algo Trading</Link></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-lg px-3 py-2 text-xs font-black ${killSwitchActive ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{killSwitchActive ? "Kill switch active" : "Risk armed"}</span><button type="button" onClick={() => setBuilderOpen(true)} className="algo-action primary">+ Strategy</button><button type="button" onClick={() => setBrokerOpen(true)} className="algo-action secondary">Connect Dhan</button><button type="button" onClick={() => setExitConfirmOpen(true)} className="algo-action danger">EXIT ALL</button></div></div></header><section className="space-y-5 px-4 py-6 lg:px-7"><div className="algo-os-hero"><div><div className="algo-os-eyebrow">{sectionTitle}</div><h1>{sectionTitle}</h1><p>Broker-independent TradingOS workspace for native strategies, TradingView webhooks, Dhan execution, options-aware backtesting, risk protection, automated journal and analytics.</p></div><div className="algo-os-status"><span>System note</span><b>{status}</b></div></div>{renderSection()}</section></div>
      </div>
      {builderOpen ? <div className="algo-modal-backdrop"><div className="algo-modal"><div className="algo-card-head"><div><h3>Create strategy</h3><p>Saved as draft first. Backtest before deployment.</p></div><button type="button" onClick={() => setBuilderOpen(false)}>×</button></div><div className="algo-form-grid"><label>Strategy name<input value={savedStrategyName} onChange={(event) => setSavedStrategyName(event.target.value)} /></label><label>Instrument<select><option>NIFTY</option><option>BANKNIFTY</option><option>FINNIFTY</option></select></label><label>Timeframe<select><option>5 Minutes</option><option>15 Minutes</option><option>1 Hour</option></select></label><label>Entry action<select><option>Buy ATM CE</option><option>Buy ATM PE</option><option>Sell option spread</option></select></label></div><label className="algo-textarea-label">Rules<textarea defaultValue="EMA(9) crosses above EMA(21) AND RSI(14) > 55 AND Close > VWAP" /></label><div className="algo-modal-actions"><button type="button" onClick={() => setBuilderOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={saveStrategy} className="algo-action primary">Save draft</button></div></div></div> : null}
      {brokerOpen ? <div className="algo-modal-backdrop"><div className="algo-modal small"><div className="algo-card-head"><div><h3>Connect Dhan</h3><p>Token storage and validation must be implemented server-side before live trading.</p></div><button type="button" onClick={() => setBrokerOpen(false)}>×</button></div><div className="algo-form-grid single"><label>Client ID<input placeholder="Dhan client ID" /></label><label>Access token<input placeholder="Stored securely on backend" type="password" /></label></div><div className="algo-modal-actions"><button type="button" onClick={() => setBrokerOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={connectDhan} className="algo-action primary">Save connection</button></div></div></div> : null}
      {exitConfirmOpen ? <div className="algo-modal-backdrop"><div className="algo-modal small danger-modal"><h3>EXIT ALL POSITIONS?</h3><p>This will exit open positions, cancel pending orders, pause strategies and activate the kill switch when broker execution is connected.</p><div className="algo-modal-actions"><button type="button" onClick={() => setExitConfirmOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={confirmExitAll} className="algo-action danger">EXIT EVERYTHING</button></div></div></div> : null}
    </main>
  );
}
