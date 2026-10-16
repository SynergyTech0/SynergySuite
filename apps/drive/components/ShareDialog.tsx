"use client";
import { Copy, Link2, Trash2, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { type Item, type Role, api, formatWhen, person } from "./client";

type Sharing = {
  owner: string;
  people: { email: string; role: Role; sharedBy: string; inherited: boolean; from?: string }[];
  links: { token: string; createdBy: string; createdAt: string; expiresAt: string | null }[];
  canShare: boolean;
  library: string | null;
};

export function ShareDialog({ item, me, onClose, onChanged }: { item: Item; me: string; onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<Sharing | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [days, setDays] = useState("0");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api<Sharing>(`/api/items/${item.id}/sharing`).then(setS, (e) => setError(e.message));
  }, [item.id]);

  const run = async (p: Promise<Sharing | { ok: boolean }>) => {
    setError("");
    try {
      const next = await p;
      if ("people" in next) setS(next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const linkUrl = (token: string) => `${location.origin}/s/${token}`;

  return (
    <Modal title={`Share "${item.name}"`} onClose={onClose} wide>
      <div className="form">
        {s?.canShare && (
          <form
            className="sharerow"
            onSubmit={(e) => {
              e.preventDefault();
              void run(api(`/api/items/${item.id}/sharing`, { method: "POST", json: { email, role } })).then(() => setEmail(""));
            }}
          >
            <input type="email" placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Email" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Permission">
              <option value="viewer">Can view</option>
              <option value="editor">Can edit</option>
            </select>
            <button className="btn primary">Share</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {!s && !error && <p className="muted">Loading…</p>}
        {s && (
          <>
            <h3>People with access</h3>
            <ul className="people">
              {s.library ? (
                <li>
                  <span className="avatar">{s.library[0]?.toUpperCase()}</span>
                  <span className="grow">Members of <b>{s.library}</b></span>
                  <span className="muted small">Library access</span>
                </li>
              ) : (
                <li>
                  <span className="avatar">{s.owner[0]?.toUpperCase()}</span>
                  <span className="grow">{person(s.owner, me)} <span className="muted small">{s.owner}</span></span>
                  <span className="muted small">Owner</span>
                </li>
              )}
              {s.people.map((p) => (
                <li key={`${p.email}-${p.from ?? ""}`}>
                  <span className="avatar">{p.email[0]?.toUpperCase()}</span>
                  <span className="grow">
                    {person(p.email, me)} <span className="muted small">{p.email}</span>
                    {p.inherited && <div className="muted small">From the folder &ldquo;{p.from}&rdquo;</div>}
                  </span>
                  {s.canShare && !p.inherited ? (
                    <>
                      <select
                        value={p.role}
                        aria-label={`Permission for ${p.email}`}
                        onChange={(e) => void run(api(`/api/items/${item.id}/sharing`, { method: "POST", json: { email: p.email, role: e.target.value } }))}
                      >
                        <option value="viewer">Can view</option>
                        <option value="editor">Can edit</option>
                      </select>
                      <button
                        className="iconbtn"
                        title="Stop sharing"
                        aria-label={`Stop sharing with ${p.email}`}
                        onClick={() => void run(api(`/api/items/${item.id}/sharing?email=${encodeURIComponent(p.email)}`, { method: "DELETE" }))}
                      >
                        <UserMinus size={16} />
                      </button>
                    </>
                  ) : (
                    <span className="muted small">{p.role === "editor" ? "Can edit" : "Can view"}</span>
                  )}
                </li>
              ))}
            </ul>

            {s.canShare && (
              <>
                <h3>View links</h3>
                <p className="muted small">Anyone with a link can view and download, without signing in.</p>
                <ul className="people">
                  {s.links.map((l) => (
                    <li key={l.token}>
                      <Link2 size={16} />
                      <span className="grow linktext">
                        <code>{linkUrl(l.token)}</code>
                        <div className="muted small">
                          Made by {person(l.createdBy, me)} {formatWhen(l.createdAt)} · {l.expiresAt ? `expires ${new Date(l.expiresAt).toLocaleDateString()}` : "never expires"}
                        </div>
                      </span>
                      <button
                        className="iconbtn"
                        title="Copy link"
                        aria-label="Copy link"
                        onClick={() => {
                          void navigator.clipboard?.writeText(linkUrl(l.token));
                          setCopied(l.token);
                        }}
                      >
                        <Copy size={16} />
                      </button>
                      {copied === l.token && <span className="small ok">Copied</span>}
                      <button
                        className="iconbtn"
                        title="Remove link"
                        aria-label="Remove link"
                        onClick={() => void run(api(`/api/items/${item.id}/links?token=${l.token}`, { method: "DELETE" }))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="sharerow">
                  <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Link expiry">
                    <option value="0">Never expires</option>
                    <option value="1">Expires in 1 day</option>
                    <option value="7">Expires in 7 days</option>
                    <option value="30">Expires in 30 days</option>
                  </select>
                  <button className="btn" onClick={() => void run(api(`/api/items/${item.id}/links`, { method: "POST", json: { expiresDays: Number(days) } }))}>
                    <Link2 size={16} /> Create link
                  </button>
                </div>
              </>
            )}
          </>
        )}
        <div className="actions">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
