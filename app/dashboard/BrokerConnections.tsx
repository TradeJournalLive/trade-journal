"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Trade } from "../data/trades";
import {
  buildBrokerConnectionId,
  type BrokerConnection,
  type BrokerImportBatch,
  type BrokerImportedTradeRecord,
  type BrokerName,
  type BrokerPreviewTrade
} from "../lib/brokers";
import { supabase } from "../lib/supabaseClient";

type InstrumentDefinition = {
  id: string;
  name: string;
  lotSize: number;
};

type TradingAccount = {
  id: string;
  name: string;
  baseCapital: number;
  isDefault: boolean;
};

type BrokerConnectionsProps = {
  dataSource: "local" | "supabase";
  session: Session | null;
  instruments: InstrumentDefinition[];
  accounts: TradingAccount[];
  defaultAccountId?: string;
  tradeList: Trade[];
  onImportBrokerTrades: (payload: {
    connection: BrokerConnection;
    previews: BrokerPreviewTrade[];
    targetAccountId: string;
  }) => Promise<string | null>;
};

const BROKER_CONNECTIONS_KEY = "pulsejournal_broker_connections";
const BROKER_BATCHES_KEY = "pulsejournal_broker_batches";

function normalizeConnectionRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    brokerName: String(row.broker_name ?? "FYERS") as BrokerName,
    label: String(row.label ?? ""),
    apiKey: String(row.api_key ?? ""),
    accessToken: String(row.access_token ?? ""),
    clientId: row.client_id ? String(row.client_id) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString())
  }));
}

function normalizeBatchRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    brokerAccountId: String(row.broker_account_id ?? ""),
    brokerName: String(row.broker_name ?? "FYERS") as BrokerName,
    startedAt: String(row.started_at ?? new Date().toISOString()),
    importedCount: Number(row.imported_count ?? 0),
    notes: row.notes ? String(row.notes) : undefined
  }));
}

