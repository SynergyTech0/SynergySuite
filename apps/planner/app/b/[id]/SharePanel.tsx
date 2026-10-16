"use client";
import { useEffect, useState } from "react";

type Role = "owner" | "admin" | "member" | "observer";
const ROLES: Role[] = ["owner", "admin", "member", "observer"];
type Member = { userId: string; role: Role; name: string; email: string | null; isMind: boolean };
type Pending = { id: string; email: string; role: Role; expiresAt: string };

/**
 * Board sharing: who is on the board, who has been invited, and a form to invite someone new.
 *
 * Anyone who can see the board can see its members. Only owners/admins get the invite form, role
 * controls and the pending list — the invites route answers 403 for everyone else, and that answer
 * is how this panel decides, so the UI never offers more than the server will honour.
 *
 * There is no outbound email yet: creating an invite shows its link to copy and send. The link is
 * shown once, because the token is never returned again.
 */
export function SharePanel({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<Pending[] | null>(null); // null = caller may not administer
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const m = await fetch(`/api/boards/${boardId}/members`);
    if (m.ok) setMembers(await m.json());
    const p = await fetch(`/api/boards/${boardId}/invites`);
    setPending(p.ok ? await p.json() : null);
  }
  useEffect(() => { load(); }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await fetch(`/api/boards/${boardId}/invites`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Couldn't create the invitation."); return; }
    const d: { token: string } = await r.json();
    setLink(`${window.location.origin}/invite/${d.token}`);
    setEmail("");
    load();
  }

  async function send(method: "PATCH" | "DELETE", url: string, body: unknown) {
    setError(null);
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || "That change was refused.");
    load();
  }

  const admin = pending !== null;

  return (
    <div className="searchresults share">
      <div className="shead">
        <b>Share this board</b>
        <span className="muted">{members.length} member{members.length === 1 ? "" : "s"}</span>
        <div style={{ flex: 1 }} />
        <button className="mini" onClick={onClose}>close</button>
      </div>

      {admin && (
        <form onSubmit={invite}>
          <input type="email" required placeholder="Email address" aria-label="Email to invite"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <select aria-label="Role for the invitee" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button className="btn" type="submit">Create invite link</button>
        </form>
      )}

      {link && (
        <div className="sharelink">
          <input readOnly aria-label="Invitation link" value={link} onFocus={(e) => e.currentTarget.select()} />
          <button className="mini" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
          <span className="muted" style={{ fontSize: 12 }}>Shown once — send it now.</span>
        </div>
      )}
      {error && <div className="bnote warn" style={{ cursor: "default" }}>{error}</div>}

      <div className="ssub">Members</div>
      {members.map((m) => (
        <div key={m.userId} className="brow">
          <span>{m.name}{m.isMind && <span className="badge" style={{ marginLeft: 6 }}>mind</span>}</span>
          {m.email && <span className="muted" style={{ fontSize: 12 }}>{m.email}</span>}
          <div style={{ flex: 1 }} />
          {admin ? (
            <>
              <select aria-label={`Role for ${m.name}`} value={m.role}
                onChange={(e) => send("PATCH", `/api/boards/${boardId}/members`, { userId: m.userId, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="mini" aria-label={`Remove ${m.name}`}
                onClick={() => { if (confirm(`Remove ${m.name} from this board?`)) send("DELETE", `/api/boards/${boardId}/members`, { userId: m.userId }); }}>
                Remove
              </button>
            </>
          ) : <span className="muted">{m.role}</span>}
        </div>
      ))}
      {!members.length && <div className="bempty">No explicit members — workspace members can still see this board.</div>}

      {admin && pending && (
        <>
          <div className="ssub">Pending invitations</div>
          {pending.map((p) => (
            <div key={p.id} className="brow">
              <span>{p.email}</span>
              <span className="muted" style={{ fontSize: 12 }}>{p.role} · expires {new Date(p.expiresAt).toLocaleDateString()}</span>
              <div style={{ flex: 1 }} />
              <button className="mini" onClick={() => send("DELETE", `/api/boards/${boardId}/invites`, { id: p.id })}>Revoke</button>
            </div>
          ))}
          {!pending.length && <div className="bempty">No pending invitations.</div>}
        </>
      )}
    </div>
  );
}
