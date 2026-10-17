"use client";
// Android management: connecting the organization's managed Google Play, and enrolling phones.
import { ExternalLink, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { useState } from "react";
import { api, formatDate, formatDateTime, plural, useData } from "./client";
import { Modal } from "./Modal";
import { type AppCtx, Facts } from "./shared";

export type AndroidStatus = {
  ready: boolean; configured?: boolean; enrolled?: number; work_profile?: number; fully_managed?: number;
  enterprise?: { enterprise: string; display_name: string; connected_by: string; connected_at: string } | null;
};
type Enrollment = { link: string; qr: string; value: string; expires: string; mode: "work_profile" | "fully_managed" };

export function AndroidSetup({ app }: { app: AppCtx }) {
  const [s, reload] = useData<AndroidStatus>("/api/mdm/android/status", app.say);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<Enrollment | null>(null);
  const connect = () => {
    setBusy(true);
    api<{ url: string }>("/api/mdm/android/signup", { method: "POST" })
      .then((r) => { window.location.href = r.url; })
      .catch((e) => { app.say(e.message); setBusy(false); });
  };
  const sync = () => {
    setBusy(true);
    api<{ devices: number }>("/api/mdm/android/sync", { method: "POST" })
      .then((r) => { app.say(`Read ${plural(r.devices, "phone")} from Google`); reload(); })
      .catch((e) => app.say(e.message))
      .finally(() => setBusy(false));
  };
  const company = () => {
    api<Enrollment>("/api/enroll/android", { method: "POST", json: { mode: "fully_managed", org: true } }).then(setToken).catch((e) => app.say(e.message));
  };
  if (!s) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Android devices</h1>
          <p className="muted">Manage Android phones and tablets through Google&apos;s Android Management API: a work profile on personal phones, or the whole phone when it belongs to the organization. Lock, erase, push settings and install apps from managed Google Play.</p>
        </div>
        {s.ready ? (
          <div className="actions">
            <button className="btn" disabled={busy} onClick={sync}><RefreshCw size={15} /> Sync now</button>
            <button className="btn primary" onClick={company}><QrCode size={15} /> Enroll a company phone</button>
          </div>
        ) : null}
      </div>
      {!s.configured ? (
        <div className="notice warn"><div><p>Android management isn&apos;t set up on this server. Make a Google Cloud service account in a project with the Android Management API turned on, and give its key to Devices as <code>DEVICES_ANDROID_SERVICE_ACCOUNT</code> (see the Devices README).</p></div></div>
      ) : null}
      <div className="split">
        <section className="panel">
          <h3>Managed Google Play</h3>
          {s.enterprise ? (
            <Facts items={[
              ["Organization", s.enterprise.display_name],
              ["Enterprise", <code key="e">{s.enterprise.enterprise}</code>],
              ["Connected", `${s.enterprise.connected_by}, ${formatDate(s.enterprise.connected_at)}`],
            ]} />
          ) : (
            <>
              <p className="small">Connect once with a Google account for the organization (a personal Gmail works; it doesn&apos;t need Google Workspace). Google asks for the organization&apos;s name and sends you back here.</p>
              <div className="actions"><button className="btn primary" disabled={!s.configured || busy} onClick={connect}><ExternalLink size={14} /> Connect to Google</button></div>
            </>
          )}
        </section>
        <section className="panel">
          <h3>Enrollment</h3>
          <Facts items={[
            ["Managed", String(s.enrolled ?? 0)],
            ["Work profiles", String(s.work_profile ?? 0)],
            ["Company phones", String(s.fully_managed ?? 0)],
          ]} />
          <p className="muted small">People enroll their own phone from My devices and get a work profile. A company phone is enrolled from its setup screen after a factory reset: tap the welcome screen six times and scan the QR code.</p>
        </section>
      </div>
      {token ? <EnrollmentToken token={token} onClose={() => setToken(null)} /> : null}
    </div>
  );
}

function EnrollmentToken({ token, onClose }: { token: Enrollment; onClose: () => void }) {
  const company = token.mode === "fully_managed";
  return (
    <Modal title={company ? "Enroll a company phone" : "Enroll your Android phone"} onClose={onClose}>
      <div className="form">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={token.qr} alt="Enrollment QR code" width={200} height={200} style={{ background: "#fff", borderRadius: 8 }} />
          <ol className="small" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            {company ? (
              <>
                <li>Factory reset the phone, or start with a new one.</li>
                <li>On the welcome screen, tap the same spot six times to open the QR reader.</li>
                <li>Scan this code and follow the steps. The phone becomes fully managed.</li>
              </>
            ) : (
              <>
                <li>On the phone, open the link below (or scan the code with its camera).</li>
                <li>Follow the steps to set up a work profile. Work apps get a briefcase badge.</li>
                <li>Your organization can lock the work profile and remove it. It can&apos;t see your personal apps, messages or photos.</li>
              </>
            )}
          </ol>
        </div>
        <label><span>Link</span><input readOnly value={token.link} onFocus={(e) => e.currentTarget.select()} /></label>
        <p className="muted small">Works for one phone, until {formatDateTime(token.expires)}.</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

/** On the enrollment screens: a work profile link for this person's Android phone. */
export function AndroidEnroll({ app }: { app: AppCtx }) {
  const [s] = useData<AndroidStatus>("/api/mdm/android/status", app.say);
  const [token, setToken] = useState<Enrollment | null>(null);
  if (!s?.ready) return null;
  const make = () => api<Enrollment>("/api/enroll/android", { method: "POST", json: { mode: "work_profile" } }).then(setToken).catch((e) => app.say(e.message));
  return (
    <section className="panel">
      <h3>Enroll an Android phone <button className="btn small primary" onClick={() => void make()}><Smartphone size={14} /> Get enrollment link</button></h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Your phone gets a work profile: work apps and data kept apart from your own. Your organization can lock or remove the work profile, apply required settings and install work apps. It can&apos;t see your personal data.
      </p>
      {token ? <EnrollmentToken token={token} onClose={() => setToken(null)} /> : null}
    </section>
  );
}
