"use client";
/**
 * Forms, as in Access: Form view shows a table's records one at a time, with a box for each field
 * and subforms listing related records; Design view picks the fields, their order and labels, the
 * subforms, and what people may do, and publishes the form to Synergy Forms as an online form.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Relation, TableInfo } from "@/lib/catalog";
import { isLookup, type Field } from "@/lib/fields";
import { onlineQuestions, SYNERGY_FORMS_TYPES, type FormLayout } from "@/lib/formLayout";
import type { FormInfo } from "@/lib/forms";
import { display, toLocalInput } from "@/lib/format";
import type { Row } from "@/lib/rows";
import { Comments } from "./Comments";
import { Chips, Datasheet, LookupPicker, MultiLookupPicker, type LookupItem } from "./Datasheet";

export type FormMode = "form" | "design";

type Lookup = { id: string | null; label: string };

/** Past any record: load() then shows the last one. */
const LAST = 1_000_000_000;

/** A record's value as its box holds it while being edited. */
function toDraft(f: Field, row: Row | null): unknown {
  const v = row?.values[f.id] ?? null;
  if (f.type === "lookup") return { id: v === null ? null : String(v), label: row?.labels?.[f.id] ?? "" } satisfies Lookup;
  if (f.type === "multilookup") return row?.items?.[f.id] ?? [];
  if (f.type === "yesno") return v === true;
  if (f.type === "multichoice") return Array.isArray(v) ? v : [];
  if (f.type === "datetime") return typeof v === "string" && v ? toLocalInput(v) : "";
  return v === null ? "" : String(v);
}

/** What is sent for a box's value. */
function fromDraft(f: Field, d: unknown): unknown {
  if (f.type === "lookup") return (d as Lookup).id;
  if (f.type === "multilookup") return (d as LookupItem[]).map((i) => i.id);
  if (f.type === "datetime") return typeof d === "string" && d ? new Date(d).toISOString() : null;
  if (typeof d === "string" && d.trim() === "") return null;
  return d;
}

/**
 * One record on its own (a list item opened from a gallery, board or calendar): `id` null adds a
 * new one with `preset` values. There is no record navigation, and `onDone` runs once the record
 * is saved as new, deleted, or the new record is cancelled.
 */
export type SingleRecord = { id: string | null; preset?: Record<string, unknown>; onDone: () => void };

