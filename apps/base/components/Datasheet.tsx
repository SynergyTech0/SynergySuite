"use client";
/**
 * Datasheet view: the table's records in a grid, edited in place, as in Access and Lists.
 * Click a cell to select it, type or press Enter (or double-click) to edit, Enter or Tab to
 * save, Esc to cancel. The last row adds a record. Headers sort; the bar above filters and
 * searches; the footer counts records and exports what's shown as CSV.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Relation, TableInfo } from "@/lib/catalog";
import { FIELD_TYPES, isLookup, TYPE_LABELS, type Field, type FieldType } from "@/lib/fields";
import { OP_LABELS, operatorsFor, type Condition, type FilterSpec, type SortSpec } from "@/lib/filter";
import { alignRight, display, toLocalInput } from "@/lib/format";
import type { Row } from "@/lib/rows";
import { SheetsLink } from "./SheetsLink";

const PAGE = 200;
const NEW = "new";

type Cell = { row: string; field: string };

type Props = {
  table: TableInfo;
  /** Every table in the database, for lookups and subdatasheets. */
  tables: TableInfo[];
  canEdit: boolean;
  onTableChanged: () => void;
  /**
   * A subdatasheet: only records whose lookup `field` points at record `value` are shown, new
   * records get that value, and the field itself is hidden (as Access hides the link field).
   */
  locked?: { field: string; value: string };
};

