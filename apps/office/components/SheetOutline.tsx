"use client";

// Row/column grouping controls drawn beside Univer's headers: the bracket for
// each group with its +/− button, and the 1 2 3 level buttons in the corner.
// Univer's headers are widened to make room; the controls are positioned
// from the sheet's layout (row heights, scroll, zoom) and redrawn whenever
// the sheet changes, scrolls or zooms. The outline itself lives in row and
// column data (see lib/sheet-outline.ts).
import { useEffect, useState } from "react";
import {
  collapsedFrom,
  groupsOf,
  indicesToShow,
  innermostGroupFor,
  levelsFrom,
  maxLevel,
  runs,
  shiftLevels,
  showLevel as levelPlan,
  summaryOf,
  type OutlineGroup,
} from "@/lib/sheet-outline";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STEP = 16; // gutter width per level, in sheet pixels
const ROW_HEADER = 46; // Univer's default row header width
const COL_HEADER = 20; // and column header height
const RANGE_ROW = 1;
const RANGE_COLUMN = 2;

type Axis = "rows" | "cols";

type Ctx = { api: any; wb: any; fs: any; ws: any; unitId: string; subUnitId: string };

function context(api: any): Ctx | null {
  const wb = api?.getActiveWorkbook?.();
  const fs = wb?.getActiveSheet?.();
  const ws = fs?.getSheet?.();
  if (!wb || !fs || !ws) return null;
  return { api, wb, fs, ws, unitId: wb.getId(), subUnitId: fs.getSheetId() };
}

const dataOf = (ctx: Ctx, axis: Axis) => (axis === "rows" ? ctx.ws.getConfig().rowData : ctx.ws.getConfig().columnData) || {};

// ---- Actions -------------------------------------------------------------------

/** Writes outline custom data (levels / collapsed marks) for some indices. */
function writeCustom(ctx: Ctx, axis: Axis, patch: Map<number, { ol?: number; olc?: boolean }>) {
  if (!patch.size) return;
  const data = dataOf(ctx, axis);
  const out: Record<number, { custom: Record<string, unknown> }> = {};
  for (const [i, p] of patch) {
    const custom: Record<string, unknown> = { ...(data[i]?.custom || {}) };
    if ("ol" in p) {
      if (p.ol) custom.ol = p.ol;
      else delete custom.ol;
    }
    if ("olc" in p) {
      if (p.olc) custom.olc = true;
      else delete custom.olc;
    }
    out[i] = { custom };
  }
  if (axis === "rows") ctx.api.executeCommand("sheet.command.set-row-data", { unitId: ctx.unitId, subUnitId: ctx.subUnitId, rowData: out });
  else ctx.api.executeCommand("sheet.command.set-col-data", { unitId: ctx.unitId, subUnitId: ctx.subUnitId, columnData: out });
}

async function setVisible(ctx: Ctx, axis: Axis, indices: number[], visible: boolean) {
  if (!indices.length) return;
  const maxRow = ctx.ws.getRowCount() - 1;
  const maxCol = ctx.ws.getColumnCount() - 1;
  const ranges = runs(indices).map(([start, count]) =>
    axis === "rows"
      ? { startRow: start, endRow: start + count - 1, startColumn: 0, endColumn: maxCol, rangeType: RANGE_ROW }
      : { startRow: 0, endRow: maxRow, startColumn: start, endColumn: start + count - 1, rangeType: RANGE_COLUMN },
  );
  const id =
    axis === "rows"
      ? visible ? "sheet.command.set-specific-rows-visible" : "sheet.command.set-rows-hidden"
      : visible ? "sheet.command.set-specific-cols-visible" : "sheet.command.set-col-hidden";
  // Showing rows moves the selection onto them; put it back.
  const keep = ctx.fs.getActiveRange?.()?.getRange?.();
  await ctx.api.executeCommand(id, { unitId: ctx.unitId, subUnitId: ctx.subUnitId, ranges });
  if (keep) {
    try {
      ctx.fs.getRange(keep.startRow, keep.startColumn, keep.endRow - keep.startRow + 1, keep.endColumn - keep.startColumn + 1).activate();
    } catch {
      /* selection is cosmetic */
    }
  }
}

const isHidden = (ctx: Ctx, axis: Axis, i: number) => (axis === "rows" ? !ctx.ws.getRowVisible(i) : !ctx.ws.getColVisible(i));

