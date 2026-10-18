"use client";
import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, ExternalLink, Pencil, Play, Plus, Settings, Trash2, X } from "lucide-react";

type Me = { email: string; admin: boolean };
type Monitor = {
  id: string;
  name: string;
  url: string;
  expect_status: number;
  interval_sec: number;
  active: boolean;
  public: boolean;
  sort: number;
  last_checked_at: string | null;
  up: boolean | null;
  last_status: number | null;
  last_error: string | null;
  uptime_24h: number | null;
  uptime_30d: number | null;
  latency_24h: number | null;
};
type Check = { id: string; ok: boolean; status_code: number | null; latency_ms: number | null; error: string | null; checked_at: string };
type Update = { id: string; status: string; body: string; author: string; created_at: string };
type Incident = { id: string; title: string; body: string; status: string; created_at: string; resolved_at: string | null; created_by: string; updates: Update[] };

const STATUSES = ["investigating", "identified", "monitoring", "resolved"];

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const ago = (d: string | null) => {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
};

export function StatusApp({ me, suiteDomain }: { me: Me; suiteDomain: string }) {
  const [tab, setTab] = useState<"monitors" | "incidents" | "page">("monitors");
  const [error, setError] = useState("");
  return (
    <div className="app">
      <nav className="nav">
        <button className={`navitem ${tab === "monitors" ? "active" : ""}`} onClick={() => setTab("monitors")}>
          <Activity size={16} /> Monitors
        </button>
        <button className={`navitem ${tab === "incidents" ? "active" : ""}`} onClick={() => setTab("incidents")}>
          <AlertTriangle size={16} /> Incidents
        </button>
        {me.admin && (
          <button className={`navitem ${tab === "page" ? "active" : ""}`} onClick={() => setTab("page")}>
            <Settings size={16} /> Status page
          </button>
        )}
        <a className="navitem" href="/status" target="_blank" rel="noreferrer">
          <ExternalLink size={16} /> Open public page
        </a>
      </nav>
      <main className="main">
        <p className="error pad">{error}</p>
        {tab === "monitors" && <Monitors me={me} suiteDomain={suiteDomain} onError={setError} />}
        {tab === "incidents" && <Incidents me={me} onError={setError} />}
        {tab === "page" && <PageSettings onError={setError} />}
      </main>
    </div>
  );
}

