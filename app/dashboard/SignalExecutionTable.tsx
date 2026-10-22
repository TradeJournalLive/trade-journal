"use client";
import { useState } from "react";
import { istDay, istTime, signalTime } from "../lib/algo/reportDates";
import type { SignalExecution } from "../lib/algo/signalExecution";

type Event = { receivedAt: string; signal: { id: string; symbol: string; action: string; timestamp: string; price?: number; status: string; metadata?: Record<string, unknown> }; decision: { reasons: string[] }; execution?: SignalExecution };
export default function SignalExecutionTable({ events }: { events: Event[] }) {
  const [view, setView] = useState<"reasons" | "delivery">("reasons");
  return <div className="space-y-3">
    <div role="tablist" aria-label="Signal details" className="flex gap-2">
      <button type="button" role="tab" aria-selected={view === "reasons"} className={`algo-action ${view === "reasons" ? "primary" : "secondary"}`} onClick={() => setView("reasons")}>Trade Reasons</button>
      <button type="button" role="tab" aria-selected={view === "delivery"} className={`algo-action ${view === "delivery" ? "primary" : "secondary"}`} onClick={() => setView("delivery")}>Webhook Delivery</button>
    </div>
    <div className="overflow-auto"><table className="algo-os-table"><thead><tr><th>Received date</th><th>Received time · IST</th><th>Signal date</th><th>Signal time · IST</th><th>Action</th><th>Instrument</th><th>Signal price</th><th>{view === "reasons" ? "Trade decision" : "Delivery status"}</th><th>Reason</th>{view === "reasons" && <th>Evidence</th>}</tr></thead><tbody>{events.length ? events.map(e => <tr key={`${e.signal.id}-${e.receivedAt}`}><td>{istDay(e.receivedAt)}</td><td>{istTime(e.receivedAt)}</td><td>{istDay(signalTime(e))}</td><td>{istTime(signalTime(e))}</td><td>{e.signal.action}</td><td>{e.signal.symbol}</td><td>{e.signal.price?.toLocaleString("en-IN") ?? "--"}</td><td>{view === "reasons" ? e.execution?.status.replaceAll("_", " ") ?? "Not recorded" : e.signal.status}</td><td className="min-w-[260px] whitespace-normal">{view === "reasons" ? e.execution?.reason ?? "No execution decision recorded." : e.decision.reasons[0] || "--"}</td>{view === "reasons" && <td>{e.execution?.source ?? "Not recorded"}</td>}</tr>) : <tr><td colSpan={view === "reasons" ? 10 : 9}>No signals received on this date for this instrument.</td></tr>}</tbody></table></div>
  </div>;
}
