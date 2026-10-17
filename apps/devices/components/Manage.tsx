"use client";
// A managed device's remote actions (lock, erase, restart, install an app) and its command history.
import { Lock, Power, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ago, api, formatDateTime } from "./client";
import { InstallApp } from "./Apps";
import { Modal } from "./Modal";
import { type AppCtx, Badge, Empty, Facts } from "./shared";

export type Management = {
  id: string; platform: "darwin" | "ios" | "android"; status: string; enrollment_type: string; info: Record<string, unknown> & { security?: Record<string, unknown> };
  info_at: string | null; enrolled_at: string | null; last_seen: string | null; unenrolled_at: string | null;
  commands: { uuid: string; request_type: string; label: string; status: string; requested_by: string; error: string | null; created_at: string; updated_at: string; pin: string | null }[];
  profiles: { id: string; name: string; status: string; error: string | null; updated_at: string }[];
};

const POSTURE: Record<string, string> = { SECURE: "Passes Play Integrity", AT_RISK: "At risk", POTENTIALLY_COMPROMISED: "Possibly compromised (rooted or modified)" };

const CMD_STATUS: Record<string, [string, string]> = {
  queued: ["amber", "Waiting for the device"], acknowledged: ["green", "Done"], notnow: ["amber", "Device busy, will retry"], error: ["red", "Failed"],
};

/** The buttons next to Refresh on a managed device. */
export function ManageActions({ app, id, hostname, m, onDone }: { app: AppCtx; id: string; hostname: string; m: Management; onDone: () => void }) {
  const [open, setOpen] = useState<"lock" | "erase" | "install" | null>(null);
  const admin = app.me.role === "admin";
  if (m.status !== "enrolled") return null;
  const power = (action: "restart" | "shutdown") =>
    api(`/api/devices/${id}/mdm/${action}`, { method: "POST" }).then(() => { app.say(action === "restart" ? "Restarting" : "Shutting down"); onDone(); }).catch((e) => app.say(e.message));
  const supervised = m.info.IsSupervised === true;
  const android = m.platform === "android";
  const canRestart = android ? m.enrollment_type === "fully_managed" : m.platform === "darwin" || supervised;
  return (
    <>
      <button className="btn" onClick={() => setOpen("lock")}><Lock size={15} /> Lock</button>
      <button className="btn" onClick={() => setOpen("install")}>Install app</button>
      {admin && canRestart ? <button className="btn" onClick={() => power("restart")}><RotateCcw size={15} /> Restart</button> : null}
      {admin && canRestart && !android ? <button className="btn" onClick={() => power("shutdown")}><Power size={15} /> Shut down</button> : null}
      {admin ? <button className="btn" onClick={() => setOpen("erase")}><Trash2 size={15} /> Erase</button> : null}
      {open === "lock" ? <LockDialog app={app} id={id} hostname={hostname} m={m} onClose={() => { setOpen(null); onDone(); }} /> : null}
      {open === "erase" ? <EraseDialog app={app} id={id} hostname={hostname} m={m} onClose={() => { setOpen(null); onDone(); }} /> : null}
      {open === "install" ? <InstallApp app={app} deviceId={id} platform={m.platform} onClose={() => { setOpen(null); onDone(); }} /> : null}
    </>
  );
}