function Monitors({ me, suiteDomain, onError }: { me: Me; suiteDomain: string; onError: (s: string) => void }) {
  const [list, setList] = useState<Monitor[] | null>(null);
  const [editing, setEditing] = useState<Partial<Monitor> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<{ monitors: Monitor[] }>("/api/monitors").then((r) => setList(r.monitors), (e) => onError(e.message)), [onError]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    onError("");
    try {
      await fn();
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const up = list?.filter((m) => m.active && m.up).length ?? 0;
  const down = list?.filter((m) => m.active && m.up === false).length ?? 0;

  return (
    <>
      <div className="head">
        <h1 className="grow">Monitors</h1>
        {me.admin && suiteDomain && (
          <button className="btn" onClick={() => act(() => api("/api/monitors/suite", { method: "POST" }))}>
            Add the suite&apos;s apps
          </button>
        )}
        {me.admin && (
          <button className="btn primary" onClick={() => setEditing({ expect_status: 200, interval_sec: 300, public: true, active: true, sort: 0 })}>
            <Plus size={16} /> New monitor
          </button>
        )}
      </div>
      <div className="body">
        <div className="kpis">
          <div className="kpi"><b>{list?.length ?? "–"}</b><span>Monitors</span></div>
          <div className="kpi"><b className="ok">{up}</b><span>Up</span></div>
          <div className="kpi"><b style={{ color: down ? "var(--danger)" : undefined }}>{down}</b><span>Down</span></div>
        </div>
        {list && list.length === 0 && (
          <div className="empty">
            Nothing is monitored yet.{me.admin ? " Add a web address to check it on a schedule." : " Ask a Status admin to add monitors."}
          </div>
        )}
        {list && list.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th>Monitor</th>
                <th>Last check</th>
                <th className="num">24 h</th>
                <th className="num">30 days</th>
                <th className="num">Response</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.55 }}>
                  <td>
                    <div className="mon" style={{ cursor: "pointer" }} onClick={() => setOpen(m.id)}>
                      <span className={`dot ${m.up === false ? "down" : m.up ? "up" : ""}`} />
                      <span>
                        <b>{m.name}</b> {!m.public && <span className="pill">hidden</span>} {!m.active && <span className="pill">paused</span>}
                        <div className="muted small mono">{m.url}</div>
                      </span>
                    </div>
                  </td>
                  <td className="small">
                    {ago(m.last_checked_at)}
                    {m.last_status ? <span className="muted"> · {m.last_status}</span> : null}
                    {m.last_error && <div className="error small">{m.last_error}</div>}
                  </td>
                  <td className="num">{m.uptime_24h != null ? `${m.uptime_24h}%` : "–"}</td>
                  <td className="num">{m.uptime_30d != null ? `${m.uptime_30d}%` : "–"}</td>
                  <td className="num">{m.latency_24h ? `${m.latency_24h} ms` : "–"}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {me.admin && (
                      <>
                        <button className="iconbtn" title="Check now" onClick={() => act(() => api(`/api/monitors/${m.id}/check`, { method: "POST" }))}>
                          <Play size={15} />
                        </button>
                        <button className="iconbtn" title="Edit" onClick={() => setEditing(m)}>
                          <Pencil size={15} />
                        </button>
                        <button
                          className="iconbtn"
                          title="Delete"
                          onClick={() => confirm(`Delete ${m.name} and its history?`) && act(() => api(`/api/monitors/${m.id}`, { method: "DELETE" }))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <MonitorForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {open && <MonitorDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function MonitorForm({ initial, onClose, onSaved }: { initial: Partial<Monitor>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial.name ?? "",
    url: initial.url ?? "https://",
    expectStatus: String(initial.expect_status ?? 200),
    intervalSec: String(initial.interval_sec ?? 300),
    isPublic: initial.public ?? true,
    active: initial.active ?? true,
    sort: String(initial.sort ?? 0),
  });
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const json = { ...f, expectStatus: Number(f.expectStatus), intervalSec: Number(f.intervalSec), sort: Number(f.sort) };
      if (initial.id) await api(`/api/monitors/${initial.id}`, { method: "PATCH", json });
      else await api("/api/monitors", { method: "POST", json });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modalhead">
          <h2>{initial.id ? "Edit monitor" : "New monitor"}</h2>
          <button type="button" className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="form">
          <label><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus required /></label>
          <label><span>Web address</span><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required /></label>
          <div className="row2">
            <label><span>Expected status</span><input type="number" min={100} max={599} value={f.expectStatus} onChange={(e) => setF({ ...f, expectStatus: e.target.value })} /></label>
            <label><span>Check every (seconds)</span><input type="number" min={60} step={30} value={f.intervalSec} onChange={(e) => setF({ ...f, intervalSec: e.target.value })} /></label>
          </div>
          <label><span>Order on the status page</span><input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Show on the public status page</label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Checking is on</label>
          <p className="muted small">Any 2xx or 3xx answer counts as up, as does the expected status. Private and internal network addresses can&apos;t be checked unless an admin allows them in STATUS_ALLOW_HOSTS.</p>
          <p className="error">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MonitorDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ monitor: Monitor; checks: Check[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ monitor: Monitor; checks: Check[] }>(`/api/monitors/${id}`).then(setData, (e) => setErr(e.message));
  }, [id]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: "min(640px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2>{data?.monitor.name ?? "Monitor"}</h2>
          <button className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="form">
          <p className="error">{err}</p>
          {data && <p className="mono muted">{data.monitor.url}</p>}
          {data && data.checks.length === 0 && <div className="empty">No checks yet.</div>}
          {data && data.checks.length > 0 && (
            <table className="grid">
              <thead><tr><th>When</th><th>Result</th><th className="num">Status</th><th className="num">Time</th></tr></thead>
              <tbody>
                {data.checks.map((c) => (
                  <tr key={c.id}>
                    <td className="small">{new Date(c.checked_at).toLocaleString()}</td>
                    <td>{c.ok ? <span className="pill good">up</span> : <span className="pill bad">down</span>} {c.error && <span className="small muted">{c.error}</span>}</td>
                    <td className="num">{c.status_code ?? "–"}</td>
                    <td className="num">{c.latency_ms != null ? `${c.latency_ms} ms` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Incidents({ me, onError }: { me: Me; onError: (s: string) => void }) {
  const [list, setList] = useState<Incident[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<Incident | null>(null);
  const load = useCallback(() => api<{ incidents: Incident[] }>("/api/incidents").then((r) => setList(r.incidents), (e) => onError(e.message)), [onError]);
  useEffect(() => void load(), [load]);
  const remove = async (i: Incident) => {
    if (!confirm(`Delete "${i.title}"?`)) return;
    try {
      await api(`/api/incidents/${i.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <>
      <div className="head">
        <h1 className="grow">Incidents</h1>
        {me.admin && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Report an incident</button>}
      </div>
      <div className="body">
        {list && list.length === 0 && <div className="empty">No incidents have been posted.</div>}
        {list?.map((i) => (
          <div className="card" key={i.id}>
            <div className="toolbar">
              <b className="grow">{i.title}</b>
              <span className={`pill ${i.status === "resolved" ? "good" : "warn"}`}>{i.status}</span>
              {me.admin && i.status !== "resolved" && <button className="btn small" onClick={() => setUpdating(i)}>Post update</button>}
              {me.admin && <button className="iconbtn" title="Delete" onClick={() => remove(i)}><Trash2 size={15} /></button>}
            </div>
            <div className="muted small">{new Date(i.created_at).toLocaleString()}{i.created_by ? ` · ${i.created_by}` : ""}</div>
            {i.updates.length === 0 && i.body && <p>{i.body}</p>}
            {i.updates.map((u) => (
              <div key={u.id} style={{ borderLeft: "2px solid var(--line)", paddingLeft: 10, marginTop: 8 }}>
                <div className="small"><b>{u.status}</b> · {new Date(u.created_at).toLocaleString()}{u.author ? ` · ${u.author}` : ""}</div>
                {u.body && <div>{u.body}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      {(creating || updating) && (
        <IncidentForm
          incident={updating}
          onClose={() => {
            setCreating(false);
            setUpdating(null);
          }}
          onSaved={() => {
            setCreating(false);
            setUpdating(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function IncidentForm({ incident, onClose, onSaved }: { incident: Incident | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState(incident ? incident.status : "investigating");
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (incident) await api(`/api/incidents/${incident.id}/updates`, { method: "POST", json: { status, body } });
      else await api("/api/incidents", { method: "POST", json: { title, body, status } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modalhead">
          <h2>{incident ? `Update: ${incident.title}` : "Report an incident"}</h2>
          <button type="button" className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="form">
          {!incident && <label><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required /></label>}
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label><span>What&apos;s happening (shown publicly)</span><textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <p className="error">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">{incident ? "Post update" : "Post"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function PageSettings({ onError }: { onError: (s: string) => void }) {
  const [f, setF] = useState<{ title: string; intro: string } | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<{ settings: { title: string; intro: string } }>("/api/settings").then((r) => setF(r.settings), (e) => onError(e.message));
  }, [onError]);
  if (!f) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setF((await api<{ settings: { title: string; intro: string } }>("/api/settings", { method: "PUT", json: f })).settings);
      setSaved(true);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <>
      <div className="head"><h1>Status page</h1></div>
      <form className="form" style={{ maxWidth: 560, padding: "16px 24px" }} onSubmit={save}>
        <label><span>Title</span><input value={f.title} onChange={(e) => (setSaved(false), setF({ ...f, title: e.target.value }))} /></label>
        <label><span>Introduction (optional)</span><textarea value={f.intro} onChange={(e) => (setSaved(false), setF({ ...f, intro: e.target.value }))} /></label>
        <p className="muted small">The page is public at <a href="/status">/status</a> and as JSON at /api/public/status.</p>
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn primary">Save</button>
          {saved && <span className="ok">Saved</span>}
        </div>
      </form>
    </>
  );
}
