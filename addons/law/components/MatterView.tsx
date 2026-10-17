"use client";
import { Download, FileText, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FEE_LABELS, ROLE_LABELS, STATUS_LABELS, amount, api, money, person, shortDate, today, when } from "./client";
import { DeadlineDialog, DeadlineTable } from "./Deadlines";
import type { Go } from "./LawApp";
import { BLANK_TERMS, TermsFields, type Terms, termsPayload } from "./Matters";
import { Modal } from "./Modal";
import { EntryForm, EntryTable, type Entry } from "./TimeView";
import { LedgerTable, type Line, TrustEntryDialog } from "./Trust";
import type { AppInfo, Deadline, Matter } from "./types";

const TABS = ["overview", "parties", "deadlines", "time", "bills", "trust", "documents", "team", "history"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview", parties: "Parties", deadlines: "Deadlines", time: "Time", bills: "Bills", trust: "Trust", documents: "Documents", team: "Team", history: "History",
};

export function MatterView({ id, tab, doc, info, go, onChange }: { id: string; tab?: string; doc?: string; info: AppInfo; go: Go; onChange: () => void }) {
  const [m, setM] = useState<Matter | null>(null);
  const [t, setT] = useState<Tab>((TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "overview");
  const [error, setError] = useState("");
  const load = useCallback(() => api<Matter>(`/api/matters/${id}`).then(setM).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="pad error">{error}</p>;
  if (!m) return <p className="pad muted">Loading…</p>;
  const lead = m.role === "responsible" || m.role === "admin";
  const pick = (x: Tab) => {
    setT(x);
    window.history.replaceState(null, "", `?matter=${id}${x === "overview" ? "" : `&tab=${x}`}`);
  };
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1><span className="muted">{m.number}</span> {m.title}</h1>
          <p className="sub muted">
            <button className="linkbtn" onClick={() => go.client(m.client_id)}>{m.client_name}</button> · {m.practice_area} · {FEE_LABELS[m.fee_type]} ·{" "}
            <span className={`pill ${m.status}`}>{STATUS_LABELS[m.status]}</span> · {person(m.responsible, info.email)}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x} role="tab" aria-selected={t === x} className={`tab${t === x ? " on" : ""}`} onClick={() => pick(x)}>{TAB_LABELS[x]}</button>
        ))}
      </div>
      <div className="body">
        {t === "overview" && <Overview m={m} info={info} lead={lead} onSaved={() => { void load(); onChange(); }} onDeleted={() => { onChange(); go.page("mine"); }} />}
        {t === "parties" && <Parties m={m} info={info} onChange={load} />}
        {t === "deadlines" && <MatterDeadlines m={m} info={info} />}
        {t === "time" && <MatterTime m={m} info={info} lead={lead} />}
        {t === "bills" && <Bills m={m} info={info} lead={lead} onChange={load} />}
        {t === "trust" && <MatterTrust m={m} info={info} />}
        {t === "documents" && <Documents m={m} info={info} lead={lead} focus={doc} onChange={load} />}
        {t === "team" && <Team m={m} info={info} lead={lead} onChange={load} />}
        {t === "history" && (
          <ul className="history">
            {m.events.map((e, i) => <li key={i}><span className="muted small">{when(e.at)} · {person(e.actor, info.email)}</span><br />{e.detail}</li>)}
          </ul>
        )}
      </div>
    </>
  );
}

function toTerms(m: Matter): Terms {
  return {
    ...BLANK_TERMS,
    title: m.title, practiceArea: m.practice_area, jurisdiction: m.jurisdiction, court: m.court, caseNumber: m.case_number, description: m.description,
    feeType: m.fee_type, rate: amount(m.rate_cents === null ? null : Number(m.rate_cents)), flatFee: amount(m.flat_cents === null ? null : Number(m.flat_cents)),
    contingencyPct: m.contingency_pct ?? "", currency: m.currency, engagementSignedOn: m.engagement_signed_on ?? "", openedOn: m.opened_on,
  };
}

