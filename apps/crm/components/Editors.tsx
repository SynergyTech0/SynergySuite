"use client";
// The create/edit dialogs for each kind of record, and the lead conversion dialog.
import { useEffect, useState } from "react";
import { STAGE_PROBABILITY } from "@/lib/pipeline";
import {
  ACCOUNT_TYPES, LEAD_SOURCES, LEAD_STATUSES, STAGES, label,
  type Account, type Contact, type ConvertResult, type Lead, type Opportunity, type Stage,
} from "@/lib/types";
import { api } from "./client";
import { Modal } from "./Modal";
import { OwnerField, formData, type AppCtx } from "./shared";

type EditorProps<T> = { app: AppCtx; record?: T | null; preset?: Partial<T>; onClose: () => void; onSaved: (r: T) => void };

/** The dialog frame every editor shares: fields, an error line, Cancel and Save. */
function EditorForm<T>({ title, path, method, onClose, onSaved, children, action = "Save", wide = true }: {
  title: string; path: string; method: "POST" | "PATCH"; onClose: () => void; onSaved: (r: T) => void;
  children: React.ReactNode; action?: string; wide?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            onSaved(await api<T>(path, { method, json: formData(e.currentTarget) }));
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        {children}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : action}</button>
        </div>
      </form>
    </Modal>
  );
}

function Choice({ name, text, value, options, labelOf = label }: { name: string; text: string; value: string; options: readonly string[]; labelOf?: (v: string) => string }) {
  return (
    <label>
      <span>{text}</span>
      <select name={name} defaultValue={value} aria-label={text}>
        {options.map((o) => <option key={o} value={o}>{labelOf(o)}</option>)}
      </select>
    </label>
  );
}

function Text({ name, text, value, type = "text", required, autoFocus, placeholder }: {
  name: string; text: string; value?: string | null; type?: string; required?: boolean; autoFocus?: boolean; placeholder?: string;
}) {
  return (
    <label>
      <span>{text}</span>
      <input name={name} type={type} defaultValue={value ?? ""} required={required} autoFocus={autoFocus} placeholder={placeholder} />
    </label>
  );
}

/**
 * Account choice for contacts and deals. There can be a great many accounts (an import brings
 * 160,000), so it shows the first 50 by name and narrows as you type.
 */
function AccountField({ value }: { value: string }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(value);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (value) void api<Account>(`/api/accounts/${value}`).then((a) => setCurrent({ id: a.id, name: a.name })).catch(() => {});
  }, [value]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "";
      void api<Account[]>(`/api/accounts?limit=50${q}`).then(setAccounts).catch(() => setAccounts([]));
    }, query ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [query]);
  const options = [...(current && !accounts?.some((a) => a.id === current.id) ? [current] : []), ...(accounts ?? [])];
  return (
    <div className="accountpick">
      <label>
        <span>Account</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find an account" aria-label="Find an account" />
      </label>
      <select name="accountId" aria-label="Account" value={picked} onChange={(e) => setPicked(e.target.value)} required disabled={!accounts}>
        <option value="">{accounts ? (accounts.length ? "Choose an account…" : "No accounts match") : "Loading…"}</option>
        {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>
  );
}

export function AccountEditor({ app, record, onClose, onSaved }: EditorProps<Account>) {
  const r = record;
  return (
    <EditorForm<Account> title={r ? "Edit account" : "New account"} path={r ? `/api/accounts/${r.id}` : "/api/accounts"} method={r ? "PATCH" : "POST"} onClose={onClose} onSaved={onSaved}>
      <Text name="name" text="Account name" value={r?.name} required autoFocus />
      <div className="grid2">
        <Choice name="type" text="Type" value={r?.type ?? "prospect"} options={ACCOUNT_TYPES} />
        <Text name="industry" text="Industry" value={r?.industry} />
        <Text name="website" text="Website" value={r?.website} placeholder="example.com" />
        <Text name="phone" text="Phone" value={r?.phone} type="tel" />
      </div>
      <label>
        <span>Address</span>
        <textarea name="address" rows={2} defaultValue={r?.address ?? ""} />
      </label>
      <div className="grid3">
        <Text name="city" text="City" value={r?.city} />
        <Text name="state" text="State" value={r?.state} />
        <Text name="postalCode" text="ZIP / postal code" value={r?.postalCode} />
      </div>
      <OwnerField app={app} value={r?.owner ?? app.me.email} />
    </EditorForm>
  );
}

