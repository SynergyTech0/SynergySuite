"use client";
// Move from Microsoft 365: connect a tenant (or an IMAP server), see who and what is there, map
// people to suite accounts, and copy their mail, files, calendar, contacts and tasks across, with
// a final sync at cutover that copies only what changed.
import { Download, Play, Plug, Plus, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  USER_WORKLOADS, WORKLOAD_LABEL, type JobSummary, type MigrationUser, type SourceDetail, type SourceSummary, type Workload,
} from "@/lib/migrate/types";
import { api, formatDateTime, formatSize, plural } from "./client";
import { Confirm, Modal } from "./Modal";
import { Badge, Facts, type AppCtx } from "./shared";

const PERMISSIONS: [string, string][] = [
  ["User.Read.All", "list the tenant's people"],
  ["Mail.Read", "read every mailbox (raw messages)"],
  ["Calendars.Read", "read calendars"],
  ["Contacts.Read", "read contacts"],
  ["Files.Read.All", "read OneDrive files"],
  ["Sites.Read.All", "read SharePoint sites and their libraries"],
  ["Tasks.Read.All", "read To Do lists and tasks"],
  ["GroupMember.Read.All", "bring SharePoint site members across (optional)"],
  ["Reports.Read.All", "show mailbox sizes (optional)"],
];

export function EntraSteps() {
  return (
    <details className="help">
      <summary>How to register the app in Microsoft Entra (5 minutes, done by the customer&apos;s admin)</summary>
      <ol className="steps">
        <li>Sign in to <strong>entra.microsoft.com</strong> as a Global Administrator, open <strong>Applications &gt; App registrations</strong> and choose <strong>New registration</strong>. Name it &quot;Synergy migration&quot;, keep &quot;Accounts in this organizational directory only&quot;, leave the redirect URI empty and register.</li>
        <li>On its overview page, copy the <strong>Application (client) ID</strong> and the <strong>Directory (tenant) ID</strong>.</li>
        <li>Open <strong>API permissions &gt; Add a permission &gt; Microsoft Graph &gt; Application permissions</strong> and add these (all read-only):
          <ul>{PERMISSIONS.map(([p, why]) => <li key={p}><code>{p}</code>: {why}</li>)}</ul>
        </li>
        <li>Choose <strong>Grant admin consent for</strong> your organization and confirm; every permission should show a green tick.</li>
        <li>Open <strong>Certificates &amp; secrets &gt; New client secret</strong>, give it an expiry that covers the project (say 6 months), and copy its <strong>Value</strong> (not the Secret ID). It is shown only once.</li>
        <li>Paste the three values below. They are tested at once; the secret is stored encrypted and never shown again. Delete the app registration when the move is finished.</li>
      </ol>
    </details>
  );
}

const STATUS_TONE: Record<string, string> = { queued: "blue", running: "amber", done: "green", failed: "red", cancelled: "" };

