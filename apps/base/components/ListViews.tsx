"use client";
/**
 * Microsoft Lists' other views of a table: Gallery (a card per record), Board (a column per
 * choice of a choice field; dragging a card changes it) and Calendar (records on a month grid by
 * a date field). Clicking a card opens the record in a form; Customize picks the fields each view
 * uses, saved per table.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Relation, TableInfo } from "@/lib/catalog";
import type { Field } from "@/lib/fields";
import { defaultLayout } from "@/lib/formLayout";
import type { FormInfo } from "@/lib/forms";
import { display } from "@/lib/format";
import { canDate, canGroup, canTitle, cleanListViews, MAX_CARD_FIELDS, monthGrid, resolveViews, type ListViewSettings } from "@/lib/listViewSettings";
import type { Row } from "@/lib/rows";
import { FormView, type SingleRecord } from "./FormView";

export type ListMode = "gallery" | "board" | "calendar";

/** Gallery and board read this many records at most. */
const MAX_CARDS = 500;
const BLANK = "\u0000blank";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shown(f: Field | null, r: Row): string {
  if (!f) return `#${r.id}`;
  if (f.type === "autonumber") return `#${r.id}`;
  if (f.type === "lookup" || f.type === "multilookup") return r.labels?.[f.id] ?? (r.values[f.id] ? `#${r.values[f.id]}` : "");
  return display(f, r.values[f.id]);
}

