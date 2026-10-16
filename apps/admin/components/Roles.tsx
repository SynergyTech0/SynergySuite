"use client";
// Roles: who runs the Admin center (ADMIN_EMAILS) and who may use Compliance (eDiscovery managers).
import { Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Grant } from "@/lib/roles";
import { api, formatDate } from "./client";
import { Confirm } from "./Modal";
import { Avatar, Badge, PeoplePicker, type AppCtx } from "./shared";

type Data = { admins: { emails: string[]; source: "ADMIN_EMAILS" | "DEV_USER_EMAIL" | "none" }; grants: Grant[] };

export function Roles({ app }: { app: AppCtx }) {
  const [d, setD] = useState<Data | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Grant | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    void api<Data>("/api/roles").then(setD).catch((e) => app.say(e.message));
  }, [app]);
  useEffect(load, [load]);

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="pagehead">
        <div>
          <h1>Roles</h1>
          <p className="muted">Who can use the Admin center. Everyone else is turned away.</p>
        </div>
      </div>
      <section className="panel">
        <h3>Global admins</h3>
        <p className="muted small" style={{ margin: "0 0 8px" }}>
          Everything here: people, apps, compliance, retention, audit and roles.{" "}
          {d?.admins.source === "DEV_USER_EMAIL"
            ? <>In development, with <code>ADMIN_EMAILS</code> unset, the dev user is the admin.</>
            : <>Set with <code>ADMIN_EMAILS</code> on the Admin center (comma-separated); change it there and restart.</>}
        </p>
        <ul className="plainlist">
          {d?.admins.emails.map((e) => (
            <li key={e} className="who" style={{ padding: "6px 0" }}>
              <Avatar name={e} /> <span className="grow">{e}{e === app.me.email ? " (you)" : ""}</span> <Badge tone="purple">Global admin</Badge>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h3>eDiscovery managers</h3>
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          Open matters, place and release holds, search content and export it, in the matters they own or are a member of. They can&apos;t see People, Apps, the audit log or Roles, or change retention.
        </p>
        <form
          className="toolbar"
          style={{ alignItems: "flex-start" }}
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              for (const email of adding) await api("/api/roles", { method: "POST", json: { email, role: "ediscovery" } });
              app.say(adding.length === 1 ? `${adding[0]} is now an eDiscovery manager` : `${adding.length} people are now eDiscovery managers`);
              setAdding([]);
              load();
            } catch (x) {
              setError((x as Error).message);
              load();
            }
          }}
        >
          <div className="grow" style={{ minWidth: 260 }}><PeoplePicker label="People to add" value={adding} onChange={setAdding} /></div>
          <button className="btn primary" disabled={!adding.length}><UserPlus size={15} /> Make eDiscovery manager</button>
        </form>
        {error ? <p className="error" style={{ marginTop: 8 }}>{error}</p> : null}
        <ul className="plainlist" style={{ marginTop: 10 }}>
          {!d ? <li className="muted">Loading…</li> : !d.grants.length ? <li className="muted small">Nobody yet.</li> : d.grants.map((g) => (
            <li key={g.email} className="who" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <Avatar name={g.email} />
              <span className="grow" style={{ display: "flex", flexDirection: "column" }}>
                <span>{g.email}</span>
                <span className="rsub">Added by {g.grantedBy}, {formatDate(g.grantedAt)}</span>
              </span>
              <Badge tone="blue">eDiscovery manager</Badge>
              <button className="iconbtn" aria-label={`Remove ${g.email}`} title="Remove" onClick={() => setRemoving(g)}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      </section>
      {removing ? (
        <Confirm
          title="Remove this eDiscovery manager?"
          action="Remove"
          danger
          message={<><strong>{removing.email}</strong> will lose access to the Admin center. Matters they own stay as they are; an admin can hand them to someone else.</>}
          onConfirm={async () => {
            try {
              await api(`/api/roles/${encodeURIComponent(removing.email)}`, { method: "DELETE" });
              app.say("Removed");
              load();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
