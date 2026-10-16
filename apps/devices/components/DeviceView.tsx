"use client";
// One device: what it is, whether it is compliant and why, what is installed, its vulnerabilities and alerts.
import { CheckCircle2, CircleHelp, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { ago, api, formatDateTime, formatSize, plural, useData } from "./client";
import { Modal } from "./Modal";
import { RULE_LABEL } from "./Policies";
import { type AppCtx, ComplianceBadge, Empty, Facts, OnOff, PLATFORM, Severity, StatusBadge } from "./shared";

type Detail = {
  id: string; host_identifier: string; hostname: string; owner: string | null; platform: string; os_name: string; os_version: string;
  hardware_vendor: string; hardware_model: string; hardware_serial: string; cpu: string; memory_bytes: string | null; osquery_version: string;
  facts: Record<string, unknown>; compliance: string; compliance_detail: { policy: string; check: string; outcome: string; detail: string }[];
  compliance_at: string | null; notes: string; last_ip: string | null; enrolled_at: string; last_seen: string; vulns_checked_at: string | null;
  enrolled_with: string | null; software_count: number; vuln_counts: Record<string, number>;
};

const TABS = [["", "Overview"], ["software", "Software"], ["vulnerabilities", "Vulnerabilities"], ["alerts", "Alerts"]] as const;

export function DeviceView({ app, id, tab }: { app: AppCtx; id: string; tab: string | null }) {
  const [d, reload] = useData<Detail>(`/api/devices/${id}`, app.say);
  const [retiring, setRetiring] = useState(false);
  const [editing, setEditing] = useState(false);
  const admin = app.me.role === "admin";
  if (!d) return <div className="page"><p className="muted">Loading…</p></div>;
  const vulns = Object.values(d.vuln_counts).reduce((a, b) => a + b, 0);
  const current = tab ?? "";
  const back = admin && d.owner !== app.me.email ? "devices" : "my";

  return (
    <div className="page">
      <div className="crumbs"><a href={`#/${back}`}>{back === "my" ? "My devices" : "Devices"}</a> › {d.hostname}</div>
      <div className="pagehead">
        <div>
          <h1>{d.hostname || "(unnamed)"}</h1>
          <p className="muted">{PLATFORM[d.platform] ?? d.platform} {d.os_version} · {d.hardware_vendor} {d.hardware_model} · seen {ago(d.last_seen)}</p>
        </div>
        <div className="toolbar">
          <ComplianceBadge state={d.compliance} />
          <button className="btn" onClick={() => api(`/api/devices/${id}/refresh`, { method: "POST" }).then(() => app.say("Asked the device for a fresh report. It answers within a minute when it is online.")).catch((e) => app.say(e.message))}>
            <RefreshCw size={15} /> Refresh
          </button>
          {admin ? <button className="btn" onClick={() => setEditing(true)}>Edit</button> : null}
          <button className="btn" onClick={() => setRetiring(true)}>Retire</button>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([t, label]) => (
          <a key={t} href={`#/devices/${id}${t ? `/${t}` : ""}`} className={current === t ? "on" : ""}>
            {label}
            {t === "software" ? <span className="count">{d.software_count}</span> : t === "vulnerabilities" && vulns ? <span className="count">{vulns}</span> : null}
          </a>
        ))}
      </nav>
      {current === "software" ? <Software id={id} app={app} />
        : current === "vulnerabilities" ? <DeviceVulns id={id} app={app} checked={d.vulns_checked_at} platform={d.platform} />
        : current === "alerts" ? <DeviceAlerts id={id} app={app} />
        : <DeviceOverview d={d} />}
      {retiring ? (
        <Modal title={`Retire ${d.hostname}?`} onClose={() => setRetiring(false)}>
          <div className="form">
            <p>The device stops reporting and leaves every list. Its alerts and history are kept. To manage it again, run an enrollment script on it.</p>
            <p className="muted small">Retiring doesn&apos;t remove osquery from the computer; uninstall it there if it is no longer needed.</p>
            <div className="actions">
              <button className="btn" onClick={() => setRetiring(false)}>Cancel</button>
              <button className="btn danger" onClick={() => api(`/api/devices/${id}/retire`, { method: "POST" }).then(() => { app.say(`${d.hostname} retired`); app.go({ view: back }); }).catch((e) => app.say(e.message))}>Retire</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {editing ? <EditDevice d={d} app={app} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} /> : null}
    </div>
  );
}

