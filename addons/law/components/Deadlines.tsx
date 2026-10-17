"use client";
import { useEffect, useState } from "react";
import { api, person, relDays, shortDate, today } from "./client";
import type { Go } from "./LawApp";
import { Modal } from "./Modal";
import type { AppInfo, Deadline } from "./types";

type Computed = { due: string; counted: string; rolled: boolean; explanation: string; basis: string; label: string };

/** Adds a deadline to a matter, typed in or worked out from a rule and the day of the event. */
export function DeadlineDialog({
  matterId, info, initial, onClose, onSaved,
}: { matterId: string; info: AppInfo; initial?: { title?: string; dueDay?: string; basis?: string }; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dueDay, setDueDay] = useState(initial?.dueDay ?? "");
  const [basis, setBasis] = useState(initial?.basis ?? "");
  const [assignee, setAssignee] = useState("");
  const [calc, setCalc] = useState({ preset: "", from: today(), days: "", count: "calendar", mail: false });
  const [computed, setComputed] = useState<Computed | null>(null);
  const [error, setError] = useState("");

  const work = async () => {
    setError("");
    try {
      const out = await api<Computed>("/api/deadlines/compute", {
        method: "POST",
        json: calc.preset ? { preset: calc.preset, from: calc.from, mail: calc.mail } : { from: calc.from, days: calc.days, count: calc.count, mail: calc.mail },
      });
      setComputed(out);
      setDueDay(out.due);
      if (out.label && !title) setTitle(out.label.replace(/\s*\(.*\)$/, ""));
      setBasis([out.basis, out.explanation].filter(Boolean).join(". "));
    } catch (x) {
      setError((x as Error).message);
    }
  };

  return (
    <Modal title="Add a deadline" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/matters/${matterId}/deadlines`, { method: "POST", json: { title, dueDay, basis, assignee: assignee || undefined } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <fieldset className="calc">
          <legend>Work it out (optional)</legend>
          <div className="row2">
            <label>
              <span>Rule</span>
              <select value={calc.preset} onChange={(e) => setCalc({ ...calc, preset: e.target.value })}>
                <option value="">Count days myself</option>
                {info.presets.map((p) => <option key={p.id} value={p.id}>{p.label}: {p.days} days, {p.basis}</option>)}
              </select>
            </label>
            <label><span>Day of the event (service, filing, judgment)</span><input type="date" value={calc.from} onChange={(e) => setCalc({ ...calc, from: e.target.value })} /></label>
          </div>
          {!calc.preset && (
            <div className="row2">
              <label><span>Days</span><input inputMode="numeric" value={calc.days} onChange={(e) => setCalc({ ...calc, days: e.target.value })} /></label>
              <label><span>Counting</span><select value={calc.count} onChange={(e) => setCalc({ ...calc, count: e.target.value })}><option value="calendar">Calendar days</option><option value="court">Court days</option></select></label>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={calc.mail} onChange={(e) => setCalc({ ...calc, mail: e.target.checked })} /> Served by mail (adds 3 days)</label>
          <div><button type="button" className="btn small" onClick={work}>Work out the date</button></div>
          {computed && <p className="small">{computed.explanation} Check local rules and any court order.</p>}
        </fieldset>
        <label><span>What is due</span><input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <div className="row2">
          <label><span>Due</span><input type="date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required /></label>
          <label><span>Who (optional; the responsible lawyer otherwise)</span><input type="email" value={assignee} onChange={(e) => setAssignee(e.target.value)} /></label>
        </div>
        <label><span>Basis</span><input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Rule, order or agreement it comes from" /></label>
        <p className="error">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Add deadline</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeadlineTable({ rows, me, go, showMatter, onChange }: { rows: Deadline[]; me: string; go?: Go; showMatter?: boolean; onChange: () => void }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr><th></th><th>Due</th><th>What</th>{showMatter && <th>Matter</th>}<th>Who</th><th></th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className={d.done_at ? "done" : ""}>
              <td>
                <input type="checkbox" aria-label="Done" checked={!!d.done_at} onChange={async (e) => { await api(`/api/deadlines/${d.id}`, { method: "PATCH", json: { done: e.target.checked } }); onChange(); }} />
              </td>
              <td className={!d.done_at && d.days_left < 0 ? "error" : !d.done_at && d.days_left <= 3 ? "warn" : ""}>
                {shortDate(d.due_day)} {!d.done_at && <span className="muted small">({relDays(d.days_left)})</span>}
              </td>
              <td>{d.title}{d.basis && <div className="muted small">{d.basis}</div>}</td>
              {showMatter && (
                <td>{go ? <button className="linkbtn" onClick={() => go.matter(d.matter_id, "deadlines")}>{d.number}</button> : d.number} {d.matter_title}</td>
              )}
              <td className="muted">{d.assignee ? person(d.assignee, me) : ""}</td>
              <td>
                <button className="btn ghost small" onClick={async () => { if (confirm(`Remove "${d.title}"?`)) { await api(`/api/deadlines/${d.id}`, { method: "DELETE" }); onChange(); } }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeadlinesView({ info, go }: { info: AppInfo; go: Go }) {
  const [mine, setMine] = useState(true);
  const [rows, setRows] = useState<Deadline[] | null>(null);
  const [error, setError] = useState("");
  const load = () => api<Deadline[]>(`/api/deadlines${mine ? "?mine=1" : ""}`).then(setRows).catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Deadlines</h1>
          <p className="sub muted">Open deadlines on matters you can see. Add them from a matter&apos;s Deadlines tab.</p>
        </div>
      </div>
      <div className="body">
        <div className="toolbar">
          <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        </div>
        {error && <p className="error">{error}</p>}
        {!rows ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">Nothing open.</div> : (
          <DeadlineTable rows={rows} me={info.email} go={go} showMatter onChange={load} />
        )}
      </div>
    </>
  );
}
