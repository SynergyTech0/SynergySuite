"use client";
// Settings: who campaigns come from, how fast they go, the team's roles, and the do-not-email list.
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Suppression } from "@/lib/audiences";
import { ROLES, label } from "@/lib/types";
import { api, formatDate, type AppCtx } from "./client";

export function SettingsView({ ctx }: { ctx: AppCtx }) {
  const s = ctx.settings;
  const admin = ctx.me.role === "admin";
  const [err, setErr] = useState("");
  return (
    <div className="page">
      <h1>Settings</h1>
      <form
        className="panel"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api("/api/settings", { method: "PUT", json: { ...f, perMinute: Number(f.perMinute) } });
            setErr("");
            ctx.say("Saved");
            ctx.refreshMe();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <h3>Sender</h3>
        <p className="small" style={{ margin: 0 }}>
          Mail goes out through: <strong>{s.sender.detail}</strong>.{" "}
          {s.sender.mode === "suite" && "The From address must be a mailbox on the suite's mail domain; it is created if need be, and bounces come back to it."}
          {s.sender.mode === "smtp" && "Your relay must allow the From address (for most providers, verify its domain there first)."}
        </p>
        <div className="grid2">
          <label className="field"><span>From name</span><input name="fromName" defaultValue={s.fromName} disabled={!admin} /></label>
          <label className="field"><span>From address</span><input name="fromEmail" type="email" defaultValue={s.fromEmail} disabled={!admin} /></label>
          <label className="field"><span>Reply-To (optional)</span><input name="replyTo" type="email" defaultValue={s.replyTo} disabled={!admin} /></label>
          <label className="field"><span>Emails a minute at most</span><input name="perMinute" type="number" min={1} max={6000} defaultValue={s.perMinute} disabled={!admin} /></label>
          <label className="field"><span>Organization name</span><input name="orgName" defaultValue={s.orgName} disabled={!admin} /></label>
          <label className="field"><span>Postal address (printed in every email&apos;s footer)</span><textarea name="postalAddress" rows={2} defaultValue={s.postalAddress} disabled={!admin} /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Anti-spam law (CAN-SPAM, CASL, the GDPR and PECR) asks every marketing email to say who sent it, carry a postal address and offer an unsubscribe that works. Campaigns adds the unsubscribe link and the one-click unsubscribe Gmail and Yahoo require, and won&apos;t send without the rest. To land in inboxes, also publish SPF, DKIM and DMARC records for the From domain.
        </p>
        <p className="error">{err}</p>
        {admin ? <div className="actions"><button className="btn primary">Save</button></div> : <p className="small muted">Only an admin can change these.</p>}
      </form>
      <Team ctx={ctx} />
      <Suppressions ctx={ctx} />
    </div>
  );
}

function Team({ ctx }: { ctx: AppCtx }) {
  const admin = ctx.me.role === "admin";
  return (
    <div className="panel">
      <h3>People</h3>
      <p className="small muted" style={{ margin: "0 0 8px" }}>Viewers see lists and reports. Marketers also edit lists and send. Admins also change these settings. New people start as viewers.</p>
      <ul className="people">
        {ctx.members.map((m) => (
          <li key={m.email}>
            <div className="grow"><strong>{m.name}</strong> <span className="muted small">{m.email}</span></div>
            {admin && m.email !== ctx.me.email ? (
              <select
                defaultValue={m.role}
                aria-label={`Role for ${m.name}`}
                onChange={async (e) => {
                  try {
                    await api(`/api/members/${encodeURIComponent(m.email)}`, { method: "PATCH", json: { role: e.target.value } });
                    ctx.refreshMe();
                  } catch (x) {
                    ctx.say((x as Error).message);
                  }
                }}
              >
                {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </select>
            ) : (
              <span className="badge">{label(m.role)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const REASON: Record<string, string> = { unsubscribed: "Unsubscribed from everything", bounced: "Bounced", complained: "Marked as spam", manual: "Added by hand" };

function Suppressions({ ctx }: { ctx: AppCtx }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Suppression[]>([]);
  const [version, setVersion] = useState(0);
  const [add, setAdd] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<Suppression[]>(`/api/suppressions?q=${encodeURIComponent(q)}`).then(setList).catch(() => {});
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, version]);
  return (
    <div className="panel">
      <h3>Do-not-email list</h3>
      <p className="small muted" style={{ margin: "0 0 8px" }}>Nothing is ever sent to these addresses, whatever audience they are in. Addresses land here when they bounce, are reported as spam, or unsubscribe from everything.</p>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {ctx.canEdit && (
          <>
            <input type="text" placeholder="Block addresses (comma separated)" value={add} onChange={(e) => setAdd(e.target.value)} style={{ minWidth: 260 }} />
            <button className="btn small" disabled={!add.trim()} onClick={async () => { try { await api("/api/suppressions", { method: "POST", json: { emails: add } }); setAdd(""); setVersion((v) => v + 1); } catch (e) { ctx.say((e as Error).message); } }}>Block</button>
          </>
        )}
      </div>
      {!list.length ? (
        <p className="muted small">Nobody{q ? " matches" : " yet"}.</p>
      ) : (
        <table className="mini">
          <thead><tr><th>Email</th><th>Why</th><th>Since</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.email}>
                <td>{s.email}</td>
                <td title={s.detail}>{REASON[s.reason] ?? s.reason}</td>
                <td>{formatDate(s.createdAt)}</td>
                <td>{ctx.canEdit && s.reason === "manual" && <button className="iconbtn small" aria-label="Unblock" onClick={async () => { await api(`/api/suppressions/${encodeURIComponent(s.email)}`, { method: "DELETE" }); setVersion((v) => v + 1); }}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
