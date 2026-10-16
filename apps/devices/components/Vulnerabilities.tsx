"use client";
// Vulnerabilities across the fleet, one row per advisory, with the devices it affects.
import { Search } from "lucide-react";
import { useState } from "react";
import { useData } from "./client";
import { type AppCtx, Empty, Severity } from "./shared";

type V = { vuln_id: string; severity: string; score: number | null; summary: string; packages: string[]; devices: number; fixed_version: string | null };
type D = { id: string; hostname: string; owner: string | null; package: string; version: string; fixed_version: string };

export function Vulnerabilities({ app, id }: { app: AppCtx; id: string | null }) {
  const [severity, setSeverity] = useState("");
  const [text, setText] = useState("");
  const [r] = useData<{ enabled: boolean; vulnerabilities: V[] }>(`/api/vulnerabilities?${new URLSearchParams({ ...(severity ? { severity } : {}), ...(text ? { q: text } : {}) })}`, app.say);
  const [devices] = useData<D[]>(id ? `/api/vulnerabilities/${encodeURIComponent(id)}` : null, app.say);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Vulnerabilities</h1>
          <p className="muted">Installed Linux packages checked against <a className="link" href="https://osv.dev" target="_blank" rel="noreferrer">OSV</a>, the open vulnerability database (Debian, Ubuntu, Rocky Linux, AlmaLinux). Only package names and versions are sent.</p>
        </div>
      </div>
      {r && !r.enabled ? <div className="notice warn"><div><p>Vulnerability checks are off (<code>DEVICES_OSV_URL=off</code>).</p></div></div> : null}
      <div className="toolbar">
        <label className="search"><Search size={16} /><input type="search" placeholder="Advisory, package or words" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search vulnerabilities" /></label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">Any severity</option>
          {["critical", "high", "medium", "low", "unknown"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>
      <div className={id ? "split" : ""}>
        <section className="panel flush">
          {!r ? <p className="muted pad">Loading…</p> : !r.vulnerabilities.length ? <Empty><p>No known vulnerabilities{severity || text ? " match" : ""}.</p></Empty> : (
            <div className="tablewrap">
              <table className="table">
                <thead><tr><th>Advisory</th><th>Severity</th><th>Packages</th><th className="num">Devices</th></tr></thead>
                <tbody>
                  {r.vulnerabilities.map((v) => (
                    <tr key={v.vuln_id} className={`click${id === v.vuln_id ? " sel" : ""}`} onClick={() => app.go({ view: "vulnerabilities", id: v.vuln_id })}>
                      <td><span className="rname">{v.vuln_id}</span><div className="snippet">{v.summary}</div></td>
                      <td className="nowrap"><Severity level={v.severity} />{v.score !== null ? <span className="muted small"> {v.score}</span> : null}</td>
                      <td className="clip">{v.packages.join(", ")}</td>
                      <td className="num">{v.devices}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {id ? (
          <section className="panel">
            <h3>{id} <a className="btn small ghost" href={`https://osv.dev/vulnerability/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">On OSV</a></h3>
            {!devices ? <p className="muted small">Loading…</p> : (
              <ul className="plainlist checks">
                {devices.map((d) => (
                  <li key={d.id + d.package}>
                    <span className="grow">
                      <a className="link" href={`#/devices/${d.id}/vulnerabilities`}>{d.hostname}</a>
                      <span className="muted small">{d.package} {d.version}{d.fixed_version ? ` → fixed in ${d.fixed_version}` : " · no fix yet"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
