"use client";
import { useState } from "react";
import type { GroupDetail, Kind } from "@/lib/types";
import { api } from "./client";
import type { MeInfo } from "./GroupsApp";
import { Modal } from "./Modal";

const CHOICES: { kind: Kind; title: string; text: string }[] = [
  { kind: "team", title: "Team", text: "Chat channels, shared files, a calendar and a mailbox" },
  { kind: "distribution", title: "Distribution list", text: "One address that sends to everyone in it" },
  { kind: "shared_mailbox", title: "Shared mailbox", text: "One inbox several people read and send from" },
  { kind: "security", title: "Security group", text: "A set of people to give access to things" },
];

function slug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function CreateGroup({ me, onClose, onCreated }: { me: MeInfo; onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<Kind>("team");
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [aliasTouched, setAliasTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownAlias = aliasTouched ? alias : slug(name);

  return (
    <Modal title="Create" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const g = await api<GroupDetail>("/api/groups", {
              method: "POST",
              json: {
                kind,
                name,
                description: f.get("description"),
                privacy: f.get("privacy"),
                alias: kind === "security" ? undefined : aliasTouched ? alias : undefined,
                members: String(f.get("members") ?? ""),
                allowExternal: f.get("allowExternal") === "on",
              },
            });
            onCreated(g.id);
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="kindpick" role="radiogroup" aria-label="What to create">
          {CHOICES.map((c) => (
            <button type="button" key={c.kind} role="radio" aria-checked={kind === c.kind} className={kind === c.kind ? "on" : ""} onClick={() => setKind(c.kind)}>
              <b>{c.title}</b>
              <small>{c.text}</small>
            </button>
          ))}
        </div>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" maxLength={1000} rows={2} />
        </label>
        {kind !== "security" && (
          <label>
            <span>Email address{kind === "team" ? " (the team's shared mailbox)" : ""}</span>
            <div className="toolbar" style={{ flexWrap: "nowrap" }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                value={shownAlias}
                onChange={(e) => {
                  setAliasTouched(true);
                  setAlias(e.target.value.toLowerCase());
                }}
                pattern="[a-z0-9]([a-z0-9._\-]{0,62}[a-z0-9])?"
                title="Letters, numbers, dots, dashes and underscores"
                required={kind !== "team"}
              />
              <span className="muted">@{me.domain}</span>
            </div>
          </label>
        )}
        <div className="row2">
          <label>
            <span>Privacy</span>
            <select name="privacy" defaultValue="private">
              <option value="private">Private: owners add people</option>
              <option value="public">Public: anyone can join</option>
            </select>
          </label>
          {kind === "distribution" && (
            <label className="check" style={{ alignSelf: "end" }}>
              <input type="checkbox" name="allowExternal" /> People outside the organization can send to it
            </label>
          )}
        </div>
        <label>
          <span>Members (emails, separated by commas; you are the owner)</span>
          <textarea name="members" rows={2} placeholder="ana@example.com, ben@example.com" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
