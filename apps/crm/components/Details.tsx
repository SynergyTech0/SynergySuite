"use client";
// The record pages: the facts, related records, and the activity timeline.
import { ArrowLeft, ArrowRight, Lock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { effectiveProbability } from "@/lib/pipeline";
import { label, type Account, type Contact, type Lead, type Opportunity, type RecordType } from "@/lib/types";
import { api, formatDate, formatDateTime, formatMoney, type View } from "./client";
import { AccountEditor, ContactEditor, ConvertDialog, LeadEditor, OpportunityEditor } from "./Editors";
import { Confirm, Modal } from "./Modal";
import { Avatar, Badge, Facts, type AppCtx } from "./shared";
import { SharePanel } from "./Sharing";
import { Timeline } from "./Timeline";

type DetailProps = { app: AppCtx; id: string; onChange: () => void };

/** Loads one record and reloads it on demand. */
function useRecord<T>(path: string, app: AppCtx): [T | null, () => Promise<void>, string] {
  const [rec, setRec] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRec(await api<T>(path));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [load, app.version]);
  return [rec, load, error];
}

function Header({ app, view, name, sub, badges, editable, onEdit, onDelete, square, extra }: {
  app: AppCtx; view: View; name: string; sub?: React.ReactNode; badges?: React.ReactNode; editable: boolean;
  onEdit?: () => void; onDelete?: () => void; square?: boolean; extra?: React.ReactNode;
}) {
  return (
    <>
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back to the list" onClick={() => app.go(view)}><ArrowLeft size={18} /></button>
        <span className="grow" />
        {extra}
        {editable ? (
          <>
            {onEdit ? <button className="btn small" onClick={onEdit}><Pencil size={14} /> Edit</button> : null}
            {onDelete ? <button className="iconbtn" title="Delete" aria-label={`Delete ${name}`} onClick={onDelete}><Trash2 size={16} /></button> : null}
          </>
        ) : (
          <span className="badge" title="Only the owner or a manager can change this record"><Lock size={11} /> Read-only</span>
        )}
      </div>
      <div className="cardhead">
        <Avatar name={name} square={square} big />
        <div className="grow">
          <div className="bigname">{name}</div>
          {sub ? <p className="muted">{sub}</p> : null}
          {badges ? <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{badges}</div> : null}
        </div>
      </div>
    </>
  );
}

function Missing({ error }: { error: string }) {
  return <div className="empty"><p>{error || "Loading…"}</p></div>;
}

function useDelete(app: AppCtx, kind: View, what: string, path: string, onChange: () => void) {
  const [asking, setAsking] = useState(false);
  const dialog = asking ? (
    <Confirm
      title={`Delete ${what}?`}
      message={kind === "accounts" ? "Its contacts, opportunities and their activity go too. This can't be undone." : "This can't be undone."}
      action="Delete"
      danger
      onClose={() => setAsking(false)}
      onConfirm={async () => {
        try {
          await api(path, { method: "DELETE" });
          app.changed();
          onChange();
          app.go(kind);
        } catch (e) {
          app.say((e as Error).message);
        }
      }}
    />
  ) : null;
  return [dialog, () => setAsking(true)] as const;
}

function RelatedLink({ app, view, id, children }: { app: AppCtx; view: View; id: string | null; children: React.ReactNode }) {
  if (!id) return <>{children}</>;
  return <button className="link" onClick={() => app.go(view, id)}>{children}</button>;
}

const site = (url: string) => url ? <a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a> : "";
const mail = (email: string) => email ? <a href={`mailto:${email}`}>{email}</a> : "";
const tel = (phone: string) => phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : "";

