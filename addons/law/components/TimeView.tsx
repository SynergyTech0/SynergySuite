"use client";
import { useEffect, useState } from "react";
import { api, hours, money, shortDate, today } from "./client";
import type { Go } from "./LawApp";
import type { AppInfo, MatterSummary } from "./types";

export type Entry = {
  id: string; kind: "time" | "expense"; who: string; day: string; minutes: number; rate_cents: string; amount_cents: string; description: string;
  billable: boolean; bill_id: string | null; bill_number: string | null; value_cents: string; matter_id?: string; number?: string; matter_title?: string;
};

/** A quick line to record time or an expense; `matterId` fixed on a matter, picked otherwise. */
export function EntryForm({ matterId, matters, onSaved }: { matterId?: string; matters?: MatterSummary[]; onSaved: () => void }) {
  const [v, setV] = useState({ matter: matterId ?? "", kind: "time", day: today(), hours: "", amount: "", description: "", billable: true });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="entryform"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await api(`/api/matters/${v.matter}/time`, {
            method: "POST",
            json: { kind: v.kind, day: v.day, description: v.description, billable: v.billable, ...(v.kind === "time" ? { hours: v.hours } : { amount: v.amount }) },
          });
          setV({ ...v, hours: "", amount: "", description: "" });
          onSaved();
        } catch (x) {
          setError((x as Error).message);
        }
      }}
    >
      {!matterId && (
        <select className="cellin" value={v.matter} onChange={set("matter")} required aria-label="Matter">
          <option value="">Matter…</option>
          {(matters ?? []).map((m) => <option key={m.id} value={m.id}>{m.number} {m.title}</option>)}
        </select>
      )}
      <select className="cellin" value={v.kind} onChange={set("kind")} aria-label="Kind"><option value="time">Time</option><option value="expense">Expense</option></select>
      <input className="cellin" type="date" value={v.day} onChange={set("day")} aria-label="Date" />
      {v.kind === "time"
        ? <input className="cellin short" value={v.hours} onChange={set("hours")} placeholder="1.5" aria-label="Hours" required />
        : <input className="cellin short" inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="0.00" aria-label="Amount" required />}
      <input className="cellin grow" value={v.description} onChange={set("description")} placeholder={v.kind === "time" ? "What you did" : "What it was for"} aria-label="Description" required />
      <label className="check"><input type="checkbox" checked={v.billable} onChange={(e) => setV({ ...v, billable: e.target.checked })} /> Billable</label>
      <button className="btn primary">Add</button>
      <p className="error">{error}</p>
    </form>
  );
}

export function EntryTable({ rows, showMatter, go, canEdit, onChange }: { rows: Entry[]; showMatter?: boolean; go?: Go; canEdit: (e: Entry) => boolean; onChange: () => void }) {
  const total = rows.reduce((s, r) => s + Number(r.value_cents), 0);
  const mins = rows.reduce((s, r) => s + (r.kind === "time" ? r.minutes : 0), 0);
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr><th>Date</th>{showMatter && <th>Matter</th>}<th>Who</th><th>Description</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Value</th><th>Billing</th><th></th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>{shortDate(e.day)}</td>
              {showMatter && <td>{go && e.matter_id ? <button className="linkbtn" onClick={() => go.matter(e.matter_id!, "time")}>{e.number}</button> : e.number} {e.matter_title}</td>}
              <td className="muted">{e.who.split("@")[0]}</td>
              <td>{e.kind === "expense" && <span className="pill">expense</span>} {e.description}</td>
              <td className="num">{e.kind === "time" ? hours(e.minutes) : ""}</td>
              <td className="num">{e.kind === "time" ? money(Number(e.rate_cents)) : ""}</td>
              <td className="num">{money(Number(e.value_cents))}</td>
              <td>{e.bill_number ? <span className="pill billed">{e.bill_number}</span> : e.billable ? <span className="muted small">unbilled</span> : <span className="muted small">not billable</span>}</td>
              <td>{!e.bill_id && canEdit(e) && <button className="btn ghost small" onClick={async () => { await api(`/api/time/${e.id}`, { method: "DELETE" }); onChange(); }}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={showMatter ? 4 : 3}>Total</td><td className="num">{hours(mins)}</td><td></td><td className="num">{money(total)}</td><td colSpan={2}></td></tr></tfoot>
      </table>
    </div>
  );
}

export function TimeView({ info, go }: { info: AppInfo; go: Go }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [error, setError] = useState("");
  const load = () => api<Entry[]>("/api/time").then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    api<MatterSummary[]>("/api/matters?view=mine").then(setMatters).catch(() => {});
  }, []);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>My time</h1>
          <p className="sub muted">Your time and expenses over the last two weeks, on every matter.</p>
        </div>
      </div>
      <div className="body">
        {matters.length > 0 ? <EntryForm matters={matters} onSaved={load} /> : <p className="muted">You aren&apos;t on any open matters.</p>}
        {error && <p className="error">{error}</p>}
        {!rows ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">Nothing recorded in the last two weeks.</div> : (
          <EntryTable rows={rows} showMatter go={go} canEdit={(e) => e.who === info.email} onChange={load} />
        )}
      </div>
    </>
  );
}
