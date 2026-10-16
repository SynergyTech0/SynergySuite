"use client";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DiagramInfo, Member } from "@/lib/types";
import { api, person } from "./client";
import { Modal } from "./Modal";

/** Share a diagram with people in the organization, to edit or only to view. */
export function ShareDialog({ diagram, me, onClose, onChanged }: { diagram: DiagramInfo; me: string; onClose: () => void; onChanged?: () => void }) {
  const [members, setMembers] = useState<Member[]>(diagram.members);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"edit" | "view">("edit");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ members: Member[] }>(`/api/diagrams/${diagram.id}/members`).then((r) => setMembers(r.members), () => {});
  }, [diagram.id]);

  const change = async (body: { email: string; role: "edit" | "view" }) => {
    setError("");
    try {
      const r = await api<{ members: Member[] }>(`/api/diagrams/${diagram.id}/members`, { method: "POST", json: body });
      setMembers(r.members);
      onChanged?.();
      return true;
    } catch (x) {
      setError((x as Error).message);
      return false;
    }
  };

  return (
    <Modal title={`Share “${diagram.name}”`} onClose={onClose}>
      <div className="form">
        <form
          className="sharerow"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await change({ email, role })) setEmail("");
          }}
        >
          <input type="email" placeholder="Email address" aria-label="Email address to share with" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          <select aria-label="What they can do" value={role} onChange={(e) => setRole(e.target.value as "edit" | "view")}>
            <option value="edit">Can edit</option>
            <option value="view">Can view</option>
          </select>
          <button className="btn primary">Share</button>
        </form>
        <p className="error" role="alert">{error}</p>
        <p className="small muted">They find it under Shared with me. Only one person&apos;s changes are kept when two people edit at once: the second to save is asked which copy to keep.</p>
        <ul className="people">
          <li>
            <span className="avatar">{person(diagram.owner, me)[0]}</span>
            <span className="grow">{person(diagram.owner, me)} <span className="muted small">Owner</span></span>
          </li>
          {members.map((m) => (
            <li key={m.email}>
              <span className="avatar">{person(m.email, me)[0]}</span>
              <span className="grow">{person(m.email, me)} <span className="muted small">{m.email}</span></span>
              <select aria-label={`What ${m.email} can do`} value={m.role} onChange={(e) => void change({ email: m.email, role: e.target.value as "edit" | "view" })}>
                <option value="edit">Can edit</option>
                <option value="view">Can view</option>
              </select>
              <button
                className="iconbtn"
                aria-label={`Stop sharing with ${m.email}`}
                onClick={async () => {
                  const r = await api<{ members: Member[] }>(`/api/diagrams/${diagram.id}/members?email=${encodeURIComponent(m.email)}`, { method: "DELETE" });
                  setMembers(r.members);
                  onChanged?.();
                }}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
