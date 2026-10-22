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

export async function listPersistedAlgoSignalEvents(secret: string, limit = 100, date?: string) {
  const supabase = getServerSupabase();
  if (!supabase || !secret.trim()) return { ok: false, events: [], reason: "Supabase service role or secret is missing." };

  let query = supabase
    .from(TABLE_NAME)
    .select("received_at,signal,decision")
    .eq("secret_hash", hashWebhookSecret(secret.trim()))
    .neq("strategy_id", "__paper_control__")
    .neq("strategy_id", "__nifty_paper_worker__")
    .neq("strategy_id", "__nifty_paper_trade__")
    .neq("strategy_id", "__btc_delta_worker__")
    .neq("strategy_id", "__btc_delta_trade__")
    .neq("strategy_id", "__btc_delta_decision__")
    .neq("strategy_id", "__nifty_paper_decision__").neq("strategy_id", "__gold_mt5_worker__").neq("strategy_id", "__gold_mt5_trade__").neq("strategy_id", "__gold_mt5_decision__")
    .order("received_at", { ascending: false })
    .order("signal_id", { ascending: false });
  if (date) {
    const start = new Date(`${date}T00:00:00+05:30`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start.getTime()) || new Date(start.getTime() + 19800000).toISOString().slice(0, 10) !== date) return { ok: false, events: [], reason: "Invalid signal date." };
    query = query.gte("received_at", start.toISOString()).lt("received_at", new Date(start.getTime() + 86400000).toISOString());
  }
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const paginated = Boolean(date) || limit === 0;
    const { data, error } = await query.range(offset, offset + (paginated ? 999 : limit - 1));
    if (error) return { ok: false, events: [], reason: error.message };
    rows.push(...(data ?? []));
    if (!paginated || !data || data.length < 1000) break;
  }

  return {
    ok: true,
    events: rows.map((row) => ({
      receivedAt: String(row.received_at),
      signal: row.signal,
      decision: row.decision
    })) as StoredAlgoEvent[]
  };
}
