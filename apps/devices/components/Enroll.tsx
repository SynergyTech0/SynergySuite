"use client";
// Enrollment keys and the scripts that use them. A personal key makes the device yours; an
// organization key (admins) is for rolling out to many machines with a deployment tool.
import { Copy, Download, KeyRound } from "lucide-react";
import { useState } from "react";
import { ago, api, download, useData } from "./client";
import { AndroidEnroll } from "./Android";
import { AppleEnroll } from "./Apple";
import { WindowsEnroll } from "./Windows";
import { Modal } from "./Modal";
import { type AppCtx, Badge, Empty } from "./shared";

type Key = { id: string; name: string; owner: string | null; created_by: string; created_at: string; last_used_at: string | null; revoked_at: string | null; devices: number };
type Pkg = { host: string; flags: string; scripts: Record<"windows" | "darwin" | "linux", { file: string; text: string }> };

const OS: ["windows" | "darwin" | "linux", string, string][] = [
  ["windows", "Windows", "Install osquery (the .msi from osquery.io), then run the script in PowerShell as Administrator."],
  ["darwin", "macOS", "Install osquery (the .pkg from osquery.io), then run: sudo sh enroll-macos.sh. Give osqueryd Full Disk Access in System Settings so it can see FileVault."],
  ["linux", "Linux", "Install osquery (the .deb or .rpm from osquery.io, or its apt/yum repository), then run: sudo sh enroll-linux.sh"],
];

export function Enroll({ app, organization, onCreated }: { app: AppCtx; organization?: boolean; onCreated?: () => void }) {
  const [data, reload] = useData<{ host: string; keys: Key[] }>(`/api/enroll${organization ? "?all=1" : ""}`, app.say);
  const [made, setMade] = useState<{ secret: string; package: Pkg } | null>(null);
  const [name, setName] = useState("");
  const [asking, setAsking] = useState(false);

  const create = (org: boolean) =>
    api<{ secret: string; package: Pkg }>("/api/enroll", { method: "POST", json: { name, organization: org } })
      .then((r) => { setMade(r); setAsking(false); setName(""); reload(); onCreated?.(); })
      .catch((e) => app.say(e.message));

  const body = (
    <>
      <section className="panel">
        <h3>{organization ? "Enrollment keys" : "Enroll a computer"}
          <span className="toolbar">
            {organization ? <button className="btn small primary" onClick={() => setAsking(true)}><KeyRound size={14} /> New organization key</button> : null}
            <button className={`btn small${organization ? "" : " primary"}`} onClick={() => create(false)}><KeyRound size={14} /> New personal key</button>
          </span>
        </h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Devices uses <a className="link" href="https://osquery.io" target="_blank" rel="noreferrer">osquery</a>, the open source endpoint agent, which only reads the computer&apos;s state.
          {organization ? " A personal key makes the devices that use it yours. An organization key is for many machines at once (with Intune, Jamf, Ansible or a login script); those devices start without an owner." : " Make a key, then run its script on the computer. The key is shown once."}
        </p>
        {!data ? null : !data.keys.length ? <Empty><p>No keys yet.</p></Empty> : (
          <table className="table">
            <thead><tr><th>Key</th>{organization ? <th>Kind</th> : null}<th className="num">Devices</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {data.keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}{k.revoked_at ? <> <Badge tone="gray">Revoked</Badge></> : null}<div className="rsub">Made by {k.created_by} {ago(k.created_at)}</div></td>
                  {organization ? <td>{k.owner ? `Personal (${k.owner})` : "Organization"}</td> : null}
                  <td className="num">{k.devices}</td>
                  <td className="muted nowrap">{k.last_used_at ? ago(k.last_used_at) : "Never"}</td>
                  <td>{k.revoked_at ? null : <button className="btn small" onClick={() => api(`/api/enroll/${k.id}`, { method: "DELETE" }).then(() => { app.say("Key revoked. Devices already enrolled keep reporting."); reload(); }).catch((e) => app.say(e.message))}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {asking ? (
        <Modal title="New organization key" onClose={() => setAsking(false)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void create(true); }}>
            <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Office laptops, Linux servers" autoFocus /></label>
            <div className="actions"><button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button><button className="btn primary">Make key</button></div>
          </form>
        </Modal>
      ) : null}
      <AppleEnroll app={app} />
      <AndroidEnroll app={app} />
      <WindowsEnroll app={app} />
      {made ? <Scripts made={made} app={app} onClose={() => setMade(null)} /> : null}
    </>
  );
  if (!organization) return body;
  return (
    <div className="page">
      <div className="pagehead"><div><h1>Enrollment</h1><p className="muted">Devices report to <code>{data?.host ?? "…"}</code>.</p></div></div>
      {body}
    </div>
  );
}

function Scripts({ made, app, onClose }: { made: { secret: string; package: Pkg }; app: AppCtx; onClose: () => void }) {
  const [os, setOs] = useState<"windows" | "darwin" | "linux">(() => (typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "darwin" : /Linux/.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "linux" : "windows"));
  const s = made.package.scripts[os];
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => app.say("Copied")).catch(() => app.say("Couldn't copy; select the text instead"));
  return (
    <Modal title="Enroll with this key" onClose={onClose} wide>
      <div className="form">
        <div className="notice warn"><div><p>This is the only time the key is shown. Anyone with it can enroll a computer; revoke it when you&apos;re done.</p></div></div>
        <div className="seg" role="tablist">
          {OS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={os === k} className={os === k ? "on" : ""} onClick={() => setOs(k)}>{label}</button>)}
        </div>
        <p className="small">{OS.find((o) => o[0] === os)![2]}</p>
        <pre style={{ maxHeight: 260 }}>{s.text}</pre>
        <div className="actions">
          <button className="btn" onClick={() => copy(made.secret)}><Copy size={14} /> Copy key only</button>
          <button className="btn" onClick={() => copy(s.text)}><Copy size={14} /> Copy script</button>
          <button className="btn primary" onClick={() => download(s.file, s.text)}><Download size={14} /> Download {s.file}</button>
        </div>
        <details className="help"><summary>Deploying another way</summary>
          <p className="small">Put the key in a file osquery can read and start osqueryd with these flags (add <code>--tls_server_certs</code> if your server uses a private certificate authority):</p>
          <pre>{made.package.flags}</pre>
        </details>
      </div>
    </Modal>
  );
}
