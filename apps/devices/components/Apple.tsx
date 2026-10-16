"use client";
// Apple device management: the push certificate, and the enrollment profile for an iPhone, iPad or Mac.
import { Download, Smartphone, Upload } from "lucide-react";
import { useState } from "react";
import { api, formatDate, plural, useData } from "./client";
import { type AppCtx, Badge, Facts } from "./shared";

export type AppleStatus = {
  ready: boolean; configured?: boolean; server?: string; enrolled?: number; pending?: number; unenrolled?: number; push_expires_in_days?: number | null;
  push?: { topic: string; expires_at: string; subject: string; uploaded_by: string; uploaded_at: string } | null;
};

export function AppleSetup({ app }: { app: AppCtx }) {
  const [s, reload] = useData<AppleStatus>("/api/mdm/apple/status", app.say);
  const [pem, setPem] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = () => {
    setBusy(true);
    api<{ topic: string }>("/api/mdm/apple/push-cert", { method: "PUT", json: { pem } })
      .then((r) => { app.say(`Push certificate saved (${r.topic})`); setPem(""); reload(); })
      .catch((e) => app.say(e.message))
      .finally(() => setBusy(false));
  };
  const readFiles = async (files: FileList | null) => {
    if (!files) return;
    const parts = await Promise.all([...files].map((f) => f.text()));
    setPem((p) => [p, ...parts].filter(Boolean).join("\n"));
  };
  if (!s) return <div className="page"><p className="muted">Loading…</p></div>;
  const days = s.push_expires_in_days ?? null;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Apple devices</h1>
          <p className="muted">Manage iPhones, iPads and Macs: lock or erase them, push settings and install apps. Macs can also run osquery for full inventory and threat detection.</p>
        </div>
        {s.ready ? <a className="btn primary" href="/api/enroll/apple?org=1"><Download size={15} /> Organization profile</a> : null}
      </div>
      {!s.configured ? (
        <div className="notice warn"><div><p>The Apple MDM service isn&apos;t set up on this server. Set <code>DEVICES_MDM_API_KEY</code>, <code>DEVICES_MDM_WEBHOOK_KEY</code> and <code>DEVICES_SCEP_CHALLENGE</code> for Devices and the <code>devices-mdm</code> and <code>devices-scep</code> services (see the Devices README).</p></div></div>
      ) : null}
      <div className="split">
        <section className="panel">
          <h3>Push certificate</h3>
          {s.push ? (
            <>
              <Facts items={[
                ["Topic", <code key="t">{s.push.topic}</code>],
                ["Expires", <span key="e">{formatDate(s.push.expires_at)} {days !== null && days < 30 ? <Badge tone={days < 0 ? "red" : "amber"}>{days < 0 ? "Expired" : `In ${plural(days, "day")}`}</Badge> : null}</span>],
                ["Uploaded", `${s.push.uploaded_by}, ${formatDate(s.push.uploaded_at)}`],
              ]} />
              <p className="muted small">Renew it at identity.apple.com before it expires, with the same Apple ID, and upload the renewal here. A new certificate (rather than a renewal) means every device has to enroll again.</p>
            </>
          ) : (
            <ol className="small">
              <li>Make a certificate signing request and have it signed by an MDM vendor. <a className="link" href="https://mdmcert.download" target="_blank" rel="noreferrer">mdmcert.download</a> does this for free.</li>
              <li>Upload the signed request at <a className="link" href="https://identity.apple.com" target="_blank" rel="noreferrer">identity.apple.com</a> with a company Apple ID, and download the certificate.</li>
              <li>Paste or choose the certificate (PEM) and its private key, unencrypted, below.</li>
            </ol>
          )}
          <div className="form" style={{ padding: 0, marginTop: 12 }}>
            <label><span>{s.push ? "Renewed certificate and key" : "Certificate and private key"}</span>
              <textarea rows={6} value={pem} onChange={(e) => setPem(e.target.value)} placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----BEGIN RSA PRIVATE KEY-----\n…"} spellCheck={false} />
            </label>
            <div className="actions">
              <label className="btn" style={{ flexDirection: "row" }}><Upload size={14} /> Choose files<input type="file" accept=".pem,.crt,.key,.cer" multiple hidden onChange={(e) => void readFiles(e.target.files)} /></label>
              <button className="btn primary" disabled={!pem.trim() || busy || !s.configured} onClick={upload}>Save certificate</button>
            </div>
          </div>
        </section>
        <section className="panel">
          <h3>Enrollment</h3>
          <Facts items={[
            ["Managed", String(s.enrolled ?? 0)],
            ["Enrolling", String(s.pending ?? 0)],
            ["Left management", String(s.unenrolled ?? 0)],
            ["Server", <code key="s">{s.server}</code>],
          ]} />
          <p className="muted small">People enroll their own iPhone, iPad or Mac from My devices. The organization profile enrolls devices without an owner: install it with Apple Configurator or send it to a team.</p>
        </section>
      </div>
    </div>
  );
}

/** On the enrollment screens: download a profile for this person's iPhone, iPad or Mac. */
export function AppleEnroll({ app }: { app: AppCtx }) {
  const [s] = useData<AppleStatus>("/api/mdm/apple/status", app.say);
  if (!s?.ready) return null;
  return (
    <section className="panel">
      <h3>Enroll an iPhone, iPad or Mac <a className="btn small primary" href="/api/enroll/apple"><Smartphone size={14} /> Download profile</a></h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Open the profile on the device (on an iPhone or iPad, open this page in Safari), then install it in Settings › General › VPN &amp; Device Management (on a Mac: System Settings › Privacy &amp; Security › Profiles).
        Your organization can then lock or erase the device if it&apos;s lost, apply required settings and install work apps. It can&apos;t see your personal data, messages or photos.
        Each download works for one device.
      </p>
    </section>
  );
}
