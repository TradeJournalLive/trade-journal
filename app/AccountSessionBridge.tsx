"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "./lib/supabaseClient";
import { accountFetch } from "./lib/accountFetch";

type LinkState = { linked: boolean; canLink: boolean };
export default function AccountSessionBridge({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const protectedPage = path.startsWith("/dashboard/algo");
  const [ready, setReady] = useState(false), [user, setUser] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [linking, setLinking] = useState(false);
  useEffect(() => {
    if (!supabase) { setError("Sign-in service unavailable."); return; }
    let stopped = false, generation = 0, queue = Promise.resolve();
    function sync(token: string | null, id: string) {
      const current = ++generation; setReady(false); setError(""); setLinks({});
      queue = queue.catch(() => {}).then(async () => {
        if (stopped || current !== generation) return;
        try {
          const response = await fetch("/api/account/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token }), signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("Unable to verify your account. Retry or sign in again.");
          const verified = await response.json();
          if (token && verified.userId !== id) throw new Error("Account verification mismatch. Sign in again.");
          if (!stopped && current === generation) { setUser(verified.userId || ""); setEmail(verified.email || ""); setReady(true); }
        } catch (e) { if (!stopped && current === generation) setError(e instanceof Error ? e.message : "Account verification failed."); }
      });
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { sync(session?.access_token ?? null, session?.user.id ?? ""); });
    return () => { stopped = true; subscription.unsubscribe(); };
  }, [retry]);
  useEffect(() => {
    if (!ready || !user || !protectedPage) return;
    let stopped = false;
    async function load() {
      try {
        const result: Record<string, LinkState> = {};
        for (const endpoint of ["/api/algo/link-account", "/api/brokers/fyers/link-account"]) {
          const response = await accountFetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("Unable to check saved account connections.");
          result[endpoint] = await response.json();
        }
        if (!stopped) setLinks(result);
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : "Connection lookup failed."); }
    }
    void load(); return () => { stopped = true; };
  }, [ready, user, protectedPage]);
  async function linkDevice() {
    if (!window.confirm(`Link this device's existing webhook and FYERS setup to ${email || "this account"}? Only continue if this account owns the setup.`)) return;
    setLinking(true); setError("");
    try {
      for (const [endpoint, state] of Object.entries(links)) {
        if (state.linked || !state.canLink) continue;
        const response = await accountFetch(endpoint, { method: "POST", signal: AbortSignal.timeout(15000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to link connection.");
      }
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to link setup."); }
    finally { setLinking(false); }
  }
  if (!protectedPage) return <>{children}</>;
  if (!ready) return <main className="p-8"><p role="status">{error || "Verifying your account..."}</p>{error && <button className="mt-4 underline" onClick={() => setRetry(value => value + 1)}>Retry account verification</button>}</main>;
  if (!user) return <main className="p-8"><Link href="/sign-in">Sign in to view your saved setup</Link></main>;
  const pending = Object.values(links).some(state => !state.linked && state.canLink);
  const missing = Object.values(links).some(state => !state.linked && !state.canLink);
  return <div key={user}>
    {(pending || missing || error) && <section className="border-b-2 border-amber-500 bg-amber-50 px-5 py-4 text-amber-950">
      <h2 className="font-bold">{pending ? "Save this device's setup to your account" : "Account connections"}</h2>
      <p className="mt-1 text-sm font-semibold">Signed in as {email || "verified account"}</p>
      <p className="mt-1 text-sm">{pending ? "One-time linking keeps your existing credentials and trade history. Other devices signed into this same account can then access them." : "On your original device, sign into this same account and link the existing setup. New devices do not need broker credentials again after linking."}</p>
      {pending && <button disabled={linking} onClick={() => void linkDevice()} className="mt-3 rounded-md bg-blue-700 px-4 py-2 font-semibold text-white">{linking ? "Linking..." : "Link this device's setup to my account"}</button>}
      {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
    </section>}
    {children}
  </div>;
}