export function AccountDetail({ app, id, onChange }: DetailProps) {
  const [a, reload, error] = useRecord<Account & { contacts: Contact[]; opportunities: Opportunity[] }>(`/api/accounts/${id}`, app);
  const [editing, setEditing] = useState<null | "account" | "contact" | "opportunity">(null);
  const [del, askDelete] = useDelete(app, "accounts", "this account", `/api/accounts/${id}`, onChange);
  if (!a) return <Missing error={error} />;
  const done = () => {
    setEditing(null);
    void reload();
    onChange();
    app.changed();
  };
  const open = a.opportunities.filter((o) => o.stage !== "closed_won" && o.stage !== "closed_lost");
  return (
    <div className="card">
      <Header app={app} view="accounts" name={a.name} sub={a.industry} square badges={<Badge value={a.type} />} editable={a.editable} onEdit={() => setEditing("account")} onDelete={askDelete} />
      <section className="panel">
        <Facts items={[["Website", site(a.website)], ["Phone", tel(a.phone)], ["Owner", a.ownerName], ["Address", a.address ? <span className="pre">{a.address}</span> : ""], ["Created", formatDate(a.createdAt)], ["Updated", formatDate(a.updatedAt)]]} />
      </section>
      <section className="panel">
        <h3>Contacts ({a.contacts.length}) <button className="btn small ghost" onClick={() => setEditing("contact")}><Plus size={14} /> Add</button></h3>
        {a.contacts.length ? (
          <table className="mini"><tbody>
            {a.contacts.map((c) => (
              <tr key={c.id}>
                <td><RelatedLink app={app} view="contacts" id={c.id}>{c.name}</RelatedLink></td>
                <td className="muted">{c.title}</td>
                <td>{mail(c.email)}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="muted small">No contacts yet.</p>}
      </section>
      <section className="panel">
        <h3>Opportunities ({a.opportunities.length}) <button className="btn small ghost" onClick={() => setEditing("opportunity")}><Plus size={14} /> Add</button></h3>
        {a.opportunities.length ? (
          <table className="mini">
            <thead><tr><th>Name</th><th>Stage</th><th>Close</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {a.opportunities.map((o) => (
                <tr key={o.id}>
                  <td><RelatedLink app={app} view="opportunities" id={o.id}>{o.name}</RelatedLink></td>
                  <td><Badge value={o.stage} /></td>
                  <td>{formatDate(o.closeDate)}</td>
                  <td className="num">{formatMoney(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">No opportunities yet.</p>}
        {open.length ? <p className="muted small" style={{ marginTop: 8 }}>Open: {formatMoney(open.reduce((s, o) => s + Number(o.amount ?? 0), 0))}</p> : null}
      </section>
      <SharePanel app={app} kind="account" id={a.id} canShare={a.editable} />
      <Timeline app={app} relatedType="account" relatedId={a.id} />
      {editing === "account" ? <AccountEditor app={app} record={a} onClose={() => setEditing(null)} onSaved={done} /> : null}
      {editing === "contact" ? <ContactEditor app={app} preset={{ accountId: a.id }} onClose={() => setEditing(null)} onSaved={done} /> : null}
      {editing === "opportunity" ? <OpportunityEditor app={app} preset={{ accountId: a.id }} onClose={() => setEditing(null)} onSaved={done} /> : null}
      {del}
    </div>
  );
}

export function ContactDetail({ app, id, onChange }: DetailProps) {
  const [c, reload, error] = useRecord<Contact>(`/api/contacts/${id}`, app);
  const [editing, setEditing] = useState(false);
  const [del, askDelete] = useDelete(app, "contacts", "this contact", `/api/contacts/${id}`, onChange);
  if (!c) return <Missing error={error} />;
  return (
    <div className="card">
      <Header
        app={app} view="contacts" name={c.name}
        sub={<>{c.title ? `${c.title} at ` : ""}<RelatedLink app={app} view="accounts" id={c.accountId}>{c.accountName}</RelatedLink></>}
        editable={c.editable} onEdit={() => setEditing(true)} onDelete={askDelete}
      />
      <section className="panel">
        <Facts items={[["Email", mail(c.email)], ["Phone", tel(c.phone)], ["Account", <RelatedLink key="a" app={app} view="accounts" id={c.accountId}>{c.accountName}</RelatedLink>], ["Owner", c.ownerName], ["Created", formatDate(c.createdAt)], ["Updated", formatDate(c.updatedAt)]]} />
      </section>
      <SharePanel app={app} kind="contact" id={c.id} canShare={c.editable} />
      <Timeline app={app} relatedType="contact" relatedId={c.id} />
      {editing ? <ContactEditor app={app} record={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); onChange(); }} /> : null}
      {del}
    </div>
  );
}

export function OpportunityDetail({ app, id, onChange }: DetailProps) {
  const [o, reload, error] = useRecord<Opportunity>(`/api/opportunities/${id}`, app);
  const [editing, setEditing] = useState(false);
  const [del, askDelete] = useDelete(app, "opportunities", "this opportunity", `/api/opportunities/${id}`, onChange);
  if (!o) return <Missing error={error} />;
  const p = effectiveProbability(o.stage, o.probability);
  return (
    <div className="card">
      <Header
        app={app} view="opportunities" name={o.name} square
        sub={<RelatedLink app={app} view="accounts" id={o.accountId}>{o.accountName}</RelatedLink>}
        badges={<><Badge value={o.stage} /><span className="badge">{p}%{o.probability === null ? " (stage default)" : ""}</span></>}
        editable={o.editable} onEdit={() => setEditing(true)} onDelete={askDelete}
      />
      <section className="panel">
        <Facts items={[
          ["Amount", formatMoney(o.amount)], ["Weighted", o.amount ? formatMoney((Number(o.amount) * p) / 100) : ""], ["Expected close", o.closeDate ? formatDate(o.closeDate) : ""],
          ["Owner", o.ownerName], ["Created", formatDate(o.createdAt)], ["Updated", formatDate(o.updatedAt)],
        ]} />
      </section>
      <SharePanel app={app} kind="opportunity" id={o.id} canShare={o.editable} />
      <Timeline app={app} relatedType="opportunity" relatedId={o.id} />
      {editing ? <OpportunityEditor app={app} record={o} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); onChange(); app.changed(); }} /> : null}
      {del}
    </div>
  );
}

function ScoreCard({ app, lead, onChange }: { app: AppCtx; lead: Lead; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canChange = lead.editable && lead.status !== "converted";
  return (
    <section className="panel" aria-label="Lead score">
      <h3><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Sparkles size={14} /> Lead score</span></h3>
      <div className="scorebox">
        {lead.score !== null ? (
          <div className="bigscore">{lead.score}<small>/100</small></div>
        ) : <div className="muted">Not scored yet.</div>}
        <div className="grow">
          {lead.scoreRationale ? <p style={{ margin: 0 }}>{lead.scoreRationale}</p> : null}
          {lead.score !== null ? (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {lead.scoreIsOverride ? "Set by hand" : `Scored by ${lead.scoreModel}`}{lead.scoreUpdatedAt ? ` · ${formatDateTime(lead.scoreUpdatedAt)}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {canChange ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {app.ai && !lead.scoreIsOverride ? (
            <button className="btn small" disabled={busy} onClick={() => run(() => api(`/api/leads/${lead.id}/score`, { method: "POST" }))}>
              <Sparkles size={14} /> {busy ? "Scoring…" : lead.score === null ? "Score with AI" : "Rescore with AI"}
            </button>
          ) : null}
          <button className="btn small" disabled={busy} onClick={() => setManual(true)}>Set score</button>
          {lead.scoreIsOverride ? (
            <button className="btn small ghost" disabled={busy} onClick={() => run(() => api(`/api/leads/${lead.id}/score`, { method: "PUT", json: { score: null } }))}>Clear manual score</button>
          ) : null}
        </div>
      ) : null}
      {manual ? (
        <Modal title="Set the lead score" onClose={() => setManual(false)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = e.currentTarget;
              const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
              const err = f.querySelector(".error") as HTMLElement;
              try {
                await api(`/api/leads/${lead.id}/score`, { method: "PUT", json: { score: get("score"), note: get("note") } });
                setManual(false);
                onChange();
              } catch (x) {
                err.textContent = (x as Error).message;
              }
            }}
          >
            <label><span>Score (0–100)</span><input name="score" type="number" min={0} max={100} required autoFocus defaultValue={lead.score ?? ""} /></label>
            <label><span>Why (optional)</span><input name="note" maxLength={600} /></label>
            <p className="muted small">A score set by hand stays until it is cleared; the AI won&apos;t replace it.</p>
            <p className="error" role="alert" />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setManual(false)}>Cancel</button>
              <button className="btn primary">Save score</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

export function LeadDetail({ app, id, onChange }: DetailProps) {
  const [l, reload, error] = useRecord<Lead>(`/api/leads/${id}`, app);
  const [editing, setEditing] = useState<null | "edit" | "convert">(null);
  const [del, askDelete] = useDelete(app, "leads", "this lead", `/api/leads/${id}`, onChange);
  if (!l) return <Missing error={error} />;
  const converted = l.status === "converted";
  const refresh = () => {
    void reload();
    onChange();
  };
  const related: RecordType = "lead";
  return (
    <div className="card">
      <Header
        app={app} view="leads" name={l.name} sub={l.company}
        badges={<><Badge value={l.status} /><span className="badge">{label(l.source)}</span></>}
        editable={l.editable}
        onEdit={converted ? undefined : () => setEditing("edit")}
        onDelete={askDelete}
        extra={l.editable && !converted ? <button className="btn primary small" onClick={() => setEditing("convert")}><ArrowRight size={14} /> Convert</button> : null}
      />
      {converted ? (
        <div className="notice" role="status">
          <span>Converted {formatDate(l.convertedAt)}{l.convertedAccountName ? ` to ${l.convertedAccountName}` : ""}. Converted leads are read-only.</span>
          <span style={{ display: "flex", gap: 12 }}>
            {l.convertedAccountId ? <RelatedLink app={app} view="accounts" id={l.convertedAccountId}>Account</RelatedLink> : null}
            {l.convertedContactId ? <RelatedLink app={app} view="contacts" id={l.convertedContactId}>Contact</RelatedLink> : null}
            {l.convertedOpportunityId ? <RelatedLink app={app} view="opportunities" id={l.convertedOpportunityId}>Opportunity</RelatedLink> : null}
          </span>
        </div>
      ) : null}
      <section className="panel">
        <Facts items={[["Company", l.company], ["Email", mail(l.email)], ["Phone", tel(l.phone)], ["Source", label(l.source)], ["Owner", l.ownerName], ["Created", formatDate(l.createdAt)]]} />
      </section>
      <ScoreCard app={app} lead={l} onChange={refresh} />
      {l.utmSource || l.utmMedium || l.utmCampaign || l.landingPath ? (
        <section className="panel">
          <h3>Came from</h3>
          <Facts items={[["UTM source", l.utmSource], ["UTM medium", l.utmMedium], ["UTM campaign", l.utmCampaign], ["Landing page", l.landingPath]]} />
        </section>
      ) : null}
      <SharePanel app={app} kind="lead" id={l.id} canShare={l.editable} />
      <Timeline app={app} relatedType={related} relatedId={l.id} />
      {editing === "edit" ? <LeadEditor app={app} record={l} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
      {editing === "convert" ? (
        <ConvertDialog
          app={app}
          lead={l}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
            app.changed();
            app.say("Lead converted");
          }}
        />
      ) : null}
      {del}
    </div>
  );
}
