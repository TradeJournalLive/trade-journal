"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type AlgoSection =
  | "dashboard"
  | "strategies"
  | "builder"
  | "backtests"
  | "paper"
  | "live"
  | "positions"
  | "orders"
  | "risk"
  | "broker"
  | "alerts"
  | "settings";

type BacktestResult = {
  pnl: string;
  winRate: string;
  drawdown: string;
  trades: string;
};

const algoNav: { label: string; id: AlgoSection }[] = [
  { label: "Dashboard", id: "dashboard" },
  { label: "My Strategies", id: "strategies" },
  { label: "Strategy Builder", id: "builder" },
  { label: "Backtests", id: "backtests" },
  { label: "Paper Trading", id: "paper" },
  { label: "Live Trading", id: "live" },
  { label: "Positions", id: "positions" },
  { label: "Orders", id: "orders" },
  { label: "Risk Management", id: "risk" },
  { label: "Broker Connections", id: "broker" },
  { label: "Alerts", id: "alerts" },
  { label: "Settings", id: "settings" }
];

const strategyRows = [
  { name: "NIFTY EMA 9/21", mode: "Paper", stage: "Draft", instrument: "NIFTY ATM CE", risk: "20% SL" },
  { name: "BANKNIFTY ORB", mode: "Paper", stage: "Paused", instrument: "BANKNIFTY Futures", risk: "1 lot max" },
  { name: "VWAP Pullback", mode: "Backtest", stage: "Ready", instrument: "NIFTY 50", risk: "Time filter" }
];