export function FormView({
  form,
  table,
  tables,
  canEdit,
  onFormChanged,
  onTableChanged,
  record,
}: {
  form: FormInfo;
  table: TableInfo;
  tables: TableInfo[];
  canEdit: boolean;
  onFormChanged: (f: FormInfo) => void;
  onTableChanged: () => void;
  record?: SingleRecord;
}) {
  const layout = form.layout;
  const items = useMemo(
    () => layout.items.map((i) => ({ ...i, f: table.fields.find((x) => x.id === i.field) })).filter((i): i is typeof i & { f: Field } => !!i.f),
    [layout.items, table.fields],
  );
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [row, setRow] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const editsAllowed = canEdit && (adding ? layout.allowAdditions : layout.allowEdits);

  const show = useCallback(
    (r: Row | null) => {
      setRow(r);
      setDraft(Object.fromEntries(table.fields.map((f) => [f.id, toDraft(f, r)])));
      setChanged(new Set());
      setPicking(null);
    },
    [table.fields],
  );

  const load = useCallback(
    async (at: number) => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({ offset: String(Math.max(at, 0)), limit: "1" });
        if (search.trim()) sp.set("q", search.trim());
        if (record) {
          if (record.id === null) {
            setAdding(true);
            show(null);
            const preset = Object.entries(record.preset ?? {});
            setDraft((d) => ({ ...d, ...Object.fromEntries(preset) }));
            setChanged(new Set(preset.map(([k]) => k)));
            return;
          }
          const idField = table.fields.find((f) => f.type === "autonumber")!;
          sp.set("require", JSON.stringify([{ field: idField.id, op: "eq", value: record.id }]));
        }
        const data = await api<{ rows: Row[]; total: number }>(`/api/tables/${table.id}/rows?${sp}`);
        setTotal(data.total);
        if (!data.rows[0] && data.total > 0 && at > 0) return load(data.total - 1);
        setIndex(Math.max(Math.min(at, data.total - 1), 0));
        setAdding(false);
        show(data.rows[0] ?? null);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    // The record to show is fixed when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.id, search, show, record?.id],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  /** Saves the record being shown; false when it couldn't be saved. */
  async function save(): Promise<boolean> {
    if (!changed.size) return true;
    const values: Record<string, unknown> = {};
    for (const id of changed) {
      const f = table.fields.find((x) => x.id === id);
      if (f) values[id] = fromDraft(f, draft[id]);
    }
    try {
      if (adding) {
        const { rows } = await api<{ rows: Row[] }>(`/api/tables/${table.id}/rows`, { body: { records: [values] } });
        if (record) {
          record.onDone();
          return true;
        }
        setAdding(false);
        setIndex(total);
        setTotal((n) => n + 1);
        show(rows[0]);
      } else if (row) {
        const { row: updated } = await api<{ row: Row }>(`/api/tables/${table.id}/rows/${row.id}`, { method: "PATCH", body: { values } });
        show(updated);
      }
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function go(at: number) {
    if (!(await save())) return;
    await load(at);
  }

  async function newRecord() {
    if (!(await save())) return;
    setAdding(true);
    show(null);
  }

  async function deleteRecord() {
    if (!row || !confirm("Delete this record? This can't be undone.")) return;
    try {
      await api(`/api/tables/${table.id}/rows`, { method: "DELETE", body: { ids: [row.id] } });
      if (record) return record.onDone();
      await load(Math.min(index, total - 2));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function undo() {
    if (adding && record) record.onDone();
    else if (adding) void load(index);
    else show(row);
  }

  async function getResponses() {
    setNotice("Getting responses…");
    try {
      const r = await api<{ added: number; failed: { submission: string; reason: string }[]; missed: boolean; form: FormInfo }>(`/api/forms/${form.id}/sync`, { method: "POST" });
      onFormChanged(r.form);
      const parts = [r.added ? `Added ${r.added} new record${r.added === 1 ? "" : "s"} from online responses.` : "No new responses."];
      if (r.failed.length) parts.push(`${r.failed.length} couldn't be added: ${r.failed.slice(0, 3).map((f) => f.reason).join("; ")}.`);
      if (r.missed) parts.push("More responses came in than can be read at once; older ones are in Synergy Forms.");
      setNotice(parts.join(" "));
      if (r.added) await load(LAST);
    } catch (e) {
      setNotice("");
      setError((e as Error).message);
    }
  }

  function set(f: Field, v: unknown) {
    setDraft((d) => ({ ...d, [f.id]: v }));
    setChanged((c) => new Set(c).add(f.id));
  }

  function box(f: Field) {
    const v = draft[f.id];
    const ro = !editsAllowed || f.type === "autonumber";
    if (f.type === "autonumber") return <input readOnly value={adding ? "(New)" : String(row?.values[f.id] ?? "")} />;
    if (ro) {
      const shown = isLookup(f) ? (row?.labels?.[f.id] ?? "") : display(f, row?.values[f.id]);
      return <input readOnly value={shown} />;
    }
    switch (f.type) {
      case "lookup": {
        const l = v as Lookup;
        if (picking === f.id)
          return (
            <LookupPicker
              tableId={table.id}
              field={f}
              draft={{ ...l, search: "" }}
              onCommit={(id, label) => {
                setPicking(null);
                if ((id ?? null) !== l.id) set(f, { id: id === null || id === undefined ? null : String(id), label: label ?? "" });
              }}
              onCancel={() => setPicking(null)}
            />
          );
        return (
          <button type="button" className="lookup-box" onClick={() => setPicking(f.id)}>
            {l.id ? l.label || `#${l.id}` : <span className="muted">Pick a record…</span>}
          </button>
        );
      }
      case "multilookup": {
        const items = (v as LookupItem[] | undefined) ?? [];
        if (picking === f.id)
          return (
            <MultiLookupPicker
              tableId={table.id}
              field={f}
              draft={{ items, search: "" }}
              onCommit={(next) => {
                setPicking(null);
                if (next.map((i) => i.id).join() !== items.map((i) => i.id).join()) set(f, next);
              }}
              onCancel={() => setPicking(null)}
            />
          );
        return (
          <button type="button" className="lookup-box" onClick={() => setPicking(f.id)}>
            {items.length ? <Chips items={items} /> : <span className="muted">Pick records…</span>}
          </button>
        );
      }
      case "yesno":
        return <input type="checkbox" checked={v === true} onChange={(e) => set(f, e.target.checked)} />;
      case "choice":
        return (
          <select value={String(v ?? "")} onChange={(e) => set(f, e.target.value)}>
            <option value="" />
            {(f.options.choices ?? []).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        );
      case "multichoice": {
        const picked = new Set(v as string[]);
        return (
          <div className="form-multi">
            {(f.options.choices ?? []).map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={picked.has(c)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(c);
                    else next.delete(c);
                    set(f, [...next]);
                  }}
                />
                {c}
              </label>
            ))}
          </div>
        );
      }
      case "longtext":
        return <textarea rows={4} value={String(v ?? "")} onChange={(e) => set(f, e.target.value)} />;
      default: {
        const type = f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "email" ? "email" : "text";
        return <input type={type} inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined} value={String(v ?? "")} onChange={(e) => set(f, e.target.value)} />;
      }
    }
  }

  const last = Math.max(total - 1, 0);
  const position = adding ? `New record (${total} saved)` : total ? `Record ${index + 1} of ${total}` : "No records";

  return (
    <div
      className="formview"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="toolbar">
        {!record && <input className="search" type="search" placeholder="Find records" value={search} onChange={(e) => setSearch(e.target.value)} />}
        <span className="grow" />
        {form.online && canEdit && (
          <button onClick={getResponses} title={form.online.syncedAt ? `Last brought in ${new Date(form.online.syncedAt).toLocaleString()}` : "Bring in responses to the online form"}>
            Get responses
          </button>
        )}
        {canEdit && layout.allowAdditions && !record && (
          <button onClick={newRecord} disabled={adding}>
            New record
          </button>
        )}
        {canEdit && layout.allowDeletions && (
          <button className="danger" onClick={deleteRecord} disabled={adding || !row}>
            Delete record
          </button>
        )}
      </div>
      {error && (
        <div className="error-bar" role="alert">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="notice-bar" role="status">
          <span>{notice}</span> <button onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      <div className="form-body">
        {layout.title && <h2 className="form-title">{layout.title}</h2>}
        {!row && !adding && !loading ? (
          <p className="muted">
            {record ? "This record no longer exists." : search ? "No records match." : "This table has no records yet."}{" "}
            {canEdit && layout.allowAdditions && !search && !record && <button onClick={newRecord}>Add the first one</button>}
          </p>
        ) : (
          <form
            className={`form-grid cols-${layout.columns}`}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {items.map(({ f, label, wide }) => (
              <div key={f.id} className={`form-item ${wide ? "wide" : ""} ${f.type === "yesno" ? "check" : ""}`}>
                <label>
                  {label ?? f.name}
                  {f.required && editsAllowed && <span className="req">*</span>}
                </label>
                {box(f)}
              </div>
            ))}
            {items.length === 0 && <p className="muted">This form shows no fields; add some in Design view.</p>}
            {editsAllowed && (
              <div className="form-actions wide">
                <button type="submit" className="primary" disabled={!changed.size}>
                  {adding ? "Save new record" : "Save"}
                </button>
                <button type="button" onClick={undo} disabled={!changed.size && !adding}>
                  {adding ? "Cancel" : "Undo changes"}
                </button>
                {changed.size > 0 && <span className="muted small">Unsaved changes; moving to another record saves them.</span>}
              </div>
            )}
          </form>
        )}
        {row &&
          !adding &&
          layout.subforms.map((s) => {
            const child = tables.find((t) => t.id === s.table);
            const via = child?.fields.find((f) => f.id === s.field);
            if (!child || !via) return null;
            return (
              <section key={`${s.table}:${s.field}`} className="subform">
                <h3>{s.label ?? (child.fields.filter((f) => isLookup(f) && f.options.targetTable === table.id).length > 1 ? `${child.name} (${via.name})` : child.name)}</h3>
                <div className="subdatasheet" onKeyDown={(e) => e.stopPropagation()}>
                  <Datasheet key={`${row.id}:${s.field}`} table={child} tables={tables} canEdit={canEdit} onTableChanged={onTableChanged} locked={{ field: s.field, value: row.id }} />
                </div>
              </section>
            );
          })}
        {row && !adding && <Comments tableId={table.id} rowId={row.id} canEdit={canEdit} />}
      </div>
      {!record && (
        <div className="navigator">
          <span className="record-nav">
          <button aria-label="First record" title="First record" onClick={() => go(0)} disabled={adding || index === 0}>
            ⏮
          </button>
          <button aria-label="Previous record" title="Previous record" onClick={() => go(index - 1)} disabled={adding || index === 0}>
            ◀
          </button>
          <span>{position}</span>
          <button aria-label="Next record" title="Next record" onClick={() => go(index + 1)} disabled={adding || index >= last}>
            ▶
          </button>
          <button aria-label="Last record" title="Last record" onClick={() => go(last)} disabled={adding || index >= last}>
            ⏭
          </button>
        </span>
          {form.online && <span className="badge">{form.online.published ? "Online" : "Online form closed"}</span>}
        </div>
      )}
    </div>
  );
}

/** Design view: which fields the form shows and how, its subforms, and the online form. */
export function FormDesign({ form, table, canEdit, onFormChanged }: { form: FormInfo; table: TableInfo; canEdit: boolean; onFormChanged: (f: FormInfo) => void }) {
  const [layout, setLayout] = useState<FormLayout>(form.layout);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<{ title: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) setLayout(form.layout);
  }, [form.layout, dirty]);

  useEffect(() => {
    api<{ relations: Relation[] }>(`/api/tables/${table.id}/related`)
      .then((d) => setRelations(d.relations))
      .catch(() => setRelations([]));
  }, [table.id]);

  const change = (next: Partial<FormLayout>) => {
    setLayout((l) => ({ ...l, ...next }));
    setDirty(true);
  };
  const included = new Set(layout.items.map((i) => i.field));
  const rows = [...layout.items.map((i) => table.fields.find((f) => f.id === i.field)).filter((f): f is Field => !!f), ...table.fields.filter((f) => !included.has(f.id))];
  const online = onlineQuestions(layout, table.fields);

  function item(f: Field, patch: { label?: string; wide?: boolean }) {
    change({ items: layout.items.map((i) => (i.field === f.id ? { ...i, ...patch } : i)) });
  }
  function toggle(f: Field, on: boolean) {
    change({ items: on ? [...layout.items, { field: f.id }] : layout.items.filter((i) => i.field !== f.id) });
  }
  function move(f: Field, by: number) {
    const at = layout.items.findIndex((i) => i.field === f.id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= layout.items.length) return;
    const next = [...layout.items];
    [next[at], next[to]] = [next[to], next[at]];
    change({ items: next });
  }
  function toggleSub(r: Relation, on: boolean) {
    change({ subforms: on ? [...layout.subforms, { table: r.tableId, field: r.fieldId }] : layout.subforms.filter((s) => !(s.table === r.tableId && s.field === r.fieldId)) });
  }

  async function save(): Promise<boolean> {
    try {
      const { form: saved } = await api<{ form: FormInfo }>(`/api/forms/${form.id}`, { method: "PATCH", body: { layout } });
      setDirty(false);
      onFormChanged(saved);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const r = await api<{ form: FormInfo; notes: string[]; added: number }>(`/api/forms/${form.id}/online`, { method: "POST" });
      onFormChanged(r.form);
      const title = form.online ? "The online form now asks for this form's fields." : "The form is online. Anyone with the link can fill it in.";
      setNotes({ title: r.added ? `${title} ${r.added} earlier response${r.added === 1 ? " was" : "s were"} added first.` : title, notes: r.notes });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      const { form: f } = await api<{ form: FormInfo }>(`/api/forms/${form.id}/online`, { method: "DELETE" });
      onFormChanged(f);
      setNotes({ title: "The online form no longer takes responses. Publish again to reopen it.", notes: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="design form-design">
      {error && (
        <div className="error-bar" role="alert">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {notes && (
        <div className="notice-bar" role="status">
          <div>
            <strong>{notes.title}</strong>
            {notes.notes.length > 0 && (
              <ul>
                {notes.notes.map((n, i) => (
                  <li key={i}>{n}.</li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={() => setNotes(null)}>Dismiss</button>
        </div>
      )}
      <table className="fields">
        <thead>
          <tr>
            <th>On form</th>
            <th>Field</th>
            <th>Label</th>
            <th>Full width</th>
            <th>Online</th>
            <th>Order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const it = layout.items.find((i) => i.field === f.id);
            const at = layout.items.findIndex((i) => i.field === f.id);
            return (
              <tr key={f.id} className={it ? "" : "off"}>
                <td>
                  <input type="checkbox" aria-label={`Show ${f.name}`} checked={!!it} disabled={!canEdit} onChange={(e) => toggle(f, e.target.checked)} />
                </td>
                <td>{f.name}</td>
                <td>
                  <input aria-label={`Label for ${f.name}`} placeholder={f.name} value={it?.label ?? ""} disabled={!canEdit || !it} onChange={(e) => item(f, { label: e.target.value || undefined })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${f.name} full width`} checked={!!it?.wide} disabled={!canEdit || !it} onChange={(e) => item(f, { wide: e.target.checked || undefined })} />
                </td>
                <td className="muted small">{!it || f.type === "autonumber" ? "" : online.fieldIds.includes(f.id) ? "Asked" : SYNERGY_FORMS_TYPES[f.type] ? "Over the limit" : "Not online"}</td>
                <td className="order">
                  {it && canEdit && (
                    <>
                      <button aria-label={`Move ${f.name} up`} onClick={() => move(f, -1)} disabled={at === 0}>
                        ↑
                      </button>
                      <button aria-label={`Move ${f.name} down`} onClick={() => move(f, 1)} disabled={at === layout.items.length - 1}>
                        ↓
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="props">
        <h3>Form</h3>
        <div className="prop-grid">
          <label htmlFor="form-title">Title shown</label>
          <input id="form-title" placeholder={form.name} value={layout.title ?? ""} disabled={!canEdit} onChange={(e) => change({ title: e.target.value || undefined })} />
          <label htmlFor="form-cols">Columns</label>
          <select id="form-cols" value={layout.columns} disabled={!canEdit} onChange={(e) => change({ columns: e.target.value === "1" ? 1 : 2 })}>
            <option value={1}>One</option>
            <option value={2}>Two</option>
          </select>
          <label htmlFor="form-edits">Allow edits</label>
          <input id="form-edits" type="checkbox" checked={layout.allowEdits} disabled={!canEdit} onChange={(e) => change({ allowEdits: e.target.checked })} />
          <label htmlFor="form-adds">Allow additions</label>
          <input id="form-adds" type="checkbox" checked={layout.allowAdditions} disabled={!canEdit} onChange={(e) => change({ allowAdditions: e.target.checked })} />
          <label htmlFor="form-dels">Allow deletions</label>
          <input id="form-dels" type="checkbox" checked={layout.allowDeletions} disabled={!canEdit} onChange={(e) => change({ allowDeletions: e.target.checked })} />
        </div>
        <h3 className="spaced">Subforms</h3>
        {relations.length === 0 ? (
          <p className="muted small">No other table looks up {table.name}, so there are no related records to show. Add a lookup field to make a relationship.</p>
        ) : (
          <div className="sub-list">
            {relations.map((r) => {
              const s = layout.subforms.find((x) => x.table === r.tableId && x.field === r.fieldId);
              return (
                <div key={r.fieldId} className="sub-row">
                  <label>
                    <input type="checkbox" checked={!!s} disabled={!canEdit} onChange={(e) => toggleSub(r, e.target.checked)} /> {r.tableName} <span className="muted">(by {r.fieldName})</span>
                  </label>
                  {s && (
                    <input
                      aria-label={`Heading for ${r.tableName}`}
                      placeholder={r.tableName}
                      value={s.label ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => change({ subforms: layout.subforms.map((x) => (x === s ? { ...x, label: e.target.value || undefined } : x)) })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {canEdit && (
          <div className="actions">
            <button className="primary" onClick={save} disabled={!dirty}>
              Save
            </button>
            <button
              onClick={() => {
                setLayout(form.layout);
                setDirty(false);
              }}
              disabled={!dirty}
            >
              Undo changes
            </button>
          </div>
        )}
        <h3 className="spaced">Online form</h3>
        {form.online ? (
          <div className="online">
            <p>
              {form.online.published ? "Taking responses at " : "Closed to responses. Its address was "}
              <a href={form.online.url} target="_blank" rel="noreferrer">
                {form.online.url}
              </a>
              {form.online.published && (
                <button className="small-btn" onClick={() => void navigator.clipboard?.writeText(form.online!.url)}>
                  Copy link
                </button>
              )}
            </p>
            <p className="muted small">
              Responses become new {table.name} records when someone chooses Get responses in Form view
              {form.online.syncedAt ? `; last brought in ${new Date(form.online.syncedAt).toLocaleString()}` : ""}.
            </p>
            {canEdit && (
              <div className="actions">
                <button onClick={publish} disabled={busy}>
                  {form.online.published ? "Update online form" : "Take responses again"}
                </button>
                {form.online.published && (
                  <button onClick={close} disabled={busy}>
                    Stop taking responses
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="online">
            <p className="muted small">
              Publish this form to Synergy Forms to collect records from anyone with the link, without access to the database. It asks the {online.questions.length} field
              {online.questions.length === 1 ? "" : "s"} marked Asked above.
            </p>
            {canEdit && (
              <div className="actions">
                <button className="primary" onClick={publish} disabled={busy || online.questions.length === 0}>
                  {busy ? "Publishing…" : "Publish online"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Picks the table and name of a new form. */
export function NewFormDialog({ tables, onCancel, onCreate }: { tables: TableInfo[]; onCancel: () => void; onCreate: (input: { tableId: string; name: string }) => Promise<void> }) {
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [name, setName] = useState(tables[0]?.name ?? "");
  const [named, setNamed] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-back" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onCreate({ tableId, name });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h3>New form</h3>
        <p className="muted small">The form shows every field of the table, with subforms for the tables that look it up. Change it in Design view.</p>
        <div className="prop-grid">
          <label htmlFor="nf-table">Records from</label>
          <select
            id="nf-table"
            value={tableId}
            onChange={(e) => {
              setTableId(e.target.value);
              if (!named) setName(tables.find((t) => t.id === e.target.value)?.name ?? "");
            }}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label htmlFor="nf-name">Form name</label>
          <input
            id="nf-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!tableId || !name.trim()}>
            Create
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
