"use client";
import { Copy, Link2, Trash2, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { ApiError, type DlpDecision, type Item, type Role, api, formatWhen, person } from "./client";

type Sharing = {
  owner: string;
  people: { email: string; role: Role; sharedBy: string; inherited: boolean; from?: string }[];
  links: { token: string; createdBy: string; createdAt: string; expiresAt: string | null }[];
  canShare: boolean;
  library: string | null;
};

/** A data loss prevention policy tip; `retry` goes ahead with a reason (warnings only). */
type Tip = { message: string; dlp: DlpDecision; retry?: (justification: string) => Promise<boolean> };

export function ShareDialog({ item, me, onClose, onChanged }: { item: Item; me: string; onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<Sharing | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [days, setDays] = useState("0");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [tip, setTip] = useState<Tip | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    api<Sharing>(`/api/items/${item.id}/sharing`).then(setS, (e) => setError(e.message));
  }, [item.id]);

  /** Sends a change; a DLP warning or block comes back as a policy tip instead of an error. */
  const send = async (path: string, method: string, json?: Record<string, unknown>, after?: () => void): Promise<boolean> => {
    setError("");
    setTip(null);
    try {
      const next = await api<Sharing | { ok: boolean }>(path, { method, json });
      if ("people" in next) setS(next);
      onChanged();
      after?.();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.data.dlp) {
        setReason("");
        setTip({
          message: e.message,
          dlp: e.data.dlp as DlpDecision,
          retry: e.status === 409 ? (justification) => send(path, method, { ...json, dlpOverride: { justification } }, after) : undefined,
        });
      } else setError((e as Error).message);
      return false;
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
              void send(`/api/items/${item.id}/sharing`, "POST", { email, role }, () => setEmail(""));
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
        {tip && (
          <div className={`dlp${tip.retry ? " warn" : ""}`} role="alert">
            <b>{tip.retry ? "Check before sharing" : "This can't be shared"}</b>
            <p>{tip.message}</p>
            {tip.dlp.matches.length > 0 && (
              <ul>
                {tip.dlp.matches.map((m) => (
                  <li key={m.type}>{m.name}{m.count > 1 ? ` (${m.count})` : ""}</li>
                ))}
              </ul>
            )}
            {tip.retry ? (
              <form
                className="form"
                style={{ padding: 0 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim()) void tip.retry!(reason.trim());
                }}
              >
                <label>
                  <span>To share anyway, say why</span>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required aria-label="Reason for sharing anyway" />
                </label>
                <div className="actions">
                  <button type="button" className="btn" onClick={() => setTip(null)}>Cancel</button>
                  <button className="btn primary" disabled={!reason.trim()}>Share anyway</button>
                </div>
              </form>
            ) : (
              <div className="actions">
                <button className="btn" onClick={() => setTip(null)}>OK</button>
              </div>
            )}
          </div>
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
                        onChange={(e) => void send(`/api/items/${item.id}/sharing`, "POST", { email: p.email, role: e.target.value })}
                      >
                        <option value="viewer">Can view</option>
                        <option value="editor">Can edit</option>
                      </select>
                      <button
                        className="iconbtn"
                        title="Stop sharing"
                        aria-label={`Stop sharing with ${p.email}`}
                        onClick={() => void send(`/api/items/${item.id}/sharing?email=${encodeURIComponent(p.email)}`, "DELETE")}
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
                        onClick={() => void send(`/api/items/${item.id}/links?token=${l.token}`, "DELETE")}
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
                  <button className="btn" onClick={() => void send(`/api/items/${item.id}/links`, "POST", { expiresDays: Number(days) })}>
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
