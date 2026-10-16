// Slicers and timelines on the live workbook: reading the field they filter,
// and applying a pick to the table (its column filter, one undoable step) or
// the pivot table (its field filter, then the pivot is written again).
import { fieldNames, type PivotDef } from "./pivot.ts";
import { readSource } from "./sheet-pivots.ts";
import { pivotExclude, tableFilter, type SlicerData, type SlicerSource } from "./slicers.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** What the slicer drawings need from the sheet, set by the sheet editor. */
export const slicerBus = {
  api: null as any,
  canEdit: false,
  pivots: (() => []) as () => PivotDef[],
  /** Saves a slicer's new pick and applies it. */
  change: null as ((drawingId: string, data: SlicerData) => void) | null,
  version: 0,
  listeners: new Set<() => void>(),
  tick() {
    this.version++;
    for (const l of this.listeners) l();
  },
  subscribe(l: () => void) {
    slicerBus.listeners.add(l);
    return () => void slicerBus.listeners.delete(l);
  },
};

/** Redraws slicers after edits (their buttons follow the data). Returns a disposer. */
export function registerSlicerTicks(injector: any, core: any): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sub = injector.get(core.ICommandService).onCommandExecuted((info: { id: string }) => {
    if (!/^sheet\.mutation\./.test(info?.id || "") || timer) return;
    timer = setTimeout(() => {
      timer = null;
      slicerBus.tick();
    }, 150);
  });
  return () => {
    if (timer) clearTimeout(timer);
    sub.dispose();
  };
}

export type FieldSource = { kind: "table" | "pivot"; id: string; name: string; sheetId: string; fields: string[] };

const textOf = (v: unknown) => (v == null ? "" : String(v).trim());

/** Tables and pivot tables a slicer can filter, with their fields. */
export function slicerSources(api: any, pivots: PivotDef[]): FieldSource[] {
  const wb = api?.getActiveWorkbook?.();
  if (!wb) return [];
  const out: FieldSource[] = [];
  for (const t of (wb.getTableList?.() || []) as any[]) {
    const sheet = wb.getSheetBySheetId(t.subUnitId);
    if (!sheet) continue;
    const g = t.range;
    const header = sheet.getRange(g.startRow, g.startColumn, 1, g.endColumn - g.startColumn + 1).getValues()[0] || [];
    out.push({ kind: "table", id: t.id, name: t.name, sheetId: t.subUnitId, fields: header.map((h: unknown, i: number) => textOf(h) || `Column${i + 1}`) });
  }
  for (const p of pivots) {
    try {
      out.push({ kind: "pivot", id: p.id, name: p.name, sheetId: p.target.sheetId, fields: fieldNames(readSource(api, p)[0] || []) });
    } catch {
      /* source gone */
    }
  }
  return out;
}

type Column = { values: unknown[]; table?: { id: string; column: number } };

/** The values of the field a slicer filters (all rows, filtered out or not). */
export function fieldValues(api: any, source: SlicerSource, field: string): Column | null {
  const wb = api?.getActiveWorkbook?.();
  if (!wb) return null;
  if (source.type === "table") {
    const t = (wb.getTableList?.() || []).find((x: any) => x.id === source.tableId);
    const sheet = t && wb.getSheetBySheetId(t.subUnitId);
    if (!sheet) return null;
    const g = t.range;
    const width = g.endColumn - g.startColumn + 1;
    const header: unknown[] = sheet.getRange(g.startRow, g.startColumn, 1, width).getValues()[0] || [];
    const j = header.findIndex((h, i) => (textOf(h) || `Column${i + 1}`).toLowerCase() === field.toLowerCase());
    if (j < 0 || g.endRow <= g.startRow) return j < 0 ? null : { values: [], table: { id: t.id, column: j } };
    // Raw values: the table filter compares them as they are stored.
    const ws = sheet.getSheet();
    const values: unknown[] = [];
    for (let r = g.startRow + 1; r <= g.endRow; r++) values.push(ws.getCellRaw(r, g.startColumn + j)?.v ?? null);
    return { values, table: { id: t.id, column: j } };
  }
  const p = slicerBus.pivots().find((x) => x.id === source.pivotId);
  if (!p) return null;
  const table = readSource(api, p);
  const i = fieldNames(table[0] || []).indexOf(field);
  return i < 0 ? null : { values: table.slice(1).map((r) => r[i]) };
}

/** Applies a pick: the table's column filter, or the pivot's field filter (via `writePivot`). */
export async function applySlicer(api: any, data: SlicerData, writePivot: (def: PivotDef) => Promise<void>) {
  const col = fieldValues(api, data.source, data.field);
  if (!col) throw new Error(`The ${data.source.type === "table" ? "table" : "pivot table"} or its ${data.field} field no longer exists.`);
  if (data.source.type === "table") {
    const wb = api.getActiveWorkbook();
    const ok = await wb.setTableFilter(col.table!.id, col.table!.column, tableFilter(data, col.values));
    if (ok === false) throw new Error("The table could not be filtered.");
    return;
  }
  const source = data.source;
  const p = slicerBus.pivots().find((x) => x.id === source.pivotId)!;
  const exclude = pivotExclude(data, col.values);
  const filters = [...p.filters.filter((f) => f.field !== data.field), ...(exclude.length ? [{ field: data.field, exclude }] : [])];
  await writePivot({ ...p, filters });
}