export function ContactEditor({ app, record, preset, onClose, onSaved }: EditorProps<Contact>) {
  const r = record;
  return (
    <EditorForm<Contact> title={r ? "Edit contact" : "New contact"} path={r ? `/api/contacts/${r.id}` : "/api/contacts"} method={r ? "PATCH" : "POST"} onClose={onClose} onSaved={onSaved}>
      <Text name="name" text="Name" value={r?.name} required autoFocus />
      <AccountField value={r?.accountId ?? preset?.accountId ?? ""} />
      <div className="grid2">
        <Text name="title" text="Title" value={r?.title} />
        <Text name="email" text="Email" value={r?.email} type="email" />
        <Text name="phone" text="Phone" value={r?.phone} type="tel" />
      </div>
      <OwnerField app={app} value={r?.owner ?? app.me.email} />
    </EditorForm>
  );
}

export function LeadEditor({ app, record, onClose, onSaved }: EditorProps<Lead>) {
  const r = record;
  return (
    <EditorForm<Lead> title={r ? "Edit lead" : "New lead"} path={r ? `/api/leads/${r.id}` : "/api/leads"} method={r ? "PATCH" : "POST"} onClose={onClose} onSaved={onSaved}>
      <Text name="name" text="Name" value={r?.name} required autoFocus />
      <div className="grid2">
        <Text name="company" text="Company" value={r?.company} />
        <Text name="email" text="Email" value={r?.email} type="email" />
        <Text name="phone" text="Phone" value={r?.phone} type="tel" />
        <Choice name="source" text="Source" value={r?.source ?? "other"} options={LEAD_SOURCES} />
        <Choice name="status" text="Status" value={r?.status ?? "new"} options={LEAD_STATUSES.filter((s) => s !== "converted")} />
      </div>
      <OwnerField app={app} value={r?.owner ?? app.me.email} />
    </EditorForm>
  );
}

export function OpportunityEditor({ app, record, preset, onClose, onSaved }: EditorProps<Opportunity>) {
  const r = record;
  const [stage, setStage] = useState<Stage>(r?.stage ?? "prospecting");
  return (
    <EditorForm<Opportunity> title={r ? "Edit opportunity" : "New opportunity"} path={r ? `/api/opportunities/${r.id}` : "/api/opportunities"} method={r ? "PATCH" : "POST"} onClose={onClose} onSaved={onSaved}>
      <Text name="name" text="Opportunity name" value={r?.name} required autoFocus />
      <AccountField value={r?.accountId ?? preset?.accountId ?? ""} />
      <div className="grid2">
        <Text name="amount" text="Amount (USD)" value={r?.amount} placeholder="50000" />
        <label>
          <span>Stage</span>
          <select name="stage" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <Text name="closeDate" text="Expected close" value={r?.closeDate} type="date" />
        <label>
          <span>Probability (%)</span>
          <input name="probability" type="number" min={0} max={100} defaultValue={r?.probability ?? ""} placeholder={`${STAGE_PROBABILITY[stage]} (stage default)`} />
        </label>
      </div>
      <OwnerField app={app} value={r?.owner ?? app.me.email} />
    </EditorForm>
  );
}

/** Lead conversion: one account, one contact and optionally a deal, created together. */
export function ConvertDialog({ app, lead, onClose, onDone }: { app: AppCtx; lead: Lead; onClose: () => void; onDone: (r: ConvertResult) => void }) {
  const [withOpp, setWithOpp] = useState(true);
  const company = lead.company || lead.name;
  return (
    <EditorForm<ConvertResult> title={`Convert ${lead.name}`} path={`/api/leads/${lead.id}/convert`} method="POST" onClose={onClose} onSaved={onDone} action="Convert lead">
      <fieldset>
        <legend>Account and contact</legend>
        <div className="grid2">
          <Text name="accountName" text="Account name" value={company} required autoFocus />
          <Choice name="accountType" text="Account type" value="prospect" options={ACCOUNT_TYPES} />
          <Text name="contactName" text="Contact name" value={lead.name} required />
          <Text name="contactTitle" text="Contact title" />
          <Text name="contactEmail" text="Contact email" value={lead.email} type="email" />
          <Text name="contactPhone" text="Contact phone" value={lead.phone} type="tel" />
        </div>
      </fieldset>
      <fieldset>
        <legend>
          <label className="check" style={{ display: "inline-flex" }}>
            <input type="checkbox" name="createOpportunity" checked={withOpp} onChange={(e) => setWithOpp(e.target.checked)} />
            Create an opportunity
          </label>
        </legend>
        {withOpp ? (
          <div className="grid2">
            <Text name="opportunityName" text="Opportunity name" value={`${company} deal`} required />
            <Text name="amount" text="Amount (USD)" placeholder="50000" />
            <Choice name="stage" text="Stage" value="prospecting" options={STAGES.filter((s) => s !== "closed_lost")} />
            <Text name="closeDate" text="Expected close" type="date" />
          </div>
        ) : <p className="muted small">Only the account and contact will be created.</p>}
      </fieldset>
      <OwnerField app={app} value={lead.owner} text="Owner of everything created" />
    </EditorForm>
  );
}