export default function AlgoTradingPanel() {
  const [activeSection, setActiveSection] = useState<AlgoSection>("dashboard");
  const [status, setStatus] = useState("Algo workspace ready. Connect Dhan before live deployment.");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [paperModeActive, setPaperModeActive] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [savedStrategyName, setSavedStrategyName] = useState("NIFTY EMA Protection");

  const sectionTitle = useMemo(
    () => algoNav.find((item) => item.id === activeSection)?.label ?? "Dashboard",
    [activeSection]
  );

  function selectSection(id: AlgoSection) {
    setActiveSection(id);
    setStatus(`${algoNav.find((item) => item.id === id)?.label ?? "Algo"} opened.`);
  }

  function runBacktest() {
    setBacktestResult({ pnl: "+₹18,420", winRate: "62.8%", drawdown: "-₹3,250", trades: "48" });
    setActiveSection("backtests");
    setStatus("Sample backtest completed with brokerage, slippage and execution delay assumptions.");
  }

  function activateKillSwitch() {
    setKillSwitchActive(true);
    setStatus("Kill switch active: new live orders blocked, open orders marked for cancellation.");
  }

  function confirmExitAll() {
    setExitConfirmOpen(false);
    setKillSwitchActive(true);
    setStatus("EXIT ALL command queued. Broker connection is required before live positions can be exited.");
  }

  function saveStrategy() {
    setBuilderOpen(false);
    setActiveSection("strategies");
    setStatus(`${savedStrategyName || "New strategy"} saved as Draft. Backtest before paper or live deployment.`);
  }

  function connectDhan() {
    setBrokerOpen(false);
    setActiveSection("broker");
    setStatus("Dhan connection form saved locally. Server-side credential storage and API validation are the next backend step.");
  }

  return (
    <main className="algo-shell min-h-screen bg-[#f3f6fb] text-[#10203f]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[264px] shrink-0 border-r border-[#dce5f2] bg-[#091629] text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500 text-xs font-black">AT</span>
              <div>
                <b className="block text-sm">1to2 Algo Trading</b>
                <span className="text-[11px] text-slate-400">TradingOS workspace</span>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4 text-sm">
            {algoNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left font-bold transition ${
                  activeSection === item.id
                    ? "bg-blue-500 text-white"
                    : "text-slate-300 hover:bg-white/8 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
                {activeSection === item.id ? <span className="text-[10px]">●</span> : null}
              </button>
            ))}
          </nav>
          <div className="border-t border-white/10 p-4 text-[11px] text-slate-400">
            Separate panel<br />No journal dependency
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-[#dce5f2] bg-white/95 backdrop-blur">
            <div className="flex min-h-[68px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-7">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-black shadow-sm">
                <Link href="/dashboard" className="rounded-lg px-3 py-2 text-slate-600 hover:bg-white">Journal</Link>
                <Link href="/dashboard/algo" className="rounded-lg bg-[#091629] px-3 py-2 text-white shadow-sm">Algo Trading</Link>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-lg px-3 py-2 text-xs font-black ${killSwitchActive ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
                  {killSwitchActive ? "Kill switch active" : "Risk armed"}
                </span>
                <button type="button" onClick={() => setBuilderOpen(true)} className="algo-action primary">+ Strategy</button>
                <button type="button" onClick={() => setBrokerOpen(true)} className="algo-action secondary">Connect Dhan</button>
                <button type="button" onClick={() => setExitConfirmOpen(true)} className="algo-action danger">EXIT ALL</button>
              </div>
            </div>
          </header>

          <section className="space-y-5 px-4 py-6 lg:px-7">
            <div className="algo-os-hero">
              <div>
                <div className="algo-os-eyebrow">{sectionTitle}</div>
                <h1>Build. Test. Trade. Protect.</h1>
                <p>Dhan-first algo trading workspace with strategy lifecycle, paper mode, live controls, risk engine, positions, orders and emergency actions.</p>
              </div>
              <div className="algo-os-status">
                <span>System note</span>
                <b>{status}</b>
              </div>
            </div>

            <div className="algo-os-grid five">
              {[
                ["P&L today", "₹0", "No broker feed connected"],
                ["Running strategies", "0", paperModeActive ? "Paper mode active" : "Start paper mode first"],
                ["Capital deployed", "₹0", "Dhan funds pending"],
                ["Open positions", "0", "No live exposure"],
                ["Risk state", killSwitchActive ? "Blocked" : "Ready", killSwitchActive ? "Orders stopped" : "Pre-trade checks armed"]
              ].map(([label, value, helper]) => (
                <div key={label} className="algo-os-card metric">
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <p>{helper}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
              <div className="algo-os-card">
                <div className="algo-card-head">
                  <div><h3>Strategy Builder</h3><p>Create a no-code strategy, then validate it through the lifecycle.</p></div>
                  <button type="button" onClick={() => setBuilderOpen(true)} className="algo-action primary">Open builder</button>
                </div>
                <div className="algo-flow">
                  <div><span>WHEN</span><b>NIFTY · 5 minute</b><p>EMA(9) crosses above EMA(21) AND RSI(14) &gt; 55 AND Close &gt; VWAP</p></div>
                  <strong>THEN</strong>
                  <div><span>BUY</span><b>NIFTY ATM CE · Current expiry</b><p>1 lot · SL 20% · Target 40% · Trail by 10% after +30%</p></div>
                </div>
                <div className="algo-tag-row">{["EMA", "VWAP", "RSI", "MACD", "Supertrend", "ATR", "Options legs"].map((item) => <span key={item}>{item}</span>)}</div>
              </div>

              <div className="algo-os-card">
                <div className="algo-card-head"><div><h3>Risk Engine</h3><p>Runs before every order.</p></div><span className="algo-pill good">Armed</span></div>
                <div className="algo-rule-list">
                  {[["Daily loss limit", "₹5,000"], ["Daily target", "₹10,000"], ["Max trades", "10"], ["Max open positions", "2"], ["No entries after", "3:15 PM"]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
                </div>
                <button type="button" onClick={activateKillSwitch} className="algo-action danger wide">Activate kill switch</button>
              </div>
            </div>

            <div className="algo-os-grid three">
              <div className="algo-os-card">
                <h3>Broker Connections</h3><p>Dhan is the first live broker. Credentials must stay server-side.</p>
                <div className="algo-broker-line"><div><b>Dhan</b><span>Primary broker</span></div><button type="button" onClick={() => setBrokerOpen(true)}>Setup</button></div>
                <div className="algo-rule-list compact"><div><span>Profile</span><b>Pending</b></div><div><span>Funds</span><b>Pending</b></div><div><span>Orders</span><b>Adapter planned</b></div></div>
              </div>

              <div className="algo-os-card">
                <h3>Backtest & Paper</h3><p>Validate with brokerage, STT, GST, slippage and execution delay assumptions.</p>
                <div className="algo-os-grid two small"><div><span>Backtests</span><strong>{backtestResult ? "1" : "0"}</strong></div><div><span>Paper mode</span><strong>{paperModeActive ? "On" : "Off"}</strong></div></div>
                <div className="flex flex-wrap gap-2"><button type="button" onClick={runBacktest} className="algo-action secondary">Run backtest</button><button type="button" onClick={() => { setPaperModeActive((prev) => !prev); setStatus(!paperModeActive ? "Paper trading started. No live orders will be sent." : "Paper trading stopped."); }} className="algo-action primary">{paperModeActive ? "Stop paper" : "Start paper"}</button></div>
              </div>

              <div className="algo-os-card">
                <h3>Live Trading</h3><p>Draft cannot go live without backtest, paper validation, broker health and risk approval.</p>
                <div className="algo-lifecycle-line">{["Draft", "Backtested", "Paper", "Ready", "Live"].map((item, index) => <span key={item} className={index === 0 || (backtestResult && index === 1) || (paperModeActive && index === 2) ? "active" : ""}>{item}</span>)}</div>
                <button type="button" onClick={() => setStatus("Live deployment blocked until Dhan is connected and strategy passes risk validation.")} className="algo-action secondary wide">Check live readiness</button>
              </div>
            </div>

            {backtestResult ? (
              <div className="algo-os-card result-row">
                <h3>Latest Backtest</h3>
                <div><span>Net P&L</span><b className="good-text">{backtestResult.pnl}</b></div>
                <div><span>Win rate</span><b>{backtestResult.winRate}</b></div>
                <div><span>Max drawdown</span><b className="bad-text">{backtestResult.drawdown}</b></div>
                <div><span>Trades</span><b>{backtestResult.trades}</b></div>
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
              <div className="algo-os-card">
                <div className="algo-card-head"><h3>Positions & Orders</h3><span className="algo-pill pending">Broker not connected</span></div>
                <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Strategy</th><th>Instrument</th><th>Mode</th><th>Status</th><th>P&L</th><th>Risk</th></tr></thead><tbody>{strategyRows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.instrument}</td><td>{row.mode}</td><td>{row.stage}</td><td>₹0</td><td>{row.risk}</td></tr>)}</tbody></table></div>
              </div>
              <div className="algo-os-card">
                <h3>Alerts</h3><p>Important automation events will appear here.</p>
                <div className="algo-alert-box"><b>{killSwitchActive ? "Kill switch active" : "No critical alerts"}</b><span>{killSwitchActive ? "Live deployment is blocked until reset." : "Broker and market data are pending connection."}</span></div>
                <button type="button" onClick={() => { setKillSwitchActive(false); setStatus("Kill switch reset. Risk checks remain armed."); }} className="algo-action secondary wide">Reset kill switch</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {builderOpen ? (
        <div className="algo-modal-backdrop">
          <div className="algo-modal">
            <div className="algo-card-head"><div><h3>Create strategy</h3><p>Saved as draft first. Backtest before deployment.</p></div><button type="button" onClick={() => setBuilderOpen(false)}>×</button></div>
            <div className="algo-form-grid"><label>Strategy name<input value={savedStrategyName} onChange={(event) => setSavedStrategyName(event.target.value)} /></label><label>Instrument<select><option>NIFTY</option><option>BANKNIFTY</option><option>FINNIFTY</option></select></label><label>Timeframe<select><option>5 Minutes</option><option>15 Minutes</option><option>1 Hour</option></select></label><label>Entry action<select><option>Buy ATM CE</option><option>Buy ATM PE</option><option>Sell option spread</option></select></label></div>
            <label className="algo-textarea-label">Rules<textarea defaultValue="EMA(9) crosses above EMA(21) AND RSI(14) > 55 AND Close > VWAP" /></label>
            <div className="algo-modal-actions"><button type="button" onClick={() => setBuilderOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={saveStrategy} className="algo-action primary">Save draft</button></div>
          </div>
        </div>
      ) : null}

      {brokerOpen ? (
        <div className="algo-modal-backdrop">
          <div className="algo-modal small">
            <div className="algo-card-head"><div><h3>Connect Dhan</h3><p>Token storage and validation must be implemented server-side before live trading.</p></div><button type="button" onClick={() => setBrokerOpen(false)}>×</button></div>
            <div className="algo-form-grid single"><label>Client ID<input placeholder="Dhan client ID" /></label><label>Access token<input placeholder="Stored securely on backend" type="password" /></label></div>
            <div className="algo-modal-actions"><button type="button" onClick={() => setBrokerOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={connectDhan} className="algo-action primary">Save connection</button></div>
          </div>
        </div>
      ) : null}

      {exitConfirmOpen ? (
        <div className="algo-modal-backdrop">
          <div className="algo-modal small danger-modal">
            <h3>EXIT ALL POSITIONS?</h3>
            <p>This will exit open positions, cancel pending orders, pause strategies and activate the kill switch when broker execution is connected.</p>
            <div className="algo-modal-actions"><button type="button" onClick={() => setExitConfirmOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={confirmExitAll} className="algo-action danger">EXIT EVERYTHING</button></div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
