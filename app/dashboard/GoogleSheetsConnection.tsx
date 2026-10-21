"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accountFetch } from "../lib/accountFetch";

type Status = { configured: boolean; connected: boolean; enabled: boolean; url: string | null; lastSyncedAt?: string; signalCount: number; error?: string };
const endpoint = "/api/integrations/google-sheets";
export default function GoogleSheetsConnection() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const running = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => {
    const response = await accountFetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load Sheets connection.");
    if (mounted.current) setStatus(data as Status);
    return data as Status;
  }, []);
  const action = useCallback(async (action: string, silent = false) => {
    if (running.current) return; running.current = true;
    if (!silent) { setBusy(true); setError(""); }
    try {
      const response = await accountFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(65000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Sheets action failed.");
      if (data.url && action === "connect") { window.location.assign(data.url); return; }
      await load(); if (mounted.current) setError("");
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Sheets action failed."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    const result = new URLSearchParams(window.location.search).get("sheets");
    if (result && result !== "connected") setError(`Google connection: ${result.replaceAll("_", " ")}. Please try connecting again.`);
    void load().catch(e => { if (mounted.current) setError(e.message); });
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || running.current) return;
      void load().then(s => { if (s.enabled && s.url) void action("sync", true); }).catch(e => { if (mounted.current) setError(e.message); });
    }, 60000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [load, action]);
  return <section className="border-t border-slate-200 py-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Google Sheets</h3><span className="text-sm">{!status ? "Checking..." : !status.configured ? "Server setup required" : status.connected ? status.url ? status.enabled ? "Auto-sync on" : "Sync paused" : "Google connected" : "Not connected"}</span></div>
    {status && <div className="mt-3 flex flex-wrap items-center gap-3">
      {!status.connected && <button type="button" className="algo-action secondary" disabled={busy || !status.configured} onClick={() => void action("connect")}>Connect Google Sheets</button>}
      {status.connected && !status.url && <button type="button" className="algo-action primary" disabled={busy} onClick={() => { if (window.confirm("Create a private signal-log sheet in the connected Google account and enable automatic signal syncing?")) void action("create"); }}>Create my private sheet</button>}
      {status.url && <><a className="algo-action secondary" href={status.url} target="_blank" rel="noopener noreferrer">Open sheet</a><button type="button" className="algo-action secondary" disabled={busy || !status.enabled} onClick={() => void action("sync")}>Sync now</button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={status.enabled} disabled={busy} onChange={() => void action(status.enabled ? "pause" : "resume")} />Auto-sync</label><span className="text-sm">{status.signalCount} signals · {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "Not synced"}</span></>}
      {status.connected && <button type="button" className="algo-action secondary" disabled={busy} onClick={() => { if (window.confirm("Disconnect Sheets? The existing sheet stays in your Drive. Reconnecting requires creating a new report. Broker connections are unchanged.")) void action("disconnect"); }}>Disconnect</button>}
      {busy && <span role="status" className="text-sm">Working...</span>}
    </div>}
    {(error || status?.error) && <p role="alert" className="mt-3 text-sm text-red-600">{error || status?.error}</p>}
  </section>;
}
