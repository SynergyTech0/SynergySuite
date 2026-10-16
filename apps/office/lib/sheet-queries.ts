// Get data on the live workbook: the query list (saved with the workbook and
// shared with collaborators), fetching through the app's guarded route, and
// writing a query's data into its sheet as one undoable edit.
import { gridFor, QUERY_RESOURCE, refreshCells, SET_QUERIES_MUTATION, type Format, type Grid, type QueryDef } from "./data-import.ts";
import { rectAfter } from "./protection-rules.mjs";
import { registerListResource, saveList } from "./sheet-analysis.ts";
import { settled } from "./sheet-what-if.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type QueryStore = Map<string, QueryDef[]>;

export function foldQueries(list: QueryDef[], op: { id: string; params?: any }): QueryDef[] {
  let changed = false;
  const next: QueryDef[] = [];
  for (const q of list) {
    const size = q.size || { rows: 1, columns: 1 };
    const g = { startRow: q.anchor.row, endRow: q.anchor.row + Math.max(1, size.rows) - 1, startColumn: q.anchor.column, endColumn: q.anchor.column + Math.max(1, size.columns) - 1 };
    const r = q.sheetId ? rectAfter(g, q.sheetId, op) : g;
    if (!r) {
      changed = true;
      continue;
    }
    if (r === g || (r.startRow === g.startRow && r.startColumn === g.startColumn && r.endRow === g.endRow && r.endColumn === g.endColumn)) next.push(q);
    else {
      changed = true;
      next.push({ ...q, anchor: { row: r.startRow, column: r.startColumn }, ...(q.size ? { size: { rows: r.endRow - r.startRow + 1, columns: r.endColumn - r.startColumn + 1 } } : {}) });
    }
  }
  return changed ? next : list;
}

export function registerQueries(injector: any, core: any, store: QueryStore, onChange: () => void) {
  return registerListResource<QueryDef>(injector, core, { resource: QUERY_RESOURCE, mutation: SET_QUERIES_MUTATION, field: "queries", store, onChange, fold: foldQueries });
}

export const saveQueries = (api: any, unitId: string, list: QueryDef[]) => saveList(api, SET_QUERIES_MUTATION, unitId, list);

/** Fetches a web address through the app (which refuses private networks). */
export async function fetchWeb(url: string): Promise<{ text: string; contentType: string; url: string }> {
  const res = await fetch("/api/get-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The address could not be reached (${res.status}).`);
  return body;
}

const cellData = (v: Grid[number][number], header: boolean): Record<string, unknown> => {
  const style = header ? { s: { bl: 1 } } : {};
  if (v == null || v === "") return { v: null, ...style };
  if (typeof v === "number") return { v, t: 2, ...style };
  if (typeof v === "boolean") return { v: v ? 1 : 0, t: 3, ...style };
  return { v: String(v), t: 1, ...style };
};

/**
 * Writes a query's data at its anchor (clearing what is left of the last
 * refresh) as one undoable edit. Returns the query with its new size.
 */
export async function writeQuery(api: any, q: QueryDef, grid: Grid): Promise<QueryDef> {
  const wb = api.getActiveWorkbook();
  if (!wb.getSheetBySheetId(q.sheetId)) throw new Error("The query's sheet no longer exists.");
  const { cells, size } = refreshCells(q.anchor, grid, q.size);
  const value: Record<number, Record<number, unknown>> = {};
  for (const c of cells) (value[c.row] ||= {})[c.column] = cellData(c.value, q.steps.headers && c.row === q.anchor.row && c.value != null);
  await settled(api, () => {
    void api.executeCommand("sheet.command.set-range-values", { unitId: wb.getId(), subUnitId: q.sheetId, value });
  });
  return { ...q, size, refreshedAt: new Date().toISOString() };
}

/** Fetches (or takes the file's text), shapes and writes a query. */
export async function runQuery(api: any, q: QueryDef, fileText?: string): Promise<QueryDef> {
  if (q.foreign) throw new Error(`${q.name} comes from another program and can't be refreshed here.`);
  let text: string;
  let format: Format = q.source.format;
  if (q.source.kind === "web") text = (await fetchWeb(q.source.url)).text;
  else if (fileText != null) text = fileText;
  else throw new Error(`Choose ${q.source.fileName} again to refresh ${q.name}.`);
  if (!format) format = "csv";
  return writeQuery(api, q, gridFor(text, format, q.steps));
}
