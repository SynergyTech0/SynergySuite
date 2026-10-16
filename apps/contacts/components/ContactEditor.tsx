"use client";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { EMPTY_CONTACT, type Address, type Contact, type ContactInput, type Labeled } from "@/lib/types";
import { cap, LABELS } from "./client";

type Props = {
  initial: Contact | Partial<ContactInput> | null;
  title: string;
  onSave: (c: ContactInput) => Promise<void>;
  onCancel: () => void;
};

function LabeledRows({ legend, kind, rows, set, type, placeholder }: {
  legend: string; kind: keyof typeof LABELS; rows: Labeled[]; set: (r: Labeled[]) => void; type: string; placeholder: string;
}) {
  const options = LABELS[kind];
  return (
    <fieldset className="rows">
      <legend>{legend}</legend>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <select aria-label={`${legend} ${i + 1} label`} value={options.includes(r.label) ? r.label : "other"} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}>
            {options.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
          </select>
          <input
            aria-label={`${legend} ${i + 1}`}
            type={type}
            value={r.value}
            placeholder={placeholder}
            autoFocus={!r.value && i === rows.length - 1 && i > 0}
            onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button type="button" className="iconbtn" aria-label={`Remove ${legend.toLowerCase()} ${i + 1}`} onClick={() => set(rows.filter((_, j) => j !== i))}>
            <X size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="linkbtn addrow" onClick={() => set([...rows, { label: options[0], value: "" }])}>
        <Plus size={14} /> Add {legend.toLowerCase().replace(/s$/, "")}
      </button>
    </fieldset>
  );
}

export function ContactEditor({ initial, title, onSave, onCancel }: Props) {
  const [c, setC] = useState<ContactInput>(() => {
    const base = { ...EMPTY_CONTACT, ...(initial ?? {}) } as ContactInput;
    return {
      ...base,
      // An empty row to type into, so a new contact doesn't need an extra click.
      emails: base.emails.length ? base.emails : [{ label: "work", value: "" }],
      phones: base.phones.length ? base.phones : [{ label: "mobile", value: "" }],
    };
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => setC((x) => ({ ...x, [k]: v }));
  const field = (k: keyof ContactInput, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      <span>{label}</span>
      <input value={c[k] as string} onChange={(e) => set(k, e.target.value as never)} {...extra} />
    </label>
  );
  const setAddr = (i: number, patch: Partial<Address>) => set("addresses", c.addresses.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await onSave({
            ...c,
            emails: c.emails.filter((x) => x.value.trim()),
            phones: c.phones.filter((x) => x.value.trim()),
            websites: c.websites.filter((x) => x.value.trim()),
          });
        } catch (x) {
          setError((x as Error).message);
          setSaving(false);
        }
      }}
    >
      <div className="editorhead">
        <h2>{title}</h2>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      <p className="error" role="alert">{error}</p>
      <div className="editorbody form">
        <div className="grid2">
          {field("firstName", "First name", { autoFocus: true, autoComplete: "off" })}
          {field("lastName", "Last name", { autoComplete: "off" })}
          {field("middleName", "Middle name", { autoComplete: "off" })}
          {field("nickname", "Nickname", { autoComplete: "off" })}
          {field("company", "Company", { autoComplete: "off" })}
          {field("jobTitle", "Job title", { autoComplete: "off" })}
          {field("department", "Department", { autoComplete: "off" })}
          <label>
            <span>Birthday</span>
            <input type="date" value={c.birthday.startsWith("1604-") ? "" : c.birthday} onChange={(e) => set("birthday", e.target.value)} />
          </label>
        </div>
        <LabeledRows legend="Emails" kind="email" type="email" placeholder="name@example.com" rows={c.emails} set={(r) => set("emails", r)} />
        <LabeledRows legend="Phones" kind="phone" type="tel" placeholder="+1 555 0100" rows={c.phones} set={(r) => set("phones", r)} />
        <fieldset className="rows">
          <legend>Addresses</legend>
          {c.addresses.map((a, i) => (
            <div className="address" key={i}>
              <div className="row">
                <select aria-label={`Address ${i + 1} label`} value={LABELS.address.includes(a.label) ? a.label : "other"} onChange={(e) => setAddr(i, { label: e.target.value })}>
                  {LABELS.address.map((o) => <option key={o} value={o}>{cap(o)}</option>)}
                </select>
                <span className="grow" />
                <button type="button" className="iconbtn" aria-label={`Remove address ${i + 1}`} onClick={() => set("addresses", c.addresses.filter((_, j) => j !== i))}>
                  <Trash2 size={16} />
                </button>
              </div>
              <textarea aria-label="Street" placeholder="Street" rows={2} value={a.street} onChange={(e) => setAddr(i, { street: e.target.value })} />
              <div className="grid2">
                <input aria-label="City" placeholder="City" value={a.city} onChange={(e) => setAddr(i, { city: e.target.value })} />
                <input aria-label="State or region" placeholder="State or region" value={a.region} onChange={(e) => setAddr(i, { region: e.target.value })} />
                <input aria-label="Postal code" placeholder="Postal code" value={a.postcode} onChange={(e) => setAddr(i, { postcode: e.target.value })} />
                <input aria-label="Country" placeholder="Country" value={a.country} onChange={(e) => setAddr(i, { country: e.target.value })} />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="linkbtn addrow"
            onClick={() => set("addresses", [...c.addresses, { label: "work", street: "", city: "", region: "", postcode: "", country: "" }])}
          >
            <Plus size={14} /> Add address
          </button>
        </fieldset>
        <LabeledRows legend="Websites" kind="website" type="text" placeholder="example.com" rows={c.websites} set={(r) => set("websites", r)} />
        <label>
          <span>Notes</span>
          <textarea rows={4} value={c.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
      </div>
    </form>
  );
}
