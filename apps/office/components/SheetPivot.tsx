"use client";

// Pivot table field list: pick the fields for rows, columns, values and
// filters; every change rewrites the table on its sheet.
import { useMemo, useState } from "react";
import { AGG_LABEL, fieldItems, fieldNames, type PivotAgg, type PivotDef } from "@/lib/pivot";
import { rangeText, readSource } from "@/lib/sheet-pivots";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Area = "rows" | "columns" | "values" | "filters";
const AREAS: { key: Area; label: string }[] = [
  { key: "filters", label: "Filters" },
  { key: "columns", label: "Columns" },
  { key: "rows", label: "Rows" },
  { key: "values", label: "Values" },
];

const chip = "flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700";
const small = "rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30";

function inArea(def: PivotDef, area: Area, field: string) {
  if (area === "values") return def.values.some((v) => v.field === field);
  if (area === "filters") return def.filters.some((f) => f.field === field);
  return def[area].includes(field);
}

function toggle(def: PivotDef, area: Area, field: string, numeric: boolean): PivotDef {
  const on = inArea(def, area, field);
  switch (area) {
    case "values":
      return { ...def, values: on ? def.values.filter((v) => v.field !== field) : [...def.values, { field, agg: numeric ? "sum" : "count" }] };
    case "filters":
      return { ...def, filters: on ? def.filters.filter((f) => f.field !== field) : [...def.filters, { field, exclude: [] }] };
    default: {
      // A field is either a row or a column field, not both.
      const other: Area = area === "rows" ? "columns" : "rows";
      const next = { ...def, [other]: (def[other] as string[]).filter((f) => f !== field) };
      return { ...next, [area]: on ? (def[area] as string[]).filter((f) => f !== field) : [...(def[area] as string[]), field] };
    }
  }
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default function SheetPivot({
  api,
  pivots,
  activeId,
  canEdit,
  version,
  onSelect,
  onChange,
  onRefresh,
  onDelete,
  onUseSelection,
  onClose,
}: {
  api: any;
  pivots: PivotDef[];
  activeId: string | null;
  canEdit: boolean;
  version: number;
  onSelect: (id: string) => void;
  onChange: (def: PivotDef) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onUseSelection: (id: string) => void;
  onClose: () => void;
}) {
  const def = pivots.find((p) => p.id === activeId) || pivots[0];
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const source = useMemo(() => {
    if (!def || !api) return { table: [] as unknown[][], error: "" };
    try {
      return { table: readSource(api, def), error: "" };
    } catch (e) {
      return { table: [] as unknown[][], error: (e as Error).message };
    }
    // version: the source cells may have changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, def, version]);
  const fields = useMemo(
    () => fieldNames(source.table[0] || []).map((field, i) => ({ field, numeric: source.table.slice(1).some((r) => typeof r[i] === "number") })),
    [source],
  );

  if (!def)
    return (
      <aside aria-label="Pivot table panel" className="flex w-[330px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
        <Header onClose={onClose} />
        <p className="p-3 text-xs leading-5 text-slate-500">Select a data range with a header row, then choose Insert → Pivot table.</p>
      </aside>
    );

  const update = (next: PivotDef) => canEdit && onChange(next);
  const numericOf = (f: string) => fields.find((x) => x.field === f)?.numeric ?? false;

  return (
    <aside aria-label="Pivot table panel" className="flex w-[330px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <Header onClose={onClose} />
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        <div className="flex items-center gap-2">
          {pivots.length > 1 ? (
            <select aria-label="Pivot table" value={def.id} onChange={(e) => onSelect(e.target.value)} className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-1">
              {pivots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex-1 font-medium text-slate-700">{def.name}</span>
          )}
          <button type="button" disabled={!canEdit} onClick={() => onRefresh(def.id)} className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            Refresh
          </button>
          <button type="button" aria-label={`Delete ${def.name}`} disabled={!canEdit} onClick={() => onDelete(def.id)} className="rounded px-1.5 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">
            Delete
          </button>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <span className="truncate">Source: {api ? rangeText(api, def.source.sheetId, def.source.range) : ""}</span>
          <button type="button" disabled={!canEdit} onClick={() => onUseSelection(def.id)} className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
            Use selection
          </button>
        </div>
        {source.error && <p className="text-rose-600">{source.error}</p>}

        <section aria-label="Fields">
          <h3 className="mb-1 font-semibold text-slate-600">Fields</h3>
          <div className="space-y-1">
            {fields.map(({ field, numeric }) => (
              <div key={field} className="flex items-center gap-1 rounded bg-white px-2 py-1 shadow-sm">
                <span className="flex-1 truncate text-slate-700" title={field}>
                  {field}
                </span>
                {AREAS.map((a) => {
                  const on = inArea(def, a.key, field);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${field} in ${a.label}`}
                      title={`${on ? "Remove from" : "Add to"} ${a.label}`}
                      disabled={!canEdit}
                      onClick={() => update(toggle(def, a.key, field, numeric))}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${on ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"} disabled:opacity-50`}
                    >
                      {a.label[0]}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">F = filter, C = columns, R = rows, V = values</p>
        </section>

        {AREAS.map((a) => (
          <section key={a.key} aria-label={a.label}>
            <h3 className="mb-1 font-semibold text-slate-600">{a.label}</h3>
            <div className="min-h-[28px] space-y-1 rounded border border-dashed border-slate-300 p-1">
              {a.key === "values" &&
                def.values.map((v, i) => (
                  <div key={`${v.field}-${i}`} className={chip}>
                    <select
                      aria-label={`Summarize ${v.field} by`}
                      value={v.agg}
                      disabled={!canEdit}
                      onChange={(e) => update({ ...def, values: def.values.map((x, k) => (k === i ? { ...x, agg: e.target.value as PivotAgg } : x)) })}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5"
                    >
                      {(Object.keys(AGG_LABEL) as PivotAgg[]).map((k) => (
                        <option key={k} value={k} disabled={!numericOf(v.field) && k !== "count"}>
                          {AGG_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <span className="flex-1 truncate">of {v.field}</span>
                    <button type="button" className={small} disabled={!canEdit || i === 0} onClick={() => update({ ...def, values: move(def.values, i, -1) })} aria-label="Move up">↑</button>
                    <button type="button" className={small} disabled={!canEdit} onClick={() => update({ ...def, values: def.values.filter((_x, k) => k !== i) })} aria-label={`Remove ${v.field}`}>×</button>
                  </div>
                ))}
              {(a.key === "rows" || a.key === "columns") &&
                def[a.key].map((f, i) => (
                  <div key={f} className={chip}>
                    <span className="flex-1 truncate">{f}</span>
                    <button type="button" className={small} disabled={!canEdit || i === 0} onClick={() => update({ ...def, [a.key]: move(def[a.key as "rows"], i, -1) })} aria-label="Move up">↑</button>
                    <button type="button" className={small} disabled={!canEdit} onClick={() => update(toggle(def, a.key, f, false))} aria-label={`Remove ${f}`}>×</button>
                  </div>
                ))}
              {a.key === "filters" &&
                def.filters.map((flt) => {
                  const items = fieldItems(source.table, flt.field);
                  const shown = items.length - flt.exclude.filter((x) => items.includes(x)).length;
                  return (
                    <div key={flt.field} className="rounded border border-slate-200 bg-white text-xs text-slate-700">
                      <div className="flex items-center gap-1 px-2 py-1">
                        <button type="button" className="flex-1 truncate text-left" onClick={() => setOpenFilter(openFilter === flt.field ? null : flt.field)} aria-expanded={openFilter === flt.field}>
                          {flt.field} <span className="text-slate-400">({shown === items.length ? "all" : `${shown} of ${items.length}`})</span>
                        </button>
                        <button type="button" className={small} disabled={!canEdit} onClick={() => update(toggle(def, "filters", flt.field, false))} aria-label={`Remove ${flt.field} filter`}>×</button>
                      </div>
                      {openFilter === flt.field && (
                        <div className="max-h-48 overflow-y-auto border-t border-slate-100 px-2 py-1">
                          {items.map((item) => (
                            <label key={item} className="flex items-center gap-1.5 py-0.5">
                              <input
                                type="checkbox"
                                disabled={!canEdit}
                                checked={!flt.exclude.includes(item)}
                                onChange={(e) =>
                                  update({
                                    ...def,
                                    filters: def.filters.map((x) =>
                                      x.field !== flt.field ? x : { ...x, exclude: e.target.checked ? x.exclude.filter((y) => y !== item) : [...x.exclude, item] },
                                    ),
                                  })
                                }
                              />
                              {item}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        ))}

        <section aria-label="Options" className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={def.grandTotals !== false} onChange={(e) => update({ ...def, grandTotals: e.target.checked })} />
            Grand totals
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={def.subtotals !== false} onChange={(e) => update({ ...def, subtotals: e.target.checked })} />
            Subtotals for outer row fields
          </label>
        </section>
      </div>
    </aside>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
      <h2 className="text-sm font-semibold text-slate-700">Pivot table</h2>
      <button type="button" aria-label="Close pivot table panel" onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-200">
        ×
      </button>
    </div>
  );
}
