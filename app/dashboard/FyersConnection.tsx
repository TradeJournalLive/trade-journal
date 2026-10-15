"use client";
import { useEffect, useState } from "react";

type Status = { configured: boolean; authenticated: boolean; callback: string };
type Quote = { symbol: string; status: string; ltp: number | null; bid: number | null; ask: number | null; timestamp: string | number | null };
export default function FyersConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [symbols, setSymbols] = useState("NSE:NIFTY50-INDEX");
  const [checkedAt, setCheckedAt] = useState("");
  async function refresh() {
    const response = await fetch("/api/brokers/fyers", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setStatus(data);
  }
  useEffect(() => { void refresh().catch(() => setError("Unable to load FYERS connection.")); }, []);
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const appId = String(fields.get("appId") || "").trim();
    const secret = String(fields.get("secret") || "").trim();
    try {
      const response = await fetch("/api/brokers/fyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(appId || secret ? { appId, secret } : {}) });
      const data = await response.json();
      form.reset();
      if (!response.ok) throw new Error(data.error);
      const destination = new URL(data.url);
      if (destination.origin !== "https://api-t1.fyers.in") throw new Error("Unexpected authorization destination.");
      window.location.assign(destination.toString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to connect."); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setQuotes([]); setCheckedAt("");
    try {
      const response = await fetch(`/api/brokers/fyers/quotes?${new URLSearchParams({ symbols })}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setQuotes(data.quotes); setCheckedAt(data.checkedAt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Quote test failed."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/brokers/fyers", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to disconnect FYERS.");
      setQuotes([]); setCheckedAt(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Disconnect failed."); }
    finally { setBusy(false); }
  }
  const value = (number: number | null) => number == null ? "--" : number.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return <div className="space-y-4">
    <div className="algo-os-card"><div className="algo-card-head"><h3>FYERS market data</h3><span className="algo-pill pending">Non-trading only</span></div>
      <div className="algo-rule-list"><div><span>Session</span><b>{status ? status.authenticated ? "Saved · quote verification required" : status.configured ? "Awaiting FYERS login" : "Not configured" : "Loading"}</b></div><div><span>Order execution</span><b>Disabled</b></div><div><span>Streaming worker</span><b>Not connected</b></div></div>
      {error && <div role="alert" className="algo-alert-box"><b>FYERS connection</b><span>{error}</span></div>}
      <form onSubmit={connect} className="mt-4 space-y-4">
        <div className="algo-form-grid"><label>App ID<input name="appId" autoComplete="off" spellCheck={false} required={!status?.configured} placeholder="Paper_new App ID" /></label><label>Secret ID<input name="secret" type="password" autoComplete="off" required={!status?.configured} placeholder={status?.configured ? "Saved securely" : "App secret"} /></label></div>
        <label className="block text-sm">Registered redirect URL<input aria-label="Registered redirect URL" readOnly value={status?.callback || ""} className="mt-2 block w-full min-w-0 rounded-lg border border-slate-200 p-3 text-xs" /></label>
        <div className="flex flex-wrap gap-2"><button className="algo-action primary" disabled={busy || !status} type="submit">{status?.configured ? "Sign in to FYERS" : "Save and sign in"}</button>{status?.configured && <button className="algo-action secondary" disabled={busy} type="button" onClick={() => void disconnect()}>Disconnect</button>}</div>
      </form>
    </div>
    <div className="algo-os-card"><div className="algo-card-head"><h3>Read-only quote test</h3><span className="algo-pill pending">Snapshot</span></div>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">NSE symbols<input aria-label="NSE quote symbols" value={symbols} onChange={event => setSymbols(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-200 p-3" /></label><button className="algo-action secondary" disabled={busy || !status?.authenticated} type="button" onClick={() => void test()}>Test quotes</button></div>
      {checkedAt && <p className="mt-3 text-xs text-slate-500">Checked {new Date(checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · not a streaming connection</p>}
      <div className="mt-3 overflow-auto"><table className="algo-os-table"><thead><tr><th>Symbol</th><th>Status</th><th>LTP</th><th>Bid</th><th>Ask</th><th>Feed timestamp</th></tr></thead><tbody>{quotes.map(quote => <tr key={quote.symbol}><td>{quote.symbol}</td><td>{quote.status}</td><td>{value(quote.ltp)}</td><td>{value(quote.bid)}</td><td>{value(quote.ask)}</td><td>{quote.timestamp ?? "--"}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}
