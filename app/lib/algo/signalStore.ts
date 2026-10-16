import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { StoredAlgoEvent } from "./automation";

type PersistEventInput = {
  event: StoredAlgoEvent;
  secret: string;
  rawPayload: Record<string, unknown>;
};

const TABLE_NAME = "tradingview_signal_events";

export function hashWebhookSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function scrubRawPayload(rawPayload: Record<string, unknown>) {
  const { secret: _secret, ...safePayload } = rawPayload;
  return safePayload;
}

export async function persistAlgoSignalEvent({ event, secret, rawPayload }: PersistEventInput) {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, skipped: true, reason: "Supabase service role is not configured." };

  const row = {
    secret_hash: hashWebhookSecret(secret),
    strategy_id: event.signal.strategyId,
    signal_id: event.signal.id,
    source: event.signal.source,
    symbol: event.signal.symbol,
    action: event.signal.action,
    received_at: event.receivedAt,
    signal_timestamp: event.signal.timestamp,
    price: event.signal.price ?? null,
    status: event.signal.status,
    accepted: event.decision.accepted,
    execution_mode: event.decision.executionMode,
    stage: event.decision.stage,
    reason: event.decision.reasons[0] ?? null,
    signal: event.signal,
    decision: event.decision,
    raw_payload: scrubRawPayload(rawPayload)
  };

  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert(row, { onConflict: "secret_hash,strategy_id,signal_id" });

  if (error) return { ok: false, skipped: false, reason: error.message };
  return { ok: true, skipped: false };
}

export async function listPersistedAlgoSignalEvents(secret: string, limit = 100) {
  const supabase = getServerSupabase();
  if (!supabase || !secret.trim()) return { ok: false, events: [], reason: "Supabase service role or secret is missing." };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("received_at,signal,decision")
    .eq("secret_hash", hashWebhookSecret(secret.trim()))
    .neq("strategy_id", "__paper_control__")
    .neq("strategy_id", "__nifty_paper_worker__")
    .neq("strategy_id", "__nifty_paper_trade__")
    .neq("strategy_id", "__btc_delta_worker__")
    .neq("strategy_id", "__btc_delta_trade__")
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, events: [], reason: error.message };

  return {
    ok: true,
    events: (data ?? []).map((row) => ({
      receivedAt: String(row.received_at),
      signal: row.signal,
      decision: row.decision
    })) as StoredAlgoEvent[]
  };
}