function LockDialog({ app, id, hostname, m, onClose }: { app: AppCtx; id: string; hostname: string; m: Management; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState<string | null>(null);
  const [err, setErr] = useState("");
  if (pin) {
    return (
      <Modal title={`${hostname} is locking`} onClose={onClose}>
        <div className="form">
          <p>The Mac locks as soon as it&apos;s online. To unlock it, enter this PIN on its screen:</p>
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4 }}><code>{pin}</code></p>
          <p className="muted small">Admins can find the PIN later in the device&apos;s Management tab.</p>
          <div className="actions"><button className="btn primary" onClick={onClose}>Done</button></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Lock ${hostname}?`} onClose={onClose}>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        api<{ pin: string | null }>(`/api/devices/${id}/mdm/lock`, { method: "POST", json: { message, phone } })
          .then((r) => { if (r.pin) setPin(r.pin); else { app.say("Locking. It locks as soon as it's online."); onClose(); } })
          .catch((x) => setErr(x.message));
      }}>
        <p>{m.platform === "darwin" ? "The Mac locks and restarts to a screen that asks for a six-digit PIN, which you'll see next." : "The screen locks; it unlocks with the device's own passcode. Use this for a lost or stolen device."}</p>
        {m.platform !== "android" ? <label><span>Message on the lock screen (optional)</span><input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} placeholder="This device is lost. Please call…" /></label> : null}
        {m.platform === "ios" ? <label><span>Phone number to show (optional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></label> : null}
        <p className="error small">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Lock</button></div>
      </form>
    </Modal>
  );
}

function EraseDialog({ app, id, hostname, m, onClose }: { app: AppCtx; id: string; hostname: string; m: Management; onClose: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [keepPlan, setKeepPlan] = useState(true);
  const workProfile = m.platform === "android" && m.enrollment_type === "work_profile";
  const [pin, setPin] = useState<string | null>(null);
  const [err, setErr] = useState("");
  if (pin) {
    return (
      <Modal title={`${hostname} is being erased`} onClose={onClose}>
        <div className="form">
          <p>Older Macs (without Apple silicon or a T2 chip) ask for this PIN after erasing:</p>
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4 }}><code>{pin}</code></p>
          <div className="actions"><button className="btn primary" onClick={onClose}>Done</button></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={workProfile ? `Remove the work profile from ${hostname}?` : `Erase ${hostname}?`} onClose={onClose}>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        api<{ pin: string | null }>(`/api/devices/${id}/mdm/erase`, { method: "POST", json: { confirm, keep_data_plan: keepPlan } })
          .then((r) => { if (r.pin) setPin(r.pin); else { app.say(`Erasing ${hostname}`); onClose(); } })
          .catch((x) => setErr(x.message));
      }}>
        <div className="notice danger"><div><p>{workProfile
          ? "The work profile and its apps and data are deleted; the person's own apps and data stay. This can't be undone, and the phone leaves management."
          : "Everything on the device is deleted and it returns to its setup screen. This can't be undone, and the device leaves management."}</p></div></div>
        {m.platform === "ios" || (m.platform === "android" && !workProfile) ? <label className="check"><input type="checkbox" checked={keepPlan} onChange={(e) => setKeepPlan(e.target.checked)} /> Keep the cellular data plan (eSIM)</label> : null}
        <label><span>Type <strong>{hostname}</strong> to confirm</span><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></label>
        <p className="error small">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={confirm !== hostname}>{workProfile ? "Remove" : "Erase"}</button></div>
      </form>
    </Modal>
  );
}

/** The Management tab: enrollment, profiles and the commands sent to the device. */
export function ManagementTab({ m }: { m: Management }) {
  const sec = m.info.security ?? {};
  return (
    <div className="split">
      <section className="panel flush">
        <h3>Commands</h3>
        {!m.commands.length ? <Empty><p>No commands yet.</p></Empty> : (
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Command</th><th>Status</th><th>By</th><th>Sent</th></tr></thead>
              <tbody>
                {m.commands.map((c) => {
                  const [tone, label] = CMD_STATUS[c.status] ?? ["gray", c.status];
                  return (
                    <tr key={c.uuid}>
                      <td>{c.label}{c.pin ? <div className="rsub">PIN <code>{c.pin}</code></div> : null}</td>
                      <td><Badge tone={tone}>{label}</Badge>{c.error ? <div className="snippet">{c.error}</div> : null}</td>
                      <td className="muted clip">{c.requested_by}</td>
                      <td className="muted nowrap">{ago(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="panel">
          <h3>Management</h3>
          <Facts items={[
            ["Status", m.status === "enrolled" ? <Badge key="s" tone="green">Managed</Badge> : m.status === "authenticated" ? <Badge key="s" tone="amber">Enrolling</Badge> : <Badge key="s" tone="gray">Left management</Badge>],
            ["Enrolled", formatDateTime(m.enrolled_at)],
            ["Last contact", formatDateTime(m.last_seen)],
            ["Mode", m.platform !== "android" ? "" : m.enrollment_type === "work_profile" ? "Work profile (personal phone)" : "Fully managed (company phone)"],
            ["Meets the Android policy", m.info.policy_compliant === true ? "Yes" : m.info.policy_compliant === false ? <span key="p">No{Array.isArray(m.info.noncompliance) && m.info.noncompliance.length ? <div className="rsub">{(m.info.noncompliance as { settingName?: string }[]).map((n) => n.settingName).filter(Boolean).join(", ")}</div> : null}</span> : ""],
            ["Device integrity", typeof m.info.posture === "string" ? POSTURE[m.info.posture] ?? m.info.posture : ""],
            ["Supervised", m.info.IsSupervised === true ? "Yes" : m.info.IsSupervised === false ? "No" : ""],
            ["Find My", m.info.IsDeviceLocatorServiceEnabled === true ? "On" : m.info.IsDeviceLocatorServiceEnabled === false ? "Off" : ""],
            ["Activation Lock", m.info.IsActivationLockEnabled === true ? "On" : m.info.IsActivationLockEnabled === false ? "Off" : ""],
            ["Passcode meets the profile", sec.passcode_compliant === true ? "Yes" : sec.passcode_compliant === false ? "No" : ""],
            ["Phone number", typeof m.info.PhoneNumber === "string" ? m.info.PhoneNumber : typeof m.info.phone === "string" ? m.info.phone : ""],
            ["Battery", typeof m.info.BatteryLevel === "number" ? `${Math.round((m.info.BatteryLevel as number) * 100)}%` : ""],
            ["Details from", m.info_at ? ago(m.info_at) : ""],
          ]} />
        </section>
        <section className="panel">
          <h3>Configuration profiles</h3>
          {!m.profiles.length ? <p className="muted small">None.</p> : (
            <ul className="plainlist">
              {m.profiles.map((p) => (
                <li key={p.id} style={{ padding: "4px 0" }}>
                  {p.name} <Badge tone={p.status === "installed" ? "green" : p.status === "error" ? "red" : "amber"}>{p.status === "installed" ? "Installed" : p.status === "error" ? "Failed" : p.status === "removing" ? "Removing" : "Waiting"}</Badge>
                  {p.error ? <div className="snippet">{p.error}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
