"use client";
// The device list. Admins see the fleet with filters; "My devices" is the Company Portal view of
// someone's own computers, with how to enroll another one.
import { Search } from "lucide-react";
import { useState } from "react";
import { ago, useData } from "./client";
import { Enroll } from "./Enroll";
import { type AppCtx, ComplianceBadge, Empty, PLATFORM, Severity } from "./shared";

export type DeviceSummary = {
  id: string; hostname: string; owner: string | null; platform: string; os_name: string; os_version: string;
  hardware_model: string; compliance: string; last_seen: string; open_alerts: number; worst_alert: string | null; vulns: number;
};

export function DeviceList({ app, mine }: { app: AppCtx; mine?: boolean }) {
  const [text, setText] = useState("");
  const [compliance, setCompliance] = useState("");
  const [platform, setPlatform] = useState("");
  const qs = new URLSearchParams({ ...(mine ? { mine: "1" } : {}), ...(text ? { q: text } : {}), ...(compliance ? { compliance } : {}), ...(platform ? { platform } : {}) });
  const [list, reload] = useData<DeviceSummary[]>(`/api/devices?${qs}`, app.say);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>{mine ? "My devices" : "Devices"}</h1>
          <p className="muted">{mine ? "The computers and phones you have enrolled, and whether they meet your organization's requirements." : "Every enrolled computer, phone and tablet, with its compliance and open threats."}</p>
        </div>
        {!mine ? <a className="btn primary" href="#/enroll">Enroll devices</a> : null}
      </div>
      {!mine ? (
        <div className="toolbar">
          <label className="search"><Search size={16} /><input type="search" placeholder="Name, owner, model or serial" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search devices" /></label>
          <select value={compliance} onChange={(e) => setCompliance(e.target.value)} aria-label="Compliance">
            <option value="">Any compliance</option>
            <option value="noncompliant">Not compliant</option>
            <option value="compliant">Compliant</option>
            <option value="unknown">Not evaluated</option>
          </select>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
            <option value="">Any platform</option>
            {Object.entries(PLATFORM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      ) : null}
      <section className="panel flush">
        {!list ? <p className="muted pad">Loading…</p> : list.length === 0 ? (
          <Empty>
            <p>{mine ? "You haven't enrolled a device yet." : text || compliance || platform ? "No device matches." : "No devices are enrolled yet."}</p>
          </Empty>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr><th>Device</th>{mine ? null : <th>Owner</th>}<th>OS</th><th>Compliance</th><th>Threats</th><th>Last seen</th></tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="click" onClick={() => app.go({ view: "devices", id: d.id })}>
                    <td>
                      <div className="cellstack">
                        <a className="link rname" href={`#/devices/${d.id}`} onClick={(e) => e.stopPropagation()}>{d.hostname || "(unnamed)"}</a>
                        <span className="rsub">{d.hardware_model}</span>
                      </div>
                    </td>
                    {mine ? null : <td className="clip">{d.owner ?? <span className="muted">No owner</span>}</td>}
                    <td className="nowrap">{PLATFORM[d.platform] ?? d.platform} <span className="muted">{d.os_version}</span></td>
                    <td><ComplianceBadge state={d.compliance} /></td>
                    <td>{d.open_alerts ? <><Severity level={d.worst_alert ?? "low"} /> <span className="muted small">{d.open_alerts}</span></> : <span className="muted">None</span>}</td>
                    <td className="nowrap muted">{ago(d.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {mine ? <Enroll app={app} onCreated={reload} /> : null}
    </div>
  );
}
