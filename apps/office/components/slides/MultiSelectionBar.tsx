"use client";

import type { Align, Axis } from "@/lib/slides/selection";

export default function MultiSelectionBar({ count, onAlign, onDistribute, onGroup, onDuplicate, onDelete, onClear }: {
  count: number;
  onAlign: (align: Align) => void;
  onDistribute: (axis: Axis) => void;
  onGroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const button = "rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";
  return <div className="flex flex-wrap items-center gap-1.5 border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 no-print" data-testid="multi-selection-bar">
    <span className="mr-2 text-xs font-medium text-indigo-700">{count} objects selected</span>
    {(["left", "center", "right", "top", "middle", "bottom"] as const).map((align) =>
      <button key={align} type="button" className={button} data-testid={`align-${align}`} onClick={() => onAlign(align)}>Align {align}</button>)}
    <button type="button" className={button} data-testid="distribute-horizontal" onClick={() => onDistribute("horizontal")}>Space across</button>
    <button type="button" className={button} data-testid="distribute-vertical" onClick={() => onDistribute("vertical")}>Space down</button>
    <button type="button" className={button} data-testid="multi-group" onClick={onGroup}>Group</button>
    <button type="button" className={button} data-testid="multi-duplicate" onClick={onDuplicate}>Duplicate</button>
    <button type="button" className={button} data-testid="multi-delete" onClick={onDelete}>Delete</button>
    <button type="button" className={button} data-testid="multi-clear" onClick={onClear}>Clear selection</button>
    <span className="ml-auto text-xs text-slate-500">Drag any selected object to move the group</span>
  </div>;
}