function JobBadge({ j }: { j: JobSummary | null }) {
  if (!j) return <span className="muted">Not copied</span>;
  const done = Object.values(j.progress.done ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const failed = Object.values(j.report.counts).reduce((a, c) => a + (c?.failed ?? 0), 0);
  return (
    <span className="cellstack">
      <span>
        <Badge tone={STATUS_TONE[j.status]}>{j.status === "done" ? "Copied" : j.status[0].toUpperCase() + j.status.slice(1)}</Badge>
        {failed ? <> <Badge tone="red">{plural(failed, "error")}</Badge></> : null}
      </span>
      <span className="rsub">
        {j.status === "running" ? `${j.progress.workload ? WORKLOAD_LABEL[j.progress.workload] : ""} ${j.progress.step ?? ""} · ${done.toLocaleString()} items`
          : j.status === "queued" && j.error ? j.error
          : j.finishedAt ? formatDateTime(j.finishedAt) : ""}
      </span>
    </span>
  );
}

// ---------- the list of sources ----------

export function Migrate({ app, id, tab }: { app: AppCtx; id: string | null; tab: string | null }) {
  if (id) return <SourceView key={id} app={app} id={id} tab={tab} />;
  return <Sources app={app} />;
}

function Sources({ app }: { app: AppCtx }) {
  const [list, setList] = useState<{ sources: SourceSummary[]; keyConfigured: boolean } | null>(null);
  const [adding, setAdding] = useState<"m365" | "imap" | null>(null);
  const load = useCallback(() => void api<{ sources: SourceSummary[]; keyConfigured: boolean }>("/api/migrate").then(setList).catch((e) => app.say(e.message)), [app]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Move from Microsoft 365</h1>
          <p className="muted">Copy people&apos;s mail, OneDrive, calendars, contacts and To Do, and SharePoint libraries, into the suite. Run it as often as you like: each run copies only what changed.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setAdding("imap")}><Plus size={16} /> Another IMAP server</button>
          <button className="btn primary" onClick={() => setAdding("m365")}><Plug size={16} /> Connect Microsoft 365</button>
        </div>
      </div>
      {list && !list.keyConfigured ? (
        <div className="notice danger"><div><p>Set <code>MIGRATION_ENCRYPTION_KEY</code> (<code>openssl rand -base64 32</code>) and restart the Admin center before connecting a source: secrets are stored encrypted with it.</p></div></div>
      ) : null}
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Source</th><th>People</th><th>Sites</th><th>Copies</th><th>Discovered</th></tr></thead>
            <tbody>
              {!list ? <tr><td colSpan={5} className="muted">Loading…</td></tr>
                : !list.sources.length ? <tr><td colSpan={5} className="muted">Nothing connected yet. Start with &quot;Connect Microsoft 365&quot;.</td></tr>
                : list.sources.map((s) => (
                  <tr key={s.id} className="click" onClick={() => app.go({ view: "migrate", id: s.id })}>
                    <td>
                      <div className="cellstack">
                        <span className="rname">{s.name}</span>
                        <span className="rsub">{s.kind === "m365" ? `Microsoft 365 · tenant ${s.config.tenantId}` : `IMAP · ${s.config.host}:${s.config.port}`}</span>
                      </div>
                    </td>
                    <td>{s.userCount ? `${s.mapped} of ${s.userCount} mapped` : "—"}</td>
                    <td>{s.kind === "m365" ? s.siteCount : "—"}</td>
                    <td>
                      {s.jobCounts.running ? <Badge tone="amber">{s.jobCounts.running} running</Badge> : null}{" "}
                      {s.jobCounts.queued ? <Badge tone="blue">{s.jobCounts.queued} queued</Badge> : null}{" "}
                      {s.jobCounts.failed ? <Badge tone="red">{s.jobCounts.failed} failed</Badge> : null}{" "}
                      {s.jobCounts.done ? <Badge tone="green">{s.jobCounts.done} done</Badge> : null}
                    </td>
                    <td className="muted nowrap">{s.discoveryError ? <Badge tone="red">Failed</Badge> : formatDateTime(s.discoveredAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h3>Before you start</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Copying reads only: nothing in Microsoft 365 is changed or deleted.</li>
          <li>Not copied yet: Teams chats, OneNote notebooks, Planner plans, mailbox rules and signatures. Each person&apos;s report lists what was skipped and why.</li>
          <li>At cutover: point the domain&apos;s MX record at the suite, wait for mail to arrive here, then run every person again for a final sync.</li>
        </ul>
      </section>
      {adding ? <AddSource kind={adding} onClose={() => setAdding(null)} onAdded={(s) => { setAdding(null); app.say(`${s.name} connected`); app.go({ view: "migrate", id: s.id }); }} /> : null}
    </div>
  );
}

function AddSource({ kind, onClose, onAdded }: { kind: "m365" | "imap"; onClose: () => void; onAdded: (s: SourceSummary) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={kind === "m365" ? "Connect Microsoft 365" : "Add an IMAP server"} onClose={onClose} wide={kind === "m365"}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget).entries());
          setBusy(true);
          setError("");
          try {
            onAdded(await api<SourceSummary>("/api/migrate", { method: "POST", json: kind === "m365" ? { kind, ...f } : { kind, ...f, port: Number(f.port), secure: f.secure === "on" } }));
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind === "m365" ? (
          <>
            <EntraSteps />
            <label><span>Name</span><input name="name" placeholder="Contoso" /></label>
            <label><span>Directory (tenant) ID</span><input name="tenantId" required autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" /></label>
            <label><span>Application (client) ID</span><input name="clientId" required autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" /></label>
            <label><span>Client secret value</span><input name="clientSecret" type="password" required autoComplete="new-password" /></label>
          </>
        ) : (
          <>
            <p className="muted small">For mailboxes that aren&apos;t in Microsoft 365: Google Workspace, another host, an old mail server. You add each mailbox with its login next.</p>
            <label><span>Name</span><input name="name" placeholder="Old mail host" /></label>
            <label><span>IMAP server</span><input name="host" required placeholder="imap.example.com" /></label>
            <label><span>Port</span><input name="port" type="number" defaultValue={993} /></label>
            <label className="check"><input type="checkbox" name="secure" defaultChecked /> TLS from the start (port 993); otherwise STARTTLS</label>
          </>
        )}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? (kind === "m365" ? "Testing the connection…" : "Adding…") : kind === "m365" ? "Connect" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- one source ----------

function SourceView({ app, id, tab }: { app: AppCtx; id: string; tab: string | null }) {
  const [d, setD] = useState<SourceDetail | null>(null);
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [siteSel, setSiteSel] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState<"people" | "sites" | null>(null);
  const [report, setReport] = useState<JobSummary | null>(null);
  const [addingBox, setAddingBox] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [filter, setFilter] = useState("");
  const [domain, setDomain] = useState("");
  const view = tab === "sites" || tab === "copies" ? tab : "people";

  const load = useCallback(() => void api<SourceDetail>(`/api/migrate/${id}`).then(setD).catch((e) => app.say(e.message)), [app, id]);
  useEffect(load, [load]);
  const active = d?.jobs.some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      if (ok) app.say(ok);
      load();
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const users = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (d?.users ?? []).filter((u) => words.every((w) => `${u.name} ${u.email} ${u.target ?? ""}`.toLowerCase().includes(w)));
  }, [d, filter]);

  if (!d) return <div className="page"><p className="muted">Loading…</p></div>;
  const m365 = d.kind === "m365";
  const chosen = [...sel].filter((x) => d.users.some((u) => u.extId === x));

  const setTarget = (u: MigrationUser, target: string) => {
    const t = target.trim().toLowerCase();
    if (t === (u.target ?? "")) return;
    void run("map", () => api(`/api/migrate/${id}/map`, { method: "POST", json: { mappings: [{ extId: u.extId, target: t || null }] } }));
  };
  const mapAll = () => {
    const dom = domain.trim().replace(/^@/, "").toLowerCase();
    const mappings = d.users.filter((u) => !u.target && (chosen.length ? sel.has(u.extId) : true))
      .map((u) => ({ extId: u.extId, target: dom ? `${u.email.split("@")[0]}@${dom}` : u.email }));
    if (!mappings.length) return app.say("Everyone shown already has a suite account picked");
    void run("map", () => api(`/api/migrate/${id}/map`, { method: "POST", json: { mappings } }), `${plural(mappings.length, "person", "people")} mapped`);
  };

  return (
    <div className="page">
      <div className="crumbs"><a href="#/migrate">Move from Microsoft 365</a> <span>/</span> <span>{d.name}</span></div>
      <div className="pagehead">
        <div>
          <h1>{d.name}</h1>
          <p className="muted">{m365 ? `Microsoft 365 tenant ${d.config.tenantId}` : `IMAP server ${d.config.host}:${d.config.port}`} · {d.discoveredAt ? `discovered ${formatDateTime(d.discoveredAt)}` : "not discovered yet"}</p>
        </div>
        <div className="toolbar">
          <button className="btn" disabled={!!busy} onClick={() => run("discover", () => api(`/api/migrate/${id}/discover`, { method: "POST", json: {} }), m365 ? "Discovery finished" : "Logins checked")}>
            <RefreshCw size={16} className={busy === "discover" ? "spin" : ""} /> {busy === "discover" ? "Reading…" : m365 ? "Discover" : "Check logins"}
          </button>
          <button className="btn ghost" onClick={() => setRemoving(true)}><Trash2 size={16} /> Remove</button>
        </div>
      </div>
      {d.discoveryError ? <div className="notice danger"><div><p>{d.discoveryError}</p></div></div> : null}
      {d.notes.length ? <div className="notice warn"><div>{d.notes.map((n) => <p key={n}>{n}</p>)}</div></div> : null}
      {!d.discoveredAt && m365 ? <div className="notice"><div><p>Choose <strong>Discover</strong> to read the tenant&apos;s people, mailbox and OneDrive sizes, and SharePoint sites.</p></div></div> : null}

      <nav className="tabs">
        <a href={`#/migrate/${id}/people`} className={view === "people" ? "on" : ""}>People <span className="count">{d.users.length}</span></a>
        {m365 ? <a href={`#/migrate/${id}/sites`} className={view === "sites" ? "on" : ""}>SharePoint sites <span className="count">{d.sites.length}</span></a> : null}
        <a href={`#/migrate/${id}/copies`} className={view === "copies" ? "on" : ""}>Copies <span className="count">{d.jobs.length}</span></a>
      </nav>

      {view === "people" ? (
        <>
          <div className="toolbar">
            <label className="search"><Search size={16} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search people" aria-label="Search people" /></label>
            <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Suite domain, e.g. example.com" aria-label="Suite domain for new addresses" />
            <button className="btn" disabled={!!busy} onClick={mapAll} title="Pick a suite address for everyone not mapped yet: the same name at this domain (or the same address when it's empty)">Map unmapped</button>
            <span className="grow" />
            {!m365 ? <button className="btn" onClick={() => setAddingBox(true)}><Plus size={16} /> Add mailbox</button> : null}
            <button className="btn" disabled={!!busy || !d.directory} title={d.directory ? "Create suite accounts and mailboxes for the chosen people who don't have one" : "Set ADMIN_SCIM_TOKEN to create accounts"}
              onClick={() => run("accounts", async () => {
                const r = await api<{ created: string[]; existed: string[]; failed: { email: string; error: string }[] }>(`/api/migrate/${id}/accounts`, { method: "POST", json: { extIds: chosen } });
                app.say(`${plural(r.created.length, "account")} created${r.failed.length ? `; ${r.failed.length} failed: ${r.failed[0].email}: ${r.failed[0].error}` : ""}`);
              })}>
              <UserPlus size={16} /> Create missing accounts
            </button>
            <button className="btn primary" disabled={!chosen.length} onClick={() => setCopying("people")}><Play size={16} /> Copy {chosen.length ? chosen.length : ""}</button>
          </div>
          <section className="panel flush">
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Choose everyone shown" checked={users.length > 0 && users.every((u) => sel.has(u.extId))} onChange={(e) => setSel(e.target.checked ? new Set(users.map((u) => u.extId)) : new Set())} /></th>
                    <th>{m365 ? "Microsoft 365 user" : "Mailbox"}</th><th className="num">Mailbox</th>{m365 ? <th className="num">OneDrive</th> : null}<th>Moves to</th><th>Last copy</th>
                  </tr>
                </thead>
                <tbody>
                  {!users.length ? <tr><td colSpan={6} className="muted">{m365 ? "Nobody yet: run Discover." : "Add each mailbox to copy."}</td></tr> : users.map((u) => (
                    <tr key={u.extId} className={sel.has(u.extId) ? "sel" : ""}>
                      <td><input type="checkbox" aria-label={`Choose ${u.email}`} checked={sel.has(u.extId)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(u.extId); else n.delete(u.extId); setSel(n); }} /></td>
                      <td>
                        <div className="cellstack">
                          <span className="rname">{u.name || u.email} {!u.enabled ? <Badge>Sign-in blocked</Badge> : null}</span>
                          {u.name ? <span className="rsub">{u.email}</span> : null}
                        </div>
                      </td>
                      <td className="num nowrap">{u.hasMailbox === false ? <span className="muted">None</span> : u.mailBytes !== null ? formatSize(u.mailBytes) : u.mailItems !== null ? plural(u.mailItems, "item") : "—"}</td>
                      {m365 ? <td className="num nowrap">{u.hasDrive === false ? <span className="muted">None</span> : formatSize(u.driveBytes)}</td> : null}
                      <td>
                        <div className="cellstack">
                          <input className="inline" key={u.target ?? ""} defaultValue={u.target ?? ""} placeholder="name@yourdomain" aria-label={`Suite account for ${u.email}`}
                            onBlur={(e) => setTarget(u, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                          {u.target && u.targetExists === false ? <span className="rsub">No account yet</span> : null}
                        </div>
                      </td>
                      <td>
                        <JobBadge j={u.lastJob} />
                        {u.lastJob && u.lastJob.status !== "queued" && u.lastJob.status !== "running" ? <> <button className="linkbtn small" onClick={() => setReport(u.lastJob)}>Report</button></> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="muted small">Copy again at any time: it brings across only what changed since the last copy (new mail, edited files, read and flag changes, deletions). Do it once more right after the MX change.</p>
        </>
      ) : null}

      {view === "sites" ? (
        <>
          <div className="toolbar">
            <span className="muted small">Each site&apos;s document libraries become shared libraries in Drive, owned by you at first, with the site&apos;s owners and members who have suite accounts.</span>
            <span className="grow" />
            <button className="btn primary" disabled={!siteSel.size} onClick={() => setCopying("sites")}><Play size={16} /> Copy {siteSel.size || ""}</button>
          </div>
          <section className="panel flush">
            <div className="tablewrap">
              <table className="table">
                <thead><tr><th /><th>Site</th><th className="num">Size</th><th>Members</th><th>Last copy</th></tr></thead>
                <tbody>
                  {!d.sites.length ? <tr><td colSpan={5} className="muted">No sites found.</td></tr> : d.sites.map((s) => (
                    <tr key={s.siteId}>
                      <td><input type="checkbox" aria-label={`Choose ${s.name}`} checked={siteSel.has(s.siteId)} onChange={(e) => { const n = new Set(siteSel); if (e.target.checked) n.add(s.siteId); else n.delete(s.siteId); setSiteSel(n); }} /></td>
                      <td><div className="cellstack"><span className="rname">{s.name}</span><span className="rsub">{s.url}</span></div></td>
                      <td className="num nowrap">{formatSize(s.driveBytes)}{s.libraries && s.libraries > 1 ? <span className="rsub">{s.libraries} libraries</span> : null}</td>
                      <td className="small">{s.members.length ? `${s.members.filter((m) => m.role === "owner").length} owners, ${s.members.filter((m) => m.role === "member").length} members` : <span className="muted">Not a group site</span>}</td>
                      <td><JobBadge j={s.lastJob} />{s.lastJob && s.lastJob.status !== "queued" && s.lastJob.status !== "running" ? <> <button className="linkbtn small" onClick={() => setReport(s.lastJob)}>Report</button></> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {view === "copies" ? (
        <section className="panel flush">
          <div className="tablewrap">
            <table className="table">
              <thead><tr><th>Who</th><th>Into</th><th>What</th><th>Status</th><th>Started</th><th /></tr></thead>
              <tbody>
                {!d.jobs.length ? <tr><td colSpan={6} className="muted">Nothing copied yet.</td></tr> : d.jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="rname">{j.label}</td>
                    <td className="small">{j.subjectKind === "site" ? "Shared library" : j.target}</td>
                    <td className="small">{j.workloads.map((w) => WORKLOAD_LABEL[w]).join(", ")}</td>
                    <td><JobBadge j={j} /></td>
                    <td className="muted nowrap small">{formatDateTime(j.startedAt ?? j.createdAt)}</td>
                    <td className="num nowrap">
                      {j.status === "queued" || j.status === "running"
                        ? <button className="btn small" onClick={() => run("cancel", () => api(`/api/migrate/jobs/${j.id}`, { method: "POST", json: { action: "cancel" } }), "Cancelled")}>Cancel</button>
                        : <>
                          <button className="btn small" onClick={() => setReport(j)}>Report</button>{" "}
                          <button className="btn small" title="Copy only what changed since" onClick={() => run("rerun", () => api(`/api/migrate/jobs/${j.id}`, { method: "POST", json: { action: "rerun" } }), "Queued: only changes will be copied")}><RefreshCw size={14} /> Sync changes</button>
                        </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {copying ? (
        <StartCopy kind={copying} m365={m365} count={copying === "people" ? chosen.length : siteSel.size} onClose={() => setCopying(null)}
          onStart={async (workloads) => {
            const r = await api<{ queued: JobSummary[]; skipped: string[] }>(`/api/migrate/${id}/start`, {
              method: "POST", json: copying === "people" ? { extIds: chosen, workloads } : { siteIds: [...siteSel] },
            });
            app.say(`${plural(r.queued.length, "copy", "copies")} queued${r.skipped.length ? `; ${r.skipped.length} skipped (${r.skipped[0]})` : ""}`);
            setCopying(null);
            app.go({ view: "migrate", id, tab: "copies" });
            load();
          }} />
      ) : null}
      {report ? <ReportView job={report} onClose={() => setReport(null)} /> : null}
      {addingBox ? <AddMailbox id={id} onClose={() => setAddingBox(false)} onAdded={() => { setAddingBox(false); load(); }} /> : null}
      {removing ? (
        <Confirm title="Remove this source?" danger action="Remove"
          message={<>The connection, its discovery and its copy history go. What was already copied stays in the suite. A copy run later starts from scratch.</>}
          onConfirm={async () => { try { await api(`/api/migrate/${id}`, { method: "DELETE" }); app.go({ view: "migrate" }); } catch (e) { app.say((e as Error).message); } }}
          onClose={() => setRemoving(false)} />
      ) : null}
    </div>
  );
}

function StartCopy({ kind, m365, count, onClose, onStart }: { kind: "people" | "sites"; m365: boolean; count: number; onClose: () => void; onStart: (w: Workload[]) => Promise<void> }) {
  const [w, setW] = useState<Set<Workload>>(new Set(m365 ? USER_WORKLOADS : ["mail"]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={kind === "people" ? `Copy ${plural(count, "person", "people")}` : `Copy ${plural(count, "site")}`} onClose={onClose}>
      <div className="form">
        {kind === "people" && m365 ? (
          <fieldset>
            <legend>What to copy</legend>
            {USER_WORKLOADS.map((x) => (
              <label className="check" key={x}><input type="checkbox" checked={w.has(x)} onChange={(e) => { const n = new Set(w); if (e.target.checked) n.add(x); else n.delete(x); setW(n); }} /> {WORKLOAD_LABEL[x]}</label>
            ))}
          </fieldset>
        ) : null}
        <p className="muted small">Copies run in the background, a few at a time; you can close this page. Someone copied before gets only what changed since.</p>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (kind === "people" && !w.size)} onClick={async () => {
            setBusy(true);
            try {
              await onStart([...w]);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}>Start</button>
        </div>
      </div>
    </Modal>
  );
}

function ReportView({ job, onClose }: { job: JobSummary; onClose: () => void }) {
  const r = job.report;
  return (
    <Modal title={`Report: ${job.label}`} onClose={onClose} wide>
      <div className="form">
        <Facts items={[
          ["Into", job.subjectKind === "site" ? "Shared library" : job.target],
          ["Status", job.status],
          ["Started", formatDateTime(job.startedAt)],
          ["Finished", formatDateTime(job.finishedAt)],
          ["Throttled by Microsoft", r.throttled ? `${r.throttled} times (waited as asked)` : "No"],
        ]} />
        {job.error ? <div className="notice danger"><div><p>{job.error}</p></div></div> : null}
        <table className="table">
          <thead><tr><th>What</th><th className="num">Copied</th><th className="num">Updated</th><th className="num">Deleted</th><th className="num">Skipped</th><th className="num">Errors</th></tr></thead>
          <tbody>
            {([...USER_WORKLOADS, "library"] as Workload[]).filter((w) => r.counts[w]).map((w) => {
              const c = r.counts[w]!;
              return <tr key={w}><td>{WORKLOAD_LABEL[w]}</td><td className="num">{c.copied}</td><td className="num">{c.updated}</td><td className="num">{c.deleted}</td><td className="num">{c.skipped}</td><td className="num">{c.failed}</td></tr>;
            })}
          </tbody>
        </table>
        {r.skipped.length ? (
          <details className="help"><summary>Skipped ({r.skipped.length})</summary><ul>{r.skipped.map((s, i) => <li key={i}><strong>{WORKLOAD_LABEL[s.workload]}</strong>: {s.item}: {s.reason}</li>)}</ul></details>
        ) : null}
        {r.errors.length ? (
          <details className="help" open><summary>Errors ({r.errors.length}); a copy run again tries them again</summary><ul>{r.errors.map((s, i) => <li key={i}><strong>{WORKLOAD_LABEL[s.workload]}</strong>: {s.item}: {s.error}</li>)}</ul></details>
        ) : null}
        {r.notMigrated.length ? <p className="muted small">Not migrated yet: {r.notMigrated.join("; ")}.</p> : null}
        <div className="actions">
          <a className="btn" href={`/api/migrate/jobs/${job.id}/report`}><Download size={16} /> Download CSV</a>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function AddMailbox({ id, onClose, onAdded }: { id: string; onClose: () => void; onAdded: () => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="Add a mailbox" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/migrate/${id}/mailbox`, { method: "POST", json: Object.fromEntries(new FormData(e.currentTarget).entries()) });
          onAdded();
        } catch (x) {
          setError((x as Error).message);
        }
      }}>
        <label><span>Login (usually the email address)</span><input name="login" required autoComplete="off" /></label>
        <label><span>Password or app password</span><input name="password" type="password" required autoComplete="new-password" /></label>
        <label><span>Name (optional)</span><input name="name" /></label>
        <label><span>Moves to (suite account)</span><input name="target" type="email" placeholder="name@yourdomain" /></label>
        <p className="muted small">The password is stored encrypted and used only to read this mailbox. Google and Microsoft accounts with two-step sign-in need an app password.</p>
        <p className="error" role="alert">{error}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Add</button></div>
      </form>
    </Modal>
  );
}
