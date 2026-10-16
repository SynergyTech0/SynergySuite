"use client";
/**
 * Share: who can open this database and what they may do. Owners add people by email and change
 * or remove access; everyone else sees the list and can leave.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DatabaseInfo, Role } from "@/lib/catalog";
import type { Member } from "@/lib/sharing";

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", editor: "Can edit", viewer: "Can view" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including sharing and deleting the database",
  editor: "Records, tables, queries, forms and reports",
  viewer: "Opens everything but changes nothing",
};

export function ShareDialog({ database, me, onClose }: { database: DatabaseInfo; me: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [error, setError] = useState("");
  const owner = database.role === "owner";
  const url = `/api/databases/${database.id}/members`;

  useEffect(() => {
    api<{ members: Member[] }>(url)
      .then((r) => setMembers(r.members))
      .catch((e) => setError((e as Error).message));
  }, [url]);

  async function share(who: string, r: Role) {
    try {
      setMembers((await api<{ members: Member[] }>(url, { body: { email: who, role: r } })).members);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function remove(who: string) {
    const self = who === me;
    if (!confirm(self ? `Leave "${database.name}"? You won't be able to open it again unless someone shares it with you.` : `Remove ${who}'s access?`)) return;
    try {
      const r = await api<{ members: Member[] | null }>(url, { method: "DELETE", body: { email: who } });
      if (self) window.location.href = "/";
      else setMembers(r.members ?? []);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal share" role="dialog" aria-label="Share" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Share “{database.name}”</h3>
        {owner ? (
          <form
            className="share-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await share(email, role)) setEmail("");
            }}
          >
            <input type="email" placeholder="Email address" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(["editor", "viewer", "owner"] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button className="primary" type="submit">
              Share
            </button>
          </form>
        ) : (
          <p className="muted small">Only an owner can change who has access.</p>
        )}
        <p className="muted small">{ROLE_HELP[role]}.</p>
        {error && <p className="error">{error}</p>}
        <ul className="members">
          {members.map((m) => (
            <li key={m.email}>
              <span className="who">
                {m.email}
                {m.email === me && <span className="muted"> (you)</span>}
              </span>
              {owner ? (
                <select aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => void share(m.email, e.target.value as Role)}>
                  {(["owner", "editor", "viewer"] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">{ROLE_LABELS[m.role]}</span>
              )}
              {(owner || m.email === me) && (
                <button aria-label={m.email === me ? "Leave" : `Remove ${m.email}`} onClick={() => remove(m.email)}>
                  {m.email === me ? "Leave" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small">People sign in to the suite with these addresses. Nobody is emailed; send them the link to this page.</p>
        <div className="actions">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
