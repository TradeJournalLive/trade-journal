"use client";
import { accountFetch } from "../lib/accountFetch";

import { useEffect, useState } from "react";

type Readiness = "checking" | "signin" | "unavailable" | "ready";

export default function BrokerReadinessAlert({ onConnect }: { onConnect: () => void }) {
  const [state, setState] = useState<Readiness>("checking");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const controller = new AbortController();
    async function check() {
      if (checking) return;
      checking = true;
      if (!stopped) setState("checking");
      try {
        const response = await accountFetch("/api/brokers/fyers/quotes?symbols=NSE:NIFTY50-INDEX", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const result = await response.json();
        const valid = response.ok && result.quotes?.some((quote: { symbol?: string; status?: string; ltp?: number }) => quote.symbol === "NSE:NIFTY50-INDEX" && quote.status === "ok" && typeof quote.ltp === "number" && Number.isFinite(quote.ltp) && quote.ltp > 0);
        if (!stopped) setState(valid ? "ready" : response.status === 401 ? "signin" : "unavailable");
      } catch {
        if (!stopped) setState("unavailable");
      } finally { checking = false; }
    }
    void check();
    const focus = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(focus, 30000);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [retry]);

  if (state === "ready" || state === "checking") return <div role="status" aria-live="polite" className={`flex flex-wrap items-center gap-3 border px-4 py-3 text-sm ${state === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
    <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${state === "ready" ? "bg-emerald-600" : "bg-slate-400"}`} />
    <strong>{state === "ready" ? "FYERS connected · GREEN" : "Checking FYERS connection"}</strong>
    <span>{state === "ready" ? "Quote access verified. NIFTY worker status is separate." : "Connection not yet verified."}</span>
  </div>;
  return <div role="alert" aria-labelledby="fyers-readiness-title" className="flex flex-wrap items-center justify-between gap-5 border-y-2 border-red-600 bg-red-50 px-5 py-6 text-red-950 sm:px-6">
    <div className="min-w-0 flex-1 basis-72"><div className="mb-2 flex items-center gap-2 font-bold"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-red-600" />{state === "signin" ? "FYERS disconnected · RED" : "FYERS connection unverified · RED"}</div><h2 id="fyers-readiness-title" className="break-words text-xl font-extrabold leading-tight sm:text-2xl">{state === "signin" ? "CONNECT FYERS TO START NIFTY AUTO PAPER TRADING" : "NIFTY AUTO PAPER TRADING: CHECK FYERS CONNECTION"}</h2>
      <p className="mt-2 text-sm font-semibold">{state === "signin" ? "Your FYERS data session is not connected. Sign in to restore NIFTY market data." : "FYERS market data could not be verified. Recheck or reconnect before relying on NIFTY paper entries."}</p>
      <p className="mt-2 text-sm">After connecting, confirm the NIFTY worker is online and entries are armed. Paper trading only; Delta BTC is unaffected.</p>
    </div>
    <div className="flex w-full flex-wrap gap-3 sm:w-auto"><button type="button" className="min-h-12 rounded-md bg-red-700 px-6 py-3 text-base font-extrabold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" onClick={onConnect}>CONNECT FYERS</button><button type="button" className="algo-action secondary" onClick={() => { setState("checking"); setRetry(value => value + 1); }}>Recheck</button></div>
  </div>;
}
