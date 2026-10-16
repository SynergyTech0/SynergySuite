"use client";

// View > Custom Views: save how the workbook looks under a name, show a saved
// view again, or delete one.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import { captureView, runsOf, type CustomView, type Rect } from "@/lib/custom-views";

/* eslint-disable @typescript-eslint/no-explicit-any */

const button = "text-sm rounded-full px-4 py-1.5";
const primary = `${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`;
const plain = `${button} hover:bg-slate-100 text-slate-700 disabled:opacity-40`;

/** The workbook's view right now, under a name. */
export function currentView(api: any, name: string): CustomView {
  const wb = api.getActiveWorkbook();
  const snap = wb.save();
  const active = wb.getActiveSheet();
  const sel = active?.getActiveRange?.()?.getRange?.() as Rect | undefined;
  const activeId = active?.getSheetId?.();
  return captureView(name, snap.sheets, activeId, activeId && sel ? { [activeId]: { startRow: sel.startRow, endRow: sel.endRow, startColumn: sel.startColumn, endColumn: sel.endColumn } } : {});
}

/** Puts a saved view back: each sheet's hidden rows and columns, panes, zoom, gridlines and visibility, then the open sheet and its selection. */
export function applyCustomView(api: any, v: CustomView) {
  const wb = api.getActiveWorkbook();
  const active = v.activeSheetId ? wb.getSheetBySheetId(v.activeSheetId) : null;
  // Show the sheet to open first, so hiding the others never leaves none visible.
  if (active?.isSheetHidden?.()) active.showSheet();
  active?.activate?.();
  for (const [sid, sv] of Object.entries(v.sheets)) {
    const sh = wb.getSheetBySheetId(sid);
    if (!sh) continue;
    if (sv.hidden && sid !== v.activeSheetId) {
      if (!sh.isSheetHidden()) sh.hideSheet();
    } else if (sh.isSheetHidden()) sh.showSheet();
    const snap = sh.getSheet?.()?.getSnapshot?.() || {};
    const hiddenNow = (data: Record<string, { hd?: number }> | undefined) => Object.entries(data || {}).filter(([, x]) => x?.hd === 1).map(([k]) => Number(k));
    for (const [s, n] of runsOf(hiddenNow(snap.rowData).filter((r) => !sv.hiddenRows.includes(r)))) sh.showRows(s, n);
    for (const [s, n] of runsOf(sv.hiddenRows.filter((r) => r < sh.getMaxRows()))) sh.hideRows(s, n);
    for (const [s, n] of runsOf(hiddenNow(snap.columnData).filter((c) => !sv.hiddenColumns.includes(c)))) sh.showColumns(s, n);
    for (const [s, n] of runsOf(sv.hiddenColumns.filter((c) => c < sh.getMaxColumns()))) sh.hideColumns(s, n);
    if (sv.frozenRows || sv.frozenColumns) sh.setFreeze({ xSplit: sv.frozenColumns, ySplit: sv.frozenRows, startRow: sv.frozenRows || -1, startColumn: sv.frozenColumns || -1 });
    else sh.cancelFreeze();
    if (sh.hasHiddenGridLines() === sv.gridlines) sh.setHiddenGridlines(!sv.gridlines);
    if (typeof sh.zoom === "function" && Math.abs((sh.getZoom?.() || 1) - sv.zoom) > 0.001) sh.zoom(sv.zoom);
  }
  const sel = v.activeSheetId ? v.sheets[v.activeSheetId]?.selection : undefined;
  if (active && sel) active.getRange(sel.startRow, sel.startColumn, sel.endRow - sel.startRow + 1, sel.endColumn - sel.startColumn + 1).activate();
}

export function CustomViewsDialog({ views, canEdit, onAdd, onShow, onDelete, onClose }: { views: CustomView[]; canEdit: boolean; onAdd: (name: string) => Promise<void>; onShow: (v: CustomView) => void; onDelete: (v: CustomView) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = (n: string) => views.some((v) => v.name.toLowerCase() === n.trim().toLowerCase());
  return (
    <Modal title="Custom Views" onClose={onClose}>
      <div className="w-[min(28rem,85vw)] space-y-3 text-sm">
        {views.length === 0 ? (
          <p className="text-slate-500">No views yet. A view keeps which sheet is open and, on each sheet, hidden rows and columns, frozen panes, zoom, gridlines and the selection.</p>
        ) : (
          <ul className="divide-y divide-slate-100" aria-label="Views">
            {views.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate font-medium text-slate-800">{v.name}</span>
                <span className="flex gap-1">
                  <button className={plain} aria-label={`Show ${v.name}`} onClick={() => onShow(v)}>
                    Show
                  </button>
                  <button className={plain} disabled={!canEdit || busy} aria-label={`Delete ${v.name}`} onClick={() => void onDelete(v)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              if (taken(n)) return setError(`There is already a view named ${n}.`);
              setBusy(true);
              onAdd(n)
                .then(() => {
                  setName("");
                  setError(null);
                })
                .catch((x) => setError((x as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            <input className="flex-1 rounded border border-slate-300 px-2 py-1" aria-label="View name" placeholder="Name of the current view" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className={primary} disabled={busy || !name.trim()}>
              Add
            </button>
          </form>
        )}
        {error && (
          <p className="text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button className={plain} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
