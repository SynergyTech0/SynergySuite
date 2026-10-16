"use client";
/** Who has an app: co-owners (editors) change it, users run it, and it can go to everyone. */
import { useEffect, useState } from "react";
import { api, type Member } from "@/lib/client";
import { Modal } from "./Studio";

const ROLE_LABEL = { owner: "Owner", editor: "Co-owner (can edit)", user: "User (can run)" } as const;

export function ShareDialog({ appId, me, published, onClose }: { appId: string; me: string; published: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "editor" | "owner">("user");
  const [error, setError] = useState("");
  const url = `/api/apps/${encodeURIComponent(appId)}/members`;

  useEffect(() => {
    api<{ members: Member[] }>(url)
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e.message));
  }, [url]);

  const set = async (who: string, r: string) => {
    setError("");
    try {
      setMembers((await api<{ members: Member[] }>(url, { method: "PUT", body: { email: who, role: r } })).members);
      setEmail("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (who: string) => {
    setError("");
    try {
      const r = await api<{ members: Member[] }>(`${url}?email=${encodeURIComponent(who)}`, { method: "DELETE" });
      if (who === me) window.location.href = "/";
      else setMembers(r.members);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const everyone = members?.some((m) => m.email === "*");
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/play/${appId}`;

  return (
    <Modal title="Share" onClose={onClose}>
      {!published && <p className="warn-bar">People you share with can run the app once it&apos;s published.</p>}
      <p className="muted small">
        The app reads and saves records as the person using it, so they also need access to its Synergy Base database (share it from Base).
      </p>
      <form
        className="share-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void set(email.trim(), role);
        }}
      >
        <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Role">
          <option value="user">User (can run)</option>
          <option value="editor">Co-owner (can edit)</option>
          <option value="owner">Owner</option>
        </select>
        <button className="primary" type="submit">
          Share
        </button>
      </form>
      <label className="everyone">
        <input type="checkbox" checked={!!everyone} onChange={(e) => (e.target.checked ? void set("*", "user") : void remove("*"))} /> Everyone in the organization can run it
      </label>
      {error && <p className="error">{error}</p>}
      <ul className="members">
        {members
          ?.filter((m) => m.email !== "*")
          .map((m) => (
            <li key={m.email}>
              <span>
                {m.email}
                {m.email === me && <span className="muted"> (you)</span>}
              </span>
              <select value={m.role} onChange={(e) => void set(m.email, e.target.value)} aria-label={`Role for ${m.email}`}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button onClick={() => void remove(m.email)} title={m.email === me ? "Leave" : "Remove"}>
                ×
              </button>
            </li>
          ))}
      </ul>
      {link && (
        <p className="small">
          Link to run it: <code>{link}</code>
        </p>
      )}
    </Modal>
  );
}