function Overview({ m, info, lead, onSaved, onDeleted }: { m: Matter; info: AppInfo; lead: boolean; onSaved: () => void; onDeleted: () => void }) {
  const [t, setT] = useState<Terms>(toTerms(m));
  const [status, setStatus] = useState(m.status);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [briefing, setBriefing] = useState(false);
  return (
    <div className="split">
      <div className="grow">
        {m.rules.length > 0 && (
          <section className="notice">
            {m.rules.map((r, i) => <p key={i}><b>{r.rule}.</b> {r.message} <a href={r.url} target="_blank" rel="noreferrer">{r.citation}</a></p>)}
          </section>
        )}
        <form
          className="form flat narrow"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api(`/api/matters/${m.id}`, { method: "PATCH", json: { ...termsPayload(t), status } });
              setSaved(true);
              onSaved();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <TermsFields t={t} set={(x) => { setT(x); setSaved(false); }} info={info} disabled={!lead} />
          <label>
            <span>Status</span>
            <select value={status} disabled={!lead} onChange={(e) => { setStatus(e.target.value); setSaved(false); }}>
              {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <p className="error">{error}</p>
          {lead && (
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  if (!confirm(`Delete ${m.number}? Only a matter with nothing recorded on it can be deleted.`)) return;
                  try {
                    await api(`/api/matters/${m.id}`, { method: "DELETE" });
                    onDeleted();
                  } catch (x) {
                    setError((x as Error).message);
                  }
                }}
              >
                Delete
              </button>
              <span className="grow" />
              {saved && <span className="ok">Saved</span>}
              <button className="btn primary">Save</button>
            </div>
          )}
        </form>
        {m.brief && <BriefView brief={m.brief} />}
      </div>
      <aside className="side">
        <div className="kpi"><span className="muted">Billed</span><b>{money(m.billedCents, m.currency)}</b></div>
        <div className="kpi"><span className="muted">Held in trust</span><b>{money(m.trustCents, m.currency)}</b></div>
        <div className="muted small">Opened {shortDate(m.opened_on)}{m.closed_on && `, closed ${shortDate(m.closed_on)}`}</div>
        {m.conflictChecks.length > 0 && (
          <div className="small">
            Conflict check: <span className={`pill ${m.conflictChecks[0].decision}`}>{m.conflictChecks[0].decision}</span>
            {m.conflictChecks[0].note && <div className="muted">{m.conflictChecks[0].note}</div>}
          </div>
        )}
        {info.ai && (
          <button
            className="btn"
            disabled={briefing}
            onClick={async () => {
              setBriefing(true);
              setError("");
              try {
                await api(`/api/matters/${m.id}/brief`, { method: "POST" });
                onSaved();
              } catch (x) {
                setError((x as Error).message);
              }
              setBriefing(false);
            }}
          >
            <Sparkles size={15} /> {briefing ? "Writing…" : m.brief ? "Rewrite case overview" : "Write case overview"}
          </button>
        )}
      </aside>
    </div>
  );
}

