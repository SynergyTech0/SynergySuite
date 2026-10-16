// The workbook theme on the live sheet (resource + mutation, so it reaches
// collaborators and the .xlsx), cell styles applied to the selection, and
// changing the theme (recoloring the cells that use the old one).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_THEME, fontMap, recolorMap, restyle, THEME_RESOURCE, themeFrom, type WorkbookTheme } from "./sheet-themes";
import type { UniverStyle } from "./xlsx";

export const SET_THEME_MUTATION = "sheet.mutation.set-workbook-theme";

export function registerTheme(injector: any, core: any, store: Map<string, WorkbookTheme>, onChange: () => void) {
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: THEME_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: any) => {
      if (value && typeof value === "object") store.set(unitId, themeFrom(value));
      else store.delete(unitId);
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    // A workbook that never changed theme keeps no theme (the default).
    toJson: (unitId: string) => (store.has(unitId) ? JSON.stringify(store.get(unitId)) : ""),
    parseJson: (json: string) => (json ? JSON.parse(json) : null),
  });
  const mutation = injector.get(core.ICommandService).registerCommand({
    id: SET_THEME_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: WorkbookTheme }) => {
      if (!params?.unitId || !params.value) return false;
      store.set(params.unitId, themeFrom(params.value));
      onChange();
      return true;
    },
  });
  return () => {
    resource.dispose();
    mutation.dispose();
  };
}

export const themeOf = (store: Map<string, WorkbookTheme>, unitId: string | undefined) => (unitId && store.get(unitId)) || DEFAULT_THEME;

const MAX_CELLS = 200_000;

/** Applies a cell style to every selected range, as one edit per range. Returns the cells styled. */
export async function applyCellStyle(api: any, style: UniverStyle): Promise<number> {
  const wb = api.getActiveWorkbook();
  const sheet = wb?.getActiveSheet();
  if (!sheet) return 0;
  const ranges: any[] = sheet.getSelection?.()?.getActiveRangeList?.()?.getRanges?.() || [sheet.getActiveRange()].filter(Boolean);
  // Whole rows or columns: only as far as the sheet is used.
  const lastRow = Math.max(0, sheet.getLastRow?.() ?? 0);
  const lastColumn = Math.max(0, sheet.getLastColumn?.() ?? 0);
  let n = 0;
  for (const range of ranges) {
    const top = range.getRow();
    const left = range.getColumn();
    const bottom = Math.min(top + range.getHeight() - 1, Math.max(top, lastRow));
    const right = Math.min(left + range.getWidth() - 1, Math.max(left, lastColumn));
    if ((bottom - top + 1) * (right - left + 1) > MAX_CELLS) throw new Error("Select fewer cells to style (up to 200,000 at a time).");
    const value: Record<number, Record<number, unknown>> = {};
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) (value[r] ||= {})[c] = { s: style };
    await api.executeCommand("sheet.command.set-range-values", { unitId: wb.getId(), subUnitId: sheet.getSheetId(), value });
    n += (bottom - top + 1) * (right - left + 1);
  }
  return n;
}

/**
 * Switches the workbook to another theme: cells colored with the old theme's
 * colors (or their tints) take the new ones, and its fonts the new fonts.
 * Returns the number of cells changed.
 */
export async function changeTheme(api: any, from: WorkbookTheme, to: WorkbookTheme): Promise<number> {
  const wb = api.getActiveWorkbook();
  if (!wb) return 0;
  const snap = wb.save();
  const colors = recolorMap(from, to);
  const fonts = fontMap(from, to);
  const styleOf = (s: unknown): UniverStyle | null => (s == null ? null : typeof s === "string" ? snap.styles?.[s] ?? null : (s as UniverStyle));
  let changed = 0;
  for (const sheetId of snap.sheetOrder || []) {
    const cells = snap.sheets?.[sheetId]?.cellData || {};
    const value: Record<number, Record<number, unknown>> = {};
    let any = false;
    for (const [r, row] of Object.entries(cells as Record<string, Record<string, any>>))
      for (const [c, cell] of Object.entries(row || {})) {
        const before = styleOf(cell?.s);
        const after = restyle(before, colors, fonts);
        if (!after || after === before) continue;
        (value[Number(r)] ||= {})[Number(c)] = { s: after };
        any = true;
        changed++;
      }
    if (any) await api.executeCommand("sheet.command.set-range-values", { unitId: wb.getId(), subUnitId: sheetId, value });
  }
  api.syncExecuteCommand(SET_THEME_MUTATION, { unitId: wb.getId(), value: to });
  return changed;
}
