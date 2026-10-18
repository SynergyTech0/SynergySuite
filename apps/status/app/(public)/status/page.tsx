import type { Metadata } from "next";
import { publicPage } from "@/lib/public";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getSettings()).title };
}

const BANNER = {
  operational: "All systems operational",
  degraded: "Some systems are having problems",
  incident: "",
  unknown: "Collecting data",
};

const when = (d: Date | string) => new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

/** The public status page. Anyone can open it; it auto-refreshes every two minutes. */
export default async function StatusPage() {
  const p = await publicPage();
  const open = p.incidents.find((i) => i.status !== "resolved");
  return (
    <div className="public-body" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <meta httpEquiv="refresh" content="120" />
      <div className="public">
        <h1>{p.settings.title}</h1>
        {p.settings.intro && <p className="muted">{p.settings.intro}</p>}
        <div className={`banner ${p.overall}`}>{open ? `${open.title}: ${open.status}` : BANNER[p.overall]}</div>
        {p.monitors.length === 0 && <div className="empty">Nothing is being monitored yet.</div>}
        {p.monitors.map((m) => (
          <div className="card" key={m.id}>
            <div className="mon">
              <span className={`dot ${m.up === false ? "down" : m.up ? "up" : ""}`} />
              <b>{m.name}</b>
              <span className="meta">
                {m.uptime_30d != null ? `${m.uptime_30d}% over 30 days` : "No checks yet"}
                {m.latency_24h ? ` · ${m.latency_24h} ms` : ""}
              </span>
            </div>
            <div className="bars">
              {m.days.length ? (
                m.days.map((d) => <span key={d.day} className={`bar ${d.pct >= 99 ? "g" : d.pct >= 90 ? "y" : "r"}`} title={`${d.day}: ${d.pct}%`} />)
              ) : (
                <span className="muted small">Collecting data…</span>
              )}
            </div>
          </div>
        ))}
        {p.incidents.length > 0 && (
          <>
            <h2 style={{ margin: "28px 0 10px" }}>Incidents</h2>
            {p.incidents.map((i) => (
              <div key={i.id} className={`incident ${i.status}`}>
                <b>{i.title}</b> <span className="pill">{i.status}</span>
                <div className="muted small">{when(i.created_at)}</div>
                {i.updates.length === 0 && i.body && <p>{i.body}</p>}
                {i.updates.map((u) => (
                  <div className="upd" key={u.id}>
                    <span className="small">
                      <b>{u.status}</b> · {when(u.created_at)}
                    </span>
                    {u.body && <div>{u.body}</div>}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        <footer>Updated {when(p.updatedAt)} · refreshes every 2 minutes</footer>
      </div>
    </div>
  );
}
