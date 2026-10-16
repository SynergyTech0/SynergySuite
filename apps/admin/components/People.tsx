"use client";
// People: everyone with a suite account, from the sign-in service. Add people and block or allow sign-in.
import { ExternalLink, Search, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Directory, Person } from "@/lib/directory";
import { api, formatDate } from "./client";
import { Confirm, Modal } from "./Modal";
import { Avatar, Badge, Facts, type AppCtx } from "./shared";

export function People({ app }: { app: AppCtx }) {
  const [d, setD] = useState<Directory | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "blocked">("all");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Person | null>(null);
  const [confirm, setConfirm] = useState<Person | null>(null);

  const load = useCallback(() => {
    void api<Directory>("/api/people").then(setD).catch((e) => app.say(e.message));
  }, [app]);
  useEffect(load, [load]);

  if (d && !d.configured) {
    return (
      <div className="page" style={{ maxWidth: 820 }}>
        <h1>People</h1>
        <div className="notice">
          <div>
            <p><strong>Connect the Admin center to the sign-in service to see and manage people.</strong></p>
            <p>1. Open the <a className="link" href={app.authConsole} target="_blank" rel="noreferrer">sign-in console</a>, go to Settings and mint a SCIM token (it is shown once).</p>
            <p>2. Give it to the Admin center and restart it:</p>
            <pre>ADMIN_SCIM_TOKEN=sascim_…</pre>
            <p className="small">Contacts&apos; <code>DIRECTORY_SCIM_TOKEN</code> works too. Without a token, eDiscovery still works: type custodians&apos; email addresses by hand.</p>
          </div>
        </div>
      </div>
    );
  }

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (d?.configured ? d.people : []).filter((p) =>
    (filter === "all" || (filter === "active") === p.active) && words.every((w) => `${p.name} ${p.email}`.toLowerCase().includes(w)),
  );

  const toggle = async (p: Person) => {
    try {
      const next = await api<Person>(`/api/people/${encodeURIComponent(p.id)}`, { method: "PATCH", json: { active: !p.active } });
      app.say(next.active ? `${p.email} can sign in again` : `${p.email} can no longer sign in`);
      if (open?.id === p.id) setOpen(next);
      load();
    } catch (e) {
      app.say((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>People {d?.configured ? <span className="muted" style={{ fontWeight: 400 }}>({d.total})</span> : null}</h1>
          <p className="muted">Accounts in the sign-in service. Multi-factor sign-in and password resets are in its <a className="link" href={app.authConsole} target="_blank" rel="noreferrer">console <ExternalLink size={12} /></a>.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><UserPlus size={16} /> Add a person</button>
      </div>
      {d?.configured && d.error ? <div className="notice danger"><div><p>{d.error}</p></div></div> : null}
      <div className="toolbar">
        <label className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search people" /></label>
        <div className="seg" role="group" aria-label="Show">
          {(["all", "active", "blocked"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "Everyone" : f === "active" ? "Can sign in" : "Blocked"}</button>
          ))}
        </div>
      </div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {!d ? <tr><td colSpan={4} className="muted">Loading…</td></tr>
                : !list.length ? <tr><td colSpan={4} className="muted">{q ? "Nobody matches." : "Nobody here yet."}</td></tr>
                : list.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setOpen(p)}>
                    <td>
                      <div className="who">
                        <Avatar name={p.name || p.email} />
                        <div className="cellstack">
                          <span className="rname">{p.name || p.email}{p.email === app.me.email ? " (you)" : ""}</span>
                          {p.name ? <span className="rsub">{p.email}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>{p.active ? <Badge tone="green">Can sign in</Badge> : <Badge tone="red">Blocked</Badge>}</td>
                    <td className="muted nowrap">{formatDate(p.created)}</td>
                    <td className="num">
                      <button className="btn small" disabled={p.email === app.me.email && p.active} onClick={(e) => { e.stopPropagation(); if (p.active) setConfirm(p); else void toggle(p); }}>
                        {p.active ? "Block sign-in" : "Allow sign-in"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {open ? (
        <Modal title={open.name || open.email} onClose={() => setOpen(null)}>
          <div className="form">
            <Facts items={[
              ["Email", open.email],
              ["Name", open.name],
              ["Sign-in", open.active ? <Badge tone="green">Allowed</Badge> : <Badge tone="red">Blocked</Badge>],
              ["Added", formatDate(open.created)],
              ["Account id", <code key="id">{open.id}</code>],
            ]} />
            <p className="muted small">Holds this person is a custodian of are under <a className="link" href="#/holds" onClick={() => setOpen(null)}>Holds</a>.</p>
            <div className="actions">
              <a className="btn" href={app.authConsole} target="_blank" rel="noreferrer">Open in sign-in console <ExternalLink size={14} /></a>
              <button className={`btn ${open.active ? "danger" : "primary"}`} disabled={open.email === app.me.email && open.active} onClick={() => (open.active ? setConfirm(open) : toggle(open))}>
                {open.active ? "Block sign-in" : "Allow sign-in"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {confirm ? (
        <Confirm
          title="Block sign-in?"
          danger
          action="Block sign-in"
          message={<><strong>{confirm.email}</strong> will be signed out everywhere and can&apos;t sign in until you allow it again. Their content stays as it is.</>}
          onConfirm={() => toggle(confirm)}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {adding ? <AddPerson onClose={() => setAdding(false)} onAdded={(p) => { setAdding(false); app.say(`${p.email} added`); load(); }} /> : null}
    </div>
  );
}

function AddPerson({ onClose, onAdded }: { onClose: () => void; onAdded: (p: Person) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a person" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            onAdded(await api<Person>("/api/people", {
              method: "POST",
              json: { email: f.get("email"), name: f.get("name"), password: f.get("password") || undefined, active: f.get("active") === "on" },
            }));
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label><span>Name</span><input name="name" autoFocus placeholder="Jane Doe" /></label>
        <label><span>Email address (they sign in with it)</span><input name="email" type="email" required placeholder="jane@example.com" /></label>
        <label>
          <span>Initial password (optional)</span>
          <input name="password" type="password" autoComplete="new-password" placeholder="At least 12 characters, a letter and a digit" />
        </label>
        <p className="muted small">Leave it blank and they set their own with &quot;Forgot password&quot; on the sign-in page.</p>
        <label className="check"><input type="checkbox" name="active" defaultChecked /> Can sign in now</label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}
