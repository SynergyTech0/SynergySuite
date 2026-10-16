"use client";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ComponentInfo } from "./ComponentCard";
import { type Me, api, colorFor, initials } from "./client";
import { Modal } from "./Modal";

type Member = { email: string; role: string };

function People({ members, me, owner, canRemove, onRemove }: {
  members: Member[]; me: Me; owner: boolean; canRemove: boolean; onRemove: (email: string) => Promise<void>;
}) {
  return (
    <ul className="people">
      {members.map((m) => (
        <li key={m.email}>
          <span className="avatar small" style={{ background: colorFor(m.email) }}>{initials(m.email)}</span>
          <span className="grow">{m.email}{m.email === me.email ? " (you)" : ""}</span>
          <span className="muted small">{m.role === "owner" ? "Owner" : m.role === "viewer" ? "Can view" : "Can edit"}</span>
          {m.role !== "owner" && canRemove && (owner || m.email === me.email) && (
            <button className="iconbtn small" aria-label={m.email === me.email ? "Leave" : `Remove ${m.email}`} onClick={() => onRemove(m.email)}>
              <Trash2 size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddPerson({ onAdd }: { onAdd: (email: string, role: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");
  return (
    <form
      className="addperson"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onAdd(email, role);
          setEmail("");
          setError("");
        } catch (x) {
          setError((x as Error).message);
        }
      }}
    >
      <input type="email" required placeholder="Add someone by email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
      <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access">
        <option value="editor">Can edit</option>
        <option value="viewer">Can view</option>
      </select>
      <button className="btn primary">Add</button>
      {error && <p className="error small full">{error}</p>}
    </form>
  );
}

export function WorkspaceShare({ id, me, role, members, onClose, onChanged }: {
  id: string; me: Me; role: string; members: Member[]; onClose: () => void; onChanged: () => void;
}) {
  const canEdit = role !== "viewer";
  return (
    <Modal title="Share workspace" onClose={onClose}>
      <div className="form">
        <p className="muted small">Everyone here can open every page in this workspace and the components made in it.</p>
        {canEdit && (
          <AddPerson
            onAdd={async (email, r) => {
              await api(`/api/workspaces/${id}/members`, { method: "POST", json: { email, role: r } });
              onChanged();
            }}
          />
        )}
        <People
          members={members}
          me={me}
          owner={role === "owner"}
          canRemove
          onRemove={async (email) => {
            await api(`/api/workspaces/${id}/members?email=${encodeURIComponent(email)}`, { method: "DELETE" });
            if (email === me.email) window.location.href = "/";
            else onChanged();
          }}
        />
      </div>
    </Modal>
  );
}

export function ComponentShare({ info, me, onClose, onChanged }: { info: ComponentInfo; me: Me; onClose: () => void; onChanged: () => void }) {
  const owner = info.role === "owner";
  const [error, setError] = useState("");
  return (
    <Modal title="Share component" onClose={onClose}>
      <div className="form">
        <label>
          <span>People with the link</span>
          <select
            value={info.link_access}
            disabled={!owner}
            onChange={async (e) => {
              try {
                await api(`/api/components/${info.id}`, { method: "PATCH", json: { linkAccess: e.target.value } });
                onChanged();
              } catch (x) {
                setError((x as Error).message);
              }
            }}
          >
            <option value="org-edit">Anyone in the organization can edit</option>
            <option value="org-view">Anyone in the organization can view</option>
            <option value="people">Only the people below{info.workspace_name ? ` and the ${info.workspace_name} workspace` : ""}</option>
          </select>
        </label>
        {!owner && <p className="muted small">Only {info.owner} can change who the link works for.</p>}
        {error && <p className="error small">{error}</p>}
        <AddPerson
          onAdd={async (email, r) => {
            await api(`/api/components/${info.id}/members`, { method: "POST", json: { email, role: r } });
            onChanged();
          }}
        />
        <People
          members={info.members}
          me={me}
          owner={owner}
          canRemove
          onRemove={async (email) => {
            await api(`/api/components/${info.id}/members?email=${encodeURIComponent(email)}`, { method: "DELETE" });
            onChanged();
          }}
        />
      </div>
    </Modal>
  );
}
