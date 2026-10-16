"use client";
// Configuration profiles: settings sent to every managed iPhone, iPad or Mac of the chosen platforms.
import { Plus } from "lucide-react";
import { useState } from "react";
import { api, ago, useData } from "./client";
import { Modal } from "./Modal";
import { type AppCtx, Badge, Empty, PLATFORM } from "./shared";

type Kind = { kind: string; label: string; describe: string; platforms: string[] };
type Profile = {
  id: string; name: string; description: string; kind: string; settings: Record<string, unknown>; platforms: string[]; enabled: boolean;
  version: number; created_by: string; updated_at: string; installed: number; failed: number; pending: number;
};

export function Profiles({ app }: { app: AppCtx }) {
  const [data, reload] = useData<{ profiles: Profile[]; kinds: Kind[] }>("/api/mdm/profiles", app.say);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const run = (p: Promise<unknown>, msg: string) => p.then(() => { app.say(msg); reload(); }).catch((e) => app.say(e.message));
  const label = (k: string) => data?.kinds.find((x) => x.kind === k)?.label ?? k;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Configuration profiles</h1>
          <p className="muted">Settings for managed iPhones, iPads and Macs. A profile goes to every managed device of its platforms, now and when new ones enroll; changing it sends the new version, and turning it off or deleting it removes it.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}><Plus size={16} /> New profile</button>
      </div>
      {!data ? <p className="muted">Loading…</p> : !data.profiles.length ? (
        <section className="panel"><Empty><h2>No profiles yet</h2><p>Require a passcode, turn on FileVault and the firewall, keep software up to date, add the office Wi-Fi, or upload a profile made in Apple Configurator or iMazing Profile Editor.</p></Empty></section>
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead><tr><th>Profile</th><th>Sets</th><th>Platforms</th><th className="num">Installed</th><th className="num">Pending</th><th className="num">Failed</th><th /></tr></thead>
            <tbody>
              {data.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name} {p.enabled ? null : <Badge tone="gray">Off</Badge>}<div className="rsub">Version {p.version}, changed {ago(p.updated_at)}</div></td>
                  <td>{label(p.kind)}</td>
                  <td className="muted">{p.platforms.map((x) => PLATFORM[x] ?? x).join(", ")}</td>
                  <td className="num">{p.installed}</td>
                  <td className="num">{p.pending}</td>
                  <td className="num">{p.failed ? <Badge tone="red">{p.failed}</Badge> : 0}</td>
                  <td className="nowrap">
                    <button className="btn small" onClick={() => run(api(`/api/mdm/profiles/${p.id}`, { method: "PATCH", json: { enabled: !p.enabled } }), p.enabled ? "Turned off; removing it from devices" : "Turned on; sending it to devices")}>{p.enabled ? "Turn off" : "Turn on"}</button>{" "}
                    <button className="btn small" onClick={() => setEditing(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {editing && data ? <ProfileEditor app={app} profile={editing === "new" ? null : editing} kinds={data.kinds} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </div>
  );
}

function ProfileEditor({ app, profile, kinds, onClose, onSaved }: { app: AppCtx; profile: Profile | null; kinds: Kind[]; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(profile?.kind ?? "passcode");
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [s, setS] = useState<Record<string, unknown>>(profile?.settings ?? {});
  const info = kinds.find((k) => k.kind === kind)!;
  const [platforms, setPlatforms] = useState<string[]>(profile?.platforms ?? info.platforms);
  const [err, setErr] = useState("");
  const set = (k: string, v: unknown) => setS((x) => ({ ...x, [k]: v }));
  const num = (k: string, label: string, ph: string) => (
    <label><span>{label}</span><input type="number" value={s[k] === undefined || s[k] === null ? "" : String(s[k])} placeholder={ph} onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))} /></label>
  );
  const check = (k: string, label: string, dflt = false) => (
    <label className="check"><input type="checkbox" checked={s[k] === undefined ? dflt : s[k] === true} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
  );

  return (
    <Modal title={profile ? `Edit ${profile.name}` : "New configuration profile"} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        const json = { name, description, kind, settings: s, platforms };
        (profile ? api(`/api/mdm/profiles/${profile.id}`, { method: "PATCH", json }) : api("/api/mdm/profiles", { method: "POST", json }))
          .then(() => { app.say(profile ? "Saved; sending the new version to devices" : "Created; sending it to devices"); onSaved(); })
          .catch((x) => setErr(x.message));
      }}>
        <div className="grid2">
          <label><span>Sets</span>
            <select value={kind} disabled={!!profile} onChange={(e) => { const k = kinds.find((x) => x.kind === e.target.value)!; setKind(k.kind); setS({}); setPlatforms(k.platforms); }}>
              {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder={info.label} /></label>
        </div>
        <p className="muted small">{info.describe}</p>
        <label><span>Description (shown on the device)</span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></label>
        {info.platforms.length > 1 ? (
          <label><span>Platforms</span>
            <div className="seg" role="group">
              {info.platforms.map((k) => <button type="button" key={k} className={platforms.includes(k) ? "on" : ""} onClick={() => setPlatforms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>{PLATFORM[k]}</button>)}
            </div>
          </label>
        ) : null}
        <fieldset>
          <legend>Settings</legend>
          {kind === "passcode" ? (
            <div className="grid2">
              {num("min_length", "Minimum length", "6")}
              {num("max_inactivity_minutes", "Lock after (minutes idle)", "5")}
              {num("max_failed_attempts", "Failed attempts before erase (iPhone) or lockout (Mac)", "Not limited")}
              {num("max_age_days", "Change every (days)", "Never")}
              {check("require_alphanumeric", "Require letters and numbers")}
            </div>
          ) : kind === "filevault" ? check("show_recovery_key", "Show the recovery key to the person turning it on", true)
          : kind === "firewall" ? <>{check("block_all_incoming", "Block all incoming connections")}{check("stealth", "Stealth mode (don't answer pings)")}</>
          : kind === "software_update" ? check("install_os_updates", "Install macOS updates automatically", true)
          : kind === "restrictions" ? <>{check("no_camera", "Turn off the camera")}{check("no_screenshots", "Block screenshots and screen recording")}{check("encrypted_backups", "Require encrypted backups")}</>
          : kind === "wifi" ? (
            <div className="grid2">
              <label><span>Network name</span><input value={String(s.ssid ?? "")} onChange={(e) => set("ssid", e.target.value)} maxLength={32} required /></label>
              <label><span>Security</span>
                <select value={String(s.security ?? "WPA")} onChange={(e) => set("security", e.target.value)}>
                  <option value="WPA">WPA2 / WPA3 personal</option><option value="WPA3">WPA3 personal only</option><option value="None">None</option>
                </select>
              </label>
              {s.security === "None" ? null : <label><span>Password</span><input type="password" value={String(s.password ?? "")} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" /></label>}
              <div>{check("auto_join", "Join automatically", true)}{check("hidden", "Hidden network")}</div>
            </div>
          ) : (
            <>
              <label><span>Unsigned .mobileconfig</span><input type="file" accept=".mobileconfig,.plist,.xml" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set("mobileconfig", await f.text()); }} /></label>
              {profile && Array.isArray(profile.settings.payload_types) ? <p className="muted small">Current payloads: {(profile.settings.payload_types as string[]).join(", ")}. Choose a file to replace it.</p> : null}
            </>
          )}
        </fieldset>
        <p className="error small">{err}</p>
        <div className="actions">
          {profile ? <button type="button" className="btn danger" style={{ marginRight: "auto" }} onClick={() => api(`/api/mdm/profiles/${profile.id}`, { method: "DELETE" }).then(() => { app.say("Deleted; removing it from devices"); onSaved(); }).catch((x) => setErr(x.message))}>Delete</button> : null}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{profile ? "Save" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
