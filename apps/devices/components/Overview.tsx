"use client";
// Overview: how much of the fleet is compliant, what is failing, and what needs a look.
import { useData } from "./client";
import { RULE_LABEL } from "./Policies";
import { type AppCtx, Empty, PLATFORM } from "./shared";

type O = {
  devices: number; compliant: number; noncompliant: number; unknown: number; stale: number; unowned: number; encrypted: number;
  windows: number; darwin: number; linux: number;
  alerts: Record<string, number>;
  vulns: Record<string, { advisories: number; devices: number }>;
  failing: { check: string; n: number }[];
};

export function Overview({ app }: { app: AppCtx }) {
  const [o] = useData<O>("/api/overview", app.say);
  if (!o) return <div className="page"><p className="muted">Loading…</p></div>;
  const pct = (n: number) => (o.devices ? `${(n / o.devices) * 100}%` : "0");
  const openAlerts = (o.alerts.critical ?? 0) + (o.alerts.high ?? 0) + (o.alerts.medium ?? 0) + (o.alerts.low ?? 0);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Overview</h1>
          <p className="muted">Every enrolled computer, measured against your compliance policies and watched for threats.</p>
        </div>
        <a className="btn primary" href="#/enroll">Enroll devices</a>
      </div>
      {o.devices === 0 ? (
        <section className="panel">
          <Empty>
            <h2>No devices yet</h2>
            <p>Devices uses osquery, the open source endpoint agent, on each computer. Make an enrollment key and run the script it gives you on Windows, macOS or Linux.</p>
            <a className="btn primary" href="#/enroll">Enroll the first device</a>
          </Empty>
        </section>
      ) : (
        <>
          <div className="stats">
            <a className="stat" href="#/devices">
              <div className="k">Devices</div>
              <div className="v">{o.devices}</div>
              <div className="s">{[["windows", o.windows], ["darwin", o.darwin], ["linux", o.linux]].filter(([, n]) => n).map(([p, n]) => `${n} ${PLATFORM[p as string]}`).join(" · ")}</div>
            </a>
            <a className="stat" href="#/devices">
              <div className="k">Not compliant</div>
              <div className="v" style={{ color: o.noncompliant ? "var(--danger)" : undefined }}>{o.noncompliant}</div>
              <div className="s">{o.compliant} compliant · {o.unknown} not evaluated</div>
            </a>
            <a className="stat" href="#/alerts">
              <div className="k">Open alerts</div>
              <div className="v" style={{ color: o.alerts.critical || o.alerts.high ? "var(--danger)" : undefined }}>{openAlerts}</div>
              <div className="s">{o.alerts.critical ?? 0} critical · {o.alerts.high ?? 0} high</div>
            </a>
            <a className="stat" href="#/vulnerabilities">
              <div className="k">Critical vulnerabilities</div>
              <div className="v">{o.vulns.critical?.advisories ?? 0}</div>
              <div className="s">on {o.vulns.critical?.devices ?? 0} devices · {o.vulns.high?.advisories ?? 0} high</div>
            </a>
          </div>
          <div className="split">
            <section className="panel">
              <h3>Compliance</h3>
              <div className="bar" aria-label={`${o.compliant} compliant, ${o.noncompliant} not compliant, ${o.unknown} not evaluated`}>
                <span className="g" style={{ width: pct(o.compliant) }} />
                <span className="r" style={{ width: pct(o.noncompliant) }} />
                <span className="u" style={{ width: pct(o.unknown) }} />
              </div>
              <div className="legend">
                <span><i className="dot green" /> {o.compliant} compliant</span>
                <span><i className="dot red" /> {o.noncompliant} not compliant</span>
                <span><i className="dot" /> {o.unknown} not evaluated</span>
              </div>
              <h3 style={{ marginTop: 18 }}>Failing most often</h3>
              {o.failing.length ? (
                <table className="table">
                  <tbody>
                    {o.failing.map((f) => (
                      <tr key={f.check}>
                        <td>{RULE_LABEL[f.check] ?? f.check}</td>
                        <td className="num">{f.n} {f.n === 1 ? "device" : "devices"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted small">Nothing is failing.</p>}
            </section>
            <section className="panel">
              <h3>Needs a look</h3>
              <ul className="plainlist checks">
                <li><span className="grow"><strong>{o.devices - o.encrypted}</strong> <span className="muted">not known to be encrypted</span></span></li>
                <li><span className="grow"><strong>{o.stale}</strong> <span className="muted">not seen for a week</span></span></li>
                <li><span className="grow"><strong>{o.unowned}</strong> <span className="muted">without an owner</span></span></li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
