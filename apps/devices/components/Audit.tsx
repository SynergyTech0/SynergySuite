"use client";
// Who changed what: enrollments, retirements, policies, indicators, live queries and alert triage.
import { useState } from "react";
import { formatDateTime, useData } from "./client";
import { type AppCtx, Empty } from "./shared";

type Row = { actor: string; action: string; target: string; detail: Record<string, unknown>; at: string };

export function Audit({ app }: { app: AppCtx }) {
  const [rows] = useData<Row[]>("/api/audit", app.say);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="page">
      <div className="pagehead"><div><h1>Audit log</h1><p className="muted">The last 200 changes in Devices.</p></div></div>
      <section className="panel flush">
        {!rows ? <p className="muted pad">Loading…</p> : !rows.length ? <Empty><p>Nothing yet.</p></Empty> : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`click${open === i ? " open" : ""}`} onClick={() => setOpen(open === i ? null : i)}>
                  <td className="nowrap muted">{formatDateTime(r.at)}</td>
                  <td className="clip">{r.actor}</td>
                  <td className="nowrap"><code>{r.action}</code></td>
                  <td><div className="details">{JSON.stringify(r.detail)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
