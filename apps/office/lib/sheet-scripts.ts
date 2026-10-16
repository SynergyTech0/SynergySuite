// Scripts on the live workbook: the copy a script sees, applying what it
// changed, the script list (saved with the workbook), and the recorder that
// turns edits into script lines.
import { registerListResource, saveList } from "./sheet-analysis.ts";
import { KEPT_RESOURCE, SCRIPT_RESOURCE, type Script } from "./xlsx-kept.ts";
import { dataTableResults, trialValues } from "./sheet-analysis.ts";
import type { DataTableDef } from "./data-table.ts";
import { runInSandbox, toJavaScript, type Oracle, type ScriptOp, type ScriptResult, type Snapshot } from "./script-worker.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SET_SCRIPTS_MUTATION = "sheet.mutation.set-scripts";
export type ScriptStore = Map<string, Script[]>;

export function registerScripts(injector: any, core: any, store: ScriptStore, onChange: () => void) {
  return registerListResource<Script>(injector, core, { resource: SCRIPT_RESOURCE, mutation: SET_SCRIPTS_MUTATION, field: "scripts", store, onChange });
}
export const saveScripts = (api: any, unitId: string, list: Script[]) => saveList(api, SET_SCRIPTS_MUTATION, unitId, list);

const MAX_CELLS = 300_000;

/** The copy of the workbook a script works on: each sheet's used cells. */
export function workbookSnapshot(api: any): Snapshot {
  const wb = api.getActiveWorkbook();
  let budget = MAX_CELLS;
  const sheets = (wb.getSheets() as any[]).map((fs) => {
    const ws = fs.getSheet();
    const rows = Math.min(ws.getLastRowWithContent?.() ?? -1, 100_000) + 1;
    const cols = Math.min(ws.getLastColumnWithContent?.() ?? -1, 1000) + 1;
    const values: unknown[][] = [];
    const formulas: (string | null)[][] = [];
    for (let r = 0; r < rows && budget > 0; r++) {
      const vr: unknown[] = [];
      const fr: (string | null)[] = [];
      for (let c = 0; c < cols; c++, budget--) {
        const cell = ws.getCellRaw(r, c);
        vr.push(cell?.v ?? null);
        fr.push(cell?.f || null);
      }
      values.push(vr);
      formulas.push(fr);
    }
    return { name: fs.getSheetName(), values, formulas };
  });
  const sel = wb.getActiveSheet().getActiveRange?.()?.getRange?.();
  const selection = sel ? { sheet: wb.getActiveSheet().getSheetName(), box: { row: sel.startRow, column: sel.startColumn, rows: sel.endRow - sel.startRow + 1, columns: sel.endColumn - sel.startColumn + 1 } } : undefined;
  return { active: wb.getActiveSheet().getSheetName(), sheets, ...(selection ? { selection } : {}) };
}

const cellData = (c: { v: unknown } | { f: string }) => {
  if ("f" in c) return { f: c.f, v: null };
  const v = c.v;
  if (v == null || v === "") return { v: null };
  if (typeof v === "number") return { v, t: 2 };
  if (typeof v === "boolean") return { v: v ? 1 : 0, t: 3 };
  return { v: String(v), t: 1 };
};

