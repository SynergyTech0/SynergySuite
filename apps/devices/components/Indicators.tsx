"use client";
// Custom indicators: SHA-256 hashes of known-bad files. A running program that matches raises a critical alert.
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api, formatDate, useData } from "./client";
import { type AppCtx, Empty } from "./shared";

type I = { sha256: string; title: string; added_by: string; added_at: string };

export function Indicators({ app }: { app: AppCtx }) {
  const [list, reload] = useData<I[]>("/api/indicators", app.say);
  const [hashes, setHashes] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Indicators</h1>
          <p className="muted">File hashes from threat reports or your own incidents. Every device hashes its running programs every 15 minutes; a match raises a critical alert.</p>
        </div>
      </div>
      <section className="panel">
        <form className="form" style={{ padding: 0 }} onSubmit={(e) => {
          e.preventDefault();
          api<{ added: number }>("/api/indicators", { method: "POST", json: { hashes, title } })
            .then((r) => { app.say(`${r.added} indicator${r.added === 1 ? "" : "s"} added`); setHashes(""); setTitle(""); setErr(""); reload(); })
            .catch((x) => setErr(x.message));
        }}>
          <label><span>SHA-256 hashes, one per line</span><textarea className="code" rows={4} value={hashes} onChange={(e) => setHashes(e.target.value)} spellCheck={false} /></label>
          <label><span>What they are</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. QakBot loader, from the March incident" /></label>
          <p className="error small">{err}</p>
          <div className="actions"><button className="btn primary">Add</button></div>
        </form>
      </section>
      <section className="panel flush">
        {!list ? <p className="muted pad">Loading…</p> : !list.length ? <Empty><p>No indicators yet.</p></Empty> : (
          <table className="table">
            <thead><tr><th>SHA-256</th><th>What</th><th>Added</th><th /></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.sha256}>
                  <td><code>{i.sha256.slice(0, 16)}…{i.sha256.slice(-8)}</code></td>
                  <td>{i.title}</td>
                  <td className="muted nowrap">{i.added_by} · {formatDate(i.added_at)}</td>
                  <td><button className="iconbtn" aria-label="Remove" onClick={() => api(`/api/indicators?sha256=${i.sha256}`, { method: "DELETE" }).then(reload).catch((e) => app.say(e.message))}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
