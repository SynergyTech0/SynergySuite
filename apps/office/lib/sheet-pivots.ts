// Pivot tables inside the Univer workbook: where definitions are kept, and
// how a definition is turned into cells. The definitions live in a workbook
// resource (saved with the snapshot) and change through one mutation, so they
// reach collaborators like any other edit. The output is ordinary cells.
import { computePivot, fieldNames, PIVOT_RESOURCE, type PivotDef, type PivotRange, type PivotResource } from "./pivot.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SET_PIVOTS_MUTATION = "sheet.mutation.set-pivot-tables";

export type PivotStore = Map<string, PivotResource>;

/** Registers the resource and mutation; returns a disposer. */
export function registerPivots(injector: any, core: any, store: PivotStore, onChange: () => void): () => void {
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: PIVOT_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: PivotResource) => {
      store.set(unitId, { pivots: Array.isArray(value?.pivots) ? value.pivots : [] });
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    toJson: (unitId: string) => JSON.stringify(store.get(unitId) || { pivots: [] }),
    parseJson: (json: string) => JSON.parse(json) as PivotResource,
  });
  const mutation = injector.get(core.ICommandService).registerCommand({
    id: SET_PIVOTS_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: PivotDef[] }) => {
      if (!params?.unitId || !Array.isArray(params.value)) return false;
      store.set(params.unitId, { pivots: params.value });
      onChange();
      return true;
    },
  });
  return () => {
    resource.dispose();
    mutation.dispose();
  };
}

export const pivotsOf = (store: PivotStore, unitId: string | undefined) => (unitId && store.get(unitId)?.pivots) || [];

export async function savePivots(api: any, unitId: string, pivots: PivotDef[]) {
  const ok = await api.executeCommand(SET_PIVOTS_MUTATION, { unitId, value: pivots });
  if (ok === false) throw new Error("Could not save the pivot table.");
}

const sheetById = (api: any, sheetId: string) => api.getActiveWorkbook()?.getSheetBySheetId?.(sheetId);

/** The source table (header row first), trimmed of trailing empty rows. */
export function readSource(api: any, def: Pick<PivotDef, "source">): unknown[][] {
  const sheet = sheetById(api, def.source.sheetId);
  if (!sheet) throw new Error("The pivot table's source sheet no longer exists.");
  const r = def.source.range;
  const values: unknown[][] = sheet.getRange(r.startRow, r.startColumn, r.endRow - r.startRow + 1, r.endColumn - r.startColumn + 1).getValues();
  let end = values.length;
  while (end > 1 && values[end - 1].every((v) => v == null || v === "")) end--;
  return values.slice(0, end);
}

export const sourceFields = (api: any, def: Pick<PivotDef, "source">) => fieldNames(readSource(api, def)[0] || []);

export function rangeText(api: any, sheetId: string, r: PivotRange): string {
  const name = sheetById(api, sheetId)?.getSheetName?.() || "?";
  const col = (c: number) => {
    let s = "";
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const quoted = /^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
  return `${quoted}!${col(r.startColumn)}${r.startRow + 1}:${col(r.endColumn)}${r.endRow + 1}`;
}

/** Recomputes a pivot table and writes it at its target. Returns the updated
 *  definition (with the new output size), or null when the user declined to
 *  overwrite cells that hold other data. */
export function writePivot(api: any, def: PivotDef, confirmOverwrite: (msg: string) => boolean): PivotDef | null {
  const target = sheetById(api, def.target.sheetId);
  if (!target) throw new Error("The pivot table's sheet no longer exists.");
  const grid = def.values.length || def.rows.length || def.columns.length ? computePivot(readSource(api, def), def) : null;
  const rows = grid?.cells.length || 0;
  const cols = grid?.cells[0]?.length || 0;
  const { row, column } = def.target;
  const old = def.lastSize || { rows: 0, columns: 0 };

  // Cells the new output needs that the old one didn't cover must be empty.
  if (rows && cols) {
    const current: unknown[][] = target.getRange(row, column, rows, cols).getValues();
    const busy = current.some((r, i) => r.some((v, j) => v != null && v !== "" && (i >= old.rows || j >= old.columns)));
    if (busy && !confirmOverwrite("The pivot table needs cells that already hold data. Replace them?")) return null;
  }
  if (old.rows && old.columns) target.getRange(row, column, old.rows, old.columns).clear();
  if (grid && rows && cols) {
    target.getRange(row, column, rows, cols).setValues(grid.cells.map((r) => r.map((v) => (v == null ? null : v))));
    for (const r of grid.boldRows) target.getRange(row + r, column, 1, cols).setFontWeight("bold");
    for (const c of grid.boldColumns) target.getRange(row + grid.headerRows, column + c, Math.max(1, rows - grid.headerRows), 1).setFontWeight("bold");
    target.getRange(row, column, grid.headerRows, cols).setBackgroundColor("#eef2ff");
    try {
      target.setColumnAutoWidth?.(column, cols);
    } catch {
      /* widths are cosmetic */
    }
  }
  return { ...def, lastSize: { rows, columns: cols } };
}

/** Next free "Pivot N" name among sheets and existing pivots. */
export function nextPivotName(api: any, pivots: PivotDef[]): string {
  const sheetNames = new Set<string>((api.getActiveWorkbook()?.getSheets?.() || []).map((s: any) => s.getSheetName()));
  for (let n = 1; ; n++) {
    const name = `Pivot ${n}`;
    if (!sheetNames.has(name) && !pivots.some((p) => p.name === name)) return name;
  }
}