/** Applies a script's changes to the workbook. Returns how many changes were made. */
export async function applyOps(api: any, ops: ScriptOp[]): Promise<number> {
  const wb = api.getActiveWorkbook();
  const unitId = wb.getId();
  const sheetOf = (name: string) => (wb.getSheets() as any[]).find((s) => s.getSheetName().toLowerCase() === name.toLowerCase());
  let n = 0;
  // Runs of value changes on one sheet go in as one edit.
  let pending: { sheet: any; value: Record<number, Record<number, unknown>> } | null = null;
  const flush = async () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    await api.executeCommand("sheet.command.set-range-values", { unitId, subUnitId: p.sheet.getSheetId(), value: p.value });
  };
  for (const op of ops) {
    if (op.op === "addSheet") {
      await flush();
      wb.insertSheet(op.name);
      n++;
      continue;
    }
    const sheet = sheetOf(op.sheet);
    if (!sheet) continue;
    if (op.op === "values") {
      if (pending && pending.sheet.getSheetId() !== sheet.getSheetId()) await flush();
      pending ||= { sheet, value: {} };
      op.cells.forEach((r, i) => r.forEach((c, j) => ((pending!.value[op.row + i] ||= {})[op.column + j] = cellData(c))));
      n++;
      continue;
    }
    await flush();
    n++;
    if (op.op === "activate") {
      sheet.activate();
      continue;
    }
    if (op.op === "renameSheet") {
      sheet.setName(op.name);
      continue;
    }
    if (op.op === "deleteSheet") {
      wb.deleteSheet(sheet);
      continue;
    }
    if (op.op === "sheet") {
      if (op.tabColor) sheet.setTabColor(op.tabColor);
      if (op.hidden === true) sheet.hideSheet();
      if (op.hidden === false) sheet.showSheet();
      if (op.gridlines !== undefined) sheet.setHiddenGridlines(!op.gridlines);
      continue;
    }
    if (op.op === "freeze") {
      if (op.rows || op.columns) sheet.setFreeze({ xSplit: op.columns, ySplit: op.rows, startRow: op.rows || -1, startColumn: op.columns || -1 });
      else sheet.cancelFreeze();
      continue;
    }
    if (op.op === "size") {
      if (op.dim === "columns") sheet.setColumnWidths(op.index, op.count, op.px);
      else sheet.setRowHeights(op.index, op.count, op.px);
      continue;
    }
    if (op.op === "autofit") {
      sheet.autoResizeColumns?.(op.index, op.count);
      continue;
    }
    if (op.op === "hide") {
      if (op.dim === "rows") (op.hidden ? sheet.hideRows(op.index, op.count) : sheet.showRows(op.index, op.count));
      else op.hidden ? sheet.hideColumns(op.index, op.count) : sheet.showColumns(op.index, op.count);
      continue;
    }
    if (op.op === "insert" || op.op === "delete") {
      if (op.op === "insert") (op.dim === "rows" ? sheet.insertRows(op.index, op.count) : sheet.insertColumns(op.index, op.count));
      else op.dim === "rows" ? sheet.deleteRows(op.index, op.count) : sheet.deleteColumns(op.index, op.count);
      continue;
    }
    if (op.op === "addTable") {
      const taken = new Set(((wb.getTableList?.() || []) as any[]).map((t) => String(t.name).toLowerCase()));
      let k = 1;
      while (taken.has(`table${k}`)) k++;
      const g = { startRow: op.box.row, startColumn: op.box.column, endRow: op.box.row + op.box.rows - 1, endColumn: op.box.column + op.box.columns - 1 };
      if (!(await wb.addTable(sheet.getSheetId(), `Table${k}`, g, undefined, { showHeader: op.headers }))) throw new Error("A table can't go there (it may overlap another table).");
      continue;
    }
    const range = sheet.getRange(op.box.row, op.box.column, op.box.rows, op.box.columns);
    if (op.op === "merge") {
      if (op.across) range.mergeAcross();
      else range.merge();
      continue;
    }
    if (op.op === "unmerge") {
      range.breakApart();
      continue;
    }
    if (op.op === "clear") range.clearContent ? range.clearContent() : range.clear();
    else if (op.op === "format") range.setNumberFormat(op.pattern);
    else if (op.op === "style") {
      if (op.style.bold !== undefined) range.setFontWeight(op.style.bold ? "bold" : "normal");
      if (op.style.italic !== undefined) range.setFontStyle(op.style.italic ? "italic" : "normal");
      if (op.style.color) range.setFontColor(op.style.color);
      if (op.style.fill) range.setBackgroundColor(op.style.fill);
      if (op.style.size) range.setFontSize(op.style.size);
      if (op.style.font) range.setFontFamily(op.style.font);
      if (op.style.underline !== undefined || op.style.strike !== undefined) range.setFontLine(op.style.strike ? "line-through" : op.style.underline ? "underline" : "none");
      if (op.style.wrap !== undefined) range.setWrap(op.style.wrap);
      if (op.style.valign) range.setVerticalAlignment(op.style.valign === "center" ? "middle" : op.style.valign === "top" ? "top" : "bottom");
      if (op.style.align) {
        // Left and centre through the API; right (and justify) as the cell style's own alignment.
        if (op.style.align === "left" || op.style.align === "center") range.setHorizontalAlignment(op.style.align);
        else if (op.style.align === "general") range.setHorizontalAlignment("normal");
        else {
          const ht = op.style.align === "right" ? 3 : op.style.align === "justify" ? 4 : 0;
          const value: Record<number, Record<number, unknown>> = {};
          for (let i = 0; i < op.box.rows; i++) for (let j = 0; j < op.box.columns; j++) (value[op.box.row + i] ||= {})[op.box.column + j] = { s: { ht } };
          if (ht) await api.executeCommand("sheet.command.set-range-values", { unitId, subUnitId: sheet.getSheetId(), value });
        }
      }
    }
  }
  await flush();
  return n;
}

