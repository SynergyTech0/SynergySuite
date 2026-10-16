"use client";
/**
 * Design view: the table's fields with their data types and descriptions, and the selected
 * field's properties underneath, as in Access. Changing a data type converts the values already
 * stored; if any can't be converted, nothing changes and the reason is shown.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TableInfo } from "@/lib/catalog";
import { FIELD_TYPES, isLookup, TYPE_LABELS, type Field, type FieldType } from "@/lib/fields";
import { ON_DELETE_LABELS } from "./Datasheet";

type Draft = {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
  unique: boolean;
  maxLength: string;
  decimals: string;
  currencyCode: string;
  choices: string;
  defaultValue: string;
  targetTable: string;
  displayField: string;
  onDelete: string;
};

const NEW = "new";

function toDraft(f?: Field): Draft {
  return {
    name: f?.name ?? "",
    type: f?.type ?? "text",
    description: f?.description ?? "",
    required: f?.required ?? false,
    unique: !!f?.options.unique,
    maxLength: f?.options.maxLength ? String(f.options.maxLength) : "",
    decimals: f?.options.decimals !== undefined ? String(f.options.decimals) : "",
    currencyCode: f?.options.currencyCode ?? "",
    choices: (f?.options.choices ?? []).join("\n"),
    targetTable: f?.options.targetTable ?? "",
    displayField: f?.options.displayField ?? "",
    onDelete: f?.options.onDelete ?? "restrict",
    defaultValue: f?.options.defaultValue === undefined ? "" : Array.isArray(f.options.defaultValue) ? f.options.defaultValue.join("; ") : String(f.options.defaultValue),
  };
}

function toBody(d: Draft) {
  const options: Record<string, unknown> = { unique: d.unique };
  if (d.type === "text" && d.maxLength) options.maxLength = Number(d.maxLength);
  if ((d.type === "number" || d.type === "currency") && d.decimals !== "") options.decimals = Number(d.decimals);
  if (d.type === "currency" && d.currencyCode) options.currencyCode = d.currencyCode.toUpperCase();
  if (d.type === "choice" || d.type === "multichoice") options.choices = d.choices.split("\n").map((s) => s.trim()).filter(Boolean);
  if (d.defaultValue.trim() && !isLookup(d)) options.defaultValue = d.defaultValue;
  if (d.type === "lookup") Object.assign(options, { targetTable: d.targetTable, displayField: d.displayField, onDelete: d.onDelete });
  if (d.type === "multilookup") Object.assign(options, { targetTable: d.targetTable, displayField: d.displayField });
  return { name: d.name, type: d.type, description: d.description, required: d.required, options };
}

export function Design({ table, tables, canEdit, onTableChanged }: { table: TableInfo; tables: TableInfo[]; canEdit: boolean; onTableChanged: () => void }) {
  const [selected, setSelected] = useState<string>(table.fields[1]?.id ?? table.fields[0]?.id ?? NEW);
  const field = table.fields.find((f) => f.id === selected);
  const [draft, setDraft] = useState<Draft>(toDraft(field));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(toDraft(table.fields.find((f) => f.id === selected)));
    setError("");
  }, [selected, table]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(field));
  const isId = field?.type === "autonumber";

  async function save() {
    setBusy(true);
    try {
      if (selected === NEW) {
        const { field: f } = await api<{ field: Field }>(`/api/tables/${table.id}/fields`, { body: toBody(draft) });
        setSelected(f.id);
      } else {
        await api(`/api/tables/${table.id}/fields/${selected}`, { method: "PATCH", body: isId ? { name: draft.name } : toBody(draft) });
      }
      setError("");
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!field || !confirm(`Delete the field "${field.name}" and all of its data?`)) return;
    try {
      await api(`/api/tables/${table.id}/fields/${field.id}`, { method: "DELETE" });
      setSelected(table.fields[0].id);
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function shift(f: Field, by: -1 | 1) {
    const list = table.fields.filter((x) => x.type !== "autonumber");
    const i = list.findIndex((x) => x.id === f.id);
    const other = list[i + by];
    if (!other) return;
    try {
      await api(`/api/tables/${table.id}/fields/${f.id}`, { method: "PATCH", body: { position: other.position } });
      await api(`/api/tables/${table.id}/fields/${other.id}`, { method: "PATCH", body: { position: f.position } });
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const ro = !canEdit;

  return (
    <div className="design">
      <table className="fields">
        <thead>
          <tr>
            <th>Field Name</th>
            <th>Data Type</th>
            <th>Description (optional)</th>
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {table.fields.map((f, i) => (
            <tr key={f.id} className={f.id === selected ? "sel" : ""} onClick={() => setSelected(f.id)}>
              <td>
                {f.type === "autonumber" && <span title="Primary key">🔑 </span>}
                {f.name}
              </td>
              <td>
                {TYPE_LABELS[f.type]}
                {isLookup(f) && <span className="muted"> → {tables.find((t) => t.id === f.options.targetTable)?.name ?? "?"}</span>}
              </td>
              <td className="muted">{f.description}</td>
              {canEdit && (
                <td className="order">
                  {f.type !== "autonumber" && (
                    <>
                      <button aria-label="Move up" disabled={i <= 1} onClick={(e) => { e.stopPropagation(); void shift(f, -1); }}>↑</button>
                      <button aria-label="Move down" disabled={i === table.fields.length - 1} onClick={(e) => { e.stopPropagation(); void shift(f, 1); }}>↓</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
          {canEdit && (
            <tr className={selected === NEW ? "sel" : "new-row"} onClick={() => setSelected(NEW)}>
              <td colSpan={4} className="muted">
                + Add a field
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="props">
        <h3>{selected === NEW ? "New field" : `Field properties: ${field?.name ?? ""}`}</h3>
        {error && <p className="error">{error}</p>}
        <div className="prop-grid">
          <label>Field name</label>
          <input value={draft.name} disabled={ro} onChange={(e) => set({ name: e.target.value })} maxLength={64} />
          <label>Data type</label>
          <select
            value={draft.type}
            disabled={ro || isId || (field?.type === "multilookup" && selected !== NEW)}
            title={field?.type === "multilookup" && selected !== NEW ? "A multi-value lookup keeps its type; add a new field for another kind of data" : undefined}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              const targetTable = draft.targetTable || (tables.find((t) => t.id !== table.id) ?? table).id;
              set(type === "lookup" || type === "multilookup" ? { type, targetTable } : { type });
            }}
          >
            {FIELD_TYPES.filter((t) => t !== "autonumber" || isId).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          {!isId && (
            <>
              <label>Description</label>
              <input value={draft.description} disabled={ro} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
              {draft.type === "text" && (
                <>
                  <label>Field size</label>
                  <input type="number" min={1} max={255} placeholder="255" value={draft.maxLength} disabled={ro} onChange={(e) => set({ maxLength: e.target.value })} />
                </>
              )}
              {(draft.type === "number" || draft.type === "currency") && (
                <>
                  <label>Decimal places</label>
                  <input type="number" min={0} max={10} placeholder="Auto" value={draft.decimals} disabled={ro} onChange={(e) => set({ decimals: e.target.value })} />
                </>
              )}
              {draft.type === "currency" && (
                <>
                  <label>Currency</label>
                  <input placeholder="USD" maxLength={3} value={draft.currencyCode} disabled={ro} onChange={(e) => set({ currencyCode: e.target.value })} />
                </>
              )}
              {isLookup(draft) && (
                <>
                  <label>Look up records in</label>
                  <select
                    value={draft.targetTable}
                    disabled={ro || (!!field && isLookup(field) && selected !== NEW)}
                    title={field && isLookup(field) ? "A lookup keeps its table; add a new field to look up another" : undefined}
                    onChange={(e) => set({ targetTable: e.target.value, displayField: "" })}
                  >
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <label>Show</label>
                  <select value={draft.displayField} disabled={ro} onChange={(e) => set({ displayField: e.target.value })}>
                    <option value="">(first field)</option>
                    {tables
                      .find((t) => t.id === draft.targetTable)
                      ?.fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                  <label>When a related record is deleted</label>
                  {draft.type === "multilookup" ? (
                    <span className="muted small">It's taken off the list</span>
                  ) : (
                    <select value={draft.onDelete} disabled={ro} onChange={(e) => set({ onDelete: e.target.value })}>
                      {Object.entries(ON_DELETE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {(draft.type === "choice" || draft.type === "multichoice") && (
                <>
                  <label>Choices (one per line)</label>
                  <textarea rows={5} value={draft.choices} disabled={ro} onChange={(e) => set({ choices: e.target.value })} />
                </>
              )}
              {!isLookup(draft) && <label>Default value</label>}
              {!isLookup(draft) && <input value={draft.defaultValue} disabled={ro} onChange={(e) => set({ defaultValue: e.target.value })} placeholder={draft.type === "yesno" ? "Yes or No" : draft.type === "date" ? "2026-10-16" : ""} />}
              <label>Required</label>
              <input type="checkbox" checked={draft.required} disabled={ro} onChange={(e) => set({ required: e.target.checked })} />
              {draft.type !== "longtext" && draft.type !== "multichoice" && draft.type !== "multilookup" && (
                <>
                  <label>Indexed (no duplicates)</label>
                  <input type="checkbox" checked={draft.unique} disabled={ro} onChange={(e) => set({ unique: e.target.checked })} />
                </>
              )}
            </>
          )}
        </div>
        {canEdit && (
          <div className="actions">
            <button className="primary" disabled={busy || !draft.name.trim() || (selected !== NEW && !dirty)} onClick={save}>
              {selected === NEW ? "Add field" : "Save field"}
            </button>
            {field && !isId && (
              <button className="danger" onClick={remove}>
                Delete field
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
