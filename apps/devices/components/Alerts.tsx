"use client";
// Security alerts: the queue, and one alert with its evidence, timeline and triage.
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { ago, api, formatDateTime, plural, useData } from "./client";
import { type AppCtx, Badge, Empty, Facts, Severity, STATUS_LABEL, StatusBadge } from "./shared";

type Alert = {
  id: string; device_id: string; hostname: string; owner: string | null; detection: string; severity: string; title: string;
  detail: Record<string, unknown>; status: string; assigned_to: string | null; occurrences: number; created_at: string; last_seen: string;
  closed_at: string | null; closed_by: string | null;
};

export function AlertList({ app }: { app: AppCtx }) {
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const [r] = useData<{ alerts: Alert[] }>(`/api/alerts?status=${status}${severity ? `&severity=${severity}` : ""}`, app.say);
  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Alerts</h1>
          <p className="muted">What the detections found on your devices, worst first. Resolve what you fixed; dismiss what is expected.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Status">
          {[["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["all", "All"]].map(([k, v]) => (
            <button key={k} role="radio" aria-checked={status === k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">Any severity</option>
          {["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
      <section className="panel flush">
        {!r ? <p className="muted pad">Loading…</p> : !r.alerts.length ? <Empty><p>{status === "open" ? "No open alerts." : "Nothing here."}</p></Empty> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Severity</th><th>Alert</th><th>Device</th><th>Status</th><th>Assigned</th><th>Last seen</th></tr></thead>
              <tbody>
                {r.alerts.map((a) => (
                  <tr key={a.id} className="click" onClick={() => app.go({ view: "alerts", id: a.id })}>
                    <td><Severity level={a.severity} /></td>
                    <td className="clip"><a className="link" href={`#/alerts/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.title}</a>{a.occurrences > 1 ? <span className="muted small"> · {plural(a.occurrences, "time")}</span> : null}</td>
                    <td>{a.hostname}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="muted clip">{a.assigned_to ?? "—"}</td>
                    <td className="muted nowrap">{ago(a.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Full = Alert & { events: { actor: string; action: string; note: string; at: string }[]; info: { title: string; describe: string } | null };

function eventText(e: Full["events"][number]): string {
  if (e.action === "raised") return "Alert raised";
  if (e.action.startsWith("status:")) return `Marked ${STATUS_LABEL[e.action.slice(7)]?.toLowerCase() ?? e.action.slice(7)}`;
  if (e.action.startsWith("assigned:")) return `Assigned to ${e.action.slice(9)}`;
  if (e.action === "unassigned") return "Unassigned";
  return "Note";
}

export function AlertView({ app, id }: { app: AppCtx; id: string }) {
  const [a, reload] = useData<Full>(`/api/alerts/${id}`, app.say);
  const [note, setNote] = useState("");
  const [explain, setExplain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = app.me.role === "admin";
  if (!a) return <div className="page"><p className="muted">Loading…</p></div>;
  const patch = (json: Record<string, unknown>, msg: string) =>
    api(`/api/alerts/${id}`, { method: "PATCH", json }).then(() => { setNote(""); app.say(msg); reload(); }).catch((e) => app.say(e.message));
  const open = a.status === "new" || a.status === "investigating";

  return (
    <div className="page">
      <div className="crumbs"><a href={admin ? "#/alerts" : `#/devices/${a.device_id}/alerts`}>{admin ? "Alerts" : a.hostname}</a> › Alert</div>
      <div className="pagehead">
        <div>
          <h1>{a.title}</h1>
          <p className="muted"><Severity level={a.severity} /> · on <a className="link" href={`#/devices/${a.device_id}`}>{a.hostname}</a> · first seen {formatDateTime(a.created_at)}{a.occurrences > 1 ? `, ${plural(a.occurrences, "time")} since` : ""}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>
      <div className="split">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {a.info ? <section className="panel"><h3>What this detection looks for</h3><p style={{ margin: 0 }}>{a.info.describe}</p></section> : null}
          <section className="panel">
            <h3>Evidence</h3>
            <Facts items={Object.entries(a.detail).filter(([, v]) => v !== null && v !== "").map(([k, v]) => [k.replace(/_/g, " "), <code key={k}>{String(v)}</code>])} />
          </section>
          {admin && app.me.ai ? (
            <section className="panel">
              <h3>Help me triage <button className="btn small" disabled={busy} onClick={() => { setBusy(true); api<{ text: string }>(`/api/alerts/${id}/explain`, { method: "POST" }).then((r) => setExplain(r.text)).catch((e) => app.say(e.message)).finally(() => setBusy(false)); }}><Sparkles size={14} /> {explain ? "Ask again" : "Explain"}</button></h3>
              {explain ? <p className="pre" style={{ margin: 0 }}>{explain}</p> : <p className="muted small" style={{ margin: 0 }}>Your organization&apos;s AI model reads the alert&apos;s evidence and suggests what it is and how to check. It doesn&apos;t change anything.</p>}
            </section>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {admin ? (
            <section className="panel">
              <h3>Triage</h3>
              <div className="form" style={{ padding: 0 }}>
                <label><span>Note</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you found or did" /></label>
                <div className="toolbar">
                  {open ? (
                    <>
                      {a.status === "new" ? <button className="btn" onClick={() => patch({ status: "investigating", assignedTo: a.assigned_to ?? app.me.email, note }, "Marked investigating")}>Investigate</button> : null}
                      <button className="btn primary" onClick={() => patch({ status: "resolved", note }, "Resolved")}>Resolve</button>
                      <button className="btn" onClick={() => patch({ status: "dismissed", note }, "Dismissed")}>Dismiss</button>
                    </>
                  ) : <button className="btn" onClick={() => patch({ status: "investigating", note }, "Reopened")}>Reopen</button>}
                  {note && open ? <button className="btn ghost" onClick={() => patch({ note }, "Note added")}>Add note only</button> : null}
                </div>
                <p className="muted small">Assigned to {a.assigned_to ?? "nobody"}{a.assigned_to !== app.me.email ? <> · <button className="linkbtn" onClick={() => patch({ assignedTo: app.me.email }, "Assigned to you")}>Assign to me</button></> : null}</p>
              </div>
            </section>
          ) : (
            <section className="panel"><p className="muted" style={{ margin: 0 }}>Your IT team sees this alert too. If you don&apos;t recognize what it describes, tell them.</p></section>
          )}
          <section className="panel">
            <h3>Timeline</h3>
            <ul className="timeline">
              {a.events.map((e, i) => (
                <li key={i}>
                  <div><strong>{eventText(e)}</strong> <span className="muted small">{e.actor} · {formatDateTime(e.at)}</span></div>
                  {e.note ? <div className="pre small">{e.note}</div> : null}
                </li>
              ))}
            </ul>
            {a.closed_at ? <p className="muted small"><Badge tone="gray">Closed</Badge> by {a.closed_by} {ago(a.closed_at)}</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
