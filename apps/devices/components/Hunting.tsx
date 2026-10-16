"use client";
// Live query: ask devices a question in SQL now (osquery's distributed queries), like Defender's
// advanced hunting. Devices online answer within a minute.
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { ago, api, formatDateTime, useData } from "./client";
import type { DeviceSummary } from "./DeviceList";
import { type AppCtx, Badge, Empty, PLATFORM } from "./shared";

const EXAMPLES: [string, string][] = [
  ["Programs listening on the network", "SELECT p.name, p.path, lp.port, lp.address FROM listening_ports lp JOIN processes p USING (pid) WHERE lp.port <> 0;"],
  ["Who is signed in", "SELECT user, host, time FROM logged_in_users;"],
  ["Browser extensions (Chrome)", "SELECT u.username, c.name, c.identifier, c.version FROM users u CROSS JOIN chrome_extensions c USING (uid);"],
  ["Uptime", "SELECT days, hours, minutes FROM uptime;"],
  ["Find a program by name", "SELECT name, path, pid FROM processes WHERE name LIKE '%teamviewer%';"],
];

type LiveSummary = { id: string; sql: string; created_by: string; created_at: string; targets: number; done: number; errors: number };
type Live = { id: string; sql: string; created_at: string; targets: { device_id: string; hostname: string; platform: string; status: string; rows: Record<string, unknown>[] | null; error: string | null }[] };

export function Hunting({ app, id }: { app: AppCtx; id: string | null }) {
  const [sql, setSql] = useState(EXAMPLES[0][1]);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [devices] = useData<DeviceSummary[]>("/api/devices", app.say);
  const [history, reloadHistory] = useData<LiveSummary[]>("/api/live", app.say);
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (!id) return setLive(null);
    let stop = false;
    const tick = async () => {
      try {
        const l = await api<Live>(`/api/live/${id}`);
        if (stop) return;
        setLive(l);
        if (l.targets.some((t) => t.status === "pending" || t.status === "sent")) setTimeout(tick, 3000);
        else reloadHistory();
      } catch (e) {
        app.say((e as Error).message);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id, app, reloadHistory]);

  const run = () =>
    api<{ id: string; targets: number }>("/api/live", { method: "POST", json: all ? { sql, all: true } : { sql, devices: picked } })
      .then((r) => { app.say(`Sent to ${r.targets} device${r.targets === 1 ? "" : "s"}`); app.go({ view: "hunting", id: r.id }); reloadHistory(); })
      .catch((e) => app.say(e.message));

  const rows = live?.targets.flatMap((t) => (t.rows ?? []).map((r) => ({ device: t.hostname, ...r }))) ?? [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Live query</h1>
          <p className="muted">Ask your devices anything osquery can read, in SQL. <a className="link" href="https://osquery.io/schema/" target="_blank" rel="noreferrer">Tables</a>. Queries only read; they can&apos;t change a device.</p>
        </div>
      </div>
      <section className="panel">
        <div className="form" style={{ padding: 0 }}>
          <label><span>Query</span><textarea className="code" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} /></label>
          <div className="toolbar">
            <select value="" onChange={(e) => e.target.value && setSql(e.target.value)} aria-label="Examples">
              <option value="">Examples…</option>
              {EXAMPLES.map(([label, q]) => <option key={label} value={q}>{label}</option>)}
            </select>
            <div className="seg" role="radiogroup" aria-label="Devices">
              <button type="button" className={all ? "on" : ""} onClick={() => setAll(true)}>Every device seen today</button>
              <button type="button" className={!all ? "on" : ""} onClick={() => setAll(false)}>Some devices</button>
            </div>
            <span className="grow" />
            <button className="btn primary" onClick={run} disabled={!all && !picked.length}><Play size={15} /> Run</button>
          </div>
          {!all ? (
            <div className="appchecks">
              {(devices ?? []).map((d) => (
                <label key={d.id}>
                  <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))} />
                  {d.hostname} <span className="muted small">{PLATFORM[d.platform]}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      {live ? (
        <section className="panel">
          <h3>Results <span className="muted small" style={{ textTransform: "none" }}>{formatDateTime(live.created_at)}</span></h3>
          <div className="chips" style={{ marginBottom: 10 }}>
            {live.targets.map((t) => (
              <span key={t.device_id} className="chip plain" title={t.error ?? ""}>
                {t.hostname} <Badge tone={t.status === "done" ? "green" : t.status === "error" ? "red" : "amber"}>{t.status === "done" ? `${t.rows?.length ?? 0} rows` : t.status === "error" ? "Error" : "Waiting"}</Badge>
              </span>
            ))}
          </div>
          {live.targets.filter((t) => t.error).map((t) => <p key={t.device_id} className="error small">{t.hostname}: {t.error}</p>)}
          {rows.length ? (
            <div className="resulttable">
              <table className="table">
                <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String((r as Record<string, unknown>)[c] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="panel flush">
        <h3>Recent queries</h3>
        {!history ? null : !history.length ? <Empty><p>No live queries yet.</p></Empty> : (
          <table className="table">
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className={`click${id === h.id ? " sel" : ""}`} onClick={() => { setSql(h.sql); app.go({ view: "hunting", id: h.id }); }}>
                  <td className="clip"><code>{h.sql}</code></td>
                  <td className="muted nowrap">{h.done}/{h.targets} answered{h.errors ? `, ${h.errors} errors` : ""}</td>
                  <td className="muted nowrap">{h.created_by} · {ago(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