function DeviceOverview({ d }: { d: Detail }) {
  const f = d.facts as Record<string, boolean | null | string[] | undefined>;
  const icon = (o: string) => (o === "pass" ? <CheckCircle2 size={18} color="var(--ok)" /> : o === "fail" ? <XCircle size={18} color="var(--danger)" /> : <CircleHelp size={18} color="var(--muted)" />);
  return (
    <div className="split">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="panel">
          <h3>Compliance</h3>
          {d.compliance_detail.length === 0 ? <p className="muted small">No compliance policy applies to this device.</p> : (
            <ul className="plainlist checks">
              {d.compliance_detail.map((r, i) => (
                <li key={i}>
                  {icon(r.outcome)}
                  <span className="grow"><strong>{RULE_LABEL[r.check] ?? r.check}</strong><span className="muted small">{r.detail} · {r.policy}</span></span>
                </li>
              ))}
            </ul>
          )}
          {d.compliance_at ? <p className="muted small" style={{ marginTop: 10 }}>Evaluated {ago(d.compliance_at)}</p> : null}
        </section>
        <section className="panel">
          <h3>Security settings</h3>
          <Facts items={[
            ["Disk encryption", <OnOff key="e" v={f.disk_encryption as boolean | null} />],
            ["Firewall", <OnOff key="f" v={f.firewall as boolean | null} />],
            ["Antivirus", <OnOff key="a" v={f.antivirus as boolean | null} />],
            ["Screen lock", <OnOff key="s" v={f.screen_lock as boolean | null} />],
            ["System protection", <OnOff key="p" v={f.system_protection as boolean | null} />],
            ["Automatic updates", <OnOff key="u" v={f.auto_update as boolean | null} />],
            ["Administrators", Array.isArray(f.admins) ? (f.admins.length ? f.admins.join(", ") : "None") : ""],
            ["Signed in recently", Array.isArray(f.users) ? f.users.join(", ") : ""],
          ]} />
        </section>
      </div>
      <section className="panel">
        <h3>Device</h3>
        <Facts items={[
          ["Owner", d.owner ?? "No owner"],
          ["Operating system", `${d.os_name} ${d.os_version}`],
          ["Model", `${d.hardware_vendor} ${d.hardware_model}`],
          ["Serial number", d.hardware_serial],
          ["Processor", d.cpu],
          ["Memory", formatSize(d.memory_bytes)],
          ["Enrolled", formatDateTime(d.enrolled_at)],
          ["Enrolled with", d.enrolled_with ?? ""],
          ["Last seen", `${formatDateTime(d.last_seen)}${d.last_ip ? ` from ${d.last_ip}` : ""}`],
          ["osquery", d.osquery_version],
          ["Hardware ID", <code key="h">{d.host_identifier}</code>],
        ]} />
        {d.notes ? <p className="pre" style={{ marginTop: 12 }}>{d.notes}</p> : null}
      </section>
    </div>
  );
}

function Software({ id, app }: { id: string; app: AppCtx }) {
  const [text, setText] = useState("");
  const [rows] = useData<{ name: string; version: string; source: string }[]>(`/api/devices/${id}/software?q=${encodeURIComponent(text)}`, app.say);
  return (
    <section className="panel flush">
      <div className="toolbar pad"><input type="text" placeholder="Filter" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter software" /></div>
      {!rows ? <p className="muted pad">Loading…</p> : !rows.length ? <Empty><p>{text ? "Nothing matches." : "No software reported yet."}</p></Empty> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Version</th><th>Source</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>{r.name}</td><td className="muted">{r.version}</td><td className="muted">{r.source}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeviceVulns({ id, app, checked, platform }: { id: string; app: AppCtx; checked: string | null; platform: string }) {
  const [rows] = useData<{ vuln_id: string; package: string; version: string; severity: string; score: number | null; summary: string; fixed_version: string }[]>(`/api/devices/${id}/vulnerabilities`, app.say);
  if (platform !== "linux") return <section className="panel"><p className="muted">Vulnerabilities are matched for Debian, Ubuntu, Rocky Linux and AlmaLinux packages. Software on {PLATFORM[platform] ?? platform} is inventoried, not matched.</p></section>;
  return (
    <section className="panel flush">
      <p className="muted small pad">{checked ? `Checked against OSV ${ago(checked)}.` : "Not checked yet: it happens after the device reports its packages."}</p>
      {!rows ? null : !rows.length ? <Empty><p>No known vulnerabilities.</p></Empty> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Advisory</th><th>Severity</th><th>Package</th><th>Installed</th><th>Fixed in</th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.vuln_id + v.package}>
                  <td><a className="link" href={`https://osv.dev/vulnerability/${encodeURIComponent(v.vuln_id)}`} target="_blank" rel="noreferrer">{v.vuln_id}</a><div className="snippet">{v.summary}</div></td>
                  <td><Severity level={v.severity} />{v.score !== null ? <span className="muted small"> {v.score}</span> : null}</td>
                  <td>{v.package}</td>
                  <td className="muted">{v.version}</td>
                  <td>{v.fixed_version || <span className="muted">No fix yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeviceAlerts({ id, app }: { id: string; app: AppCtx }) {
  const [r] = useData<{ alerts: { id: string; title: string; severity: string; status: string; last_seen: string; occurrences: number }[] }>(`/api/alerts?device=${id}&status=all`, app.say);
  return (
    <section className="panel flush">
      {!r ? <p className="muted pad">Loading…</p> : !r.alerts.length ? <Empty><p>No alerts on this device.</p></Empty> : (
        <table className="table">
          <thead><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Last seen</th></tr></thead>
          <tbody>
            {r.alerts.map((a) => (
              <tr key={a.id} className="click" onClick={() => app.go({ view: "alerts", id: a.id })}>
                <td><a className="link" href={`#/alerts/${a.id}`}>{a.title}</a>{a.occurrences > 1 ? <span className="muted small"> · {plural(a.occurrences, "time")}</span> : null}</td>
                <td><Severity level={a.severity} /></td>
                <td><StatusBadge status={a.status} /></td>
                <td className="muted nowrap">{ago(a.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EditDevice({ d, app, onClose, onSaved }: { d: Detail; app: AppCtx; onClose: () => void; onSaved: () => void }) {
  const [owner, setOwner] = useState(d.owner ?? "");
  const [notes, setNotes] = useState(d.notes);
  const [err, setErr] = useState("");
  return (
    <Modal title={`Edit ${d.hostname}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        api(`/api/devices/${d.id}`, { method: "PATCH", json: { owner: owner.trim() || null, notes } }).then(() => { app.say("Saved"); onSaved(); }).catch((x) => setErr(x.message));
      }}>
        <label><span>Owner (email)</span><input type="email" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="No owner" /></label>
        <label><span>Notes</span><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="error small">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