export async function groupSelection(api: any, axis: Axis, delta: 1 | -1) {
  const ctx = context(api);
  const range = ctx?.fs.getActiveRange?.()?.getRange?.();
  if (!ctx || !range) return;
  const [start, end] = axis === "rows" ? [range.startRow, range.endRow] : [range.startColumn, range.endColumn];
  const levels = levelsFrom(dataOf(ctx, axis));
  const changed = shiftLevels(levels, start, end, delta);
  if (!changed.size) return;
  const patch = new Map<number, { ol?: number; olc?: boolean }>();
  for (const [i, ol] of changed) patch.set(i, { ol });
  if (delta < 0) {
    // Ungrouping a collapsed part shows it again, as Excel does.
    const show = [...changed.keys()].filter((i) => isHidden(ctx, axis, i));
    writeCustom(ctx, axis, patch);
    await setVisible(ctx, axis, show, true);
    return;
  }
  writeCustom(ctx, axis, patch);
}

export async function toggleGroup(api: any, axis: Axis, group: OutlineGroup) {
  const ctx = context(api);
  if (!ctx) return;
  const data = dataOf(ctx, axis);
  const levels = levelsFrom(data);
  const summary = summaryOf(group);
  const collapsed = [...Array(group.end - group.start + 1).keys()].every((k) => isHidden(ctx, axis, group.start + k));
  if (collapsed) {
    writeCustom(ctx, axis, new Map([[summary, { olc: false }]]));
    await setVisible(ctx, axis, indicesToShow(levels, group, collapsedFrom(data)), true);
  } else {
    writeCustom(ctx, axis, new Map([[summary, { olc: true }]]));
    await setVisible(ctx, axis, [...Array(group.end - group.start + 1).keys()].map((k) => group.start + k), false);
  }
}

/** Expand or collapse the group around the selection (the +/− shortcut). */
export async function toggleGroupAtSelection(api: any, axis: Axis, collapse: boolean) {
  const ctx = context(api);
  const range = ctx?.fs.getActiveRange?.()?.getRange?.();
  if (!ctx || !range) return;
  const i = axis === "rows" ? range.startRow : range.startColumn;
  const group = innermostGroupFor(levelsFrom(dataOf(ctx, axis)), i);
  if (!group) return;
  const isCollapsed = isHidden(ctx, axis, group.start);
  if (isCollapsed !== collapse) await toggleGroup(api, axis, group);
}

export async function showOutlineLevel(api: any, axis: Axis, n: number) {
  const ctx = context(api);
  if (!ctx) return;
  const plan = levelPlan(levelsFrom(dataOf(ctx, axis)), n);
  const patch = new Map<number, { olc?: boolean }>();
  for (const i of plan.collapse) patch.set(i, { olc: true });
  for (const i of plan.expand) patch.set(i, { olc: false });
  writeCustom(ctx, axis, patch);
  await setVisible(ctx, axis, plan.show.filter((i) => isHidden(ctx, axis, i)), true);
  await setVisible(ctx, axis, plan.hide.filter((i) => !isHidden(ctx, axis, i)), false);
}

/** Inserting rows inside a group puts the new rows in it, as in Excel. Run for
 *  the local user's own insert only; the resulting row data reaches peers. */
export function adoptInsertedIntoGroups(api: any, command: { id?: string; params?: any }) {
  const axis: Axis | null = command.id === "sheet.mutation.insert-row" ? "rows" : command.id === "sheet.mutation.insert-col" ? "cols" : null;
  const range = command.params?.range;
  if (!axis || !range) return;
  const ctx = context(api);
  if (!ctx || command.params.subUnitId !== ctx.subUnitId) return;
  const [start, end] = axis === "rows" ? [range.startRow, range.endRow] : [range.startColumn, range.endColumn];
  const levels = levelsFrom(dataOf(ctx, axis));
  const level = Math.min(levels.get(start - 1) || 0, levels.get(end + 1) || 0);
  if (!level) return;
  const patch = new Map<number, { ol: number }>();
  for (let i = start; i <= end; i++) patch.set(i, { ol: level });
  writeCustom(ctx, axis, patch);
}

// ---- Drawing -----------------------------------------------------------------

type Mark =
  | { kind: "line"; pane: Pane; x: number; y: number; w: number; h: number }
  | { kind: "button"; pane: Pane; x: number; y: number; label: string; title: string; onClick: () => void };
/** Where a mark is drawn: beside the scrolling rows/columns, beside the frozen ones, or in the corner. */
type Pane = "rows" | "cols" | "rows-frozen" | "cols-frozen" | "corner";

type Layout = { marks: Mark[]; rowClip: DOMRectLike | null; colClip: DOMRectLike | null; rowFrozen: number; colFrozen: number };
type DOMRectLike = { left: number; top: number; width: number; height: number };

const gutterFor = (max: number) => (max ? STEP * (max + 1) + 2 : 0);

