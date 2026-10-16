"use client";
// Team: everyone who has opened the CRM, and their roles. Only admins change roles.
import { useEffect } from "react";
import { ROLES, label, type Member, type Role } from "@/lib/types";
import { api, formatDate } from "./client";
import { Avatar, Badge, type AppCtx } from "./shared";

const ABOUT: Record<Role, string> = {
  admin: "Edits every record, reassigns owners and manages roles.",
  manager: "Edits every record and reassigns owners.",
  rep: "Sees every record; edits the ones they own.",
};

export function Team({ app, onMembers }: { app: AppCtx; onMembers: (m: Member[]) => void }) {
  const admin = app.me.role === "admin";
  // People who arrived since the app loaded show up when the page opens.
  useEffect(() => {
    void api<Member[]>("/api/members").then(onMembers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, []);
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="pagehead">
        <div>
          <h1>Team</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>People appear here the first time they open the CRM. New people start as reps.</p>
        </div>
      </div>
      <section className="panel">
        <h3>Roles</h3>
        <ul className="people">
          {ROLES.map((r) => (
            <li key={r}><Badge value={r} /><span>{ABOUT[r]}</span></li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h3>People ({app.members.length})</h3>
        <ul className="people">
          {app.members.map((m) => (
            <li key={m.email}>
              <Avatar name={m.name || m.email} />
              <span className="grow" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="rname">{m.name || m.email}{m.email === app.me.email ? " (you)" : ""}</span>
                <span className="rsub">{m.email} · last here {formatDate(m.lastSeen)}</span>
              </span>
              {admin ? (
                <select
                  aria-label={`Role for ${m.name || m.email}`}
                  value={m.role}
                  onChange={async (e) => {
                    try {
                      await api(`/api/members/${encodeURIComponent(m.email)}`, { method: "PATCH", json: { role: e.target.value } });
                      onMembers(await api<Member[]>("/api/members"));
                      app.say(`${m.name || m.email} is now ${label(e.target.value).toLowerCase()}`);
                    } catch (x) {
                      app.say((x as Error).message);
                    }
                  }}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              ) : <Badge value={m.role} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