function Card({ r, title, fields, onOpen, draggable }: { r: Row; title: Field | null; fields: Field[]; onOpen: () => void; draggable?: boolean }) {
  return (
    <button
      className="card"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData("text/plain", r.id) : undefined}
    >
      <strong>{shown(title, r) || <span className="muted">(No title)</span>}</strong>
      {fields.map((f) => {
        const v = shown(f, r);
        return v ? (
          <span key={f.id} className="card-field">
            <span className="muted small">{f.name}</span> {v}
          </span>
        ) : null;
      })}
    </button>
  );
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function ListViews({ table, tables, mode, canEdit, onTableChanged }: { table: TableInfo; tables: TableInfo[]; mode: ListMode; canEdit: boolean; onTableChanged: () => void }) {
  const [settings, setSettings] = useState<ListViewSettings>(cleanListViews({}));
  const [relations, setRelations] = useState<Relation[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [opened, setOpened] = useState<{ id: string | null; preset?: Record<string, unknown> } | null>(null);
  const [customize, setCustomize] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(0);

  const views = useMemo(() => resolveViews(table.fields, settings), [table.fields, settings]);
  const days = useMemo(() => monthGrid(month.year, month.month), [month]);
  const dateField = views.calendar.date;

  useEffect(() => {
    api<{ settings: ListViewSettings }>(`/api/tables/${table.id}/views`)
      .then((d) => setSettings(d.settings))
      .catch((e) => setError(e.message));
    api<{ relations: Relation[] }>(`/api/tables/${table.id}/related`)
      .then((d) => setRelations(d.relations))
      .catch(() => {});
  }, [table.id]);

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ limit: String(MAX_CARDS) });
    if (mode === "calendar") {
      if (!dateField) return setRows([]);
      // A date-time is placed by its local day, so read a day either side of the grid.
      const pad = dateField.type === "datetime" ? 1 : 0;
      sp.set(
        "require",
        JSON.stringify([
          { field: dateField.id, op: "gte", value: shiftDay(days[0], -pad) },
          { field: dateField.id, op: "lt", value: shiftDay(days[days.length - 1], 1 + pad) },
        ]),
      );
      sp.set("sort", JSON.stringify([{ field: dateField.id, dir: "asc" }]));
    } else if (search) sp.set("q", search);
    try {
      const d = await api<{ rows: Row[]; total: number }>(`/api/tables/${table.id}/rows?${sp}`);
      setRows(d.rows);
      setTotal(d.total);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [table.id, mode, search, dateField, days]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, loaded]);

  async function save(next: ListViewSettings) {
    setSettings(next);
    try {
      setSettings((await api<{ settings: ListViewSettings }>(`/api/tables/${table.id}/views`, { method: "PUT", body: { settings: next } })).settings);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function move(rowId: string, value: string | null) {
    const group = views.board.group;
    if (!group || !canEdit) return;
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [group.id]: value } } : r)));
    try {
      await api(`/api/tables/${table.id}/rows/${rowId}`, { method: "PATCH", body: { values: { [group.id]: value } } });
    } catch (e) {
      setRows(before);
      setError((e as Error).message);
    }
  }

  const form: FormInfo = useMemo(
    () => ({ id: `list-${table.id}`, databaseId: table.databaseId, tableId: table.id, name: table.name, layout: defaultLayout(table.fields, relations), online: null, position: 0, updatedAt: "" }),
    [table, relations],
  );
  const close = () => {
    setOpened(null);
    setLoaded((n) => n + 1);
  };
  const record: SingleRecord | undefined = opened ? { ...opened, onDone: close } : undefined;

  const newRecord = (preset?: Record<string, unknown>) => setOpened({ id: null, preset });
  const more = total > rows.length && mode !== "calendar" ? <p className="muted small">Showing the first {rows.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} records; search to narrow them down.</p> : null;

  let body: React.ReactNode;
  if (mode === "gallery") {
    body = rows.length ? (
      <div className="gallery">
        {rows.map((r) => (
          <Card key={r.id} r={r} title={views.gallery.title} fields={views.gallery.fields} onOpen={() => setOpened({ id: r.id })} />
        ))}
      </div>
    ) : (
      <p className="muted empty">{search ? "No records match." : "This table has no records yet."}</p>
    );
  } else if (mode === "board") {
    const group = views.board.group;
    if (!group) {
      body = <p className="muted empty">A board needs a Choice field to make its columns. Add one in Design view{canEdit ? ", or pick one under Customize" : ""}.</p>;
    } else {
      const columns = [...(group.options.choices ?? []), BLANK];
      body = (
        <div className="board">
          {columns.map((c) => {
            const items = rows.filter((r) => (c === BLANK ? !r.values[group.id] || !(group.options.choices ?? []).includes(String(r.values[group.id])) : r.values[group.id] === c));
            return (
              <section
                key={c}
                className="board-col"
                onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
                onDrop={
                  canEdit
                    ? (e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) void move(id, c === BLANK ? null : c);
                      }
                    : undefined
                }
              >
                <h4>
                  {c === BLANK ? "(Blank)" : c} <span className="muted small">{items.length}</span>
                </h4>
                {items.map((r) => (
                  <Card key={r.id} r={r} title={views.board.title} fields={views.board.fields} draggable={canEdit} onOpen={() => setOpened({ id: r.id })} />
                ))}
                {canEdit && (
                  <button className="add-card" onClick={() => newRecord(c === BLANK ? undefined : { [group.id]: c })}>
                    + New
                  </button>
                )}
              </section>
            );
          })}
        </div>
      );
    }
  } else if (!dateField) {
    body = <p className="muted empty">A calendar needs a Date or Date/Time field. Add one in Design view.</p>;
  } else {
    const byDay = new Map<string, Row[]>();
    for (const r of rows) {
      const v = r.values[dateField.id];
      if (!v) continue;
      const day = dateField.type === "datetime" ? localDay(String(v)) : String(v).slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), r]);
    }
    const today = localDay(new Date().toISOString());
    const inMonth = `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
    body = (
      <div className="calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}
        {days.map((day) => (
          <div
            key={day}
            className={`cal-day${day.startsWith(inMonth) ? "" : " other"}${day === today ? " today" : ""}`}
            onDoubleClick={canEdit ? () => newRecord({ [dateField.id]: dateField.type === "datetime" ? new Date(`${day}T09:00`).toISOString() : day }) : undefined}
          >
            <span className="cal-num">{Number(day.slice(8))}</span>
            {(byDay.get(day) ?? []).map((r) => (
              <button key={r.id} className="cal-item" onClick={() => setOpened({ id: r.id })}>
                {dateField.type === "datetime" && <span className="muted">{new Date(String(r.values[dateField.id])).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} </span>}
                {shown(views.calendar.title, r) || "(No title)"}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const step = (n: number) => setMonth((m) => ({ year: m.year + Math.floor((m.month + n) / 12), month: (((m.month + n) % 12) + 12) % 12 }));

  return (
    <div className="listviews">
      <div className="toolbar">
        {mode === "calendar" ? (
          <span className="month-nav">
            <button aria-label="Previous month" onClick={() => step(-1)}>
              ‹
            </button>
            <strong>
              {MONTHS[month.month]} {month.year}
            </strong>
            <button aria-label="Next month" onClick={() => step(1)}>
              ›
            </button>
            <button
              onClick={() => {
                const d = new Date();
                setMonth({ year: d.getFullYear(), month: d.getMonth() });
              }}
            >
              Today
            </button>
          </span>
        ) : (
          <input className="search" type="search" placeholder="Find records" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {canEdit && (
          <button className="primary" onClick={() => newRecord()}>
            New record
          </button>
        )}
        {canEdit && (
          <button className={customize ? "on" : ""} onClick={() => setCustomize((c) => !c)}>
            Customize
          </button>
        )}
        {mode === "calendar" && canEdit && dateField && <span className="muted small">Double-click a day to add a record on it.</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {customize && <Customize fields={table.fields} mode={mode} settings={settings} views={views} onChange={save} />}
      <div className="listview-body">
        {body}
        {more}
      </div>
      {record && (
        <div className="modal-back" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal record-modal" role="dialog" aria-label={`${table.name} record`}>
            <div className="record-modal-head">
              <h3>{opened!.id ? `${table.name} #${opened!.id}` : `New ${table.name} record`}</h3>
              <button aria-label="Close" onClick={close}>
                ✕
              </button>
            </div>
            <FormView form={form} table={table} tables={tables} canEdit={canEdit} onFormChanged={() => {}} onTableChanged={onTableChanged} record={record} />
          </div>
        </div>
      )}
    </div>
  );
}