function layout(api: any, host: HTMLElement, canEdit: boolean, applied: Map<string, string>): Layout | null {
  const ctx = context(api);
  if (!ctx) return null;
  const rowData = dataOf(ctx, "rows");
  const colData = dataOf(ctx, "cols");
  const rowLevels = levelsFrom(rowData);
  const colLevels = levelsFrom(colData);
  const rMax = maxLevel(rowLevels);
  const cMax = maxLevel(colLevels);
  const rowGw = gutterFor(rMax);
  const colGw = gutterFor(cMax);

  // Make room in Univer's headers (a view setting, per sheet and per client).
  const key = `${ctx.unitId}:${ctx.subUnitId}`;
  const want = `${rowGw}x${colGw}`;
  if (applied.get(key) !== want && (applied.has(key) || rowGw || colGw)) {
    applied.set(key, want);
    try {
      ctx.fs.setRowHeaderWidth(ROW_HEADER + rowGw);
      ctx.fs.setColumnHeaderHeight(COL_HEADER + colGw);
    } catch {
      /* render not ready */
    }
    return null; // the skeleton changes; draw on the next frame
  }
  if (!rMax && !cMax) return { marks: [], rowClip: null, colClip: null, rowFrozen: 0, colFrozen: 0 };

  const sk = ctx.fs.getSkeleton?.();
  const canvas = host.querySelector<HTMLCanvasElement>('canvas[id^="univer-sheet-main-canvas"]');
  if (!sk || !canvas) return null;
  const base = host.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  const left0 = cr.left - base.left;
  const top0 = cr.top - base.top;
  const z = ctx.fs.getZoom?.() || 1;
  const rowAcc: ArrayLike<number> = sk.rowHeightAccumulation;
  const colAcc: ArrayLike<number> = sk.columnWidthAccumulation;
  const rowTop = (r: number) => (r <= 0 ? 0 : rowAcc[Math.min(r, rowAcc.length) - 1] ?? 0);
  const colLeft = (c: number) => (c <= 0 ? 0 : colAcc[Math.min(c, colAcc.length) - 1] ?? 0);
  const hdrH = sk.columnHeaderHeight ?? COL_HEADER + colGw;
  const hdrW = sk.rowHeaderWidth ?? ROW_HEADER + rowGw;
  const scroll = ctx.fs.getScrollState?.() || { sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetX: 0, offsetY: 0 };
  const freeze = ctx.fs.getFreeze?.() || {};
  const frozenRows = freeze.ySplit > 0 ? freeze.startRow : 0;
  const frozenCols = freeze.xSplit > 0 ? freeze.startColumn : 0;
  const scrollY = rowTop(scroll.sheetViewStartRow) + scroll.offsetY;
  const scrollX = colLeft(scroll.sheetViewStartColumn) + scroll.offsetX;
  // Sheet coordinates (headers included) -> pixels inside the host.
  const yOf = (r: number, edge: number) => top0 + (hdrH + edge - (r >= frozenRows ? Math.max(0, scrollY) : 0)) * z;
  const xOf = (c: number, edge: number) => left0 + (hdrW + edge - (c >= frozenCols ? Math.max(0, scrollX) : 0)) * z;

  const marks: Mark[] = [];
  const btn = 12;
  const gutterPos = (level: number) => (2 + (level - 1) * STEP + STEP / 2) * z;
  const add = (axis: Axis, levels: Map<number, number>, data: any, size: (i: number) => [number, number]) => {
    const frozen = axis === "rows" ? frozenRows : frozenCols;
    for (const g of groupsOf(levels)) {
      const pane: Pane = g.end < frozen ? `${axis}-frozen` : axis;
      const [a] = size(g.start);
      const [, b] = size(g.end);
      const s = size(summaryOf(g));
      const collapsed = b - a < 0.5;
      const lane = gutterPos(g.level);
      const mid = (s[0] + s[1]) / 2;
      if (!collapsed) {
        if (axis === "rows") {
          marks.push({ kind: "line", pane, x: lane, y: a + 2, w: 1, h: Math.max(0, b - a - 2) });
          marks.push({ kind: "line", pane, x: lane, y: b - 1, w: 5 * z, h: 1 });
        } else {
          marks.push({ kind: "line", pane, x: a + 2, y: lane, w: Math.max(0, b - a - 2), h: 1 });
          marks.push({ kind: "line", pane, x: b - 1, y: lane, w: 1, h: 5 * z });
        }
      }
      const label = collapsed ? "+" : "−";
      const what = axis === "rows" ? "rows" : "columns";
      marks.push({
        kind: "button",
        pane,
        x: axis === "rows" ? lane - btn / 2 : mid - btn / 2,
        y: axis === "rows" ? mid - btn / 2 : lane - btn / 2,
        label,
        title: `${collapsed ? "Expand" : "Collapse"} ${what} ${axis === "rows" ? `${g.start + 1}–${g.end + 1}` : `${colName(g.start)}–${colName(g.end)}`}`,
        onClick: () => canEdit && void toggleGroup(api, axis, g),
      });
    }
    void data;
  };
  const rowsBase = top0 + hdrH * z;
  const colsBase = left0 + hdrW * z;
  if (rMax) add("rows", rowLevels, rowData, (i) => [yOf(i, rowTop(i)) - rowsBase, yOf(i, rowTop(i + 1)) - rowsBase]);
  if (cMax) add("cols", colLevels, colData, (i) => [xOf(i, colLeft(i)) - colsBase, xOf(i, colLeft(i + 1)) - colsBase]);

  // Level buttons: for rows along the column-header band, for columns down the row-header band.
  const levelButtons: Mark[] = [];
  for (let n = 1; rMax && n <= rMax + 1; n++)
    levelButtons.push({ kind: "button", pane: "corner", x: left0 + gutterPos(n) - btn / 2, y: top0 + (colGw + COL_HEADER / 2) * z - btn / 2, label: String(n), title: `Show row level ${n}`, onClick: () => canEdit && void showOutlineLevel(api, "rows", n) });
  for (let n = 1; cMax && n <= cMax + 1; n++)
    levelButtons.push({ kind: "button", pane: "corner", x: left0 + (rowGw + ROW_HEADER / 2) * z - btn / 2, y: top0 + gutterPos(n) - btn / 2, label: String(n), title: `Show column level ${n}`, onClick: () => canEdit && void showOutlineLevel(api, "cols", n) });

  return {
    marks: [...marks, ...levelButtons],
    rowFrozen: rowTop(frozenRows) * z,
    colFrozen: colLeft(frozenCols) * z,
    rowClip: rMax ? { left: left0, top: rowsBase, width: rowGw * z, height: cr.height - hdrH * z } : null,
    colClip: cMax ? { left: colsBase, top: top0, width: cr.width - hdrW * z, height: colGw * z } : null,
  };
}

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export default function SheetOutline({ api, host, canEdit, ready }: { api: any; host: HTMLElement | null; canEdit: boolean; ready: number }) {
  const [view, setView] = useState<Layout | null>(null);

  useEffect(() => {
    if (!api || !host) return;
    const applied = new Map<string, string>();
    let raf = 0;
    const draw = () => {
      raf = 0;
      try {
        const next = layout(api, host, canEdit, applied);
        if (next) setView(next);
        else raf = requestAnimationFrame(draw);
      } catch {
        /* the workbook is being replaced */
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const subs: { dispose?: () => void }[] = [];
    try {
      subs.push(api.onCommandExecuted(schedule));
      if (api.Event?.Scroll) subs.push(api.addEvent(api.Event.Scroll, schedule));
      if (api.Event?.SheetZoomChanged) subs.push(api.addEvent(api.Event.SheetZoomChanged, schedule));
    } catch {
      /* events optional; commands still redraw */
    }
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      subs.forEach((s) => s?.dispose?.());
    };
  }, [api, host, canEdit, ready]);

  if (!view || !view.marks.length) return null;
  const btnClass = "absolute w-3 h-3 flex items-center justify-center border border-slate-400 bg-white text-[9px] leading-none text-slate-600 rounded-[2px] hover:bg-indigo-50 hover:border-indigo-400 pointer-events-auto select-none";
  const render = (m: Mark, i: number) =>
    m.kind === "line" ? (
      <div key={i} className="absolute bg-slate-400" style={{ left: m.x, top: m.y, width: m.w, height: m.h }} />
    ) : (
      <button key={i} type="button" title={m.title} aria-label={m.title} disabled={!canEdit} onClick={m.onClick} className={btnClass} style={{ left: m.x, top: m.y }}>
        {m.label}
      </button>
    );
  // The scrolling part is cut where the frozen rows/columns end, so groups
  // scrolled out of view don't draw over the frozen ones.
  const clip = (r: DOMRectLike | null, pane: Pane, cut: string, size?: { width?: number; height?: number }) =>
    r && (
      <div className="absolute overflow-hidden pointer-events-none" style={{ left: r.left, top: r.top, width: size?.width ?? r.width, height: Math.max(0, size?.height ?? r.height), clipPath: cut }}>
        {view.marks.filter((m) => m.pane === pane).map(render)}
      </div>
    );
  return (
    <div className="absolute inset-0 pointer-events-none z-10" data-outline>
      {clip(view.rowClip, "rows", `inset(${view.rowFrozen}px 0 0 0)`)}
      {view.rowFrozen > 0 && clip(view.rowClip, "rows-frozen", "none", { height: view.rowFrozen })}
      {clip(view.colClip, "cols", `inset(0 0 0 ${view.colFrozen}px)`)}
      {view.colFrozen > 0 && clip(view.colClip, "cols-frozen", "none", { width: view.colFrozen })}
      {view.marks.filter((m) => m.pane === "corner").map(render)}
    </div>
  );
}
