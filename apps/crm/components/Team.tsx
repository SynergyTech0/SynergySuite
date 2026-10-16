"use client";
// Team: everyone who has opened the CRM, and their roles. Only admins change roles.
import { useEffect } from "react";
import { ROLES, label, type Member, type Role } from "@/lib/types";
import { api, formatDate } from "./client";
import { Avatar, Badge, type AppCtx } from "./shared";

const ABOUT: Record<Role, string> = {
  admin: "Sees and edits every record, reassigns owners and manages roles.",
  manager: "Sees and edits every record and reassigns owners.",
  rep: "Edits the records they own.",
};

const REP_READ = {
  own: { label: "Their own and shared records", about: "Records they own or that were shared with them, plus what hangs off those: an account's contacts and deals, any record's activities." },
  all: { label: "Every record", about: "Every record in the CRM, whoever owns it." },
} as const;

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
        <h3>What reps can see</h3>
        <p className="muted small" style={{ marginTop: 0 }}>This applies in the CRM and in suite search. Owners and managers can share any record with someone from its page.</p>
        {admin ? (
          <select
            aria-label="What reps can see"
            value={app.repRead}
            onChange={async (e) => {
              try {
                const r = await api<{ repRead: "own" | "all" }>("/api/settings", { method: "PATCH", json: { repRead: e.target.value } });
                app.setRepRead(r.repRead);
                app.changed();
                app.say("Saved");
              } catch (x) {
                app.say((x as Error).message);
              }
            }}
          >
            <option value="own">{REP_READ.own.label}</option>
            <option value="all">{REP_READ.all.label}</option>
          </select>
        ) : <p style={{ margin: 0 }}><strong>{REP_READ[app.repRead].label}</strong></p>}
        <p className="muted small" style={{ marginBottom: 0 }}>{REP_READ[app.repRead].about}</p>
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
