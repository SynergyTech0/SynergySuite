"use client";
// The Admin center's audit log: every hold change, search, export, download, role and user change.
import { ExternalLink, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "@/lib/audit";
import { api, formatDateTime } from "./client";
import type { AppCtx } from "./shared";

type Data = { entries: AuditEntry[]; more: boolean; actions: string[] };

const GROUPS = ["matter", "hold", "search", "export", "retention", "role", "user"];

export function Audit({ app }: { app: AppCtx }) {
  const [d, setD] = useState<Data | null>(null);
  const [f, setF] = useState({ q: "", actor: "", action: "", from: "", to: "" });
  const [open, setOpen] = useState<string | null>(null);

  const query = useCallback((before?: string) => {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    if (before) p.set("before", before);
    return api<Data>(`/api/audit?${p}`);
  }, [f]);

  useEffect(() => {
    const t = setTimeout(() => void query().then(setD).catch((e) => app.say(e.message)), 250);
    return () => clearTimeout(t);
  }, [query, app]);

  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const actions = [...GROUPS.map((g) => ({ v: g, t: `All ${g} actions` })), ...(d?.actions ?? []).map((a) => ({ v: a, t: a }))];

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Audit log</h1>
          <p className="muted">What people did in the Admin center. Entries can&apos;t be changed or removed. Sign-ins, MFA and the sign-in service&apos;s own changes are in <a className="link" href={app.authConsole} target="_blank" rel="noreferrer">its audit log <ExternalLink size={12} /></a>.</p>
        </div>
      </div>
      <div className="toolbar">
        <label className="search"><Search size={16} /><input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Search everything" aria-label="Search the audit log" /></label>
        <input type="text" value={f.actor} onChange={(e) => set("actor", e.target.value)} placeholder="Who" aria-label="Who" />
        <select value={f.action} onChange={(e) => set("action", e.target.value)} aria-label="Action">
          <option value="">Every action</option>
          {actions.map((a) => <option key={a.v} value={a.v}>{a.t}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="From" />
        <span className="muted">to</span>
        <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="To" />
      </div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>
              {!d ? <tr><td colSpan={5} className="muted">Loading…</td></tr>
                : !d.entries.length ? <tr><td colSpan={5} className="muted">Nothing matches.</td></tr>
                : d.entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className={`click${open === e.id ? " open sel" : ""}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="nowrap muted">{formatDateTime(e.at)}</td>
                      <td className="clip">{e.actor}</td>
                      <td className="nowrap"><code>{e.action}</code></td>
                      <td className="clip" style={{ maxWidth: 220 }}>{e.target}</td>
                      <td><div className="details">{open === e.id ? JSON.stringify(e.details, null, 2) : JSON.stringify(e.details)}</div></td>
                    </tr>
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {d?.more ? (
        <div>
          <button className="btn" onClick={async () => {
            const last = d.entries[d.entries.length - 1];
            const next = await query(last.id);
            setD({ ...next, entries: [...d.entries, ...next.entries] });
          }}>Show older</button>
        </div>
      ) : null}
    </div>
  );
}