export function Datasheet({ table, tables, canEdit, onTableChanged, locked }: Props) {
  const fields = useMemo(() => table.fields.filter((f) => f.id !== locked?.field), [table.fields, locked?.field]);
  const nested = !!locked;
  const [relations, setRelations] = useState<Relation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lookupDialog, setLookupDialog] = useState<"lookup" | "multilookup" | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortSpec>([]);
  const [filter, setFilter] = useState<FilterSpec>({ match: "all", conditions: [] });
  const [showFilter, setShowFilter] = useState(false);
  const [sel, setSel] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<{ cell: Cell; draft: unknown } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadSeq = useRef(0);

  // Conditions still waiting for a value don't filter yet.
  const activeFilter = useMemo(() => {
    const conditions = filter.conditions
      .map((c) => (fields.find((f) => f.id === c.field)?.type === "yesno" && !c.value ? { ...c, value: "true" } : c))
      .filter((c) => c.op === "empty" || c.op === "notempty" || String(c.value ?? "").trim() !== "");
    return { ...filter, conditions };
  }, [filter, fields]);
  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (search.trim()) sp.set("q", search.trim());
    if (sort.length) sp.set("sort", JSON.stringify(sort));
    if (activeFilter.conditions.length) sp.set("filter", JSON.stringify(activeFilter));
    if (locked) sp.set("require", JSON.stringify([{ field: locked.field, op: "eq", value: locked.value }]));
    return sp;
  }, [search, sort, activeFilter, locked]);

  // Tables whose lookups point here: each record can open their matching records below it.
  useEffect(() => {
    if (nested) return;
    api<{ relations: Relation[] }>(`/api/tables/${table.id}/related`)
      .then((d) => setRelations(d.relations))
      .catch(() => setRelations([]));
  }, [table.id, nested, tables]);

  // A changed data type changes the stored values, so the records are read again.
  const fieldsKey = fields.map((f) => `${f.id}:${f.type}`).join(",");

  const load = useCallback(
    async (offset = 0) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      try {
        const sp = new URLSearchParams(query);
        sp.set("offset", String(offset));
        sp.set("limit", String(PAGE));
        const data = await api<{ rows: Row[]; total: number }>(`/api/tables/${table.id}/rows?${sp}`);
        if (seq !== loadSeq.current) return;
        setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
        setTotal(data.total);
        setError("");
      } catch (e) {
        if (seq === loadSeq.current) setError((e as Error).message);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [table.id, query],
  );

  // Reload when the view changes; the search box waits for typing to pause.
  useEffect(() => {
    const t = setTimeout(() => void load(0), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, fieldsKey]);

  const rowIds = useMemo(() => [...rows.map((r) => r.id), ...(canEdit ? [NEW] : [])], [rows, canEdit]);
  const editable = (f: Field) => canEdit && f.type !== "autonumber";

  async function commit(cell: Cell, value: unknown) {
    const f = fields.find((x) => x.id === cell.field)!;
    setEditing(null);
    try {
      if (cell.row === NEW) {
        if (value === "" || value === null) return;
        const { rows: added } = await api<{ rows: Row[] }>(`/api/tables/${table.id}/rows`, { body: { records: [{ [f.id]: value, ...(locked ? { [locked.field]: locked.value } : {}) }] } });
        setRows((prev) => [...prev, ...added]);
        setTotal((n) => n + 1);
        setSel({ row: added[0].id, field: cell.field });
      } else {
        const row = rows.find((r) => r.id === cell.row);
        if (row && JSON.stringify(row.values[f.id] ?? null) === JSON.stringify(value === "" ? null : value)) return;
        const { row: updated } = await api<{ row: Row }>(`/api/tables/${table.id}/rows/${cell.row}`, { method: "PATCH", body: { values: { [f.id]: value } } });
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    gridRef.current?.focus();
  }

  function startEdit(cell: Cell, initial?: string) {
    const f = fields.find((x) => x.id === cell.field);
    if (!f || !editable(f)) return;
    if (f.type === "yesno") {
      const row = rows.find((r) => r.id === cell.row);
      void commit(cell, !(row?.values[f.id] ?? false));
      return;
    }
    const current = rows.find((r) => r.id === cell.row)?.values[f.id];
    let draft: unknown = initial ?? current ?? "";
    if (f.type === "datetime" && typeof draft === "string" && draft && initial === undefined) draft = toLocalInput(draft);
    if (f.type === "multichoice") draft = Array.isArray(current) ? current : [];
    if (f.type === "lookup") {
      const row = rows.find((r) => r.id === cell.row);
      draft = { id: current ?? null, label: row?.labels?.[f.id] ?? "", search: initial ?? "" };
    }
    if (f.type === "multilookup") draft = { items: rows.find((r) => r.id === cell.row)?.items?.[f.id] ?? [], search: initial ?? "" } satisfies MultiLookupDraft;
    setEditing({ cell, draft });
  }

  function move(dRow: number, dCol: number) {
    if (!sel) return;
    const r = Math.min(Math.max(rowIds.indexOf(sel.row) + dRow, 0), rowIds.length - 1);
    const c = Math.min(Math.max(fields.findIndex((f) => f.id === sel.field) + dCol, 0), fields.length - 1);
    setSel({ row: rowIds[r], field: fields[c].id });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || !sel) return;
    const keys: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (keys[e.key]) {
      e.preventDefault();
      move(...keys[e.key]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(sel);
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel.row !== NEW) {
      const f = fields.find((x) => x.id === sel.field);
      if (f && editable(f) && !f.required) void commit(sel, f.type === "yesno" ? false : null);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const f = fields.find((x) => x.id === sel.field);
      if (f && ["text", "longtext", "number", "currency", "email", "hyperlink", "phone", "lookup", "multilookup"].includes(f.type)) {
        e.preventDefault();
        startEdit(sel, e.key);
      } else if (f?.type === "yesno" && e.key === " ") {
        e.preventDefault();
        startEdit(sel);
      }
    }
  }

  function toggleSort(f: Field, dir?: "asc" | "desc") {
    setMenu(null);
    setSort((prev) => {
      const cur = prev.find((s) => s.field === f.id);
      const next = dir ?? (cur?.dir === "asc" ? "desc" : "asc");
      return [{ field: f.id, dir: next }];
    });
  }

  async function deleteChecked() {
    if (!checked.size || !confirm(`Delete ${checked.size} record${checked.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    try {
      const { deleted } = await api<{ deleted: number }>(`/api/tables/${table.id}/rows`, { method: "DELETE", body: { ids: [...checked] } });
      setRows((prev) => prev.filter((r) => !checked.has(r.id)));
      setTotal((n) => n - deleted);
      setChecked(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameField(f: Field) {
    setMenu(null);
    const name = prompt("Field name", f.name);
    if (!name || name === f.name) return;
    try {
      await api(`/api/tables/${table.id}/fields/${f.id}`, { method: "PATCH", body: { name } });
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteField(f: Field) {
    setMenu(null);
    if (!confirm(`Delete the field "${f.name}" and all of its data?`)) return;
    try {
      await api(`/api/tables/${table.id}/fields/${f.id}`, { method: "DELETE" });
      setFilter((prev) => ({ ...prev, conditions: prev.conditions.filter((c) => c.field !== f.id) }));
      setSort((prev) => prev.filter((s) => s.field !== f.id));
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addField(type: FieldType) {
    setAdding(false);
    if (type === "lookup" || type === "multilookup") {
      setLookupDialog(type);
      return;
    }
    const name = prompt(`Name for the new ${TYPE_LABELS[type]} field`, `Field${fields.length}`);
    if (!name) return;
    let options: Record<string, unknown> = {};
    if (type === "choice" || type === "multichoice") {
      const list = prompt("Choices, separated by commas", "Choice 1, Choice 2, Choice 3");
      options = { choices: (list ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
    }
    try {
      await api(`/api/tables/${table.id}/fields`, { body: { name, type, options } });
      onTableChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!loading && rows.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 200) void load(rows.length);
  }

  const exportHref = `/api/tables/${table.id}/csv?${query}`;
  const selIndex = sel ? rows.findIndex((r) => r.id === sel.row) : -1;

  return (
    <div className={`datasheet${nested ? " nested" : ""}`}>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
        <button className={activeFilter.conditions.length ? "on" : ""} onClick={() => setShowFilter((v) => !v)}>
          Filter{activeFilter.conditions.length ? ` (${activeFilter.conditions.length})` : ""}
        </button>
        {sort.length > 0 && <button onClick={() => setSort([])}>Clear sort</button>}
        {checked.size > 0 && canEdit && (
          <button className="danger" onClick={deleteChecked}>
            Delete {checked.size} record{checked.size === 1 ? "" : "s"}
          </button>
        )}
        <span className="grow" />
        {!nested && (
          <a className="button" href={exportHref}>
            Export CSV
          </a>
        )}
        {!nested && <SheetsLink databaseId={table.databaseId} source={{ kind: "table", id: table.id }} name={table.name} canEdit={canEdit} />}
      </div>
      {showFilter && <FilterPanel fields={fields} filter={filter} onChange={setFilter} />}
      {error && (
        <div className="error-bar" role="alert">
          {error} <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      <div className="grid-wrap" ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} onScroll={onScroll}>
        <table className="grid">
          <thead>
            <tr>
              <th className={`selector${relations.length ? " wide" : ""}`}>
                <input
                  type="checkbox"
                  aria-label="Select all records"
                  checked={rows.length > 0 && checked.size === rows.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              {fields.map((f) => {
                const s = sort.find((x) => x.field === f.id);
                return (
                  <th key={f.id} className={alignRight(f) ? "num" : ""} title={`${f.name} (${TYPE_LABELS[f.type]})${f.description ? ` - ${f.description}` : ""}`}>
                    <button className="head" onClick={() => toggleSort(f)}>
                      {f.name}
                      {f.required && <span className="req">*</span>}
                      {s && <span className="arrow">{s.dir === "asc" ? " ▲" : " ▼"}</span>}
                    </button>
                    <button className="menu-btn" aria-label={`${f.name} options`} onClick={() => setMenu(menu === f.id ? null : f.id)}>
                      ▾
                    </button>
                    {menu === f.id && (
                      <div className="menu" onMouseLeave={() => setMenu(null)}>
                        <button onClick={() => toggleSort(f, "asc")}>Sort ascending</button>
                        <button onClick={() => toggleSort(f, "desc")}>Sort descending</button>
                        <button
                          onClick={() => {
                            setMenu(null);
                            setShowFilter(true);
                            setFilter((prev) => ({ ...prev, conditions: [...prev.conditions, { field: f.id, op: operatorsFor(f)[0], value: "" }] }));
                          }}
                        >
                          Filter on this field
                        </button>
                        {canEdit && <button onClick={() => renameField(f)}>Rename field</button>}
                        {canEdit && f.type !== "autonumber" && (
                          <button className="danger" onClick={() => deleteField(f)}>
                            Delete field
                          </button>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
              {canEdit && (
                <th className="add">
                  <button className="head" onClick={() => setAdding((v) => !v)}>
                    Click to Add ▾
                  </button>
                  {adding && (
                    <div className="menu" onMouseLeave={() => setAdding(false)}>
                      {FIELD_TYPES.filter((t) => t !== "autonumber").map((t) => (
                        <button key={t} onClick={() => addField(t)}>
                          {TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rowIds.map((rid) => {
              const row = rows.find((r) => r.id === rid);
              const open = expanded.has(rid);
              return (
                <Fragment key={rid}>
                <tr className={rid === NEW ? "new-row" : checked.has(rid) ? "checked" : ""}>
                  <td className={`selector${relations.length ? " wide" : ""}`}>
                    {relations.length > 0 && rid !== NEW && (
                      <button
                        className="expand"
                        aria-expanded={open}
                        aria-label={open ? "Hide related records" : "Show related records"}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (open) next.delete(rid);
                            else next.add(rid);
                            return next;
                          })
                        }
                      >
                        {open ? "−" : "+"}
                      </button>
                    )}
                    {rid === NEW ? (
                      <span aria-label="New record">*</span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Select record ${rid}`}
                        checked={checked.has(rid)}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(rid);
                            else next.delete(rid);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                  {fields.map((f) => {
                    const cell = { row: rid, field: f.id };
                    const isSel = sel?.row === rid && sel.field === f.id;
                    const isEditing = editing?.cell.row === rid && editing.cell.field === f.id;
                    const v = row?.values[f.id];
                    return (
                      <td
                        key={f.id}
                        className={`${alignRight(f) ? "num" : ""} ${isSel ? "sel" : ""} ${f.type === "yesno" ? "center" : ""}`}
                        onMouseDown={() => {
                          if (!isEditing) setSel(cell);
                        }}
                        onDoubleClick={() => startEdit(cell)}
                      >
                        {isEditing ? (
                          <Editor tableId={table.id} field={f} draft={editing!.draft} onDraft={(d) => setEditing({ cell, draft: d })} onCommit={(val) => void commit(cell, val)} onCancel={() => { setEditing(null); gridRef.current?.focus(); }} />
                        ) : rid === NEW ? (
                          f.type === "autonumber" ? <span className="muted">(New)</span> : null
                        ) : f.type === "yesno" ? (
                          <input type="checkbox" checked={!!v} readOnly={!editable(f)} onChange={() => startEdit(cell)} aria-label={f.name} />
                        ) : f.type === "hyperlink" && v ? (
                          <a href={String(v)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                            {String(v)}
                          </a>
                        ) : f.type === "lookup" ? (
                          v ? (row?.labels?.[f.id] ?? `#${v}`) : ""
                        ) : f.type === "multilookup" ? (
                          <Chips items={row?.items?.[f.id]} />
                        ) : (
                          display(f, v)
                        )}
                      </td>
                    );
                  })}
                  {canEdit && <td className="add" />}
                </tr>
                {open && (
                  <tr className="sub">
                    <td colSpan={fields.length + (canEdit ? 2 : 1)}>
                      <Subdatasheet relations={relations} tables={tables} rowId={rid} canEdit={canEdit} onTableChanged={onTableChanged} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="empty-note">{search || activeFilter.conditions.length ? "No records match." : canEdit ? "No records yet. Type in the row marked * to add one." : "No records yet."}</p>
        )}
      </div>
      <div className="navigator">
        <span>
          Record: {selIndex >= 0 ? selIndex + 1 : sel?.row === NEW ? "(New)" : "-"} of {total.toLocaleString("en-US")}
        </span>
        {(search || activeFilter.conditions.length > 0) && <span className="badge">Filtered</span>}
        {loading && <span className="muted">Loading…</span>}
      </div>
      {lookupDialog && (
        <LookupDialog
          table={table}
          tables={tables}
          multiple={lookupDialog === "multilookup"}
          onClose={() => setLookupDialog(null)}
          onSaved={() => {
            setLookupDialog(null);
            onTableChanged();
          }}
        />
      )}
    </div>
  );
}

/** The related records of one record: one of the tables that look this table up, filtered to it. */
function Subdatasheet({ relations, tables, rowId, canEdit, onTableChanged }: { relations: Relation[]; tables: TableInfo[]; rowId: string; canEdit: boolean; onTableChanged: () => void }) {
  const [pick, setPick] = useState(0);
  const rel = relations[Math.min(pick, relations.length - 1)];
  const child = tables.find((t) => t.id === rel.tableId);
  return (
    // Keys typed in here belong to this grid, not the one around it.
    <div className="subdatasheet" onKeyDown={(e) => e.stopPropagation()}>
      {relations.length > 1 && (
        <div className="sub-tabs">
          {relations.map((r, i) => (
            <button key={r.fieldId} className={i === pick ? "on" : ""} onClick={() => setPick(i)}>
              {r.tableName} ({r.fieldName})
            </button>
          ))}
        </div>
      )}
      {child ? (
        <Datasheet key={rel.fieldId} table={child} tables={tables} canEdit={canEdit} onTableChanged={onTableChanged} locked={{ field: rel.fieldId, value: rowId }} />
      ) : (
        <p className="muted">That table isn't available.</p>
      )}
    </div>
  );
}

export type LookupDraft = { id: string | null; label: string; search: string };

/** Picks a related record for a lookup cell (or a form's box): type to search the target table, Enter to choose. */
export function LookupPicker({ tableId, field, draft, onCommit, onCancel }: { tableId: string; field: Field; draft: LookupDraft; onCommit: (v: unknown, label?: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(draft.search || draft.label);
  const [choices, setChoices] = useState<{ id: string; label: string }[]>([]);
  const [hi, setHi] = useState(0);
  const typed = useRef(!!draft.search);

  useEffect(() => {
    let live = true;
    const q = typed.current ? text : "";
    const t = setTimeout(() => {
      api<{ choices: { id: string; label: string }[] }>(`/api/tables/${tableId}/fields/${field.id}/choices?q=${encodeURIComponent(q)}`)
        .then((d) => {
          if (!live) return;
          setChoices(d.choices);
          const at = d.choices.findIndex((c) => c.id === draft.id);
          setHi(typed.current ? 0 : Math.max(at, 0));
        })
        .catch(() => live && setChoices([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, tableId, field.id, draft.id]);

  const choose = (c?: { id: string; label: string }) => (c ? onCommit(c.id, c.label) : onCommit(text.trim() === "" ? null : draft.id, text.trim() === "" ? "" : draft.label));
  return (
    <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
      <input
        className="cell-input"
        autoFocus
        value={text}
        placeholder="Search…"
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        onBlur={() => choose()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, choices.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(text.trim() === "" ? undefined : choices[hi]);
          }
        }}
      />
      <ul className="picker-list" role="listbox">
        {choices.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === hi} className={i === hi ? "hi" : ""} onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
            {c.label} <span className="muted small">#{c.id}</span>
          </li>
        ))}
        {choices.length === 0 && <li className="muted">No matching records</li>}
      </ul>
    </div>
  );
}

export type LookupItem = { id: string; label: string };
export type MultiLookupDraft = { items: LookupItem[]; search: string };

/** A multi-value lookup's related records, as chips. */
export function Chips({ items }: { items?: LookupItem[] }) {
  if (!items?.length) return null;
  return (
    <span className="chips">
      {items.map((i) => (
        <span key={i.id} className="chip" title={`#${i.id}`}>
          {i.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Picks related records for a multi-value lookup: the picked ones as chips, a search box over
 * the target table, Enter or a click to add or take off the highlighted one, Done (or leaving it) to save.
 */
export function MultiLookupPicker({ tableId, field, draft, onCommit, onCancel }: { tableId: string; field: Field; draft: MultiLookupDraft; onCommit: (items: LookupItem[]) => void; onCancel: () => void }) {
  const [items, setItems] = useState(draft.items);
  const [text, setText] = useState(draft.search);
  const [choices, setChoices] = useState<LookupItem[]>([]);
  const [hi, setHi] = useState(0);
  const done = useRef(false);
  const finish = (list: LookupItem[]) => {
    if (done.current) return;
    done.current = true;
    onCommit(list);
  };

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api<{ choices: LookupItem[] }>(`/api/tables/${tableId}/fields/${field.id}/choices?q=${encodeURIComponent(text)}`)
        .then((d) => {
          if (!live) return;
          setChoices(d.choices);
          setHi(0);
        })
        .catch(() => live && setChoices([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, tableId, field.id]);

  const has = (id: string) => items.some((i) => i.id === id);
  const toggle = (c: LookupItem) => {
    setItems((list) => (list.some((i) => i.id === c.id) ? list.filter((i) => i.id !== c.id) : [...list, c]));
    setText("");
  };
  return (
    <div
      className="picker multi-picker"
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) finish(items);
      }}
    >
      <div className="chips">
        {items.map((i) => (
          <span key={i.id} className="chip">
            {i.label}
            <button type="button" aria-label={`Remove ${i.label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))}>
              ✕
            </button>
          </span>
        ))}
        <input
          className="cell-input"
          autoFocus
          value={text}
          placeholder={items.length ? "Add…" : "Search…"}
          aria-label={`Add to ${field.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              done.current = true;
              onCancel();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, choices.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Backspace" && text === "" && items.length) {
              setItems((list) => list.slice(0, -1));
            } else if (e.key === "Enter" && text.trim() !== "" && choices[hi]) {
              e.preventDefault();
              toggle(choices[hi]);
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              finish(items);
            }
          }}
        />
      </div>
      <div className="picker-pop">
        <ul className="picker-list" role="listbox" aria-multiselectable="true">
        {choices.map((c, i) => (
          <li key={c.id} role="option" aria-selected={has(c.id)} className={`${i === hi ? "hi" : ""} ${has(c.id) ? "on" : ""}`} onMouseDown={(e) => { e.preventDefault(); toggle(c); }}>
            <span className="tick">{has(c.id) ? "✓" : ""}</span>
            {c.label} <span className="muted small">#{c.id}</span>
          </li>
        ))}
        {choices.length === 0 && <li className="muted">No matching records</li>}
        </ul>
        <div className="picker-foot">
          <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(items)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Adds a lookup field: which table to look up, which of its fields to show, and the delete rule. */
export function LookupDialog({ table, tables, multiple: startMultiple = false, onClose, onSaved }: { table: TableInfo; tables: TableInfo[]; multiple?: boolean; onClose: () => void; onSaved: () => void }) {
  const [multiple, setMultiple] = useState(startMultiple);
  const [target, setTarget] = useState(tables.find((t) => t.id !== table.id)?.id ?? table.id);
  const targetTable = tables.find((t) => t.id === target);
  const [display, setDisplay] = useState("");
  const [name, setName] = useState("");
  const [onDelete, setOnDelete] = useState("restrict");
  const [error, setError] = useState("");
  const shown = display || targetTable?.fields.find((f) => f.type !== "autonumber")?.id || "";

  async function save() {
    try {
      await api(`/api/tables/${table.id}/fields`, {
        body: {
          name: name || targetTable?.name || "Lookup",
          type: multiple ? "multilookup" : "lookup",
          options: multiple ? { targetTable: target, displayField: shown } : { targetTable: target, displayField: shown, onDelete },
        },
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="New lookup field" onMouseDown={(e) => e.stopPropagation()}>
        <h3>New lookup field</h3>
        <p className="muted small">
          Each record in {table.name} will point at {multiple ? "any number of records" : "one record"} in the table you pick.
        </p>
        <div className="prop-grid">
          <label htmlFor="lk-table">Look up records in</label>
          <select id="lk-table" value={target} onChange={(e) => { setTarget(e.target.value); setDisplay(""); }}>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label htmlFor="lk-show">Show</label>
          <select id="lk-show" value={shown} onChange={(e) => setDisplay(e.target.value)}>
            {targetTable?.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <label htmlFor="lk-name">Field name</label>
          <input id="lk-name" value={name} placeholder={targetTable?.name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          <span />
          <label className="check">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Allow multiple values
          </label>
          {!multiple && <label htmlFor="lk-del">When a {targetTable?.name ?? "related"} record is deleted</label>}
          {!multiple && (
            <select id="lk-del" value={onDelete} onChange={(e) => setOnDelete(e.target.value)}>
              {Object.entries(ON_DELETE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </div>
        {multiple && <p className="muted small">When a {targetTable?.name ?? "related"} record is deleted, it's taken off these lists.</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button className="primary" onClick={save}>
            Add field
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export const ON_DELETE_LABELS: Record<string, string> = {
  restrict: "Don't allow it while records point at it",
  cascade: "Delete the records that point at it",
  setnull: "Leave this field blank",
};

/** The box a cell shows while it's being edited. */
function Editor({ tableId, field: f, draft, onDraft, onCommit, onCancel }: { tableId: string; field: Field; draft: unknown; onDraft: (d: unknown) => void; onCommit: (v: unknown) => void; onCancel: () => void }) {
  const done = useRef(false);
  const commit = (v: unknown) => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
  };
  const value = () => {
    if (f.type === "datetime" && typeof draft === "string" && draft) return new Date(draft).toISOString();
    return draft;
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      done.current = true;
      onCancel();
    } else if ((e.key === "Enter" && !(f.type === "longtext" && e.shiftKey)) || e.key === "Tab") {
      e.preventDefault();
      commit(value());
    }
  };
  const common = { autoFocus: true, onKeyDown: keys, onBlur: () => commit(value()), className: "cell-input" };
  if (f.type === "lookup") {
    return <LookupPicker tableId={tableId} field={f} draft={draft as LookupDraft} onCommit={commit} onCancel={() => { done.current = true; onCancel(); }} />;
  }
  if (f.type === "multilookup") {
    return <MultiLookupPicker tableId={tableId} field={f} draft={draft as MultiLookupDraft} onCommit={(items) => commit(items.map((i) => i.id))} onCancel={() => { done.current = true; onCancel(); }} />;
  }
  if (f.type === "choice") {
    return (
      <select {...common} value={String(draft ?? "")} onChange={(e) => onDraft(e.target.value)}>
        <option value="" />
        {(f.options.choices ?? []).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  }
  if (f.type === "multichoice") {
    const picked = new Set(draft as string[]);
    return (
      <div className="multi" tabIndex={-1} onKeyDown={keys} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit([...picked]); }}>
        {(f.options.choices ?? []).map((c, i) => (
          <label key={c}>
            <input
              type="checkbox"
              autoFocus={i === 0}
              checked={picked.has(c)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                onDraft([...next]);
              }}
            />
            {c}
          </label>
        ))}
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => commit([...picked])}>
          Done
        </button>
      </div>
    );
  }
  if (f.type === "longtext") return <textarea {...common} rows={4} value={String(draft ?? "")} onChange={(e) => onDraft(e.target.value)} />;
  const type = f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text";
  return <input {...common} type={type} inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined} value={String(draft ?? "")} onChange={(e) => onDraft(e.target.value)} />;
}

function FilterPanel({ fields, filter, onChange }: { fields: Field[]; filter: FilterSpec; onChange: (f: FilterSpec) => void }) {
  const set = (i: number, c: Partial<Condition>) => onChange({ ...filter, conditions: filter.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  return (
    <div className="filter-panel">
      {filter.conditions.length > 1 && (
        <label>
          Show records that match{" "}
          <select value={filter.match} onChange={(e) => onChange({ ...filter, match: e.target.value as "all" | "any" })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>{" "}
          of these
        </label>
      )}
      {filter.conditions.map((c, i) => {
        const f = fields.find((x) => x.id === c.field) ?? fields[0];
        const ops = operatorsFor(f);
        const needsValue = c.op !== "empty" && c.op !== "notempty";
        return (
          <div className="condition" key={i}>
            <select value={f.id} onChange={(e) => set(i, { field: e.target.value, op: operatorsFor(fields.find((x) => x.id === e.target.value)!)[0], value: "" })}>
              {fields.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {OP_LABELS[o]}
                </option>
              ))}
            </select>
            {needsValue &&
              (f.type === "yesno" ? (
                <select value={String(c.value ?? "true")} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === "choice" || f.type === "multichoice" ? (
                <select value={String(c.value ?? "")} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="" />
                  {(f.options.choices ?? []).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              ) : (
                <input type={f.type === "date" ? "date" : "text"} value={String(c.value ?? "")} onChange={(e) => set(i, { value: e.target.value })} placeholder={isLookup(f) && (c.op === "eq" || c.op === "ne") ? "Record ID" : "Value"} />
              ))}
            <button aria-label="Remove condition" onClick={() => onChange({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        );
      })}
      <div>
        <button onClick={() => onChange({ ...filter, conditions: [...filter.conditions, { field: fields[0].id, op: operatorsFor(fields[0])[0], value: "" }] })}>Add condition</button>
        {filter.conditions.length > 0 && <button onClick={() => onChange({ ...filter, conditions: [] })}>Clear filter</button>}
      </div>
    </div>
  );
}
