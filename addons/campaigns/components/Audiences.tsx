"use client";
// Audiences: the lists, and one list's people, imports (CSV, CRM, Contacts), segments, signup
// form and settings, each on its own tab (#/audiences/<id>/<tab>).
import { ArrowLeft, Download, Plus, RefreshCw, Trash2, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Audience, AudienceSource, Condition, Rules, Segment, Subscriber } from "@/lib/types";
import { label } from "@/lib/types";
import { api, formatDate, formatDateTime, num, type AppCtx } from "./client";
import { Modal } from "./Modal";

export function AudiencesView({ ctx, id, tab }: { ctx: AppCtx; id: string | null; tab: string | null }) {
  if (id) return <AudienceDetail ctx={ctx} id={id} tab={tab ?? "people"} />;
  return <AudienceList ctx={ctx} />;
}

function AudienceList({ ctx }: { ctx: AppCtx }) {
  const [list, setList] = useState<Audience[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<Audience[]>("/api/audiences").then(setList).catch((e) => ctx.say(e.message));
  }, [ctx]);
  return (
    <div className="page">
      <div className="pagehead">
        <h1>Audiences</h1>
        {ctx.canEdit && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New audience</button>}
      </div>
      {!list ? (
        <div className="empty">Loading…</div>
      ) : !list.length ? (
        <div className="empty"><Users size={28} /><p>No audiences yet. An audience is a list of people you email: import them from CRM, Contacts or a spreadsheet, or let them sign up.</p></div>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th className="num">Subscribed</th><th className="num">Pending</th><th className="num">Unsubscribed</th><th className="num">Cleaned</th><th>Updated</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="click" onClick={() => ctx.go({ view: "audiences", id: a.id })}>
                <td><strong>{a.name}</strong>{a.description && <div className="rsub">{a.description}</div>}</td>
                <td className="num">{num(a.counts.subscribed)}</td>
                <td className="num">{num(a.counts.pending)}</td>
                <td className="num">{num(a.counts.unsubscribed)}</td>
                <td className="num">{num(a.counts.cleaned)}</td>
                <td>{formatDate(a.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <Modal title="New audience" onClose={() => setCreating(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const a = await api<Audience>("/api/audiences", { method: "POST", json: { name: f.get("name"), description: f.get("description") } });
                ctx.go({ view: "audiences", id: a.id, tab: "import" });
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            <label><span>Name</span><input name="name" required autoFocus maxLength={120} placeholder="Newsletter" /></label>
            <label><span>Description (optional)</span><input name="description" maxLength={500} /></label>
            <p className="error">{err}</p>
            <div className="actions"><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary">Create</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

type Detail = { audience: Audience; tags: string[]; fields: string[]; segments: Segment[]; sources: AudienceSource[]; formUrl: string };

const TABS = [["people", "People"], ["import", "Import"], ["segments", "Segments"], ["form", "Signup form"], ["settings", "Settings"]] as const;

function AudienceDetail({ ctx, id, tab }: { ctx: AppCtx; id: string; tab: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const load = useCallback(() => {
    void api<Detail>(`/api/audiences/${id}`).then(setD).catch((e) => ctx.say(e.message));
  }, [id, ctx]);
  useEffect(load, [load]);
  if (!d) return <div className="empty">Loading…</div>;
  const a = d.audience;
  return (
    <div className="page">
      <div className="pagehead">
        <div className="toolbar">
          <button className="btn ghost" onClick={() => ctx.go({ view: "audiences" })}><ArrowLeft size={16} /> Audiences</button>
          <h1>{a.name}</h1>
        </div>
        <span className="muted small">{num(a.counts.subscribed)} subscribed · {num(a.counts.pending)} pending · {num(a.counts.unsubscribed)} unsubscribed · {num(a.counts.cleaned)} cleaned</span>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([t, text]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => ctx.go({ view: "audiences", id, tab: t })}>{text}</button>
        ))}
      </div>
      {tab === "people" && <People ctx={ctx} d={d} reload={load} />}
      {tab === "import" && <Import ctx={ctx} d={d} reload={load} />}
      {tab === "segments" && <Segments ctx={ctx} d={d} reload={load} />}
      {tab === "form" && <FormTab ctx={ctx} d={d} reload={load} />}
      {tab === "settings" && <AudienceSettings ctx={ctx} d={d} reload={load} />}
    </div>
  );
}

function People({ ctx, d, reload }: { ctx: AppCtx; d: Detail; reload: () => void }) {
  const [f, setF] = useState({ q: "", status: "", tag: "" });
  const [page, setPage] = useState<{ items: Subscriber[]; total: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<{ items: Subscriber[]; total: number }>(`/api/audiences/${d.audience.id}/subscribers?${new URLSearchParams({ ...f, offset: String(offset) })}`)
        .then((r) => { setPage(r); setSel(new Set()); })
        .catch((e) => ctx.say(e.message));
    }, 200);
    return () => window.clearTimeout(t);
  }, [d.audience.id, f, offset, version, ctx]);

  const bulk = async (action: string) => {
    let tags: string | null = null;
    if (action !== "delete") {
      tags = prompt(action === "tag" ? "Tag to add" : "Tag to remove");
      if (!tags) return;
    } else if (!confirm(`Remove ${sel.size} ${sel.size === 1 ? "person" : "people"} from this audience? Past reports keep their numbers.`)) return;
    try {
      await api(`/api/audiences/${d.audience.id}/subscribers/bulk`, { method: "POST", json: { action, ids: [...sel], tags } });
      setVersion((v) => v + 1);
      reload();
    } catch (e) {
      ctx.say((e as Error).message);
    }
  };

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search name, email or company" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setOffset(0); }} style={{ minWidth: 260 }} />
        <select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setOffset(0); }}>
          <option value="">Any status</option>
          {["subscribed", "pending", "unsubscribed", "cleaned"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <select value={f.tag} onChange={(e) => { setF({ ...f, tag: e.target.value }); setOffset(0); }}>
          <option value="">Any tag</option>
          {d.tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="grow" />
        {ctx.canEdit && sel.size > 0 && (
          <>
            <span className="small muted">{sel.size} selected</span>
            <button className="btn small" onClick={() => bulk("tag")}>Add tag</button>
            <button className="btn small" onClick={() => bulk("untag")}>Remove tag</button>
            <button className="btn small" onClick={() => bulk("delete")}><Trash2 size={14} /> Remove</button>
          </>
        )}
        {ctx.canEdit && <a className="btn small" href={`/api/audiences/${d.audience.id}/export`}><Download size={14} /> Export</a>}
        {ctx.canEdit && <button className="btn small primary" onClick={() => setAdding(true)}><Plus size={14} /> Add person</button>}
      </div>
      {!page ? (
        <div className="empty">Loading…</div>
      ) : !page.items.length ? (
        <div className="empty"><p>Nobody here{f.q || f.status || f.tag ? " matches" : " yet"}.</p></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {ctx.canEdit && <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={sel.size === page.items.length} onChange={(e) => setSel(e.target.checked ? new Set(page.items.map((s) => s.id)) : new Set())} /></th>}
              <th>Email</th><th>Name</th><th>Company</th><th>Status</th><th>Tags</th><th>Source</th><th>Added</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((s) => (
              <tr key={s.id} className="click" onClick={() => setOpen(s.id)}>
                {ctx.canEdit && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${s.email}`} checked={sel.has(s.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(s.id); else n.delete(s.id); setSel(n); }} />
                  </td>
                )}
                <td className="trunc">{s.email}</td>
                <td className="trunc">{[s.firstName, s.lastName].filter(Boolean).join(" ") || "—"}</td>
                <td className="trunc">{s.company || "—"}</td>
                <td><SubBadge s={s} /></td>
                <td><div className="chips">{s.tags.slice(0, 4).map((t) => <span key={t} className="badge">{t}</span>)}{s.tags.length > 4 && <span className="badge">+{s.tags.length - 4}</span>}</div></td>
                <td className="small">{label(s.source)}</td>
                <td>{formatDate(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page && page.total > 100 && (
        <div className="toolbar">
          <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
          <span className="small muted">{offset + 1}–{Math.min(offset + 100, page.total)} of {num(page.total)}</span>
          <button className="btn small" disabled={offset + 100 >= page.total} onClick={() => setOffset(offset + 100)}>Next</button>
        </div>
      )}
      {adding && <AddPerson ctx={ctx} audienceId={d.audience.id} onClose={() => setAdding(false)} onDone={() => { setVersion((v) => v + 1); reload(); }} />}
      {open && <PersonDialog ctx={ctx} id={open} onClose={() => setOpen(null)} onDone={() => { setVersion((v) => v + 1); reload(); }} />}
    </>
  );
}

function SubBadge({ s }: { s: Subscriber }) {
  if (s.suppressed && s.status !== "cleaned" && s.status !== "unsubscribed") return <span className="badge red" title={`On the do-not-email list (${s.suppressed})`}>Blocked</span>;
  const cls = { subscribed: "green", pending: "amber", unsubscribed: "", cleaned: "red" }[s.status];
  return <span className={`badge ${cls}`}>{label(s.status)}</span>;
}

function AddPerson({ ctx, audienceId, onClose, onDone }: { ctx: AppCtx; audienceId: string; onClose: () => void; onDone: () => void }) {
  const [err, setErr] = useState("");
  return (
    <Modal title="Add a person" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          try {
            await api(`/api/audiences/${audienceId}/subscribers`, { method: "POST", json: f });
            ctx.say("Added");
            onDone();
            onClose();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <label><span>Email</span><input name="email" type="email" required autoFocus /></label>
        <div className="grid2">
          <label><span>First name</span><input name="firstName" /></label>
          <label><span>Last name</span><input name="lastName" /></label>
        </div>
        <label><span>Company</span><input name="company" /></label>
        <label><span>Tags (separated by commas)</span><input name="tags" /></label>
        <p className="small muted">Only add people who agreed to hear from you.</p>
        <p className="error">{err}</p>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Add</button></div>
      </form>
    </Modal>
  );
}

type Activity = { name: string | null; status: string; sent_at: string | null; opened_at: string | null; clicked_at: string | null; unsubscribed_at: string | null };

function PersonDialog({ ctx, id, onClose, onDone }: { ctx: AppCtx; id: string; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState<{ subscriber: Subscriber; activity: Activity[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<{ subscriber: Subscriber; activity: Activity[] }>(`/api/subscribers/${id}`).then(setData).catch((e) => setErr(e.message));
  }, [id]);
  const s = data?.subscriber;
  return (
    <Modal title={s?.email ?? "Person"} onClose={onClose} wide>
      {!s ? (
        <div className="form"><p className="error">{err}</p></div>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const fields: Record<string, string> = {};
            for (const line of String(f.get("fields") ?? "").split("\n")) {
              const at = line.indexOf("=");
              if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
            }
            try {
              await api(`/api/subscribers/${id}`, {
                method: "PATCH",
                json: { firstName: f.get("firstName"), lastName: f.get("lastName"), company: f.get("company"), tags: f.get("tags"), status: f.get("status"), fields },
              });
              onDone();
              onClose();
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        >
          <div className="toolbar"><SubBadge s={s} /><span className="small muted">From {label(s.source)}{s.sourceRef ? ` (${s.sourceRef})` : ""}, added {formatDate(s.createdAt)}{s.consentAt ? `, consent ${formatDateTime(s.consentAt)}` : ""}</span></div>
          <div className="grid2">
            <label><span>First name</span><input name="firstName" defaultValue={s.firstName} disabled={!ctx.canEdit} /></label>
            <label><span>Last name</span><input name="lastName" defaultValue={s.lastName} disabled={!ctx.canEdit} /></label>
            <label><span>Company</span><input name="company" defaultValue={s.company} disabled={!ctx.canEdit} /></label>
            <label>
              <span>Status</span>
              <select name="status" defaultValue={s.status === "subscribed" ? "subscribed" : "unsubscribed"} disabled={!ctx.canEdit || s.status !== "subscribed"}>
                <option value="subscribed">Subscribed</option>
                <option value="unsubscribed">Unsubscribed</option>
              </select>
            </label>
          </div>
          <label><span>Tags (separated by commas)</span><input name="tags" defaultValue={s.tags.join(", ")} disabled={!ctx.canEdit} /></label>
          <label><span>Custom fields (one name=value a line)</span><textarea name="fields" rows={3} defaultValue={Object.entries(s.fields).map(([k, v]) => `${k}=${v}`).join("\n")} disabled={!ctx.canEdit} /></label>
          {data!.activity.length > 0 && (
            <table className="mini">
              <thead><tr><th>Email</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead>
              <tbody>{data!.activity.map((a, i) => <tr key={i}><td>{a.name ?? "—"}{a.unsubscribed_at && <span className="badge red" style={{ marginLeft: 6 }}>Unsubscribed</span>}</td><td>{a.sent_at ? formatDateTime(a.sent_at) : label(a.status)}</td><td>{a.opened_at ? formatDateTime(a.opened_at) : "—"}</td><td>{a.clicked_at ? formatDateTime(a.clicked_at) : "—"}</td></tr>)}</tbody>
            </table>
          )}
          <p className="error">{err}</p>
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Close</button>{ctx.canEdit && <button className="btn primary">Save</button>}</div>
        </form>
      )}
    </Modal>
  );
}

type Result = { added: number; updated: number; skipped: number; invalid: string[] };

function Import({ ctx, d, reload }: { ctx: AppCtx; d: Detail; reload: () => void }) {
  const [kind, setKind] = useState<"csv" | "crm_contacts" | "crm_leads" | "contacts_group">("csv");
  const [csv, setCsv] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<{ id: string; name: string; count: number }[] | null>(null);
  const [preview, setPreview] = useState<{ count: number; sample: { email: string; name: string }[] } | null>(null);
  const [tags, setTags] = useState("");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setPreview(null);
    setErr("");
    if (kind === "contacts_group" && !groups) void api<typeof groups>("/api/contact-groups").then(setGroups).catch((e) => setErr(e.message));
  }, [kind, groups]);

  if (!ctx.canEdit) return <p className="muted">Only marketers and admins can add people.</p>;

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const body = kind === "csv" ? { kind, csv, tags } : { kind, params, tags, keepSynced: keep };
      setResult(await api<Result>(`/api/audiences/${d.audience.id}/import`, { method: "POST", json: body }));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setErr("");
    try {
      setPreview(await api(`/api/audiences/${d.audience.id}/import/preview`, { method: "POST", json: { kind, params } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="cols">
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3>Add people from</h3>
        <div className="seg" role="radiogroup">
          {([["csv", "Spreadsheet (CSV)"], ["crm_contacts", "CRM contacts"], ["crm_leads", "CRM leads"], ["contacts_group", "A Contacts group"]] as const).map(([k, t]) => (
            <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => { setKind(k); setParams({}); }}>{t}</button>
          ))}
        </div>
        {kind === "csv" && (
          <>
            <label className="field">
              <span>A CSV file with an Email column; First name, Last name, Company and Tags are picked up too, other columns become custom fields</span>
              <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
            </label>
            <label className="field"><span>Or paste it</span><textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"email,first name,last name\nann@example.com,Ann,Lee"} /></label>
          </>
        )}
        {kind === "crm_contacts" && (
          <div className="row">
            <label className="field"><span>Matching (name, email, account)</span><input value={params.q ?? ""} onChange={(e) => setParams({ ...params, q: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={params.mine === "1"} onChange={(e) => setParams({ ...params, mine: e.target.checked ? "1" : "" })} /> Only mine</label>
          </div>
        )}
        {kind === "crm_leads" && (
          <div className="row">
            <label className="field">
              <span>Status</span>
              <select value={params.status ?? ""} onChange={(e) => setParams({ ...params, status: e.target.value })}>
                <option value="">Any</option><option value="open">Open (not converted or unqualified)</option>
                {["new", "working", "nurturing", "qualified", "unqualified", "converted"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Source</span>
              <select value={params.source ?? ""} onChange={(e) => setParams({ ...params, source: e.target.value })}>
                <option value="">Any</option>
                {["web", "referral", "event", "cold_outreach", "partner", "other"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={params.mine === "1"} onChange={(e) => setParams({ ...params, mine: e.target.checked ? "1" : "" })} /> Only mine</label>
          </div>
        )}
        {kind === "contacts_group" && (
          <label className="field">
            <span>Your contact group</span>
            <select value={params.group ?? ""} onChange={(e) => setParams({ group: e.target.value, groupName: groups?.find((g) => g.id === e.target.value)?.name ?? "" })}>
              <option value="">Pick a group</option>
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.count})</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Tag everyone added (optional)</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="spring-event" /></label>
        {kind !== "csv" && (
          <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep in sync: add new matches before each campaign to this audience</label>
        )}
        <p className="small muted">Only add people who agreed to hear from you. Anyone who unsubscribed, bounced or complained stays that way.</p>
        <p className="error">{err}</p>
        {preview && <p className="small">{num(preview.count)} with an email address{preview.sample.length ? `, like ${preview.sample.map((s) => s.name || s.email).join(", ")}` : ""}.</p>}
        {result && <p className="ok">{num(result.added)} added, {num(result.updated)} updated{result.invalid.length ? `, ${result.invalid.length} invalid addresses skipped (${result.invalid.slice(0, 5).join(", ")})` : ""}.</p>}
        <div className="actions">
          {kind !== "csv" && <button className="btn" onClick={check} disabled={kind === "contacts_group" && !params.group}>Check</button>}
          <button className="btn primary" onClick={run} disabled={busy || (kind === "csv" ? !csv.trim() : kind === "contacts_group" && !params.group)}><Upload size={15} /> {busy ? "Adding…" : "Add people"}</button>
        </div>
      </div>
      <div className="panel">
        <h3>Kept in sync</h3>
        {!d.sources.length ? (
          <p className="muted small">Nothing yet. Import from CRM or Contacts with “Keep in sync” on, and new people there join this audience before each campaign.</p>
        ) : (
          <table className="mini">
            <thead><tr><th>Source</th><th>As</th><th>Last sync</th><th /></tr></thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td className="small">{s.owner}</td>
                  <td className="small">{s.lastSyncAt ? `${formatDateTime(s.lastSyncAt)}: ${s.lastResult}` : "—"}</td>
                  <td><button className="iconbtn small" aria-label="Stop syncing" title="Stop syncing (the people stay)" onClick={async () => { await api(`/api/sources/${s.id}`, { method: "DELETE" }); reload(); }}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.sources.length > 0 && (
          <div className="actions">
            <button className="btn small" onClick={async () => { try { await api(`/api/audiences/${d.audience.id}/sync`, { method: "POST" }); reload(); ctx.say("Synced"); } catch (e) { ctx.say((e as Error).message); } }}>
              <RefreshCw size={14} /> Sync now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  email: "Email", first_name: "First name", last_name: "Last name", company: "Company", tag: "Tag", source: "Source",
  created: "Joined", opened: "Opened", clicked: "Clicked", field: "Custom field",
};
const OP_LABEL: Record<string, string> = {
  is: "is", is_not: "is not", contains: "contains", not_contains: "doesn't contain", before: "before", after: "on or after",
  within_days: "in the last … days", any: "a campaign", none: "no campaign",
};
const OPS: Record<string, string[]> = {
  email: ["is", "is_not", "contains", "not_contains"], first_name: ["is", "is_not", "contains", "not_contains"],
  last_name: ["is", "is_not", "contains", "not_contains"], company: ["is", "is_not", "contains", "not_contains"],
  source: ["is", "is_not"], field: ["is", "is_not", "contains", "not_contains"], tag: ["is", "is_not"],
  created: ["within_days", "before", "after"], opened: ["any", "none", "within_days"], clicked: ["any", "none", "within_days"],
};

function Segments({ ctx, d, reload }: { ctx: AppCtx; d: Detail; reload: () => void }) {
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  return (
    <>
      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>A segment is part of this audience picked by rules, kept up to date as people change.</p>
        <div className="grow" />
        {ctx.canEdit && <button className="btn small primary" onClick={() => setEditing("new")}><Plus size={14} /> New segment</button>}
      </div>
      {d.segments.length > 0 && (
        <table className="table">
          <thead><tr><th>Name</th><th>Rules</th><th className="num">People</th></tr></thead>
          <tbody>
            {d.segments.map((s) => (
              <tr key={s.id} className="click" onClick={() => setEditing(s)}>
                <td><strong>{s.name}</strong></td>
                <td className="small trunc">{s.rules.conditions.map((c) => `${FIELD_LABEL[c.field]}${c.key ? ` ${c.key}` : ""} ${OP_LABEL[c.op]} ${c.value}`).join(s.rules.match === "any" ? " or " : " and ") || "Everyone"}</td>
                <td className="num">{num(s.count ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <SegmentEditor ctx={ctx} d={d} seg={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={reload} />}
    </>
  );
}

function SegmentEditor({ ctx, d, seg, onClose, onDone }: { ctx: AppCtx; d: Detail; seg: Segment | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(seg?.name ?? "");
  const [rules, setRules] = useState<Rules>(seg?.rules ?? { match: "all", conditions: [{ field: "tag", op: "is", value: d.tags[0] ?? "" }] });
  const [count, setCount] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    void api<{ id: string; name: string; status: string }[]>("/api/campaigns").then((l) => setCampaigns(l.filter((c) => c.status !== "draft"))).catch(() => {});
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<{ count: number }>("/api/segments/count", { method: "POST", json: { audienceId: d.audience.id, rules } })
        .then((r) => { setCount(r.count); setErr(""); })
        .catch((e) => { setCount(null); setErr(e.message); });
    }, 300);
    return () => window.clearTimeout(t);
  }, [rules, d.audience.id]);
  const set = (i: number, c: Partial<Condition>) => setRules({ ...rules, conditions: rules.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  return (
    <Modal title={seg ? seg.name : "New segment"} onClose={onClose} wide>
      <div className="form">
        <label><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} disabled={!ctx.canEdit} autoFocus /></label>
        <div className="toolbar">
          People who match
          <select value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value === "any" ? "any" : "all" })} disabled={!ctx.canEdit}>
            <option value="all">all</option><option value="any">any</option>
          </select>
          of these:
        </div>
        <div className="rules">
          {rules.conditions.map((c, i) => (
            <div className="rule" key={i}>
              <select value={c.field} disabled={!ctx.canEdit} onChange={(e) => { const field = e.target.value as Condition["field"]; set(i, { field, op: OPS[field][0] as Condition["op"], value: "" }); }}>
                {Object.entries(FIELD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {c.field === "field" && (
                <select value={c.key ?? ""} disabled={!ctx.canEdit} onChange={(e) => set(i, { key: e.target.value })}>
                  <option value="">Pick a field</option>
                  {d.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
              <select value={c.op} disabled={!ctx.canEdit} onChange={(e) => set(i, { op: e.target.value as Condition["op"], value: "" })}>
                {OPS[c.field].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select>
              {c.field === "tag" ? (
                <select value={c.value} disabled={!ctx.canEdit} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Pick a tag</option>
                  {d.tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : (c.field === "opened" || c.field === "clicked") && c.op !== "within_days" ? (
                <select value={c.value} disabled={!ctx.canEdit} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Any campaign</option>
                  {campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              ) : (
                <input
                  type={c.op === "before" || c.op === "after" ? "date" : c.op === "within_days" ? "number" : "text"}
                  min={c.op === "within_days" ? 1 : undefined}
                  value={c.value}
                  disabled={!ctx.canEdit}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
              )}
              {ctx.canEdit && <button type="button" className="iconbtn small" aria-label="Remove rule" onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
            </div>
          ))}
          {ctx.canEdit && <div><button type="button" className="btn small" onClick={() => setRules({ ...rules, conditions: [...rules.conditions, { field: "tag", op: "is", value: "" }] })}><Plus size={14} /> Add rule</button></div>}
        </div>
        <p>{count === null ? <span className="muted">Counting…</span> : <strong>{num(count)} {count === 1 ? "person" : "people"} would get a campaign to this segment.</strong>}</p>
        <p className="error">{err}</p>
        <div className="actions">
          {seg && ctx.canEdit && (
            <button type="button" className="btn" onClick={async () => { try { await api(`/api/segments/${seg.id}`, { method: "DELETE" }); onDone(); onClose(); } catch (e) { setErr((e as Error).message); } }}>Delete</button>
          )}
          <div className="grow" />
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {ctx.canEdit && (
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  if (seg) await api(`/api/segments/${seg.id}`, { method: "PATCH", json: { name, rules } });
                  else await api("/api/segments", { method: "POST", json: { audienceId: d.audience.id, name, rules } });
                  onDone();
                  onClose();
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              Save
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FormTab({ ctx, d, reload }: { ctx: AppCtx; d: Detail; reload: () => void }) {
  const a = d.audience;
  const [intro, setIntro] = useState(a.formIntro);
  const save = async (patch: Record<string, unknown>) => {
    try {
      await api(`/api/audiences/${a.id}`, { method: "PATCH", json: patch });
      reload();
    } catch (e) {
      ctx.say((e as Error).message);
    }
  };
  const embed = `<a href="${d.formUrl}">Subscribe to ${a.name}</a>`;
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      <label className="check"><input type="checkbox" checked={a.formEnabled} disabled={!ctx.canEdit} onChange={(e) => save({ formEnabled: e.target.checked })} /> <strong>Let people sign up to this audience themselves</strong></label>
      <label className="check"><input type="checkbox" checked={a.doubleOptIn} disabled={!ctx.canEdit} onChange={(e) => save({ doubleOptIn: e.target.checked })} /> Ask them to confirm by email first (double opt-in, recommended)</label>
      <label className="field"><span>A line at the top of the form</span><textarea rows={2} value={intro} disabled={!ctx.canEdit} onChange={(e) => setIntro(e.target.value)} onBlur={() => intro !== a.formIntro && save({ formIntro: intro })} placeholder="News and offers, about once a month." /></label>
      {a.formEnabled ? (
        <>
          <div className="field"><span>The form&apos;s address, for your website, social profiles or a QR code</span><a className="link" href={d.formUrl} target="_blank" rel="noreferrer">{d.formUrl}</a></div>
          <div className="field"><span>A link to put on your website</span><div className="code">{embed}</div></div>
        </>
      ) : (
        <p className="muted small">The form is off. Turn it on to get its link.</p>
      )}
    </div>
  );
}

function AudienceSettings({ ctx, d, reload }: { ctx: AppCtx; d: Detail; reload: () => void }) {
  const a = d.audience;
  const [err, setErr] = useState("");
  return (
    <form
      className="panel"
      style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api(`/api/audiences/${a.id}`, { method: "PATCH", json: { name: f.get("name"), description: f.get("description") } });
          reload();
          ctx.say("Saved");
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <label className="field"><span>Name (subscribers see it in the footer and on the unsubscribe page)</span><input name="name" defaultValue={a.name} disabled={!ctx.canEdit} /></label>
      <label className="field"><span>Description</span><input name="description" defaultValue={a.description} disabled={!ctx.canEdit} /></label>
      <p className="error">{err}</p>
      {ctx.canEdit && (
        <div className="actions">
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete ${a.name} and everyone in it? Reports of past campaigns keep their numbers.`)) return;
              try {
                await api(`/api/audiences/${a.id}`, { method: "DELETE" });
                ctx.go({ view: "audiences" });
              } catch (x) {
                setErr((x as Error).message);
              }
            }}
          >
            Delete audience
          </button>
          <div className="grow" />
          <button className="btn primary">Save</button>
        </div>
      )}
    </form>
  );
}
