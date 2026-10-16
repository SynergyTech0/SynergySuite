"use client";

// A slicer or timeline over the grid. Univer places, moves and resizes the box
// (a floating DOM drawing; drag it by its caption); the buttons pick what the
// table or pivot table shows.
import { useState, useSyncExternalStore } from "react";
import { fieldValues, slicerBus } from "@/lib/sheet-slicers";
import { pickPeriod, slicerItems, timelinePeriods, timelineRange, toggleItem, type SlicerData, type TimeLevel } from "@/lib/slicers";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const LEVELS: { level: TimeLevel; label: string }[] = [
  { level: "years", label: "Years" },
  { level: "quarters", label: "Quarters" },
  { level: "months", label: "Months" },
  { level: "days", label: "Days" },
];

export default function SheetSlicer({ data, floatDomId }: { data?: SlicerData; floatDomId?: string }) {
  useSyncExternalStore(slicerBus.subscribe, () => slicerBus.version, () => 0);
  const [multi, setMulti] = useState(false);
  if (!data) return null;
  let values: unknown[] | null = null;
  try {
    values = fieldValues(slicerBus.api, data.source, data.field)?.values ?? null;
  } catch {
    values = null;
  }
  const change = (next: SlicerData) => floatDomId && slicerBus.canEdit && slicerBus.change?.(floatDomId, next);
  const filtered = data.kind === "timeline" ? !!data.period : !!data.selected;
  const header = (
    <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1 cursor-move" title={`${data.source.name}: ${data.field}`}>
      <span className="flex-1 truncate text-[12px] font-semibold text-slate-700">{data.caption}</span>
      <button
        type="button"
        aria-label={`Clear filter ${data.caption}`}
        disabled={!filtered || !slicerBus.canEdit}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={() => change(data.kind === "timeline" ? { ...data, period: null } : { ...data, selected: null })}
        className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-30"
      >
        Clear
      </button>
    </div>
  );
  const box = (body: React.ReactNode) => (
    <div data-sheet-slicer={data.kind} aria-label={`${data.kind === "timeline" ? "Timeline" : "Slicer"} ${data.caption}`} role="group" className="absolute inset-0 flex flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-sm" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
      {header}
      {values == null ? <div className="p-2 text-[11px] text-slate-400">The {data.source.type === "table" ? "table" : "pivot table"} or field is gone.</div> : body}
    </div>
  );

  if (data.kind === "timeline") {
    const level = data.level || "months";
    const periods = timelinePeriods(values || [], level);
    const range = timelineRange(data);
    const on = (start: Date) => !range || (start.getTime() >= range.start.getTime() && start.getTime() <= range.end.getTime());
    const groups: { group: string; items: typeof periods }[] = [];
    for (const p of periods) {
      const last = groups[groups.length - 1];
      if (last && last.group === p.group) last.items.push(p);
      else groups.push({ group: p.group, items: [p] });
    }
    const label = !range ? "All periods" : data.period!.from === data.period!.to ? data.period!.from : `${data.period!.from} – ${data.period!.to}`;
    return box(
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5" onPointerDown={stop} onMouseDown={stop}>
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span aria-label="Timeline selection">{label}</span>
          <select aria-label="Timeline level" value={level} disabled={!slicerBus.canEdit} onChange={(e) => change({ ...data, level: e.target.value as TimeLevel, period: null })} className="rounded border border-slate-200 bg-white px-1 text-[11px]">
            {LEVELS.map((l) => (
              <option key={l.level} value={l.level}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden">
          {groups.map((g) => (
            <div key={g.group || "all"} className="flex shrink-0 flex-col">
              {g.group && <div className="text-[10px] text-slate-500">{g.group}</div>}
              <div className="flex gap-0.5">
                {g.items.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-label={p.key}
                    aria-pressed={!!range && on(p.start)}
                    disabled={!slicerBus.canEdit}
                    onClick={(e) => change({ ...data, period: pickPeriod(data.period, p.key, e.shiftKey) })}
                    className={`h-6 min-w-[28px] rounded-sm px-1 text-[10px] ${on(p.start) ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>,
    );
  }

  const items = slicerItems(values || [], data.selected);
  const cols = Math.max(1, data.columns || 1);
  return box(
    <div className="flex min-h-0 flex-1 flex-col" onPointerDown={stop} onMouseDown={stop}>
      <div className="flex justify-end px-1.5 pt-1">
        <button type="button" aria-pressed={multi} aria-label="Multi-select" onClick={() => setMulti(!multi)} className={`rounded px-1 text-[10px] ${multi ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-100"}`}>
          Multi-select
        </button>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min gap-1 overflow-y-auto p-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            aria-pressed={i.selected}
            disabled={!slicerBus.canEdit}
            onClick={(e) => change({ ...data, selected: toggleItem(items, i.key, multi || e.ctrlKey || e.metaKey) })}
            className={`truncate rounded-sm border px-1.5 py-0.5 text-left text-[11px] ${i.selected ? "border-sky-300 bg-sky-100 text-slate-800" : "border-slate-200 bg-white text-slate-400"}`}
            title={i.label}
          >
            {i.label}
          </button>
        ))}
      </div>
    </div>,
  );
}
