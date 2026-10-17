"use client";
// Windows device management: where PCs enroll and check in, and how a person enrolls their PC.
import { Copy, Monitor } from "lucide-react";
import { useData } from "./client";
import { type AppCtx, Facts } from "./shared";

export type WindowsStatus = { ready: boolean; link: string; server: string; management?: string; discovery?: string; enrolled?: number; pending?: number };

export function WindowsSetup({ app }: { app: AppCtx }) {
  const [s] = useData<WindowsStatus>("/api/mdm/windows/status", app.say);
  if (!s) return <div className="page"><p className="muted">Loading…</p></div>;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => app.say("Copied"), () => app.say(v));
  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Windows devices</h1>
          <p className="muted">Manage Windows 10 and 11 PCs with the device management built into Windows: push settings (password, BitLocker, firewall, updates, Wi-Fi), install MSI apps, and restart or reset PCs. Nothing is installed on the PC; add osquery for full inventory and threat detection.</p>
        </div>
      </div>
      {!s.ready ? <div className="notice warn"><div><p>Windows device management is turned off on this server (<code>DEVICES_WINDOWS_MDM=off</code>).</p></div></div> : null}
      <div className="split">
        <section className="panel">
          <h3>Server</h3>
          <Facts items={[
            ["Enrollment server", <span key="d"><code>{s.server}</code> <button className="btn small" onClick={() => void copy(s.server)}><Copy size={12} /></button></span>],
            ["PCs check in at", <code key="m">{s.management}</code>],
          ]} />
          <p className="muted small">PCs check in about once an hour, so commands and settings reach them at their next check-in. The check-in address must resolve to this server; the proxy asks PCs for the certificate Devices issued them there.</p>
        </section>
        <section className="panel">
          <h3>Enrollment</h3>
          <Facts items={[["Managed", String(s.enrolled ?? 0)], ["Enrolling", String(s.pending ?? 0)]]} />
          <p className="muted small">People enroll their own PC from My devices. A PC belongs to whoever signs in while enrolling it; admins can change the owner on its page.</p>
        </section>
      </div>
    </div>
  );
}

/** On the enrollment screens: enroll this person's Windows PC. */
export function WindowsEnroll({ app }: { app: AppCtx }) {
  const [s] = useData<WindowsStatus>("/api/mdm/windows/status", app.say);
  if (!s?.ready) return null;
  return (
    <section className="panel">
      <h3>Enroll a Windows PC <a className="btn small primary" href={s.link}><Monitor size={14} /> Enroll this PC</a></h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        On the PC, open this page and choose Enroll this PC, then sign in when Windows asks. Or go to Settings › Accounts › Access work or school,
        choose Enroll only in device management, enter your email and, if asked, the server <code>{s.server}</code>.
        Your organization can then apply required settings, install work apps, and restart or reset the PC. It can&apos;t see your personal files.
      </p>
    </section>
  );
}
