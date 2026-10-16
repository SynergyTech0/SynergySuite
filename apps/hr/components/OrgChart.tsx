"use client";
import { type Ctx, type Employee, initials } from "./client";

/** Managers above their reports. People whose manager isn't in HR sit at the top. */
export function OrgChart({ ctx }: { ctx: Ctx }) {
  const people = ctx.people;
  const emails = new Set(people.map((p) => p.email));
  const reportsOf = (email: string) => people.filter((p) => p.manager_email === email && p.email !== email);
  const roots = people.filter((p) => !p.manager_email || !emails.has(p.manager_email));

  const node = (p: Employee, seen: Set<string>): React.ReactNode => {
    if (seen.has(p.email)) return null;
    const next = new Set(seen).add(p.email);
    const reports = reportsOf(p.email);
    return (
      <li key={p.id}>
        <button className="orgcard" onClick={() => ctx.openPerson(p.id)}>
          <span className="avatar">{initials(p.name)}</span>
          <span><b>{p.name}</b><br /><span className="small muted">{[p.title, p.department].filter(Boolean).join(", ")}{reports.length ? ` · ${reports.length} ${reports.length === 1 ? "report" : "reports"}` : ""}</span></span>
        </button>
        {reports.length > 0 && <ul>{reports.map((r) => node(r, next))}</ul>}
      </li>
    );
  };

  return (
    <main className="view">
      <div className="viewhead"><h1>Org chart</h1><span className="muted">{people.length} people</span></div>
      <div className="viewbody org">
        {people.length ? <ul>{roots.map((r) => node(r, new Set()))}</ul> : <p className="empty">Nobody here yet.</p>}
      </div>
    </main>
  );
}