export default function BrokerConnections({
  dataSource,
  session,
  instruments,
  accounts,
  defaultAccountId,
  tradeList,
  onImportBrokerTrades
}: BrokerConnectionsProps) {
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [batches, setBatches] = useState<BrokerImportBatch[]>([]);
  const [brokerName, setBrokerName] = useState<BrokerName>("FYERS");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState("");
  const [syncingId, setSyncingId] = useState("");
  const [previewTrades, setPreviewTrades] = useState<BrokerPreviewTrade[]>([]);
  const [previewConnectionId, setPreviewConnectionId] = useState("");
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState(defaultAccountId ?? "");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const connectionsStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${BROKER_CONNECTIONS_KEY}_${session.user.id}`;
    }
    return BROKER_CONNECTIONS_KEY;
  }, [dataSource, session?.user?.id]);

  const batchesStorageKey = useMemo(() => {
    if (dataSource === "supabase" && session?.user?.id) {
      return `${BROKER_BATCHES_KEY}_${session.user.id}`;
    }
    return BROKER_BATCHES_KEY;
  }, [dataSource, session?.user?.id]);

  useEffect(() => {
    if (!targetAccountId && (defaultAccountId || accounts[0]?.id)) {
      setTargetAccountId(defaultAccountId || accounts[0]?.id || "");
    }
  }, [accounts, defaultAccountId, targetAccountId]);

  useEffect(() => {
    if (dataSource !== "supabase") {
      const stored = localStorage.getItem(connectionsStorageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as BrokerConnection[];
          setConnections(Array.isArray(parsed) ? parsed : []);
        } catch {
          setConnections([]);
        }
      } else {
        setConnections([]);
      }
      const storedBatches = localStorage.getItem(batchesStorageKey);
      if (storedBatches) {
        try {
          const parsed = JSON.parse(storedBatches) as BrokerImportBatch[];
          setBatches(Array.isArray(parsed) ? parsed : []);
        } catch {
          setBatches([]);
        }
      } else {
        setBatches([]);
      }
      return;
    }

    if (!supabase || !session?.user?.id) return;
    (async () => {
      const [{ data: connectionRows, error: connectionError }, { data: batchRows, error: batchError }] =
        await Promise.all([
          supabase
            .from("broker_accounts")
            .select("*")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("broker_import_batches")
            .select("*")
            .eq("user_id", session.user.id)
            .order("started_at", { ascending: false })
            .limit(10)
        ]);
      if (connectionError) {
        setStatus(`Broker account load failed: ${connectionError.message}`);
      } else {
        setConnections(normalizeConnectionRows((connectionRows ?? []) as Record<string, unknown>[]));
      }
      if (batchError) {
        setStatus((prev) => prev || `Broker import history failed: ${batchError.message}`);
      } else {
        setBatches(normalizeBatchRows((batchRows ?? []) as Record<string, unknown>[]));
      }
    })();
  }, [batchesStorageKey, connectionsStorageKey, dataSource, session?.user?.id]);

  useEffect(() => {
    if (dataSource !== "local") return;
    localStorage.setItem(connectionsStorageKey, JSON.stringify(connections));
  }, [connections, connectionsStorageKey, dataSource]);

  useEffect(() => {
    if (dataSource !== "local") return;
    localStorage.setItem(batchesStorageKey, JSON.stringify(batches));
  }, [batches, batchesStorageKey, dataSource]);

  const selectedConnection = connections.find((item) => item.id === previewConnectionId) ?? null;
  const selectedPreviewTrades = previewTrades.filter((item) => selectedPreviewIds.includes(item.id));

  async function handleSaveConnection() {
    const trimmedLabel = label.trim();
    const trimmedKey = apiKey.trim();
    const trimmedClientId = clientId.trim();
    const trimmedToken = accessToken.trim();

    if (!trimmedLabel) {
      setStatus("Connection label is required.");
      return;
    }
    if (brokerName === "FYERS") {
      if (!trimmedClientId && !trimmedKey) {
        setStatus("FYERS needs client ID / app ID.");
        return;
      }
    } else if (!trimmedKey) {
      setStatus("Zerodha needs API key.");
      return;
    }
    if (!trimmedToken) {
      setStatus("Access token is required.");
      return;
    }

    const next: BrokerConnection = {
      id: buildBrokerConnectionId(brokerName, trimmedLabel),
      brokerName,
      label: trimmedLabel,
      apiKey: trimmedKey,
      clientId: trimmedClientId || undefined,
      accessToken: trimmedToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setStatus("Please sign in to save broker connections.");
        return;
      }
      const { error } = await supabase.from("broker_accounts").insert({
        id: next.id,
        user_id: session.user.id,
        broker_name: next.brokerName,
        label: next.label,
        api_key: next.apiKey,
        client_id: next.clientId ?? null,
        access_token: next.accessToken
      });
      if (error) {
        setStatus(`Broker connection failed: ${error.message}`);
        return;
      }
    }

    setConnections((prev) => [...prev, next]);
    setLabel("");
    setApiKey("");
    setClientId("");
    setAccessToken("");
    setStatus("Broker connection saved.");
    setTimeout(() => setStatus(""), 1800);
  }

  async function handleDeleteConnection(connection: BrokerConnection) {
    if (!window.confirm(`Delete ${connection.label}?`)) return;
    if (dataSource === "supabase") {
      if (!supabase || !session?.user?.id) {
        setStatus("Please sign in to delete broker connections.");
        return;
      }
      const { error } = await supabase
        .from("broker_accounts")
        .delete()
        .eq("user_id", session.user.id)
        .eq("id", connection.id);
      if (error) {
        setStatus(`Delete failed: ${error.message}`);
        return;
      }
    }
    setConnections((prev) => prev.filter((item) => item.id !== connection.id));
    if (previewConnectionId === connection.id) {
      setPreviewConnectionId("");
      setPreviewTrades([]);
      setSelectedPreviewIds([]);
    }
    setStatus("Broker connection deleted.");
    setTimeout(() => setStatus(""), 1800);
  }

  async function handleSyncConnection(connection: BrokerConnection) {
    try {
      setSyncingId(connection.id);
      setStatus("");
      const response = await fetch("/api/brokers/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          brokerName: connection.brokerName,
          brokerAccountId: connection.id,
          apiKey: connection.apiKey,
          clientId: connection.clientId,
          accessToken: connection.accessToken,
          fromDate,
          toDate,
          instruments
        })
      });
      const payload = (await response.json()) as {
        error?: string;
        previews?: BrokerPreviewTrade[];
      };
      if (!response.ok) {
        setStatus(payload.error || `${connection.brokerName} sync failed.`);
        return;
      }
      const previews = Array.isArray(payload.previews) ? payload.previews : [];
      setPreviewConnectionId(connection.id);
      setPreviewTrades(previews);
      setSelectedPreviewIds(previews.map((item) => item.id));
      setStatus(
        previews.length
          ? `${connection.brokerName} sync complete. Review ${previews.length} trade${previews.length === 1 ? "" : "s"}.`
          : `${connection.brokerName} sync complete. No closed trades found in the current payload.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Broker sync failed.");
    } finally {
      setSyncingId("");
    }
  }

  async function handleImportSelected() {
    if (!selectedConnection) {
      setStatus("Sync a broker connection first.");
      return;
    }
    if (!targetAccountId) {
      setStatus("Select a target trading account.");
      return;
    }
    if (!selectedPreviewTrades.length) {
      setStatus("Select at least one imported trade.");
      return;
    }

    try {
      setImporting(true);
      const error = await onImportBrokerTrades({
        connection: selectedConnection,
        previews: selectedPreviewTrades,
        targetAccountId
      });
      if (error) {
        setStatus(error);
        return;
      }
      const nextBatch: BrokerImportBatch = {
        id: `${selectedConnection.id}-${Date.now()}`,
        brokerAccountId: selectedConnection.id,
        brokerName: selectedConnection.brokerName,
        startedAt: new Date().toISOString(),
        importedCount: selectedPreviewTrades.length,
        notes: `Imported into ${accounts.find((item) => item.id === targetAccountId)?.name ?? "selected account"}`
      };
      if (dataSource === "supabase" && supabase && session?.user?.id) {
        await supabase.from("broker_import_batches").insert({
          id: nextBatch.id,
          user_id: session.user.id,
          broker_account_id: nextBatch.brokerAccountId,
          broker_name: nextBatch.brokerName,
          started_at: nextBatch.startedAt,
          imported_count: nextBatch.importedCount,
          notes: nextBatch.notes ?? null
        });
      }
      setBatches((prev) => [nextBatch, ...prev].slice(0, 10));
      setPreviewTrades((prev) => prev.filter((item) => !selectedPreviewIds.includes(item.id)));
      setSelectedPreviewIds([]);
      setStatus(`Imported ${selectedPreviewTrades.length} broker trade${selectedPreviewTrades.length === 1 ? "" : "s"} into your journal.`);
    } finally {
      setImporting(false);
    }
  }

  const todayImportedHint = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tradeList.filter((trade) => trade.date === today && (trade.platform === "FYERS" || trade.platform === "ZERODHA")).length;
  }, [tradeList]);

  return (
    <section id="brokers" className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h2 className="section-title">Broker Connections</h2>
        <p className="section-lead">
          Connect FYERS and Zerodha in a separate import layer. Your current journal flow stays manual and untouched until you confirm imports.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="card space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Add broker connection</h3>
            <p className="mt-1 text-xs text-muted">
              Save the broker credentials you already use for API access. Imports stay in preview until you confirm them.
            </p>
          </div>

          <div className="grid gap-3 text-xs md:grid-cols-2">
            <select
              value={brokerName}
              onChange={(event) => setBrokerName(event.target.value as BrokerName)}
              className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            >
              <option value="FYERS">FYERS</option>
              <option value="ZERODHA">Zerodha</option>
            </select>
            <input
              placeholder="Connection label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
            <input
              placeholder={brokerName === "FYERS" ? "App ID / API key (optional)" : "API key"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
            <input
              placeholder={brokerName === "FYERS" ? "Client ID / App ID" : "Access token"}
              value={brokerName === "FYERS" ? clientId : accessToken}
              onChange={(event) =>
                brokerName === "FYERS"
                  ? setClientId(event.target.value)
                  : setAccessToken(event.target.value)
              }
              className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            />
            {brokerName === "FYERS" ? (
              <input
                placeholder="Access token"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white md:col-span-2"
              />
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void handleSaveConnection()}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white"
          >
            Save broker connection
          </button>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-muted">
            Zerodha uses `api_key + access_token` in the order/trade headers. FYERS uses `client ID / app ID + access token`. If APIs return auth errors, regenerate the access token in your broker developer app.
          </div>
        </div>

        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Saved connections</h3>
              <p className="mt-1 text-xs text-muted">
                Current-day imported broker trades in journal: {todayImportedHint}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
              />
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="space-y-3">
            {connections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-muted">
                No broker connections yet.
              </div>
            ) : (
              connections.map((connection) => (
                <div key={connection.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{connection.label}</div>
                      <div className="text-[11px] text-muted">{connection.brokerName} · Added {new Date(connection.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSyncConnection(connection)}
                        className="rounded-full bg-[linear-gradient(135deg,#2563eb,#14b8a6)] px-4 py-2 text-[11px] font-semibold text-white"
                      >
                        {syncingId === connection.id ? "Syncing..." : "Sync trades"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteConnection(connection)}
                        className="rounded-full border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {status ? <div className="text-xs text-muted">{status}</div> : null}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Import preview</h3>
            <p className="mt-1 text-xs text-muted">
              Sync first, review closed trades, then import only the ones you want into the existing journal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={targetAccountId}
              onChange={(event) => setTargetAccountId(event.target.value)}
              className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
            >
              <option value="" disabled>
                Target trading account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleImportSelected()}
              disabled={importing || !selectedPreviewIds.length}
              className="rounded-full bg-primary px-4 py-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? "Importing..." : `Import selected (${selectedPreviewIds.length})`}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-xs">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Select</th>
                <th className="px-3 py-2 text-left font-semibold">Broker</th>
                <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                <th className="px-3 py-2 text-left font-semibold">Instrument</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Entry</th>
                <th className="px-3 py-2 text-left font-semibold">Exit</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Lots</th>
                <th className="px-3 py-2 text-right font-semibold">Entry Price</th>
                <th className="px-3 py-2 text-right font-semibold">Exit Price</th>
              </tr>
            </thead>
            <tbody>
              {previewTrades.map((trade) => {
                const checked = selectedPreviewIds.includes(trade.id);
                return (
                  <tr key={trade.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedPreviewIds((prev) =>
                            event.target.checked
                              ? [...prev, trade.id]
                              : prev.filter((item) => item !== trade.id)
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 font-semibold">{trade.brokerName}</td>
                    <td className="px-3 py-2">{trade.symbol}</td>
                    <td className="px-3 py-2">{trade.inferredInstrument}</td>
                    <td className="px-3 py-2">{trade.date}</td>
                    <td className="px-3 py-2">{trade.entryTime}</td>
                    <td className="px-3 py-2">{trade.exitTime}</td>
                    <td className="px-3 py-2 text-right">{trade.quantity}</td>
                    <td className="px-3 py-2 text-right">{trade.lots ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{trade.entryPrice}</td>
                    <td className="px-3 py-2 text-right">{trade.exitPrice}</td>
                  </tr>
                );
              })}
              {previewTrades.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-4 text-center text-muted">
                    No synced broker trades in preview yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-lg font-semibold">Recent broker imports</h3>
        <div className="space-y-2 text-sm text-muted">
          {batches.length === 0 ? (
            <div>No broker imports recorded yet.</div>
          ) : (
            batches.map((batch) => (
              <div key={batch.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                {batch.brokerName} · {batch.importedCount} trade{batch.importedCount === 1 ? "" : "s"} · {new Date(batch.startedAt).toLocaleString()}
                {batch.notes ? <span className="text-[11px] text-muted"> — {batch.notes}</span> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
