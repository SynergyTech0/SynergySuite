"use client";
import { X } from "lucide-react";
import { useState } from "react";
import type { List } from "@/lib/types";
import { api, person } from "./client";
import { Modal } from "./Modal";

/** Share a list with people in the organization; everyone on it can add, change and complete its tasks. */
export function ShareDialog({ list, me, onClose, onChanged }: { list: List; me: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [members, setMembers] = useState(list.members);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  return (
    <Modal title={`Share “${list.name}”`} onClose={onClose}>
      <div className="form">
        <form
          className="sharerow"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api(`/api/lists/${list.id}/members`, { method: "POST", json: { email } });
              setMembers((m) => [...new Set([...m, email.trim().toLowerCase()])]);
              setEmail("");
              await onChanged();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <input type="email" placeholder="Email address" aria-label="Email address to share with" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          <button className="btn primary">Share</button>
        </form>
        <p className="error" role="alert">{error}</p>
        <p className="small muted">Everyone on the list can add, change and complete its tasks.</p>
        <ul className="people">
          <li>
            <span className="avatar">{person(list.owner, me)[0]}</span>
            <span className="grow">{person(list.owner, me)} <span className="muted small">Owner</span></span>
          </li>
          {members.map((m) => (
            <li key={m}>
              <span className="avatar">{person(m, me)[0]}</span>
              <span className="grow">{person(m, me)} <span className="muted small">{m}</span></span>
              <button
                className="iconbtn"
                aria-label={`Stop sharing with ${m}`}
                onClick={async () => {
                  await api(`/api/lists/${list.id}/members?email=${encodeURIComponent(m)}`, { method: "DELETE" });
                  setMembers((x) => x.filter((y) => y !== m));
                  await onChanged();
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