function Customize({ fields, mode, settings, views, onChange }: { fields: Field[]; mode: ListMode; settings: ListViewSettings; views: ReturnType<typeof resolveViews>; onChange: (s: ListViewSettings) => void }) {
  const select = (label: string, value: Field | null, ok: (f: Field) => boolean, set: (id: string) => void) => (
    <label>
      {label}
      <select value={value?.id ?? ""} onChange={(e) => set(e.target.value)}>
        {!value && <option value="">(None)</option>}
        {fields.filter(ok).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
  const cardFields = (chosen: Field[], skip: (Field | null)[], set: (ids: string[]) => void) => {
    const ids = chosen.map((f) => f.id);
    return (
      <fieldset>
        <legend>Fields on cards (up to {MAX_CARD_FIELDS})</legend>
        {fields
          .filter((f) => !skip.some((s) => s?.id === f.id))
          .map((f) => (
            <label key={f.id} className="check">
              <input
                type="checkbox"
                checked={ids.includes(f.id)}
                disabled={!ids.includes(f.id) && ids.length >= MAX_CARD_FIELDS}
                onChange={(e) => set(e.target.checked ? [...ids, f.id] : ids.filter((x) => x !== f.id))}
              />{" "}
              {f.name}
            </label>
          ))}
      </fieldset>
    );
  };
  if (mode === "gallery")
    return (
      <div className="customize">
        {select("Card title", views.gallery.title, canTitle, (id) => onChange({ ...settings, gallery: { ...settings.gallery, title: id } }))}
        {cardFields(views.gallery.fields, [views.gallery.title], (ids) => onChange({ ...settings, gallery: { ...settings.gallery, fields: ids } }))}
      </div>
    );
  if (mode === "board")
    return (
      <div className="customize">
        {select("Columns from", views.board.group, canGroup, (id) => onChange({ ...settings, board: { ...settings.board, group: id } }))}
        {select("Card title", views.board.title, canTitle, (id) => onChange({ ...settings, board: { ...settings.board, title: id } }))}
        {cardFields(views.board.fields, [views.board.title, views.board.group], (ids) => onChange({ ...settings, board: { ...settings.board, fields: ids } }))}
      </div>
    );
  return (
    <div className="customize">
      {select("Date field", views.calendar.date, canDate, (id) => onChange({ ...settings, calendar: { ...settings.calendar, date: id } }))}
      {select("Show", views.calendar.title, canTitle, (id) => onChange({ ...settings, calendar: { ...settings.calendar, title: id } }))}
    </div>
  );
}