/**
 * The formula results after a script's changes so far: the changes go onto
 * the live sheet for this client only, the formulas and the workbook's data
 * tables recalculate, the results are read, and every cell is put back.
 */
export async function recalculatedValues(api: any, ops: ScriptOp[], dataTables: DataTableDef[] = []): Promise<Record<string, unknown[][]>> {
  const wb = api.getActiveWorkbook();
  const sheetOf = (name: string) => (wb.getSheets() as any[]).find((x) => x.getSheetName().toLowerCase() === name.toLowerCase());
  // The last change to each cell wins.
  const bySheet = new Map<string, Map<string, { cell: { row: number; column: number }; data: Record<string, unknown> }>>();
  const set = (sheetId: string, row: number, column: number, data: Record<string, unknown>) => {
    const m = bySheet.get(sheetId) || new Map();
    bySheet.set(sheetId, m);
    m.set(`${row}:${column}`, { cell: { row, column }, data });
  };
  for (const op of ops) {
    if (op.op !== "values" && op.op !== "clear") continue;
    const sheet = sheetOf(op.sheet);
    if (!sheet) continue;
    const id = sheet.getSheetId();
    if (op.op === "values")
      op.cells.forEach((r, i) =>
        r.forEach((c, j) => set(id, op.row + i, op.column + j, "f" in c ? { f: c.f, v: null, si: null, p: null } : { ...cellData(c), f: null, si: null, p: null })),
      );
    else for (let i = 0; i < op.box.rows; i++) for (let j = 0; j < op.box.columns; j++) set(id, op.box.row + i, op.box.column + j, { v: null, f: null, si: null, p: null });
  }
  const undo: (() => Promise<void>)[] = [];
  try {
    for (const [sheetId, cells] of bySheet) undo.push(await trialValues(api, sheetId, [...cells.values()]));
    // Data tables work themselves out on the changed sheet, as Excel's automatic calculation would.
    for (const def of dataTables) {
      if (!wb.getSheetBySheetId(def.sheetId)) continue;
      const { results } = await dataTableResults(api, def);
      undo.push(await trialValues(api, def.sheetId, results.map((r) => ({ cell: r.cell, data: cellData({ v: r.value }) }))));
    }
    const snap = workbookSnapshot(api);
    return Object.fromEntries(snap.sheets.map((x) => [x.name, x.values]));
  } finally {
    for (const put of undo.reverse()) await put();
  }
}

/**
 * Runs a script on the live workbook: in the sandbox, recalculating whenever
 * it reads formulas after changing cells (see public/script-sandbox.js), then
 * applies its changes as ordinary edits. TypeScript is accepted.
 */
export async function runScriptLive(
  api: any,
  code: string,
  o: { dataTables?: DataTableDef[]; run?: typeof runInSandbox; maxSyncs?: number } = {},
): Promise<ScriptResult & { syncs: number }> {
  let js: string;
  try {
    js = await toJavaScript(code);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), logs: [], ops: [], syncs: 0 };
  }
  const run = o.run || runInSandbox;
  const snapshot = workbookSnapshot(api);
  const oracle: Oracle = {};
  for (let syncs = 0; ; syncs++) {
    const r = await run(js, snapshot, 10_000, oracle);
    if (r.ok || r.sync == null) return { ...r, syncs };
    if (syncs >= (o.maxSyncs ?? 50)) return { ok: false, error: `The script recalculated the workbook too many times (${o.maxSyncs ?? 50} at most).`, logs: r.logs, ops: [], syncs };
    oracle[r.sync] = await recalculatedValues(api, r.ops, o.dataTables);
  }
}

// ---- Recorder ------------------------------------------------------------------

