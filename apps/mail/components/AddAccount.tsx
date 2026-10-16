"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { postJson } from "@/lib/client";

// Well-known providers, so most people only type their address and an app password.
const PRESETS: Record<string, { imap: string; smtp: string; smtpPort: number; note?: string }> = {
  "gmail.com": { imap: "imap.gmail.com", smtp: "smtp.gmail.com", smtpPort: 465, note: "Gmail needs an app password (Google Account → Security → App passwords)." },
  "googlemail.com": { imap: "imap.gmail.com", smtp: "smtp.gmail.com", smtpPort: 465 },
  "outlook.com": { imap: "outlook.office365.com", smtp: "smtp-mail.outlook.com", smtpPort: 587 },
  "hotmail.com": { imap: "outlook.office365.com", smtp: "smtp-mail.outlook.com", smtpPort: 587 },
  "live.com": { imap: "outlook.office365.com", smtp: "smtp-mail.outlook.com", smtpPort: 587 },
  "yahoo.com": { imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com", smtpPort: 465, note: "Yahoo needs an app password." },
  "icloud.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", smtpPort: 587, note: "iCloud needs an app-specific password." },
  "me.com": { imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", smtpPort: 587 },
};

export function AddAccount({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [f, setF] = useState({ address: "", password: "", label: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465", username: "" });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = f.address.split("@")[1]?.toLowerCase() ?? "";
  const preset = PRESETS[domain];

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...f, [k]: e.target.value };
    if (k === "address") {
      const p = PRESETS[e.target.value.split("@")[1]?.toLowerCase() ?? ""];
      const d = e.target.value.split("@")[1] ?? "";
      next.imapHost = p?.imap ?? (d ? `imap.${d}` : "");
      next.smtpHost = p?.smtp ?? (d ? `smtp.${d}` : "");
      next.smtpPort = String(p?.smtpPort ?? 465);
    }
    setF(next);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const smtpPort = Number(f.smtpPort);
      const out = await postJson<{ id: string }>("/api/accounts", {
        address: f.address, password: f.password, label: f.label, username: f.username,
        imapHost: f.imapHost, imapPort: Number(f.imapPort), imapSecure: Number(f.imapPort) === 993,
        smtpHost: f.smtpHost, smtpPort, smtpSecure: smtpPort === 465,
      });
      onAdded(out.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modalwrap" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalhead"><h2>Add an email account</h2><button type="button" className="iconbtn" onClick={onClose}><X size={16} /></button></div>
        <p className="muted small">Connect another mailbox (Gmail, Outlook.com, your company's mail, any IMAP account). It appears beside your Synergy mailbox.</p>
        <label>Email address<input type="email" required value={f.address} onChange={set("address")} autoFocus /></label>
        <label>Password or app password<input type="password" required value={f.password} onChange={set("password")} /></label>
        {preset?.note && <p className="note small">{preset.note}</p>}
        <button type="button" className="linkbtn" onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "Show"} server settings</button>
        {advanced && (
          <div className="grid2">
            <label>Display name<input value={f.label} onChange={set("label")} placeholder="Optional" /></label>
            <label>User name<input value={f.username} onChange={set("username")} placeholder="Same as email" /></label>
            <label>IMAP server<input required value={f.imapHost} onChange={set("imapHost")} /></label>
            <label>IMAP port<input required value={f.imapPort} onChange={set("imapPort")} inputMode="numeric" /></label>
            <label>SMTP server<input required value={f.smtpHost} onChange={set("smtpHost")} /></label>
            <label>SMTP port<input required value={f.smtpPort} onChange={set("smtpPort")} inputMode="numeric" /></label>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modalfoot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
        </div>
      </form>
    </div>
  );
}
