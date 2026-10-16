"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import type { AppInfo } from "./ContractsApp";
import { Modal } from "./Modal";

type Tpl = { id: string; name: string; type: string; description: string; fields: string[] };

export type Terms = {
  title: string; type: string; counterparty: string; counterpartyEmail: string; value: string; currency: string;
  startDay: string; endDay: string; autoRenew: boolean; renewalMonths: string; noticeDays: string; crmDeal: string;
};

export const BLANK_TERMS: Terms = {
  title: "", type: "Other", counterparty: "", counterpartyEmail: "", value: "", currency: "USD",
  startDay: "", endDay: "", autoRenew: false, renewalMonths: "12", noticeDays: "30", crmDeal: "",
};

/** The terms fields, shared by the new-contract dialog and the contract's own terms form. */
export function TermsFields({ t, set, types }: { t: Terms; set: (t: Terms) => void; types: string[] }) {
  const f = (k: keyof Terms) => ({
    value: String(t[k]),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...t, [k]: e.target.value }),
  });
  return (
    <>
      <label><span>Title</span><input {...f("title")} required /></label>
      <div className="row2">
        <label><span>Type</span><select {...f("type")}>{types.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label><span>CRM deal (optional)</span><input {...f("crmDeal")} placeholder="Deal name or link" /></label>
      </div>
      <div className="row2">
        <label><span>Counterparty</span><input {...f("counterparty")} /></label>
        <label><span>Their email</span><input type="email" {...f("counterpartyEmail")} /></label>
      </div>
      <div className="row2">
        <label><span>Value</span><input inputMode="decimal" {...f("value")} placeholder="0.00" /></label>
        <label><span>Currency</span><input {...f("currency")} maxLength={3} /></label>
      </div>
      <div className="row2">
        <label><span>Starts</span><input type="date" {...f("startDay")} /></label>
        <label><span>Ends</span><input type="date" {...f("endDay")} /></label>
      </div>
      <div className="row3">
        <label className="check"><input type="checkbox" checked={t.autoRenew} onChange={(e) => set({ ...t, autoRenew: e.target.checked })} /> Renews by itself</label>
        <label><span>Renewal term (months)</span><input inputMode="numeric" {...f("renewalMonths")} /></label>
        <label><span>Notice period (days)</span><input inputMode="numeric" {...f("noticeDays")} /></label>
      </div>
    </>
  );
}

export function termsPayload(t: Terms) {
  return {
    ...t,
    value: t.value === "" ? null : t.value,
    renewalMonths: t.renewalMonths === "" ? undefined : Number(t.renewalMonths),
    noticeDays: t.noticeDays === "" ? undefined : Number(t.noticeDays),
  };
}

export function NewContract({ info, onClose, onSaved }: { info: AppInfo; onClose: () => void; onSaved: (id: string) => void }) {
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [tpl, setTpl] = useState("");
  const [t, setT] = useState<Terms>(BLANK_TERMS);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Tpl[]>("/api/templates").then(setTemplates).catch(() => {});
  }, []);
  const chosen = templates.find((x) => x.id === tpl);

  return (
    <Modal title="New contract" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const out = await api<{ id: string }>("/api/contracts", { method: "POST", json: { ...termsPayload(t), templateId: tpl || undefined, values } });
            onSaved(out.id);
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          <span>Start from</span>
          <select
            value={tpl}
            onChange={(e) => {
              setTpl(e.target.value);
              const x = templates.find((y) => y.id === e.target.value);
              if (x) setT((cur) => ({ ...cur, type: x.type, title: cur.title || x.name }));
            }}
          >
            <option value="">A blank contract</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        {chosen?.description && <p className="muted small">{chosen.description}</p>}
        <TermsFields t={t} set={setT} types={info.types} />
        {chosen && chosen.fields.length > 0 && (
          <>
            <h3>Template details</h3>
            {chosen.fields.map((name) => (
              <label key={name}>
                <span>{name}</span>
                <input value={values[name] ?? ""} onChange={(e) => setValues({ ...values, [name]: e.target.value })} />
              </label>
            ))}
          </>
        )}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Create draft</button>
        </div>
      </form>
    </Modal>
  );
}