const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const a1 = (g: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => {
  const a = `${colName(g.startColumn)}${g.startRow + 1}`;
  const b = `${colName(g.endColumn)}${g.endRow + 1}`;
  return a === b ? a : `${a}:${b}`;
};
const lit = (v: unknown) => JSON.stringify(v ?? "");

/** One recorded line for a value matrix written at (row, column). */
export function valueLines(cells: Record<string, Record<string, any>>): string[] {
  const out: string[] = [];
  for (const [r, row] of Object.entries(cells))
    for (const [c, cell] of Object.entries(row || {})) {
      const at = `${colName(Number(c))}${Number(r) + 1}`;
      if (cell == null) out.push(`  sheet.getRange("${at}").clear();`);
      else if (cell.f) out.push(`  sheet.getRange("${at}").setFormula(${lit(cell.f)});`);
      else if ("v" in cell) out.push(`  sheet.getRange("${at}").setValue(${lit(cell.v)});`);
    }
  return out;
}

/**
 * Records this person's edits as script lines while it is on. Returns
 * { start, stop() -> code, dispose }.
 */
export function createRecorder(injector: any, core: any, api: () => any) {
  let lines: string[] | null = null;
  let sheetName = "";
  let startName = "";
  const commands = injector.get(core.ICommandService);
  const selection = () => api()?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.()?.getRange?.();
  const onSheet = (name: string) => {
    if (name === sheetName || !lines) return;
    sheetName = name;
    lines.push(`  sheet = workbook.getWorksheet(${lit(name)});`);
  };
  const sub = commands.onCommandExecuted((info: { id: string; params?: any }) => {
    if (!lines) return;
    const wb = api()?.getActiveWorkbook?.();
    if (!wb) return;
    const id = info.id;
    const p = info.params || {};
    const sheetNameOf = (subUnitId?: string) => (subUnitId ? wb.getSheetBySheetId(subUnitId)?.getSheetName?.() : wb.getActiveSheet().getSheetName());
    if (id === "sheet.command.set-range-values") {
      const name = sheetNameOf(p.subUnitId);
      if (!name) return;
      onSheet(name);
      const g = p.range || selection();
      let cells: Record<string, Record<string, any>> = {};
      if (Array.isArray(p.value) && g) p.value.forEach((r: any[], i: number) => r.forEach((c, j) => ((cells[g.startRow + i] ||= {})[g.startColumn + j] = c)));
      else if (p.value && typeof p.value === "object" && ("v" in p.value || "f" in p.value || "p" in p.value) && g) {
        for (let r = g.startRow; r <= g.endRow; r++) for (let c = g.startColumn; c <= g.endColumn; c++) (cells[r] ||= {})[c] = p.value;
      } else if (p.value && typeof p.value === "object") cells = p.value;
      // Rich text from the cell editor: record its plain text.
      for (const row of Object.values(cells)) for (const [c, cell] of Object.entries(row || {})) if (cell?.p && !("v" in cell) && !cell.f) row[c] = { v: cell.p.body?.dataStream?.replace(/\r\n$/, "") ?? "" };
      lines.push(...valueLines(cells));
      return;
    }
    const g = selection();
    if (!g) return;
    onSheet(wb.getActiveSheet().getSheetName());
    const at = `sheet.getRange("${a1(g)}")`;
    const first = wb.getActiveSheet().getSheet().getCell?.(g.startRow, g.startColumn);
    const style = (first?.s && typeof first.s === "object" ? first.s : wb.getActiveSheet().getSheet().getCellStyle?.(g.startRow, g.startColumn)) || {};
    if (id === "sheet.command.set-bold") lines.push(`  ${at}.getFormat().getFont().setBold(${!!style.bl});`);
    else if (id === "sheet.command.set-italic") lines.push(`  ${at}.getFormat().getFont().setItalic(${!!style.it});`);
    else if (id === "sheet.command.set-text-color" && p.value) lines.push(`  ${at}.getFormat().getFont().setColor(${lit(p.value)});`);
    else if (id === "sheet.command.set-background-color" && p.value) lines.push(`  ${at}.getFormat().getFill().setColor(${lit(p.value)});`);
    else if (id === "sheet.command.numfmt.set.numfmt" && Array.isArray(p.values) && p.values[0]?.pattern) lines.push(`  ${at}.setNumberFormat(${lit(p.values[0].pattern)});`);
    else if (id === "sheet.command.clear-selection-content" || id === "sheet.command.clear-selection-all") lines.push(`  ${at}.clear();`);
  });
  return {
    get recording() {
      return !!lines;
    },
    start() {
      lines = [];
      sheetName = startName = api()?.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetName?.() || "";
    },
    stop(): string {
      const body = lines || [];
      lines = null;
      return `function main(workbook) {\n  let sheet = workbook.getWorksheet(${lit(startName)}) || workbook.getActiveWorksheet();\n${body.join("\n")}\n}\n`;
    },
    dispose() {
      sub.dispose();
    },
  };
}

/**
 * Keeps the workbook's untouched .xlsx/.xlsm parts (VBA project, code names,
 * custom XML) with the workbook, so a download puts them back. Returns a disposer.
 */
export function registerKeptParts(injector: any, core: any): () => void {
  const store = new Map<string, unknown>();
  const r = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: KEPT_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: unknown) => void store.set(unitId, value),
    onUnLoad: (unitId: string) => void store.delete(unitId),
    toJson: (unitId: string) => JSON.stringify(store.get(unitId) ?? {}),
    parseJson: (json: string) => JSON.parse(json),
  });
  return () => r.dispose();
}
