"use client";

export default function HistoryDatePicker({ value, onChange, label, allowAll = false }: { value: string; onChange: (value: string) => void; label: string; allowAll?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm"><span>{label}</span><input aria-label={label} title="Open calendar" type="date" value={value} onChange={event => { if (event.target.value || allowAll) onChange(event.target.value); }} className="h-9 rounded-md border border-slate-300 bg-transparent px-3" /></label>{allowAll && <button type="button" className="algo-action secondary" onClick={() => onChange("")} disabled={!value}>All dates</button>}</div>;
}
