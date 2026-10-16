"use client";
import { UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { type Library, type Role, api, person } from "./client";

/** Members and settings of a shared library. Owners can change both, except on a team's library, which Groups manages. */
export function LibraryDialog({ library, me, onClose, onChanged, onDeleted }: {
  library: Library; me: string; onClose: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const [members, setMembers] = useState<{ email: string; role: Role }[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [name, setName] = useState(library.name);
  const [error, setError] = useState("");
  const owner = library.role === "owner";
  const manage = owner && !library.team;
  const base = `/api/libraries/${library.id}`;

  useEffect(() => {
    api<{ members: { email: string; role: Role }[] }>(`${base}/members`).then((m) => setMembers(m.members), (e) => setError(e.message));
  }, [base]);

  const run = async (p: Promise<unknown>) => {
    setError("");
    try {
      const out = (await p) as { members?: { email: string; role: Role }[] };
      if (out?.members) setMembers(out.members);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <Modal title={library.name} onClose={onClose} wide>
      <div className="form">
        {manage && (
          <form
            className="sharerow"
            onSubmit={(e) => {
              e.preventDefault();
              void run(api(base, { method: "PATCH", json: { name } }));
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Library name" />
            <button className="btn">Rename</button>
          </form>
        )}
        <h3>Members</h3>
        {library.team && <p className="muted small">Members of a team&apos;s library are managed in Groups.</p>}
        {manage && (
          <form
            className="sharerow"
            onSubmit={(e) => {
              e.preventDefault();
              void run(api(`${base}/members`, { method: "POST", json: { email, role } })).then((ok) => ok && setEmail(""));
            }}
          >
            <input type="email" placeholder="Add a member by email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
              <option value="viewer">Visitor (can view)</option>
              <option value="editor">Member (can edit)</option>
              <option value="owner">Owner</option>
            </select>
            <button className="btn primary">Add</button>
          </form>
        )}
        <ul className="people">
          {members.map((m) => (
            <li key={m.email}>
              <span className="avatar">{m.email[0]?.toUpperCase()}</span>
              <span className="grow">{person(m.email, me)} <span className="muted small">{m.email}</span></span>
              {manage ? (
                <select
                  value={m.role}
                  aria-label={`Role for ${m.email}`}
                  onChange={(e) => void run(api(`${base}/members`, { method: "POST", json: { email: m.email, role: e.target.value } }))}
                >
                  <option value="viewer">Visitor</option>
                  <option value="editor">Member</option>
                  <option value="owner">Owner</option>
                </select>
              ) : (
                <span className="muted small">{m.role === "owner" ? "Owner" : m.role === "editor" ? "Member" : "Visitor"}</span>
              )}
              {!library.team && (owner || m.email === me) && (
                <button
                  className="iconbtn"
                  title={m.email === me ? "Leave library" : "Remove"}
                  aria-label={m.email === me ? "Leave library" : `Remove ${m.email}`}
                  onClick={async () => {
                    const ok = await run(api(`${base}/members?email=${encodeURIComponent(m.email)}`, { method: "DELETE" }));
                    if (ok && m.email === me) onDeleted();
                  }}
                >
                  <UserMinus size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          {manage && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Delete the library "${library.name}"? It must be empty.`)) return;
                if (await run(api(base, { method: "DELETE" }))) onDeleted();
              }}
            >
              Delete library
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
