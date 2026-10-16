"use client";
import { Shield } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";
import { type Item, type Label, api, findLabel } from "./client";

/** A sensitivity label as a small colored chip; nothing for an unlabeled item. */
export function LabelChip({ id, labels }: { id: string | null | undefined; labels: Label[] }) {
  if (!id) return null;
  const l = findLabel(labels, id);
  return (
    <span
      className="labelchip"
      style={l ? { color: l.color, borderColor: l.color } : undefined}
      title={l ? `Sensitivity: ${l.name}${l.description ? ` - ${l.description}` : ""}` : "A label that is no longer in the organization's list"}
    >
      <Shield size={11} /> {l?.name ?? "Unknown label"}
    </span>
  );
}

/** The labels to pick from, with "No label" first. */
export function LabelSelect({ value, labels, onChange, disabled }: {
  value: string | null; labels: Label[]; onChange: (id: string | null) => void; disabled?: boolean;
}) {
  const known = findLabel(labels, value);
  return (
    <select
      className="labelselect"
      aria-label="Sensitivity label"
      value={known?.id ?? value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">No label</option>
      {value && !known && <option value={value}>Unknown label</option>}
      {labels.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  );
}

/** Choosing an item's label from the context menu. */
export function LabelDialog({ item, labels, onClose, onChanged }: { item: Item; labels: Label[]; onClose: () => void; onChanged: () => void }) {
  const [pick, setPick] = useState<string | null>(findLabel(labels, item.labelId)?.id ?? item.labelId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Sensitivity of "${item.name}"`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(`/api/items/${item.id}`, { method: "PATCH", json: { labelId: pick } });
            onChanged();
            onClose();
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ul className="labelpick">
          <li>
            <label>
              <input type="radio" name="label" checked={!pick} onChange={() => setPick(null)} />
              <span className="grow"><b>No label</b></span>
            </label>
          </li>
          {labels.map((l) => (
            <li key={l.id}>
              <label>
                <input type="radio" name="label" checked={pick === l.id} onChange={() => setPick(l.id)} />
                <span className="grow">
                  <LabelChip id={l.id} labels={labels} />
                  {l.description && <span className="muted small"> {l.description}</span>}
                  {l.protection.blockExternal && <span className="muted small"> Can&apos;t be shared outside the organization.</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Apply</button>
        </div>
      </form>
    </Modal>
  );
}
