"use client";
import { Check, ExternalLink, FileUp, Printer, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { STATUS_LABELS, api, money, person, relDays, shortDate, when } from "./client";
import type { AppInfo, Me } from "./ContractsApp";
import { Confirm, Modal } from "./Modal";
import { ContractText } from "./ContractText";
import { type Terms, TermsFields, termsPayload } from "./NewContract";

type Approval = { id: string; step: number; approver: string; status: string; comment: string; decided_at: string | null };
type Obligation = { id: string; title: string; notes: string; due_day: string | null; assignee: string | null; done_at: string | null; done_by: string | null };
type FileRow = { id: string; kind: string; name: string; size: number; uploaded_by: string; uploaded_at: string };
type Version = { n: number; note: string; author: string; created_at: string; chars: number };
type Review = {
  summary: string; parties: string[]; keyDates: { label: string; date: string }[]; paymentTerms: string; termination: string;
  risks: { severity: string; clause: string; issue: string; suggestion: string }[]; missing: { clause: string; why: string }[];
  obligations: { title: string; due: string; party: string }[];
};
type Contract = {
  id: string; number: string; title: string; type: string; status: string; counterparty: string; counterparty_email: string; owner: string;
  value_cents: number | null; currency: string; start_day: string | null; end_day: string | null; auto_renew: boolean; renewal_months: number;
  notice_days: number; notice_day: string | null; days_left: number | null; crm_deal: string; sign_url: string; signed_at: string | null;
  body: string; role: string; people: { email: string; role: string }[]; approvals: Approval[]; obligations: Obligation[]; files: FileRow[];
  events: { kind: string; detail: string; actor: string; at: string }[]; versions: Version[]; aiReview: Review | null; aiReviewedAt: string | null;
};

const TABS = ["Text", "Terms", "Approvals", "Obligations", "Files", "People", "History", "AI review"] as const;
type Tab = (typeof TABS)[number];

export function ContractView({ id, me, info, onChange, onDeleted }: { id: string; me: Me; info: AppInfo; onChange: () => void; onDeleted: () => void }) {
  const [c, setC] = useState<Contract | null>(null);
  const [tab, setTab] = useState<Tab>("Text");
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | "submit" | "reject" | "sign" | "renew" | "terminate" | "delete">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setC(await api<Contract>(`/api/contracts/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      const out = await api(`/api/contracts/${id}/action`, { method: "POST", json: { action, ...extra } });
      await load();
      onChange();
      return out;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  if (!c) return error ? <p className="pad error">{error}</p> : <p className="pad muted">Loading…</p>;
  const canEdit = ["admin", "owner", "editor"].includes(c.role);
  const canOwn = c.role === "owner" || c.role === "admin";
  const current = c.approvals.find((a) => a.status === "pending");
  const myTurn = c.status === "review" && current?.approver === me.email;

  return (
    <>
      <div className="head">
        <div className="grow">
          <p className="muted small" style={{ margin: 0 }}>{c.number} · {c.type}</p>
          <h1>{c.title}</h1>
          <p className="sub muted">
            <span className={`pill ${c.status}`}>{STATUS_LABELS[c.status]}</span>{" "}
            {c.counterparty && <>with {c.counterparty} · </>}
            {c.value_cents !== null && <>{money(c.value_cents, c.currency)} · </>}
            {c.end_day ? <>ends {shortDate(c.end_day)}{c.status === "active" && c.days_left !== null ? ` (${relDays(c.days_left)})` : ""}</> : "no end date"}
            {" · "}owner {person(c.owner, me.email)}
          </p>
        </div>
        <div className="toolbar">
          {c.status === "draft" && canEdit && <button className="btn primary" disabled={busy} onClick={() => setDialog("submit")}>Send for approval</button>}
          {myTurn && (
            <>
              <button className="btn primary" disabled={busy} onClick={() => act("approve").catch(() => {})}><Check size={15} /> Approve</button>
              <button className="btn" disabled={busy} onClick={() => setDialog("reject")}><X size={15} /> Reject</button>
            </>
          )}
          {c.status === "approved" && canEdit && <button className="btn primary" disabled={busy} onClick={() => setDialog("sign")}>Send for signature</button>}
          {c.status === "signing" && c.sign_url && (
            <a className="btn" href={c.sign_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Signing page</a>
          )}
          {["approved", "signing"].includes(c.status) && canEdit && <button className="btn" disabled={busy} onClick={() => act("signed").catch(() => {})}>Mark signed</button>}
          {["review", "approved", "signing"].includes(c.status) && canEdit && <button className="btn" disabled={busy} onClick={() => act("draft").catch(() => {})}>Back to draft</button>}
          {["active", "expired"].includes(c.status) && canEdit && <button className="btn" disabled={busy} onClick={() => setDialog("renew")}>Renew</button>}
          {c.status === "active" && canOwn && <button className="btn" disabled={busy} onClick={() => setDialog("terminate")}>Terminate</button>}
          <a className="iconbtn" href={`/print/${c.id}`} target="_blank" rel="noreferrer" title="Print or save as PDF" aria-label="Print"><Printer size={17} /></a>
          {canOwn && <button className="iconbtn" title="Delete" aria-label="Delete" onClick={() => setDialog("delete")}><Trash2 size={17} /></button>}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t}
            {t === "Obligations" && c.obligations.some((o) => !o.done_at) ? ` (${c.obligations.filter((o) => !o.done_at).length})` : ""}
            {t === "Files" && c.files.length ? ` (${c.files.length})` : ""}
          </button>
        ))}
      </div>
      <div className="body">
        {error && <p className="error">{error}</p>}
        {tab === "Text" && <TextTab c={c} canEdit={canEdit} reload={load} />}
        {tab === "Terms" && <TermsTab c={c} info={info} canEdit={canEdit} reload={load} onChange={onChange} />}
        {tab === "Approvals" && <ApprovalsTab c={c} me={me} />}
        {tab === "Obligations" && <ObligationsTab c={c} me={me} canEdit={canEdit} reload={load} />}
        {tab === "Files" && <FilesTab c={c} canEdit={canEdit} reload={load} onChange={onChange} />}
        {tab === "People" && <PeopleTab c={c} me={me} canEdit={canEdit} reload={load} />}
        {tab === "History" && (
          <ul className="history">
            {c.events.map((e, i) => (
              <li key={i}><b>{e.kind}</b> {e.detail} <span className="muted small">{person(e.actor, me.email)} · {when(e.at)}</span></li>
            ))}
          </ul>
        )}
        {tab === "AI review" && <ReviewTab c={c} info={info} canRun={c.role !== "viewer"} onRun={() => act("review")} busy={busy} />}
      </div>

      {dialog === "submit" && (
        <ListDialog
          title="Send for approval"
          label="Approvers, in the order they decide (one email per line)"
          action="Send"
          onClose={() => setDialog(null)}
          onSubmit={async (emails, note) => act("submit", { approvers: emails, note })}
          withNote
        />
      )}
      {dialog === "reject" && (
        <TextDialog title="Reject" label="What needs to change" action="Reject" onClose={() => setDialog(null)} onSubmit={(comment) => act("reject", { comment })} />
      )}
      {dialog === "sign" && <SignDialog c={c} info={info} onClose={() => setDialog(null)} onSubmit={(b) => act("sign", b)} />}
      {dialog === "renew" && (
        <TextDialog
          title="Renew"
          label={`Months to add (default ${c.renewal_months})`}
          action="Renew"
          initial={String(c.renewal_months)}
          onClose={() => setDialog(null)}
          onSubmit={(months) => act("renew", { months: Number(months) || undefined })}
        />
      )}
      {dialog === "terminate" && (
        <TextDialog title="Terminate" label="Reason (kept in the history)" action="Terminate" danger onClose={() => setDialog(null)} onSubmit={(reason) => act("terminate", { reason })} />
      )}
      {dialog === "delete" && (
        <Confirm
          title="Delete contract"
          message={`Delete ${c.number} ${c.title}? Its text, versions, files and history go with it. If anyone on it is under a legal hold, it's kept for the hold.`}
          action="Delete"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/contracts/${c.id}`, { method: "DELETE" });
            onDeleted();
          }}
        />
      )}
    </>
  );
}

function TextTab({ c, canEdit, reload }: { c: Contract; canEdit: boolean; reload: () => Promise<void> }) {
  const editable = canEdit && c.status === "draft";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [compare, setCompare] = useState<{ n: number; lines: { op: string; text: string }[] } | null>(null);

  const showCompare = async (n: number) => {
    const v = await api<{ body: string }>(`/api/contracts/${c.id}/versions/${n}`);
    const { diffLines } = await import("@/lib/diff");
    setCompare({ n, lines: diffLines(v.body, c.body) });
  };

  return (
    <div className="split">
      <div className="grow">
        {editing ? (
          <form
            className="form"
            style={{ padding: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/api/contracts/${c.id}`, { method: "PATCH", json: { body, versionNote: note } });
                setEditing(false);
                setNote("");
                await reload();
              } catch (x) {
                setError((x as Error).message);
              }
            }}
          >
            <p className="muted small">Write in plain text. Start a line with # for a heading or - for a list, and wrap words in **two stars** for bold.</p>
            <textarea className="bodyedit" value={body} onChange={(e) => setBody(e.target.value)} rows={28} />
            <label><span>What changed (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <p className="error">{error}</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => { setEditing(false); setBody(c.body); }}>Cancel</button>
              <button className="btn primary">Save version</button>
            </div>
          </form>
        ) : compare ? (
          <>
            <div className="toolbar">
              <b>Changes since version {compare.n}</b>
              <button className="btn small" onClick={() => setCompare(null)}>Close</button>
            </div>
            <pre className="redline">
              {compare.lines.map((l, i) => <div key={i} className={l.op}>{l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}{l.text}</div>)}
            </pre>
          </>
        ) : (
          <>
            {editable && <div className="toolbar"><button className="btn" onClick={() => setEditing(true)}>Edit text</button></div>}
            {!editable && canEdit && c.status !== "draft" && <p className="muted small">The text is locked while the contract is {STATUS_LABELS[c.status].toLowerCase()}.</p>}
            <ContractText body={c.body} />
          </>
        )}
      </div>
      {c.versions.length > 0 && (
        <aside className="side">
          <h3>Versions</h3>
          {c.versions.map((v) => (
            <div key={v.n} className="ver">
              <b>Version {v.n}</b> {v.note && <span>{v.note}</span>}
              <div className="muted small">{v.author.split("@")[0]} · {when(v.created_at)}</div>
              {v.n !== c.versions[0].n && <button className="btn small" onClick={() => void showCompare(v.n)}>Compare with latest</button>}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}

function TermsTab({ c, info, canEdit, reload, onChange }: { c: Contract; info: AppInfo; canEdit: boolean; reload: () => Promise<void>; onChange: () => void }) {
  const [t, setT] = useState<Terms>({
    title: c.title, type: c.type, counterparty: c.counterparty, counterpartyEmail: c.counterparty_email,
    value: c.value_cents === null ? "" : String(c.value_cents / 100), currency: c.currency, startDay: c.start_day ?? "", endDay: c.end_day ?? "",
    autoRenew: c.auto_renew, renewalMonths: String(c.renewal_months), noticeDays: String(c.notice_days), crmDeal: c.crm_deal,
  });
  const [msg, setMsg] = useState("");
  return (
    <form
      className="form narrow"
      style={{ padding: 0 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg("");
        try {
          await api(`/api/contracts/${c.id}`, { method: "PATCH", json: termsPayload(t) });
          await reload();
          onChange();
          setMsg("Saved");
        } catch (x) {
          setMsg((x as Error).message);
        }
      }}
    >
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <TermsFields t={t} set={setT} types={info.types} />
      </fieldset>
      {c.notice_day && <p className="muted small">Last day to give notice: {shortDate(c.notice_day)}.</p>}
      {c.signed_at && <p className="muted small">Signed {when(c.signed_at)}.</p>}
      {canEdit && (
        <div className="actions">
          <span className={msg === "Saved" ? "ok" : "error"}>{msg}</span>
          <button className="btn primary">Save terms</button>
        </div>
      )}
    </form>
  );
}

function ApprovalsTab({ c, me }: { c: Contract; me: Me }) {
  if (!c.approvals.length) return <p className="muted">Nobody has been asked to approve this contract yet.</p>;
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr><th>Step</th><th>Approver</th><th>Decision</th><th>Comment</th><th>When</th></tr></thead>
        <tbody>
          {c.approvals.map((a) => (
            <tr key={a.id}>
              <td>{a.step}</td>
              <td>{person(a.approver, me.email)}</td>
              <td><span className={`pill ${a.status}`}>{a.status === "pending" ? "Waiting" : a.status[0].toUpperCase() + a.status.slice(1)}</span></td>
              <td>{a.comment}</td>
              <td className="muted">{a.decided_at ? when(a.decided_at) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ObligationsTab({ c, me, canEdit, reload }: { c: Contract; me: Me; canEdit: boolean; reload: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState("");
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {canEdit && (
        <form
          className="addrow"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/api/contracts/${c.id}/obligations`, { method: "POST", json: { title, dueDay: due || null, assignee: who || null } });
              setTitle("");
              setDue("");
              setWho("");
            });
          }}
        >
          <input className="cellin" placeholder="What has to be done, e.g. Send the quarterly usage report" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="cellin" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
          <input className="cellin" placeholder="Who (email)" value={who} onChange={(e) => setWho(e.target.value)} />
          <button className="btn" disabled={!title.trim()}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {!c.obligations.length ? (
        <p className="muted">No obligations recorded. Add what this contract commits either side to, with a due date, and it shows up on the overview when it comes due.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th /><th>Obligation</th><th>Due</th><th>Who</th><th /></tr></thead>
            <tbody>
              {c.obligations.map((o) => (
                <tr key={o.id} className={o.done_at ? "done" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!o.done_at}
                      disabled={!canEdit && o.assignee !== me.email}
                      onChange={(e) => void run(() => api(`/api/obligations/${o.id}`, { method: "PATCH", json: { done: e.target.checked } }))}
                      aria-label="Done"
                    />
                  </td>
                  <td>{o.title}{o.done_by && <span className="muted small"> · done by {person(o.done_by, me.email)}</span>}</td>
                  <td>{o.due_day ? shortDate(o.due_day) : ""}</td>
                  <td className="muted">{o.assignee ? person(o.assignee, me.email) : ""}</td>
                  <td>{canEdit && <button className="iconbtn small" aria-label="Remove" onClick={() => void run(() => api(`/api/obligations/${o.id}`, { method: "DELETE" }))}><X size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FilesTab({ c, canEdit, reload, onChange }: { c: Contract; canEdit: boolean; reload: () => Promise<void>; onChange: () => void }) {
  const [error, setError] = useState("");
  const upload = async (file: File, kind: string) => {
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    try {
      await api(`/api/contracts/${c.id}/files`, { method: "POST", body: form });
      await reload();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const picker = (kind: string, label: string) => (
    <label className="btn">
      <FileUp size={15} /> {label}
      <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, kind); e.target.value = ""; }} />
    </label>
  );
  return (
    <>
      {canEdit && (
        <div className="toolbar">
          {picker("attachment", "Attach a file")}
          {picker("executed", "Upload the signed copy")}
          {["approved", "signing"].includes(c.status) && <span className="muted small">Uploading the signed copy marks the contract signed.</span>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!c.files.length ? (
        <p className="muted">No files.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <tbody>
              {c.files.map((f) => (
                <tr key={f.id}>
                  <td><a href={`/api/files/${f.id}`}>{f.name}</a> {f.kind === "executed" && <span className="pill active">Signed copy</span>}</td>
                  <td className="num muted">{Math.max(1, Math.round(f.size / 1024))} KB</td>
                  <td className="muted">{f.uploaded_by.split("@")[0]} · {when(f.uploaded_at)}</td>
                  <td>{canEdit && <button className="iconbtn small" aria-label="Remove" onClick={async () => { await api(`/api/files/${f.id}`, { method: "DELETE" }); await reload(); }}><X size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PeopleTab({ c, me, canEdit, reload }: { c: Contract; me: Me; canEdit: boolean; reload: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState("");
  return (
    <>
      <p className="muted small">Only the owner, the people here, the approvers and the legal team can see this contract.</p>
      {canEdit && (
        <form
          className="addrow"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api(`/api/contracts/${c.id}/people`, { method: "POST", json: { email, role } });
              setEmail("");
              await reload();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <input className="cellin" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="cellin" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access">
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
          <button className="btn" disabled={!email}>Share</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div className="tablewrap">
        <table className="grid">
          <tbody>
            <tr><td>{person(c.owner, me.email)}</td><td className="muted">Owner</td><td /></tr>
            {c.people.map((p) => (
              <tr key={p.email}>
                <td>{person(p.email, me.email)} <span className="muted small">{p.email}</span></td>
                <td className="muted">{p.role === "editor" ? "Can edit" : "Can view"}</td>
                <td>
                  {canEdit && (
                    <button className="iconbtn small" aria-label="Remove" onClick={async () => { await api(`/api/contracts/${c.id}/people?email=${encodeURIComponent(p.email)}`, { method: "DELETE" }); await reload(); }}>
                      <X size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReviewTab({ c, info, canRun, onRun, busy }: { c: Contract; info: AppInfo; canRun: boolean; onRun: () => Promise<unknown>; busy: boolean }) {
  const r = c.aiReview;
  return (
    <>
      <div className="toolbar">
        {canRun && info.ai && (
          <button className="btn primary" disabled={busy || !c.body.trim()} onClick={() => void onRun().catch(() => {})}>
            <Sparkles size={15} /> {busy ? "Reviewing…" : r ? "Review again" : "Review with AI"}
          </button>
        )}
        {!info.ai && <span className="muted">AI is off. An administrator can turn it on with the AI settings.</span>}
        {c.aiReviewedAt && <span className="muted small">Last reviewed {when(c.aiReviewedAt)}. It's a first pass for a person to check, not legal advice.</span>}
      </div>
      {r && (
        <>
          <section><h2>Summary</h2><p>{r.summary}</p></section>
          {r.risks.length > 0 && (
            <section>
              <h2>Risks</h2>
              <div className="tablewrap">
                <table className="grid">
                  <thead><tr><th>Severity</th><th>Clause</th><th>Issue</th><th>Ask for</th></tr></thead>
                  <tbody>
                    {r.risks.map((x, i) => (
                      <tr key={i}><td><span className={`pill sev-${x.severity}`}>{x.severity}</span></td><td>{x.clause}</td><td>{x.issue}</td><td>{x.suggestion}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {r.missing.length > 0 && (
            <section><h2>Missing required clauses</h2><ul>{r.missing.map((m, i) => <li key={i}><b>{m.clause}</b>: {m.why}</li>)}</ul></section>
          )}
          <section>
            <h2>Key terms</h2>
            <p><b>Parties:</b> {r.parties.join("; ")}</p>
            <p><b>Payment:</b> {r.paymentTerms}</p>
            <p><b>Termination:</b> {r.termination}</p>
            {r.keyDates.length > 0 && <p><b>Dates:</b> {r.keyDates.map((d) => `${d.label} ${d.date}`).join("; ")}</p>}
          </section>
          {r.obligations.length > 0 && (
            <section>
              <h2>Obligations it found</h2>
              <p className="muted small">Add the ones that matter on the Obligations tab so they come up when due.</p>
              <ul>{r.obligations.map((o, i) => <li key={i}>{o.title} <span className="muted">({o.party}, {o.due})</span></li>)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function ListDialog({ title, label, action, withNote, onClose, onSubmit }: {
  title: string; label: string; action: string; withNote?: boolean; onClose: () => void; onSubmit: (emails: string[], note: string) => Promise<unknown>;
}) {
  const [list, setList] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSubmit(list.split(/[\s,;]+/).filter(Boolean), note);
            onClose();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>{label}</span><textarea value={list} onChange={(e) => setList(e.target.value)} rows={4} autoFocus /></label>
        {withNote && <label><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>}
        <p className="error">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{action}</button>
        </div>
      </form>
    </Modal>
  );
}

function TextDialog({ title, label, action, initial = "", danger, onClose, onSubmit }: {
  title: string; label: string; action: string; initial?: string; danger?: boolean; onClose: () => void; onSubmit: (v: string) => Promise<unknown>;
}) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSubmit(v);
            onClose();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>{label}</span><textarea value={v} onChange={(e) => setV(e.target.value)} rows={3} autoFocus /></label>
        <p className="error">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`}>{action}</button>
        </div>
      </form>
    </Modal>
  );
}

function SignDialog({ c, info, onClose, onSubmit }: { c: Contract; info: AppInfo; onClose: () => void; onSubmit: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [signers, setSigners] = useState([
    { email: c.counterparty_email, name: c.counterparty },
    { email: c.owner, name: "" },
  ]);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Send for signature" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSubmit({ signers: signers.filter((s) => s.email.trim()), signUrl: link, message });
            onClose();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <h3>Who signs, in order</h3>
        {signers.map((s, i) => (
          <div key={i} className="row2">
            <input className="cellin" placeholder="Email" value={s.email} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <input className="cellin" placeholder="Name" value={s.name} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setSigners([...signers, { email: "", name: "" }])}>Add signer</button>
        {info.signing ? (
          <label><span>Message to signers (optional)</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} /></label>
        ) : (
          <>
            <p className="muted small">
              Print the contract to PDF, send it from {info.signApp ? <a href={info.signApp} target="_blank" rel="noreferrer">Sign</a> : "Sign"}, and paste the
              signing link here. Upload the signed copy on the Files tab when it comes back.
            </p>
            <label><span>Signing link (optional)</span><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></label>
          </>
        )}
        <p className="error">{error}</p>
        <div className="actions">
          <a className="btn" href={`/print/${c.id}`} target="_blank" rel="noreferrer"><Printer size={15} /> Print</a>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{info.signing ? "Send" : "Mark as sent"}</button>
        </div>
      </form>
    </Modal>
  );
}
