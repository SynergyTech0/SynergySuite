"use client";
import { Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Board, Member } from "@/lib/boards";
import { api, person } from "./client";
import { Modal } from "./Modal";

const LINK_LABELS: Record<Board["linkAccess"], string> = {
  none: "Only people added here",
  view: "Anyone in your organization with the link can view",
  edit: "Anyone in your organization with the link can edit",
};

/**
 * Share a board: add people as editors or viewers, and (the owner) let anyone signed in to the
 * suite open it from its link.
 */
export function ShareDialog({ board, me, onClose, onChanged }: { board: Board; me: string; onClose: () => void; onChanged?: () => void | Promise<void> }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [link, setLink] = useState(board.linkAccess);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const canShare = board.role !== "viewer";
  const isOwner = board.role === "owner";
  const url = typeof location === "undefined" ? "" : `${location.origin}/b/${board.id}`;

  useEffect(() => {
    api<{ members: Member[] }>(`/api/boards/${board.id}/members`).then((r) => setMembers(r.members), (e) => setError((e as Error).message));
  }, [board.id]);

  async function run(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={`Share “${board.title}”`} onClose={onClose}>
      <div className="form">
        {canShare && (
          <form
            className="sharerow"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api<{ members: Member[] }>(`/api/boards/${board.id}/members`, { method: "POST", json: { email, role } });
                setMembers(r.members);
                setEmail("");
              });
            }}
          >
            <input type="email" placeholder="Email address" aria-label="Email address to share with" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            <select aria-label="What they can do" value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="btn primary">Share</button>
          </form>
        )}
        <p className="error" role="alert">{error}</p>
        <ul className="people">
          <li>
            <span className="avatar">{person(board.owner, me)[0]}</span>
            <span className="grow">{person(board.owner, me)} <span className="muted small">Owner</span></span>
          </li>
          {(members ?? []).map((m) => (
            <li key={m.email}>
              <span className="avatar">{person(m.email, me)[0]}</span>
              <span className="grow">{person(m.email, me)} <span className="muted small">{m.email}</span></span>
              {canShare ? (
                <select
                  aria-label={`What ${m.email} can do`}
                  value={m.role}
                  onChange={(e) => void run(async () => {
                    const r = await api<{ members: Member[] }>(`/api/boards/${board.id}/members`, { method: "POST", json: { email: m.email, role: e.target.value } });
                    setMembers(r.members);
                  })}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
              ) : (
                <span className="small muted">{m.role === "editor" ? "Can edit" : "Can view"}</span>
              )}
              {isOwner && (
                <button
                  className="iconbtn"
                  aria-label={`Stop sharing with ${m.email}`}
                  onClick={() => void run(async () => {
                    await api(`/api/boards/${board.id}/members?email=${encodeURIComponent(m.email)}`, { method: "DELETE" });
                    setMembers((x) => (x ?? []).filter((y) => y.email !== m.email));
                  })}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="linkopts">
          <b>Link</b>
          {isOwner ? (
            (["none", "view", "edit"] as const).map((v) => (
              <label key={v}>
                <input
                  type="radio"
                  name="link"
                  checked={link === v}
                  onChange={() => void run(async () => {
                    await api(`/api/boards/${board.id}`, { method: "PATCH", json: { linkAccess: v } });
                    setLink(v);
                  })}
                />
                {LINK_LABELS[v]}
              </label>
            ))
          ) : (
            <span className="small muted">{LINK_LABELS[link]}</span>
          )}
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            <Copy size={15} /> {copied ? "Link copied" : "Copy link"}
          </button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
