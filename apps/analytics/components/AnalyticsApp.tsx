"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Code2, Globe, Plus, Trash2, X } from "lucide-react";

type Me = { email: string; admin: boolean };
type Site = { id: string; site_key: string; name: string; domain: string; owner_email: string; events_30d: number; can_manage: boolean; snippet: string };
type Stats = {
  days: number;
  bucket: "hour" | "day";
  totals: { pageviews: number; visitors: number; events: number };
  series: { t: string; pageviews: number; visitors: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  topRefs: { source: string; visitors: number }[];
  topEvents: { name: string; count: number }[];
  devices: { device: string; visitors: number }[];
  live: number;
};

const RANGES = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

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

const fmt = (n: number) => n.toLocaleString();

export function AnalyticsApp({ me }: { me: Me }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<{ sites: Site[] }>("/api/sites").then(
        (r) => {
          setSites(r.sites);
          setSel((cur) => (cur && r.sites.some((s) => s.id === cur) ? cur : r.sites[0]?.id ?? null));
        },
        (e) => setError(e.message),
      ),
    [],
  );
  useEffect(() => void load(), [load]);
  const site = sites?.find((s) => s.id === sel) ?? null;

  return (
    <div className="app">
      <nav className="nav">
        <button className="btn primary" style={{ justifyContent: "center", marginBottom: 10 }} onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a site
        </button>
        {sites?.map((s) => (
          <button key={s.id} className={`navitem ${s.id === sel ? "active" : ""}`} onClick={() => setSel(s.id)}>
            <Globe size={16} />
            <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        <p className="error pad">{error}</p>
        {sites && sites.length === 0 && (
          <div className="body">
            <div className="empty">
              <BarChart3 size={28} />
              <p>No sites yet. Add a website to get its tracking snippet.</p>
            </div>
          </div>
        )}
        {site && <Dashboard key={site.id} site={site} onChanged={load} onError={setError} />}
      </main>
      {adding && (
        <AddSite
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setSel(id);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Dashboard({ site, onChanged, onError }: { site: Site; onChanged: () => void; onError: (s: string) => void }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showCode, setShowCode] = useState(site.events_30d === 0);
  useEffect(() => {
    let stop = false;
    const get = () => api<Stats>(`/api/sites/${site.id}/stats?days=${days}`).then((s) => !stop && setStats(s), (e) => onError(e.message));
    void get();
    const t = setInterval(get, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [site.id, days, onError]);

  const remove = async () => {
    if (!confirm(`Delete ${site.name} and all of its numbers?`)) return;
    try {
      await api(`/api/sites/${site.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{site.name}</h1>
          <div className="muted small">{site.domain || "Any domain"} · added by {site.owner_email}</div>
        </div>
        {stats && <span className="live small">{stats.live} on the site now</span>}
        <select className="btn" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => <option key={r.days} value={r.days}>Last {r.label}</option>)}
        </select>
        <button className="btn" onClick={() => setShowCode(!showCode)}><Code2 size={16} /> Snippet</button>
        {site.can_manage && <button className="iconbtn" title="Delete site" onClick={remove}><Trash2 size={16} /></button>}
      </div>
      <div className="body">
        {showCode && (
          <div className="card">
            <h3>Add this to every page, before &lt;/head&gt;</h3>
            <pre className="code mono">{site.snippet}</pre>
            <p className="muted small">
              No cookies and no personal data: visitors are counted with a hash that changes every day. Send a custom event with{" "}
              <span className="mono">window.synergy(&quot;signup&quot;)</span>.{site.domain ? ` Only pages on ${site.domain} and its subdomains are counted.` : ""}
            </p>
          </div>
        )}
        {stats && (
          <>
            <div className="kpis">
              <div className="kpi"><b>{fmt(stats.totals.visitors)}</b><span>Visitors</span></div>
              <div className="kpi"><b>{fmt(stats.totals.pageviews)}</b><span>Page views</span></div>
              <div className="kpi"><b>{stats.totals.visitors ? (stats.totals.pageviews / stats.totals.visitors).toFixed(1) : "–"}</b><span>Views per visitor</span></div>
              <div className="kpi"><b>{fmt(stats.totals.events)}</b><span>Events</span></div>
            </div>
            <div className="card">
              <div className="legend">
                <span><i style={{ background: "var(--accent)" }} />Page views</span>
                <span><i style={{ background: "#7b3bea" }} />Visitors</span>
              </div>
              <Chart stats={stats} />
            </div>
            <div className="cols">
              <Top title="Pages" rows={stats.topPages.map((p) => ({ label: p.path, n: p.views }))} />
              <Top title="Sources" rows={stats.topRefs.map((r) => ({ label: r.source, n: r.visitors }))} />
              <Top title="Events" rows={stats.topEvents.map((e) => ({ label: e.name, n: e.count }))} empty="No custom events in this range." />
              <Top title="Devices" rows={stats.devices.map((d) => ({ label: d.device, n: d.visitors }))} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Fills the gaps so every hour or day in the range has a point. */
function points(stats: Stats) {
  const step = stats.bucket === "hour" ? 3600_000 : 86_400_000;
  const end = Date.now();
  const start = end - stats.days * 86_400_000;
  const first = Math.floor(start / step) * step;
  const by = new Map(stats.series.map((s) => [new Date(s.t).getTime(), s]));
  const out: { t: number; pageviews: number; visitors: number }[] = [];
  for (let t = first; t <= end; t += step) out.push({ t, pageviews: by.get(t)?.pageviews ?? 0, visitors: by.get(t)?.visitors ?? 0 });
  return out;
}

function Chart({ stats }: { stats: Stats }) {
  const pts = points(stats);
  const W = 800, H = 220, L = 36, B = 22, T = 10;
  const max = Math.max(1, ...pts.map((p) => p.pageviews));
  const x = (i: number) => L + (i / Math.max(1, pts.length - 1)) * (W - L - 8);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (k: "pageviews" | "visitors") => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const area = `${line("pageviews")}L${x(pts.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const label = (t: number) =>
    stats.bucket === "hour" ? new Date(t).toLocaleTimeString([], { hour: "numeric" }) : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Page views and visitors over time">
      <text x={0} y={T + 8}>{fmt(max)}</text>
      <text x={0} y={H - B}>0</text>
      <path className="pv" d={area} />
      <path className="vis" d={line("visitors")} />
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}>
          {pts[i] ? label(pts[i].t) : ""}
        </text>
      ))}
    </svg>
  );
}

function Top({ title, rows, empty = "Nothing in this range." }: { title: string; rows: { label: string; n: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <table className="toplist">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  <span className="fill" style={{ width: `${(r.n / max) * 100}%` }} />
                  <span className="lbl" title={r.label}>{r.label}</span>
                </td>
                <td className="n">{fmt(r.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AddSite({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ site: Site }>("/api/sites", { method: "POST", json: { name, domain } });
      onAdded(r.site.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modalhead">
          <h2>Add a site</h2>
          <button type="button" className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="form">
          <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></label>
          <label><span>Domain</span><input value={domain} placeholder="example.com" onChange={(e) => setDomain(e.target.value)} /></label>
          <p className="muted small">With a domain, only pages on it and its subdomains are counted. Leave it blank to count any page that loads the snippet.</p>
          <p className="error">{err}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Add</button>
          </div>
        </div>
      </form>
    </div>
  );
}
