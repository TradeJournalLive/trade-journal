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


type DhanCheck = {
  name: string;
  ok: boolean;
  status?: number;
  message: string;
  count?: number;
};

type DhanTestResult = {
  connected: boolean;
  testedAt: string;
  checks: DhanCheck[];
  profile?: {
    dhanClientId?: string;
    tokenValidity?: string;
    activeSegment?: string;
    dataPlan?: string;
    dataValidity?: string;
  };
  funds?: {
    availabelBalance?: string | number;
    availableBalance?: string | number;
    sodLimit?: string | number;
    collateralAmount?: string | number;
    utilizedAmount?: string | number;
  };
  positionsCount?: number;
  ordersCount?: number;
  error?: string;
};

type DhanOrderTicket = {
  exchangeSegment: string;
  productType: string;
  orderType: string;
  transactionType: string;
  validity: string;
  securityId: string;
  quantity: string;
  price: string;
  triggerPrice: string;
  disclosedQuantity: string;
  afterMarketOrder: boolean;
};

type DhanOrderPreview = {
  ok: boolean;
  correlationId: string;
  warnings: string[];
  checks: { label: string; ok: boolean; message: string }[];
  estimatedValue: number;
  payload: Record<string, unknown>;
  error?: string;
};

type DhanOrderPlacement = {
  ok: boolean;
  dryRun?: boolean;
  response?: { orderId?: string; orderStatus?: string; [key: string]: unknown };
  request?: Record<string, unknown>;
  error?: string;
};

type PaperOrder = {
  id: string;
  time: string;
  securityId: string;
  exchangeSegment: string;
  side: string;
  quantity: number;
  fillPrice: number;
  value: number;
  status: string;
};

type PaperPosition = {
  securityId: string;
  exchangeSegment: string;
  netQuantity: number;
  avgPrice: number;
  investedValue: number;
};