function BriefView({ brief }: { brief: NonNullable<Matter["brief"]> }) {
  return (
    <section className="brief">
      <h2>Case overview <span className="muted small">AI, from {brief.documents} documents{brief.at && `, ${when(brief.at)}`}. Check it against the documents.</span></h2>
      <p><b>{brief.caseName}</b>{brief.caseNumber && ` · ${brief.caseNumber}`}{brief.court && ` · ${brief.court}`}{brief.judge && ` · ${brief.judge}`}</p>
      {brief.status && <p><b>Where it stands:</b> {brief.status}</p>}
      <div className="prewrap">{brief.summary}</div>
      {brief.claims.length > 0 && <><h3>Claims</h3><ul>{brief.claims.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
      {brief.keyIssues.length > 0 && <><h3>Key issues</h3><ul>{brief.keyIssues.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
      {brief.nextSteps.length > 0 && <><h3>Next steps</h3><ul>{brief.nextSteps.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
      {brief.timeline.length > 0 && <><h3>Timeline</h3><ul className="timeline">{brief.timeline.map((e, i) => <li key={i}><span className="muted">{e.date}</span> {e.event}</li>)}</ul></>}
    </section>
  );
}

function Parties({ m, info, onChange }: { m: Matter; info: AppInfo; onChange: () => void }) {
  const [v, setV] = useState({ name: "", role: "adverse", kind: "" });
  const [error, setError] = useState("");
  return (
    <>
      <p className="muted">Everyone involved besides the client. Conflict checks on new matters look at these names.</p>
      <form
        className="entryform"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/matters/${m.id}/parties`, { method: "POST", json: { ...v, kind: v.kind || undefined } });
            setV({ ...v, name: "" });
            setError("");
            onChange();
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <input className="cellin grow" placeholder="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
        <select className="cellin" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{info.partyRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        <select className="cellin" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="">Person or organization?</option><option value="person">Person</option><option value="organization">Organization</option></select>
        <button className="btn primary">Add</button>
        <p className="error">{error}</p>
      </form>
      {!m.parties.length ? <p className="muted">None yet.</p> : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Name</th><th>Role</th><th>Added by</th><th></th></tr></thead>
            <tbody>
              {m.parties.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}{p.notes && <div className="muted small">{p.notes}</div>}</td>
                  <td>{ROLE_LABELS[p.role]}</td>
                  <td className="muted">{person(p.added_by, info.email)}</td>
                  <td><button className="btn ghost small" onClick={async () => { await api(`/api/parties/${p.id}`, { method: "DELETE" }); onChange(); }}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MatterDeadlines({ m, info }: { m: Matter; info: AppInfo }) {
  const [rows, setRows] = useState<Deadline[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api<Deadline[]>(`/api/matters/${m.id}/deadlines`).then(setRows).catch(() => {}), [m.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <div className="toolbar"><button className="btn primary" onClick={() => setAdding(true)}>Add deadline</button></div>
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No deadlines yet.</p> : <DeadlineTable rows={rows} me={info.email} onChange={load} />}
      {adding && <DeadlineDialog matterId={m.id} info={info} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </>
  );
}

function MatterTime({ m, info, lead }: { m: Matter; info: AppInfo; lead: boolean }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const load = useCallback(() => api<Entry[]>(`/api/matters/${m.id}/time`).then(setRows).catch(() => {}), [m.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      {m.status !== "closed" && <EntryForm matterId={m.id} onSaved={load} />}
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">Nothing recorded yet.</p> : (
        <EntryTable rows={rows} canEdit={(e) => lead || e.who === info.email} onChange={load} />
      )}
    </>
  );
}

type Bill = {
  id: string; number: string; status: string; through_day: string; total_cents: string; currency: string; booksUrl: string | null; books_number: string | null;
  paidFromTrustCents: number; created_by: string; created_at: string; lines: { description: string; quantity: number; unitCents: number; amountCents: number }[];
};
type Preview = { through: string; lines: Bill["lines"]; totalCents: number; currency: string; books: boolean };

function Bills({ m, info, lead, onChange }: { m: Matter; info: AppInfo; lead: boolean; onChange: () => void }) {
  const [rows, setRows] = useState<Bill[] | null>(null);
  const [through, setThrough] = useState(today());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Bill[]>(`/api/matters/${m.id}/bills`).then(setRows).catch((e) => setError((e as Error).message)), [m.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      {lead && (
        <div className="toolbar">
          <label className="inline"><span>Bill work through</span><input className="cellin" type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></label>
          <button className="btn" onClick={async () => { setError(""); try { setPreview(await api<Preview>(`/api/matters/${m.id}/bills?preview=${through}`)); } catch (x) { setError((x as Error).message); } }}>Preview bill</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No bills yet.</p> : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Bill</th><th>Through</th><th className="num">Total</th><th className="num">Paid from trust</th><th>Books</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="click" onClick={() => setOpen(b)}>
                  <td>{b.number}</td>
                  <td>{shortDate(b.through_day)}</td>
                  <td className="num">{money(Number(b.total_cents), b.currency)}</td>
                  <td className="num">{b.paidFromTrustCents ? money(b.paidFromTrustCents, b.currency) : ""}</td>
                  <td>{b.books_number ? <>Invoice {b.books_number}</> : b.status === "recorded" ? <span className="muted">Not connected</span> : b.status}</td>
                  <td className="muted">{person(b.created_by, info.email)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && (
        <Modal title={`Bill through ${shortDate(preview.through)}`} onClose={() => setPreview(null)} wide>
          <div className="form">
            {!preview.lines.length ? <p className="muted">Nothing unbilled up to that day.</p> : <BillLines lines={preview.lines} total={preview.totalCents} currency={preview.currency} />}
            <p className="muted small">{preview.books ? "It goes to Books as a draft invoice to review and send." : "Books isn't connected, so the bill is kept here only."}</p>
            <p className="error">{error}</p>
            <div className="actions">
              <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!preview.lines.length}
                onClick={async () => {
                  try {
                    await api(`/api/matters/${m.id}/bills`, { method: "POST", json: { through: preview.through } });
                    setPreview(null);
                    void load();
                    onChange();
                  } catch (x) {
                    setError((x as Error).message);
                  }
                }}
              >
                Make the bill
              </button>
            </div>
          </div>
        </Modal>
      )}
      {open && (
        <Modal title={`${open.number}: ${money(Number(open.total_cents), open.currency)}`} onClose={() => setOpen(null)} wide>
          <div className="form">
            <BillLines lines={open.lines} total={Number(open.total_cents)} currency={open.currency} />
            {open.booksUrl && <p><a href={open.booksUrl} target="_blank" rel="noreferrer">Open invoices in Books</a></p>}
            <p className="error">{error}</p>
            {lead && (
              <div className="actions">
                <button
                  className="btn"
                  onClick={async () => {
                    if (!confirm(`Cancel ${open.number}? Its time goes back to unbilled.${open.books_number ? " Void the invoice in Books as well." : ""}`)) return;
                    try {
                      await api(`/api/bills/${open.id}`, { method: "DELETE" });
                      setOpen(null);
                      void load();
                      onChange();
                    } catch (x) {
                      setError((x as Error).message);
                    }
                  }}
                >
                  Cancel bill
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function BillLines({ lines, total, currency }: { lines: Bill["lines"]; total: number; currency: string }) {
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead><tr><th>Line</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitCents, currency)}</td><td className="num">{money(l.amountCents, currency)}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(total, currency)}</td></tr></tfoot>
      </table>
    </div>
  );
}

function MatterTrust({ m, info }: { m: Matter; info: AppInfo }) {
  const [rows, setRows] = useState<Line[] | null>(null);
  const [dialog, setDialog] = useState<"" | "deposit" | "disbursement" | "fee_transfer">("");
  const load = useCallback(() => api<Line[]>(`/api/matters/${m.id}/trust`).then(setRows).catch(() => {}), [m.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const balance = rows?.length ? rows[rows.length - 1].runningCents : 0;
  return (
    <>
      <div className="toolbar">
        <span className="grow">Held for this matter: <b>{money(balance, m.currency)}</b></span>
        {info.trustKeeper && (
          <>
            <button className="btn primary" onClick={() => setDialog("deposit")}>Deposit</button>
            <button className="btn" onClick={() => setDialog("disbursement")}>Pay out</button>
            <button className="btn" onClick={() => setDialog("fee_transfer")}>Move earned fees</button>
          </>
        )}
      </div>
      {!info.trustKeeper && <p className="muted small">The firm&apos;s trust account keepers record money in and out.</p>}
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No trust money on this matter.</p> : <LedgerTable rows={rows} info={info} onChange={load} />}
      {dialog && (
        <TrustEntryDialog kind={dialog} info={info} matter={{ id: m.id, label: `${m.number} ${m.title}` }} onClose={() => setDialog("")} onSaved={() => { setDialog(""); void load(); }} />
      )}
    </>
  );
}

type Doc = {
  id: string; name: string; type: string; size: number; pages: number | null; text_length: number; analysis: Analysis | null; analyzed_at: string | null;
  uploaded_by: string; uploaded_at: string; text?: string;
};
type Analysis = {
  documentType: string; title: string; filedBy: string; documentDate: string; summary: string; keyPoints: string[]; parties: { name: string; role: string }[];
  timeline: { date: string; event: string }[]; deadlines: { title: string; date: string; basis: string }[]; issues: string[];
};

function Documents({ m, info, lead, focus, onChange }: { m: Matter; info: AppInfo; lead: boolean; focus?: string; onChange: () => void }) {
  const [rows, setRows] = useState<Doc[] | null>(null);
  const [open, setOpen] = useState<string | null>(focus ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<Doc[]>(`/api/matters/${m.id}/documents`).then(setRows).catch((e) => setError((e as Error).message)), [m.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <div className="toolbar">
        <input
          ref={file}
          type="file"
          hidden
          multiple
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            setError("");
            for (const f of files) {
              setBusy(`Adding ${f.name}…`);
              const fd = new FormData();
              fd.append("file", f);
              try {
                await api(`/api/matters/${m.id}/documents`, { method: "POST", body: fd });
              } catch (x) {
                setError(`${f.name}: ${(x as Error).message}`);
              }
            }
            setBusy("");
            void load();
          }}
        />
        <button className="btn primary" onClick={() => file.current?.click()} disabled={!!busy}><Upload size={15} /> Add documents</button>
        <span className="muted small">{busy || "PDF, Word or text, up to 50 MB each. Kept in the firm's database, never in a public place."}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No documents yet.</p> : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Document</th><th>Kind</th><th className="num">Pages</th><th>Added</th><th>AI</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                  <td><FileText size={14} /> {d.name}{d.analysis?.summary && <div className="muted small clip">{d.analysis.summary}</div>}</td>
                  <td>{d.analysis?.documentType ?? ""}</td>
                  <td className="num">{d.pages ?? ""}</td>
                  <td className="muted">{shortDate(d.uploaded_at.slice(0, 10))}, {person(d.uploaded_by, info.email)}</td>
                  <td>{d.analysis ? <span className="pill approved">read</span> : !d.text_length ? <span className="muted small">no text</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <DocumentDialog id={open} m={m} info={info} lead={lead} onClose={() => setOpen(null)} onChange={() => { void load(); onChange(); }} />}
    </>
  );
}

function DocumentDialog({ id, m, info, lead, onClose, onChange }: { id: string; m: Matter; info: AppInfo; lead: boolean; onClose: () => void; onChange: () => void }) {
  const [d, setD] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deadline, setDeadline] = useState<{ title: string; dueDay: string; basis: string } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const load = useCallback(() => api<Doc>(`/api/documents/${id}`).then(setD).catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const a = d?.analysis;
  return (
    <Modal title={d?.name ?? "Document"} onClose={onClose} wide>
      <div className="form">
        {!d ? <p className="muted">{error || "Loading…"}</p> : (
          <>
            <div className="toolbar">
              <a className="btn" href={`/api/documents/${id}/file`}><Download size={15} /> Download</a>
              {info.ai && d.text_length > 0 && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/api/documents/${id}/analyze`, { method: "POST" });
                      await load();
                      onChange();
                    } catch (x) {
                      setError((x as Error).message);
                    }
                    setBusy(false);
                  }}
                >
                  <Sparkles size={15} /> {busy ? "Reading…" : a ? "Read it again" : "Have AI read it"}
                </button>
              )}
              <span className="grow" />
              {(lead || d.uploaded_by === info.email) && (
                <button className="btn ghost" onClick={async () => { if (confirm(`Remove ${d.name}?`)) { await api(`/api/documents/${id}`, { method: "DELETE" }); onChange(); onClose(); } }}>Remove</button>
              )}
            </div>
            {!d.text_length && <p className="muted small">No text could be read from this file. A scanned PDF needs OCR before it can be searched or read by AI.</p>}
            <p className="error">{error}</p>
            {a && (
              <div className="analysis">
                <p className="muted small">AI notes, {d.analyzed_at && when(d.analyzed_at)}. Check them against the document.</p>
                <p><b>{a.title || d.name}</b> · {a.documentType}{a.filedBy && ` · ${a.filedBy}`}{a.documentDate && ` · ${a.documentDate}`}</p>
                <p>{a.summary}</p>
                {a.keyPoints.length > 0 && <ul>{a.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}
                {a.deadlines.length > 0 && (
                  <>
                    <h3>Deadlines it mentions</h3>
                    <ul>
                      {a.deadlines.map((x, i) => (
                        <li key={i}>
                          {x.date} {x.title} <span className="muted small">{x.basis}</span>{" "}
                          <button className="linkbtn" onClick={() => setDeadline({ title: x.title, dueDay: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : "", basis: `${x.basis} (from ${d.name})` })}>Add to deadlines</button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {a.parties.length > 0 && (
                  <>
                    <h3>People and organizations</h3>
                    <ul>
                      {a.parties.map((p, i) => {
                        const known = m.parties.some((x) => x.name.toLowerCase() === p.name.toLowerCase()) || p.name.toLowerCase() === m.client_name.toLowerCase() || added.includes(p.name);
                        return (
                          <li key={i}>
                            {p.name} <span className="muted small">{p.role}</span>{" "}
                            {!known && (
                              <button className="linkbtn" onClick={async () => { await api(`/api/matters/${m.id}/parties`, { method: "POST", json: { name: p.name, role: "related", notes: `${p.role}, from ${d.name}` } }); setAdded([...added, p.name]); onChange(); }}>
                                Add to parties
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                {a.timeline.length > 0 && <><h3>Events</h3><ul className="timeline">{a.timeline.map((e, i) => <li key={i}><span className="muted">{e.date}</span> {e.event}</li>)}</ul></>}
                {a.issues.length > 0 && <><h3>Issues</h3><ul>{a.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              </div>
            )}
            {d.text && (
              <details>
                <summary>Text ({d.text_length.toLocaleString()} characters{d.pages ? `, ${d.pages} ${d.pages === 1 ? "page" : "pages"}` : ""})</summary>
                <pre className="doctext">{d.text.slice(0, 200_000)}</pre>
              </details>
            )}
          </>
        )}
      </div>
      {deadline && <DeadlineDialog matterId={m.id} info={info} initial={deadline} onClose={() => setDeadline(null)} onSaved={() => setDeadline(null)} />}
    </Modal>
  );
}

function Team({ m, info, lead, onChange }: { m: Matter; info: AppInfo; lead: boolean; onChange: () => void }) {
  const [v, setV] = useState({ email: "", role: "lawyer", rate: "" });
  const [error, setError] = useState("");
  return (
    <>
      <div className="tablewrap">
        <table className="grid">
          <thead><tr><th>Person</th><th>Role</th><th className="num">Rate</th><th></th></tr></thead>
          <tbody>
            <tr><td>{m.responsible}</td><td>Responsible lawyer</td><td className="num">{m.rate_cents ? money(Number(m.rate_cents)) : ""}</td><td></td></tr>
            {m.people.map((p) => (
              <tr key={p.email}>
                <td>{p.email}</td>
                <td>{p.role}</td>
                <td className="num">{p.rate_cents ? money(Number(p.rate_cents)) : <span className="muted">matter rate</span>}</td>
                <td>{lead && <button className="btn ghost small" onClick={async () => { await api(`/api/matters/${m.id}/people?email=${encodeURIComponent(p.email)}`, { method: "DELETE" }); onChange(); }}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lead && (
        <form
          className="entryform"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/api/matters/${m.id}/people`, { method: "POST", json: v });
              setV({ email: "", role: "lawyer", rate: "" });
              setError("");
              onChange();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <input className="cellin grow" type="email" placeholder="Email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required />
          <select className="cellin" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{info.teamRoles.map((r) => <option key={r}>{r}</option>)}</select>
          <input className="cellin short" inputMode="decimal" placeholder="Rate" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
          <button className="btn primary">Add to team</button>
          <p className="error">{error}</p>
        </form>
      )}
      <p className="muted small">Only the people here, and the firm&apos;s administrators, can open this matter.</p>
    </>
  );
}