type InstrumentMatch = {
  securityId: string;
  displayName: string;
  tradingSymbol: string;
  exchangeSegment: string;
  underlying: string;
  expiry: string;
  strike: string;
  optionType: string;
  lotSize: number;
  lastPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  oi?: number | null;
  volume?: number | null;
  moneyness?: string;
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

const initialDhanOrderTicket: DhanOrderTicket = {
  exchangeSegment: "NSE_EQ",
  productType: "INTRADAY",
  orderType: "MARKET",
  transactionType: "BUY",
  validity: "DAY",
  securityId: "",
  quantity: "1",
  price: "0",
  triggerPrice: "0",
  disclosedQuantity: "0",
  afterMarketOrder: false
};

export default function AlgoTradingPanel() {
  const [activeSection, setActiveSection] = useState<AlgoSection>("dashboard");
  const [status, setStatus] = useState("TradingOS ready. Connect Dhan before live deployment.");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [paperModeActive, setPaperModeActive] = useState(false);
  const [paperCash, setPaperCash] = useState(100000);
  const [paperFillPrice, setPaperFillPrice] = useState("");
  const [paperOrders, setPaperOrders] = useState<PaperOrder[]>([]);
  const [paperPositions, setPaperPositions] = useState<PaperPosition[]>([]);
  const [savedStrategyName, setSavedStrategyName] = useState("NIFTY EMA Protection");
  const [webhookSecretVisible, setWebhookSecretVisible] = useState(false);
  const [dhanClientId, setDhanClientId] = useState("");
  const [dhanAccessToken, setDhanAccessToken] = useState("");
  const [dhanTesting, setDhanTesting] = useState(false);
  const [dhanTestResult, setDhanTestResult] = useState<DhanTestResult | null>(null);
  const [dhanOrderTicket, setDhanOrderTicket] = useState<DhanOrderTicket>(initialDhanOrderTicket);
  const [dhanOrderPreview, setDhanOrderPreview] = useState<DhanOrderPreview | null>(null);
  const [dhanOrderPlacement, setDhanOrderPlacement] = useState<DhanOrderPlacement | null>(null);
  const [dhanOrderTesting, setDhanOrderTesting] = useState(false);
  const [dhanOrderPlacing, setDhanOrderPlacing] = useState(false);
  const [dhanLiveConfirm, setDhanLiveConfirm] = useState("");
  const [instrumentUnderlying, setInstrumentUnderlying] = useState("NIFTY");
  const [instrumentOptionType, setInstrumentOptionType] = useState("CE");
  const [instrumentStrike, setInstrumentStrike] = useState("");
  const [instrumentExpiry, setInstrumentExpiry] = useState("");
  const [instrumentMatches, setInstrumentMatches] = useState<InstrumentMatch[]>([]);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  const [instrumentChainMeta, setInstrumentChainMeta] = useState<{ underlyingLastPrice?: number; atmStrike?: number; expiry?: string; source?: string }>({});

  const sectionTitle = useMemo(
    () => navItems.find((item) => item.id === activeSection)?.label ?? "Dashboard",
    [activeSection]
  );

  function selectSection(id: AlgoSection) {
    setActiveSection(id);
    setStatus(`${navItems.find((item) => item.id === id)?.label ?? "TradingOS"} opened.`);
  }

  function runBacktest() {
    setActiveSection("backtests");
    setStatus("Backtest needs real data first: connect TradingView, import historical signals, or recreate the indicator logic in Strategy DSL.");
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

  async function connectDhan() {
    const clientId = dhanClientId.trim();
    const accessToken = dhanAccessToken.trim();

    if (!clientId || !accessToken) {
      setStatus("Enter your Dhan client ID and access token first.");
      return;
    }

    setDhanTesting(true);
    setStatus("Testing Dhan connection with read-only checks...");

    try {
      const response = await fetch("/api/brokers/dhan/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, accessToken })
      });
      const result = (await response.json()) as DhanTestResult;
      setDhanTestResult(result);
      setActiveSection("dhan");

      if (!response.ok || !result.connected) {
        setStatus(result.error || "Dhan connection test failed. Check the token, expiry, and Dhan API access.");
        return;
      }

      setBrokerOpen(false);
      setStatus("Dhan connection test passed. Profile, funds, positions and orders were checked without placing any trade.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Dhan connection error";
      setDhanTestResult({ connected: false, testedAt: new Date().toISOString(), checks: [], error: message });
      setStatus(`Dhan connection test failed: ${message}`);
    } finally {
      setDhanTesting(false);
    }
  }

  function updateDhanOrderTicket(field: keyof DhanOrderTicket, value: string | boolean) {
    setDhanOrderTicket((prev) => ({ ...prev, [field]: value }));
    setDhanOrderPreview(null);
    setDhanOrderPlacement(null);
    setDhanLiveConfirm("");
  }

  async function previewDhanOrder() {
    const clientId = dhanClientId.trim();
    const accessToken = dhanAccessToken.trim();

    if (!clientId || !accessToken) {
      setStatus("Connect Dhan first, then run the order dry-run preview.");
      setBrokerOpen(true);
      return;
    }

    setDhanOrderTesting(true);
    setDhanOrderPlacement(null);
    setStatus("Running Dhan order dry-run preview...");

    try {
      const response = await fetch("/api/brokers/dhan/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, accessToken, ticket: dhanOrderTicket, dryRun: true })
      });
      const result = (await response.json()) as DhanOrderPreview;
      setDhanOrderPreview(result);
      setStatus(result.ok ? "Dry-run passed. Review the payload before any live order." : result.error || "Dry-run failed. Fix the order ticket first.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown order preview error";
      setDhanOrderPreview({ ok: false, correlationId: "", warnings: [], checks: [], estimatedValue: 0, payload: {}, error: message });
      setStatus(`Dhan order preview failed: ${message}`);
    } finally {
      setDhanOrderTesting(false);
    }
  }

  async function placeDhanOrder() {
    const clientId = dhanClientId.trim();
    const accessToken = dhanAccessToken.trim();

    if (!dhanOrderPreview?.ok) {
      setStatus("Run a successful dry-run preview before placing a live order.");
      return;
    }
    if (dhanLiveConfirm !== "PLACE LIVE ORDER") {
      setStatus("Type PLACE LIVE ORDER to unlock live placement.");
      return;
    }
    if (!clientId || !accessToken) {
      setStatus("Connect Dhan again before placing a live order.");
      return;
    }

    setDhanOrderPlacing(true);
    setStatus("Sending live order to Dhan...");

    try {
      const response = await fetch("/api/brokers/dhan/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, accessToken, ticket: dhanOrderTicket, dryRun: false, liveConfirm: dhanLiveConfirm })
      });
      const result = (await response.json()) as DhanOrderPlacement;
      setDhanOrderPlacement(result);
      setStatus(result.ok ? `Dhan live order submitted: ${result.response?.orderId ?? "order id pending"}.` : result.error || "Dhan live order failed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown live order error";
      setDhanOrderPlacement({ ok: false, error: message });
      setStatus(`Dhan live order failed: ${message}`);
    } finally {
      setDhanOrderPlacing(false);
    }
  }

  async function searchDhanInstruments() {
    setInstrumentLoading(true);
    setStatus("Searching Dhan option chain...");

    try {
      const clientId = dhanClientId.trim();
      const accessToken = dhanAccessToken.trim();
      let response: Response;
      let result: { matches?: InstrumentMatch[]; error?: string; underlyingLastPrice?: number; atmStrike?: number; expiry?: string; source?: string };

      if (clientId && accessToken) {
        response = await fetch("/api/brokers/dhan/option-chain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            accessToken,
            underlying: instrumentUnderlying,
            optionType: instrumentOptionType,
            expiry: instrumentExpiry.trim() || undefined,
            strikesEachSide: 10
          })
        });
        result = (await response.json()) as typeof result;
      } else {
        const params = new URLSearchParams({
          underlying: instrumentUnderlying,
          optionType: instrumentOptionType,
          limit: "80"
        });
        if (instrumentStrike.trim()) params.set("strike", instrumentStrike.trim());
        if (instrumentExpiry.trim()) params.set("expiry", instrumentExpiry.trim());
        response = await fetch(`/api/brokers/dhan/instruments?${params.toString()}`);
        result = (await response.json()) as typeof result;
      }

      if (!response.ok) {
        setInstrumentMatches([]);
        setInstrumentChainMeta({});
        setStatus(result.error || "Dhan option search failed. If prices are needed, reconnect Dhan and ensure Data API access is enabled.");
        return;
      }

      setInstrumentMatches(result.matches ?? []);
      setInstrumentChainMeta({
        underlyingLastPrice: result.underlyingLastPrice,
        atmStrike: result.atmStrike,
        expiry: result.expiry,
        source: result.source
      });
      setStatus(`${result.matches?.length ?? 0} contracts found${result.atmStrike ? ` around ATM ${result.atmStrike}` : ""}. Pick a contract to fill security ID, lot size and price.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown option search error";
      setInstrumentMatches([]);
      setInstrumentChainMeta({});
      setStatus(`Dhan option search failed: ${message}`);
    } finally {
      setInstrumentLoading(false);
    }
  }

  function selectDhanInstrument(instrument: InstrumentMatch) {
    const price = Number(instrument.lastPrice || instrument.ask || instrument.bid || 0);
    setDhanOrderTicket((prev) => ({
      ...prev,
      exchangeSegment: instrument.exchangeSegment,
      securityId: instrument.securityId,
      quantity: String(instrument.lotSize || 1),
      price: price > 0 ? String(price) : prev.price
    }));
    setDhanOrderPreview(null);
    setDhanOrderPlacement(null);
    setPaperFillPrice(price > 0 ? String(price) : "");
    setStatus(`${instrument.displayName} selected. Security ID, lot size${price > 0 ? " and price" : ""} are filled into the ticket.`);
  }

  function resetPaperAccount() {
    setPaperModeActive(false);
    setPaperCash(100000);
    setPaperFillPrice("");
    setPaperOrders([]);
    setPaperPositions([]);
    setStatus("Paper account reset to ₹1,00,000 virtual cash.");
  }

  function placePaperOrder() {
    const quantity = Number(dhanOrderTicket.quantity);
    const ticketPrice = Number(dhanOrderTicket.price);
    const fillPrice = Number(paperFillPrice || (ticketPrice > 0 ? ticketPrice : 0));
    const securityId = dhanOrderTicket.securityId.trim();

    if (!paperModeActive) {
      setStatus("Start paper mode before placing a virtual order.");
      return;
    }
    if (!securityId) {
      setStatus("Security ID is required for a paper order.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setStatus("Paper order quantity must be a positive whole number.");
      return;
    }
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      setStatus("Enter a simulated fill price for the paper order.");
      return;
    }

    const value = quantity * fillPrice;
    const sideMultiplier = dhanOrderTicket.transactionType === "BUY" ? 1 : -1;
    const cashChange = dhanOrderTicket.transactionType === "BUY" ? -value : value;

    if (dhanOrderTicket.transactionType === "BUY" && value > paperCash) {
      setStatus("Paper order blocked: virtual cash is not enough for this buy order.");
      return;
    }

    const order: PaperOrder = {
      id: `PAPER-${Date.now().toString(36).toUpperCase()}`,
      time: new Date().toLocaleString("en-IN", { hour12: false }),
      securityId,
      exchangeSegment: dhanOrderTicket.exchangeSegment,
      side: dhanOrderTicket.transactionType,
      quantity,
      fillPrice,
      value,
      status: "Filled"
    };

    setPaperOrders((prev) => [order, ...prev]);
    setPaperCash((prev) => prev + cashChange);
    setPaperPositions((prev) => {
      const existing = prev.find((position) => position.securityId === securityId && position.exchangeSegment === dhanOrderTicket.exchangeSegment);
      const signedQuantity = sideMultiplier * quantity;

      if (!existing) {
        return [{ securityId, exchangeSegment: dhanOrderTicket.exchangeSegment, netQuantity: signedQuantity, avgPrice: fillPrice, investedValue: Math.abs(value) }, ...prev];
      }

      const nextQuantity = existing.netQuantity + signedQuantity;
      if (nextQuantity === 0) {
        return prev.filter((position) => position !== existing);
      }

      const sameDirection = Math.sign(existing.netQuantity) === Math.sign(signedQuantity);
      const nextAvgPrice = sameDirection
        ? ((Math.abs(existing.netQuantity) * existing.avgPrice) + value) / Math.abs(nextQuantity)
        : existing.avgPrice;

      return prev.map((position) => position === existing
        ? { ...position, netQuantity: nextQuantity, avgPrice: nextAvgPrice, investedValue: Math.abs(nextQuantity) * nextAvgPrice }
        : position);
    });
    setStatus(`${order.id} filled in paper mode. No Dhan order was sent.`);
  }

  const metricCards = (
    <div className="algo-os-grid five">
      {[
        ["Paper cash", `₹${paperCash.toLocaleString("en-IN")}`, paperModeActive ? "Virtual broker active" : "Start paper mode first"],
        ["Running strategies", "0", paperModeActive ? "Paper mode active" : "Start paper mode first"],
        ["Paper deployed", `₹${paperPositions.reduce((sum, item) => sum + item.investedValue, 0).toLocaleString("en-IN")}`, "Virtual exposure only"],
        ["Paper positions", String(paperPositions.length), "No live exposure"],
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
    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Backtests</h3><p>Backtest is locked until real strategy/signal data is available. No sample P&L is shown.</p></div><button type="button" onClick={() => setActiveSection("tradingview")} className="algo-action primary">Connect TradingView first</button></div><div className="algo-empty-state">No backtest data yet. Connect TradingView for realtime signals, import historical signal CSV, or recreate accessible Pine logic in the Strategy DSL.</div><div className="algo-rule-list"><div><span>Historical protected indicator</span><b>Needs imported signals</b></div><div><span>Accessible Pine logic</span><b>Convert to Strategy DSL</b></div><div><span>Forward test</span><b>TradingView signals + Dhan paper/live</b></div></div></div><div className="algo-os-card"><h3>Assumptions</h3><div className="algo-rule-list"><div><span>Entry execution</span><b>Signal price / next candle open</b></div><div><span>Brokerage + taxes</span><b>Configured before test</b></div><div><span>Slippage</span><b>Configured before test</b></div><div><span>Options data</span><b>Actual contracts only</b></div></div></div></div>;
  }

  function renderPaper() {
    const quantity = Number(dhanOrderTicket.quantity);
    const previewPrice = Number(paperFillPrice || dhanOrderTicket.price || 0);
    const previewValue = Number.isFinite(quantity * previewPrice) ? quantity * previewPrice : 0;

    return <div className="space-y-4"><div className="algo-os-grid three"><div className="algo-os-card metric"><span>Paper Mode</span><strong>{paperModeActive ? "On" : "Off"}</strong><p>Virtual broker. No Dhan order is sent.</p><button type="button" onClick={() => { setPaperModeActive((prev) => !prev); setStatus(!paperModeActive ? "Paper trading started with virtual money." : "Paper trading stopped."); }} className="algo-action primary wide">{paperModeActive ? "Stop paper" : "Start paper"}</button></div><div className="algo-os-card metric"><span>Virtual Cash</span><strong>₹{paperCash.toLocaleString("en-IN")}</strong><p>Starting balance ₹1,00,000.</p></div><div className="algo-os-card metric"><span>Paper Trades</span><strong>{paperOrders.length}</strong><p>Filled locally in the panel.</p></div></div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Paper Order Ticket</h3><p>Uses the same manual order ticket fields as Dhan, but fills against virtual cash only.</p></div><span className="algo-pill good">No live broker</span></div><div className="algo-form-grid"><label>Exchange segment<select value={dhanOrderTicket.exchangeSegment} onChange={(event) => updateDhanOrderTicket("exchangeSegment", event.target.value)}><option>NSE_EQ</option><option>NSE_FNO</option><option>BSE_EQ</option><option>BSE_FNO</option><option>MCX_COMM</option></select></label><label>Product type<select value={dhanOrderTicket.productType} onChange={(event) => updateDhanOrderTicket("productType", event.target.value)}><option>INTRADAY</option><option>CNC</option><option>MARGIN</option><option>MTF</option><option>CO</option><option>BO</option></select></label><label>Side<select value={dhanOrderTicket.transactionType} onChange={(event) => updateDhanOrderTicket("transactionType", event.target.value)}><option>BUY</option><option>SELL</option></select></label><label>Order type<select value={dhanOrderTicket.orderType} onChange={(event) => updateDhanOrderTicket("orderType", event.target.value)}><option>MARKET</option><option>LIMIT</option><option>STOP_LOSS</option><option>STOP_LOSS_MARKET</option></select></label><label>Security ID<input value={dhanOrderTicket.securityId} onChange={(event) => updateDhanOrderTicket("securityId", event.target.value)} placeholder="Dhan security ID" /></label><label>Quantity<input value={dhanOrderTicket.quantity} onChange={(event) => updateDhanOrderTicket("quantity", event.target.value)} inputMode="numeric" /></label><label>Simulated fill price<input value={paperFillPrice} onChange={(event) => setPaperFillPrice(event.target.value)} inputMode="decimal" placeholder="Required for paper" /></label><label>Ticket price<input value={dhanOrderTicket.price} onChange={(event) => updateDhanOrderTicket("price", event.target.value)} inputMode="decimal" placeholder="Optional" /></label></div><div className="algo-modal-actions"><button type="button" onClick={placePaperOrder} className="algo-action primary" disabled={!paperModeActive}>Place paper order</button><button type="button" onClick={resetPaperAccount} className="algo-action secondary">Reset paper account</button></div></div><div className="algo-os-card"><h3>Virtual Risk Check</h3><div className="algo-rule-list"><div><span>Estimated value</span><b>{previewValue > 0 ? `₹${previewValue.toLocaleString("en-IN")}` : "Enter fill price"}</b></div><div><span>Cash after buy</span><b>{previewValue > 0 ? `₹${(paperCash - previewValue).toLocaleString("en-IN")}` : "--"}</b></div><div><span>Mode</span><b>{paperModeActive ? "Paper enabled" : "Paper stopped"}</b></div><div><span>Live broker</span><b>Not used</b></div></div></div></div>

      <div className="grid gap-4 xl:grid-cols-2"><div className="algo-os-card"><div className="algo-card-head"><h3>Paper Positions</h3><span className="algo-pill pending">{paperPositions.length} open</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Security ID</th><th>Segment</th><th>Net Qty</th><th>Avg Price</th><th>Value</th></tr></thead><tbody>{paperPositions.length ? paperPositions.map((position) => <tr key={`${position.exchangeSegment}-${position.securityId}`}><td>{position.securityId}</td><td>{position.exchangeSegment}</td><td>{position.netQuantity}</td><td>₹{position.avgPrice.toFixed(2)}</td><td>₹{position.investedValue.toLocaleString("en-IN")}</td></tr>) : <tr><td colSpan={5}>No paper positions yet.</td></tr>}</tbody></table></div></div><div className="algo-os-card"><div className="algo-card-head"><h3>Paper Orders</h3><span className="algo-pill pending">{paperOrders.length} filled</span></div><div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Order</th><th>Side</th><th>Security</th><th>Qty</th><th>Fill</th><th>Value</th></tr></thead><tbody>{paperOrders.length ? paperOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.side}</td><td>{order.securityId}</td><td>{order.quantity}</td><td>₹{order.fillPrice.toFixed(2)}</td><td>₹{order.value.toLocaleString("en-IN")}</td></tr>) : <tr><td colSpan={6}>No paper orders yet.</td></tr>}</tbody></table></div></div></div></div>;
  }

  function renderLive() {
    return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><h3>Live Strategies</h3><p>Native, TradingView and API signals all normalize to the same Signal object before risk and execution.</p><div className="algo-lifecycle-line">{["Draft", "Backtested", "Paper", "Ready", "Live"].map((item, index) => <span key={item} className={index === 0 || (paperModeActive && index === 2) ? "active" : ""}>{item}</span>)}</div><button type="button" onClick={() => setStatus("Live deployment blocked until Dhan is connected and strategy passes risk validation.")} className="algo-action secondary wide">Check live readiness</button></div><div className="algo-os-card"><h3>Execution Guardrails</h3><div className="algo-rule-list"><div><span>Idempotency</span><b>Required</b></div><div><span>Risk validation</span><b>Before order</b></div><div><span>Broker status</span><b>Dhan pending</b></div><div><span>Kill switch</span><b>{killSwitchActive ? "Active" : "Ready"}</b></div></div></div></div>;
  }

  function renderTemplates() {
    return <div className="algo-os-grid three">{["EMA Crossover", "VWAP Pullback", "Opening Range", "Iron Condor", "Straddle Breakout", "Supertrend Trail"].map((name) => <div key={name} className="algo-os-card"><h3>{name}</h3><p>Start with a reusable template, then save as your own strategy version.</p><button type="button" onClick={() => { setSavedStrategyName(name); setBuilderOpen(true); }} className="algo-action secondary wide">Use template</button></div>)}</div>;
  }

  function renderPositions() {
    const positionsCheck = dhanTestResult?.checks.find((check) => check.name === "Positions");
    return <div className="algo-os-card"><div className="algo-card-head"><h3>Positions</h3><span className={`algo-pill ${positionsCheck?.ok || paperPositions.length ? "good" : "pending"}`}>{paperPositions.length ? "Paper positions" : positionsCheck?.ok ? "Dhan checked" : "Connect Dhan first"}</span></div>{paperPositions.length ? <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Security ID</th><th>Segment</th><th>Net Qty</th><th>Avg Price</th><th>Value</th></tr></thead><tbody>{paperPositions.map((position) => <tr key={`${position.exchangeSegment}-${position.securityId}`}><td>{position.securityId}</td><td>{position.exchangeSegment}</td><td>{position.netQuantity}</td><td>₹{position.avgPrice.toFixed(2)}</td><td>₹{position.investedValue.toLocaleString("en-IN")}</td></tr>)}</tbody></table></div> : <div className="algo-empty-state">{positionsCheck?.ok ? `${dhanTestResult?.positionsCount ?? 0} open positions returned by Dhan.` : "No live or paper positions loaded yet."}</div>}</div>;
  }
  function renderOrders() {
    const ordersCheck = dhanTestResult?.checks.find((check) => check.name === "Orders");
    return <div className="algo-os-card"><div className="algo-card-head"><h3>Orders</h3><span className={`algo-pill ${ordersCheck?.ok || paperOrders.length ? "good" : "pending"}`}>{paperOrders.length ? "Paper orders" : ordersCheck?.ok ? "Dhan checked" : "Paper samples"}</span></div>{paperOrders.length ? <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Order</th><th>Time</th><th>Side</th><th>Security</th><th>Qty</th><th>Fill</th><th>Status</th></tr></thead><tbody>{paperOrders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{order.time}</td><td>{order.side}</td><td>{order.securityId}</td><td>{order.quantity}</td><td>₹{order.fillPrice.toFixed(2)}</td><td>{order.status}</td></tr>)}</tbody></table></div> : ordersCheck?.ok ? <div className="algo-empty-state">{dhanTestResult?.ordersCount ?? 0} orders returned for today. Live order placement is still blocked until you approve a trade test.</div> : <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Order ID</th><th>Strategy</th><th>Side</th><th>Qty</th><th>Status</th><th>Time</th></tr></thead><tbody>{orderRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.strategy}</td><td>{row.side}</td><td>{row.qty}</td><td>{row.status}</td><td>{row.time}</td></tr>)}</tbody></table></div>}</div>;
  }
  function renderTrades() { return <div className="algo-os-card"><h3>Trades</h3><p>Automated paper/live fills will land here before syncing to journal analytics.</p><div className="algo-empty-state">No algo trades yet.</div></div>; }
  function renderRiskProfiles() { return <div className="grid gap-4 xl:grid-cols-2"><div className="algo-os-card"><h3>Intraday Protected</h3><div className="algo-rule-list">{riskRows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div></div><div className="algo-os-card"><h3>Conservative Options</h3><div className="algo-rule-list"><div><span>Max lots</span><b>1</b></div><div><span>Max loss</span><b>₹2,500</b></div><div><span>Allowed instruments</span><b>NIFTY / BANKNIFTY</b></div></div></div></div>; }
  function renderKillSwitch() { return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]"><div className="algo-os-card"><h3>Kill Switch</h3><p>Visible emergency action for exit all, cancel orders, pause strategies and block new entries.</p><button type="button" onClick={activateKillSwitch} className="algo-action danger wide">Activate kill switch</button></div><div className="algo-os-card"><h3>Protection State</h3><div className="algo-alert-box"><b>{killSwitchActive ? "Blocked" : "Ready"}</b><span>{killSwitchActive ? "New orders are stopped." : "Risk checks are armed."}</span></div><button type="button" onClick={() => { setKillSwitchActive(false); setStatus("Kill switch reset. Risk checks remain armed."); }} className="algo-action secondary wide">Reset kill switch</button></div></div>; }
  function renderRiskEvents() { return <div className="algo-os-card"><h3>Risk Events</h3><div className="algo-alert-box"><b>{killSwitchActive ? "Kill switch active" : "No critical risk events"}</b><span>{killSwitchActive ? "Live deployment is blocked until reset." : "No rejected orders yet."}</span></div><div className="algo-alert-box"><b>Order rejected sample</b><span>BANKNIFTY ORB blocked because broker connection is pending.</span></div></div>; }
  function renderJournal() { return <div className="algo-os-card"><h3>Automated Journal</h3><p>Paper and live fills will create journal entries with strategy, version, signal ID, execution mode and risk decisions.</p><div className="algo-rule-list"><div><span>Execution mode</span><b>BACKTEST / PAPER / LIVE</b></div><div><span>Signal lineage</span><b>strategyId + version + signalId</b></div><div><span>Review loop</span><b>Feeds Analytics</b></div></div></div>; }
  function renderAnalytics() { return <div className="algo-os-grid three"><div className="algo-os-card metric"><span>Profit Factor</span><strong>--</strong><p>Requires completed algo trades.</p></div><div className="algo-os-card metric"><span>Expectancy</span><strong>--</strong><p>By strategy version.</p></div><div className="algo-os-card metric"><span>Max Drawdown</span><strong>--</strong><p>Backtest/paper/live separated.</p></div></div>; }
  function renderDhan() {
    const checkMap = new Map((dhanTestResult?.checks ?? []).map((check) => [check.name, check]));
    const balance = dhanTestResult?.funds?.availableBalance ?? dhanTestResult?.funds?.availabelBalance ?? "--";
    const liveUnlocked = Boolean(dhanOrderPreview?.ok && dhanLiveConfirm === "PLACE LIVE ORDER" && !dhanOrderPlacing);

    return <div className="space-y-4"><div className="algo-warning-card"><b>Safe Dhan execution flow</b><span>First verify read access, then dry-run the exact order payload. Live placement stays locked until you type the confirmation phrase.</span></div><div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]"><div className="algo-os-card"><div className="algo-card-head"><div><h3>Dhan Connection</h3><p>Generate an access token from Dhan Web, then run a read-only health check here.</p></div><button type="button" onClick={() => setBrokerOpen(true)} className="algo-action primary">{dhanTestResult?.connected ? "Retest Dhan" : "Connect Dhan"}</button></div><div className="algo-os-grid two compact-cards">{["Profile", "Funds", "Positions", "Orders"].map((name) => { const check = checkMap.get(name); return <div key={name} className="algo-os-card metric compact"><span>{name}</span><strong>{check ? (check.ok ? "OK" : "Failed") : "Pending"}</strong><p>{check?.message ?? "Not tested yet"}</p></div>; })}</div></div><div className="algo-os-card"><h3>Account Snapshot</h3><div className="algo-rule-list"><div><span>Client ID</span><b>{dhanTestResult?.profile?.dhanClientId ?? "Not connected"}</b></div><div><span>Token validity</span><b>{dhanTestResult?.profile?.tokenValidity ?? "--"}</b></div><div><span>Active segments</span><b>{dhanTestResult?.profile?.activeSegment ?? "--"}</b></div><div><span>Data plan</span><b>{dhanTestResult?.profile?.dataPlan ?? "--"}</b></div><div><span>Available balance</span><b>{typeof balance === "number" ? `₹${balance.toLocaleString("en-IN")}` : String(balance)}</b></div><div><span>Positions / Orders</span><b>{dhanTestResult ? `${dhanTestResult.positionsCount ?? 0} / ${dhanTestResult.ordersCount ?? 0}` : "--"}</b></div></div></div></div>

      <div className="algo-os-card"><div className="algo-card-head"><div><h3>Option Chain Finder</h3><p>With Dhan connected, this shows ATM plus 10 ITM/10 OTM strikes with live LTP. Without token, it falls back to contract search.</p></div><button type="button" onClick={searchDhanInstruments} className="algo-action secondary" disabled={instrumentLoading}>{instrumentLoading ? "Searching..." : "Search contracts"}</button></div><div className="algo-form-grid"><label>Underlying<select value={instrumentUnderlying} onChange={(event) => setInstrumentUnderlying(event.target.value)}><option>NIFTY</option><option>BANKNIFTY</option><option>FINNIFTY</option><option>SENSEX</option></select></label><label>Option type<select value={instrumentOptionType} onChange={(event) => setInstrumentOptionType(event.target.value)}><option>CE</option><option>PE</option></select></label><label>Strike filter<input value={instrumentStrike} onChange={(event) => setInstrumentStrike(event.target.value)} placeholder="fallback search only" /></label><label>Expiry<input value={instrumentExpiry} onChange={(event) => setInstrumentExpiry(event.target.value)} placeholder="blank = nearest expiry" /></label></div><div className="algo-rule-list mt-4"><div><span>Underlying LTP</span><b>{instrumentChainMeta.underlyingLastPrice ? `₹${instrumentChainMeta.underlyingLastPrice.toLocaleString("en-IN")}` : "Connect Dhan and search"}</b></div><div><span>ATM strike</span><b>{instrumentChainMeta.atmStrike ?? "--"}</b></div><div><span>Expiry</span><b>{instrumentChainMeta.expiry ?? "--"}</b></div></div><div className="overflow-auto mt-4"><table className="algo-os-table"><thead><tr><th>Strike</th><th>Type</th><th>Moneyness</th><th>LTP</th><th>Bid / Ask</th><th>OI</th><th>Security ID</th><th>Lot</th><th></th></tr></thead><tbody>{instrumentMatches.length ? instrumentMatches.map((instrument) => <tr key={`${instrument.securityId}-${instrument.displayName}`}><td>{instrument.strike || "--"}</td><td>{instrument.optionType}</td><td>{instrument.moneyness ?? "--"}</td><td>{instrument.lastPrice ? `₹${instrument.lastPrice}` : "--"}</td><td>{instrument.bid || instrument.ask ? `${instrument.bid ?? "--"} / ${instrument.ask ?? "--"}` : "--"}</td><td>{instrument.oi ?? "--"}</td><td>{instrument.securityId}</td><td>{instrument.lotSize}</td><td><button type="button" onClick={() => selectDhanInstrument(instrument)} className="algo-mini-button">Use</button></td></tr>) : <tr><td colSpan={9}>Search for option chain to see ATM ±10 strikes and prices.</td></tr>}</tbody></table></div></div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(440px,0.8fr)]">
        <div className="algo-os-card">
          <div className="algo-card-head"><div><h3>Manual Test Order</h3><p>Use a small quantity first. Security ID must be the Dhan exchange security id for the exact instrument.</p></div><span className={`algo-pill ${dhanOrderPreview?.ok ? "good" : "pending"}`}>{dhanOrderPreview?.ok ? "Dry-run passed" : "Dry-run required"}</span></div>
          <div className="algo-form-grid">
            <label>Exchange segment<select value={dhanOrderTicket.exchangeSegment} onChange={(event) => updateDhanOrderTicket("exchangeSegment", event.target.value)}><option>NSE_EQ</option><option>NSE_FNO</option><option>BSE_EQ</option><option>BSE_FNO</option><option>MCX_COMM</option></select></label>
            <label>Product type<select value={dhanOrderTicket.productType} onChange={(event) => updateDhanOrderTicket("productType", event.target.value)}><option>INTRADAY</option><option>CNC</option><option>MARGIN</option><option>MTF</option><option>CO</option><option>BO</option></select></label>
            <label>Side<select value={dhanOrderTicket.transactionType} onChange={(event) => updateDhanOrderTicket("transactionType", event.target.value)}><option>BUY</option><option>SELL</option></select></label>
            <label>Order type<select value={dhanOrderTicket.orderType} onChange={(event) => updateDhanOrderTicket("orderType", event.target.value)}><option>MARKET</option><option>LIMIT</option><option>STOP_LOSS</option><option>STOP_LOSS_MARKET</option></select></label>
            <label>Validity<select value={dhanOrderTicket.validity} onChange={(event) => updateDhanOrderTicket("validity", event.target.value)}><option>DAY</option><option>IOC</option></select></label>
            <label>Security ID<input value={dhanOrderTicket.securityId} onChange={(event) => updateDhanOrderTicket("securityId", event.target.value)} placeholder="e.g. 11536" /></label>
            <label>Quantity<input value={dhanOrderTicket.quantity} onChange={(event) => updateDhanOrderTicket("quantity", event.target.value)} inputMode="numeric" placeholder="1" /></label>
            <label>Price<input value={dhanOrderTicket.price} onChange={(event) => updateDhanOrderTicket("price", event.target.value)} inputMode="decimal" placeholder="0 for market" /></label>
            <label>Trigger price<input value={dhanOrderTicket.triggerPrice} onChange={(event) => updateDhanOrderTicket("triggerPrice", event.target.value)} inputMode="decimal" placeholder="Only SL orders" /></label>
            <label>Disclosed qty<input value={dhanOrderTicket.disclosedQuantity} onChange={(event) => updateDhanOrderTicket("disclosedQuantity", event.target.value)} inputMode="numeric" placeholder="0" /></label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs font-black text-slate-600"><input type="checkbox" checked={dhanOrderTicket.afterMarketOrder} onChange={(event) => updateDhanOrderTicket("afterMarketOrder", event.target.checked)} /> After market order</label>
          <div className="algo-modal-actions"><button type="button" onClick={previewDhanOrder} className="algo-action secondary" disabled={dhanOrderTesting}>{dhanOrderTesting ? "Checking..." : "Dry-run preview"}</button></div>
        </div>

        <div className="space-y-4">
          <div className="algo-os-card"><h3>Dry-run Result</h3>{dhanOrderPreview ? <div className="algo-rule-list">{dhanOrderPreview.checks.map((check) => <div key={check.label}><span>{check.label}</span><b>{check.ok ? "OK" : check.message}</b></div>)}<div><span>Estimated value</span><b>{dhanOrderPreview.estimatedValue ? `₹${dhanOrderPreview.estimatedValue.toLocaleString("en-IN")}` : "Market order"}</b></div><div><span>Correlation ID</span><b>{dhanOrderPreview.correlationId || "--"}</b></div></div> : <div className="algo-empty-state">Run dry-run preview to validate the ticket and generate the exact Dhan payload.</div>}{dhanOrderPreview?.warnings?.length ? <div className="algo-alert-box"><b>Warnings</b><span>{dhanOrderPreview.warnings.join(" ")}</span></div> : null}</div>
          <div className="algo-os-card"><h3>Live Placement Lock</h3><p>Type <b>PLACE LIVE ORDER</b> exactly after the dry-run passes.</p><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" value={dhanLiveConfirm} onChange={(event) => setDhanLiveConfirm(event.target.value)} placeholder="PLACE LIVE ORDER" /><button type="button" onClick={placeDhanOrder} className="algo-action danger wide mt-3" disabled={!liveUnlocked}>{dhanOrderPlacing ? "Sending..." : "PLACE LIVE ORDER"}</button>{dhanOrderPlacement ? <div className="algo-alert-box"><b>{dhanOrderPlacement.ok ? "Order submitted" : "Order failed"}</b><span>{dhanOrderPlacement.ok ? `${dhanOrderPlacement.response?.orderId ?? "Order id pending"} · ${dhanOrderPlacement.response?.orderStatus ?? "Status pending"}` : dhanOrderPlacement.error}</span></div> : null}</div>
        </div>
      </div>

      <div className="algo-os-card"><h3>Dhan Payload Preview</h3><pre className="algo-code-block">{JSON.stringify(dhanOrderPreview?.payload ?? { note: "Run dry-run preview first" }, null, 2)}</pre></div>
    </div>;
  }
  function renderTradingView() {
    const webhookUrl = "/api/v1/webhooks/tradingview";
    return (
      <div className="space-y-4">
        <div className="algo-warning-card">
          <b>TradingView limitation</b>
          <span>TradingView webhooks provide realtime alert events. They do not provide the indicator&apos;s complete historical signal history. For protected indicators, import historical signals or recreate the logic in TradingOS.</span>
        </div>

        <div className="algo-os-grid two">
          <div className="algo-os-card">
            <div className="algo-card-head">
              <div><h3>Mode A · Accessible Pine Logic</h3><p>Recreate the logic in the TradingOS Strategy DSL. TradingOS becomes the source of truth for historical signals, entries, exits, P&L and analytics.</p></div>
              <span className="algo-pill good">Native backtest</span>
            </div>
            <div className="algo-rule-list"><div><span>Historical signals</span><b>Calculated by TradingOS</b></div><div><span>Performance engine</span><b>Backtest / Paper / Live</b></div><div><span>Look-ahead bias</span><b>Avoided by replay engine</b></div></div>
          </div>

          <div className="algo-os-card">
            <div className="algo-card-head">
              <div><h3>Mode B · Protected Indicator</h3><p>Treat TradingView as a black-box signal provider. No scraping, no reverse engineering, no Strategy Tester dependency.</p></div>
              <span className="algo-pill pending">Webhook source</span>
            </div>
            <div className="algo-rule-list"><div><span>Realtime signals</span><b>TradingView alerts</b></div><div><span>Historical performance</span><b>Import signal CSV</b></div><div><span>Execution</span><b>Risk engine first</b></div></div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
          <div className="algo-os-card">
            <h3>TradingView Webhook</h3>
            <p>TradingView signals normalize to Signal, then pass validation, idempotency, risk and execution checks.</p>
            <div className="algo-rule-list"><div><span>Webhook URL</span><b>{webhookUrl}</b></div><div><span>Secret</span><b>{webhookSecretVisible ? "tv_demo_secret_123" : "********"}</b></div><div><span>Actions</span><b>BUY / SELL / EXIT / CLOSE_LONG / CLOSE_SHORT</b></div><div><span>Security</span><b>Secret, timestamp, duplicate and optional HMAC checks</b></div></div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${webhookUrl}`)} className="algo-action secondary">Copy URL</button><button type="button" onClick={() => setWebhookSecretVisible((prev) => !prev)} className="algo-action secondary">{webhookSecretVisible ? "Hide" : "Show"} Secret</button><button type="button" onClick={() => setStatus("Webhook secret regenerated locally. Backend persistence is next.")} className="algo-action primary">Regenerate Secret</button></div>
          </div>

          <div className="algo-os-card">
            <h3>Payload Mapping</h3>
            <pre className="algo-code-block">{`{
  "secret": "USER_SECRET",
  "strategyId": "strategy_123",
  "signalId": "tv_123456",
  "symbol": "NSE:NIFTY",
  "timeframe": "5m",
  "action": "BUY",
  "timestamp": "2026-10-08T09:30:00+05:30",
  "price": 25250,
  "metadata": { "indicator": "My Indicator", "signal": "BUY" }
}`}</pre>
          </div>
        </div>

        <div className="algo-os-grid five">
          {[["Net P&L", "--", "Waiting for signals"], ["Today's P&L", "--", "No realtime fills yet"], ["Total Trades", "0", "No TradingView trades"], ["Win Rate", "--", "Needs closed trades"], ["Webhook Health", "Not connected", "No webhook received"]].map(([label, value, helper]) => <div key={label} className="algo-os-card metric"><span>{label}</span><strong>{value}</strong><p>{helper}</p></div>)}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
          <div className="algo-os-card">
            <div className="algo-card-head"><div><h3>Performance Comparison</h3><p>Historical and realtime performance stay separate. Combined is shown only as a labelled aggregate.</p></div><span className="algo-pill good">Separated</span></div>
            <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Dataset</th><th>Trades</th><th>Win Rate</th><th>Net P&L</th><th>Profit Factor</th><th>Max DD</th></tr></thead><tbody><tr><td>BACKTEST · Not run</td><td>0</td><td>--</td><td>--</td><td>--</td><td>--</td></tr><tr><td>PAPER · Realtime not connected</td><td>0</td><td>--</td><td>--</td><td>--</td><td>--</td></tr><tr><td>COMBINED · Disabled until data exists</td><td>0</td><td>--</td><td>--</td><td>--</td><td>--</td></tr></tbody></table></div>
          </div>

          <div className="algo-os-card">
            <h3>Import Historical Signals</h3>
            <p>For protected indicators, import signal CSV. Required columns: timestamp, symbol, action, price.</p>
            <div className="algo-import-box"><span>CSV upload area</span><b>timestamp,symbol,action,price</b><small>Validation: timezone, duplicates, chronological order, missing values.</small></div>
            <button type="button" onClick={() => setStatus("Historical signal import UI is ready. Persistence and file parsing are the next backend step.")} className="algo-action secondary wide">Prepare import</button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
          <div className="algo-os-card">
            <div className="algo-card-head"><h3>Realtime Signal Feed</h3><span className="algo-pill good">Receiving Signals</span></div>
            <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Time</th><th>Action</th><th>Symbol</th><th>Price</th><th>Source</th><th>Status</th><th>Execution</th></tr></thead><tbody><tr><td colSpan={7}>No TradingView signals received yet. Create an alert in TradingView and point it to this webhook URL.</td></tr></tbody></table></div>
          </div>

          <div className="algo-os-card">
            <h3>Webhook Health</h3>
            <div className="algo-rule-list"><div><span>Status</span><b>No recent signals</b></div><div><span>Last signal</span><b>Never</b></div><div><span>Signals today</span><b>0</b></div><div><span>Failed webhooks</span><b>0</b></div><div><span>Duplicate signals</span><b>0</b></div><div><span>Processing latency</span><b>Waiting for first webhook</b></div></div>
          </div>
        </div>

        <div className="algo-os-card">
          <h3>Normalized Signal Model</h3>
          <pre className="algo-code-block">{`{
  "id": "tv_123456",
  "strategyId": "strategy_123",
  "source": "TRADINGVIEW",
  "symbol": "NSE:NIFTY",
  "action": "BUY",
  "timestamp": "2026-10-08T09:30:00+05:30",
  "price": 25250,
  "timeframe": "5m",
  "status": "VALIDATED",
  "metadata": { "indicator": "My Indicator" }
}`}</pre>
        </div>
      </div>
    );
  }

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
      {brokerOpen ? <div className="algo-modal-backdrop"><div className="algo-modal small"><div className="algo-card-head"><div><h3>Connect Dhan</h3><p>Runs a read-only test against Dhan profile, funds, positions and orders. No trade is placed.</p></div><button type="button" onClick={() => setBrokerOpen(false)}>×</button></div><div className="algo-form-grid single"><label>Client ID<input value={dhanClientId} onChange={(event) => setDhanClientId(event.target.value)} placeholder="Dhan client ID" /></label><label>Access token<input value={dhanAccessToken} onChange={(event) => setDhanAccessToken(event.target.value)} placeholder="Paste current Dhan access token" type="password" /></label></div>{dhanTestResult?.error ? <div className="algo-alert-box"><b>Last test failed</b><span>{dhanTestResult.error}</span></div> : null}<div className="algo-modal-actions"><button type="button" onClick={() => setBrokerOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={connectDhan} className="algo-action primary" disabled={dhanTesting}>{dhanTesting ? "Testing..." : "Test connection"}</button></div></div></div> : null}
      {exitConfirmOpen ? <div className="algo-modal-backdrop"><div className="algo-modal small danger-modal"><h3>EXIT ALL POSITIONS?</h3><p>This will exit open positions, cancel pending orders, pause strategies and activate the kill switch when broker execution is connected.</p><div className="algo-modal-actions"><button type="button" onClick={() => setExitConfirmOpen(false)} className="algo-action secondary">Cancel</button><button type="button" onClick={confirmExitAll} className="algo-action danger">EXIT EVERYTHING</button></div></div></div> : null}
    </main>
  );
}
