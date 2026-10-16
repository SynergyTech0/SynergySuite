// Data tables and Solver on the live workbook. Both work the way Goal Seek
// does: values go straight into the input cells (mutations, no undo steps),
// the formula engine recalculates, the results are read back, the inputs are
// put back, and the outcome is entered as one ordinary, undoable edit.
import { DATA_TABLE_RESOURCE, dataTableJobs, resultBlock, SET_DATA_TABLES_MUTATION, type DataTableDef } from "./data-table.ts";
import { rectAfter } from "./protection-rules.mjs";
import { cellsOf, parseArea, areaRef, SET_SOLVER_MUTATION, SOLVER_RESOURCE, solveModel, type Area, type Cell, type SheetAccess, type SolverModel } from "./solver.ts";
import { settled } from "./sheet-what-if.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STRUCTURAL = /^sheet\.mutation\.(insert-row|remove-rows|insert-col|remove-col|move-rows|move-columns|remove-sheet)$/;

/**
 * A per-workbook list kept in a resource (saved with the workbook) and changed
 * through a mutation (so collaborators get it). `fold` moves items with
 * inserted and removed rows and columns. Returns a disposer.
 */
export function registerListResource<T>(
  injector: any,
  core: any,
  o: { resource: string; mutation: string; field: string; store: Map<string, T[]>; onChange: () => void; fold?: (list: T[], op: { id: string; params?: any }) => T[] },
): () => void {
  const { store, onChange } = o;
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: o.resource,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: any) => {
      store.set(unitId, Array.isArray(value?.[o.field]) ? value[o.field] : []);
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    toJson: (unitId: string) => JSON.stringify({ [o.field]: store.get(unitId) || [] }),
    parseJson: (json: string) => JSON.parse(json),
  });
  const commands = injector.get(core.ICommandService);
  const mutation = commands.registerCommand({
    id: o.mutation,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: T[] }) => {
      if (!params?.unitId || !Array.isArray(params.value)) return false;
      store.set(params.unitId, params.value);
      onChange();
      return true;
    },
  });
  const follow = o.fold
    ? commands.onCommandExecuted((info: { id: string; params?: any }) => {
        if (!STRUCTURAL.test(info?.id || "")) return;
        const unitId = info.params?.unitId;
        const list = unitId && store.get(unitId);
        if (!list?.length) return;
        const next = o.fold!(list, info);
        if (next !== list) {
          store.set(unitId, next);
          onChange();
        }
      })
    : null;
  return () => {
    resource.dispose();
    mutation.dispose();
    follow?.dispose();
  };
}

/** A cell after a structural edit (null when it was removed). */
const cellAfter = (c: Cell, sheetId: string, op: any): Cell | null => {
  const r = rectAfter({ startRow: c.row, endRow: c.row, startColumn: c.column, endColumn: c.column }, sheetId, op);
  return r ? { row: r.startRow, column: r.startColumn } : null;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function foldDataTables(list: DataTableDef[], op: { id: string; params?: any }): DataTableDef[] {
  const next: DataTableDef[] = [];
  for (const d of list) {
    const range = rectAfter(d.range, d.sheetId, op);
    const rowInput = d.rowInput ? cellAfter(d.rowInput, d.sheetId, op) : null;
    const colInput = d.colInput ? cellAfter(d.colInput, d.sheetId, op) : null;
    // A table whose block or input cells went away is gone.
    if (!range || (d.rowInput && !rowInput) || (d.colInput && !colInput)) continue;
    next.push({ ...d, range, rowInput, colInput });
  }
  return same(next, list) ? list : next;
}

export function foldSolverModels(list: SolverModel[], op: { id: string; params?: any }): SolverModel[] {
  const next: SolverModel[] = [];
  for (const m of list) {
    if (op.id === "sheet.mutation.remove-sheet" && op.params?.subUnitId === m.sheetId) continue;
    const area = (g: Area) => rectAfter(g, m.sheetId, op) as Area | null;
    const text = (t?: string) => {
      const g = t ? parseArea(t) : null;
      if (!g || /!/.test(t!)) return t;
      const moved = area(g);
      return moved ? areaRef(moved, /\$/.test(t!)) : t;
    };
    next.push({
      ...m,
      objective: m.objective ? cellAfter(m.objective, m.sheetId, op) : null,
      variables: m.variables.map(area).filter((g): g is Area => !!g),
      constraints: m.constraints.flatMap((k) => {
        const lhs = area(k.lhs);
        return lhs ? [{ ...k, lhs, ...(k.rhs !== undefined ? { rhs: text(k.rhs) } : {}) }] : [];
      }),
    });
  }
  return same(next, list) ? list : next;
}

// ---- Live evaluation ----

type CellValue = { v: unknown; t?: unknown } | null;

/** Reads and writes a sheet's cells without undo steps, waiting for recalculation. */
function liveSheet(api: any, sheetId: string) {
  const wb = api.getActiveWorkbook();
  const unitId = wb.getId();
  const fs = wb.getSheetBySheetId(sheetId);
  if (!fs) throw new Error("That sheet doesn't exist.");
  const raw = (c: Cell) => fs.getSheet().getCellRaw(c.row, c.column);
  return {
    unitId,
    fs,
    raw,
    /** A copy of the cell (the model updates cell objects in place). */
    snapshot: (c: Cell): ({ v: unknown; t?: unknown; f?: string; si?: string }) | null => {
      const x = raw(c);
      return x ? { v: x.v ?? null, t: x.t ?? null, f: x.f, si: x.si } : null;
    },
    write: (cells: { cell: Cell; data: Record<string, unknown> }[]) =>
      settled(api, () => {
        const cellValue: Record<number, Record<number, unknown>> = {};
        for (const { cell, data } of cells) (cellValue[cell.row] ||= {})[cell.column] = data;
        // Trial inputs are this client's working: recalculated here, not sent to collaborators.
        api.syncExecuteCommand("sheet.mutation.set-range-values", { unitId, subUnitId: sheetId, cellValue }, { [TRANSIENT]: true });
      }),
  };
}

const cellData = (v: unknown): Record<string, unknown> =>
  v == null || v === "" ? { v: null } : typeof v === "number" ? { v, t: 2 } : typeof v === "boolean" ? { v: v ? 1 : 0, t: 3 } : { v: String(v), t: 1 };
const restoreData = (s: CellValue) => (s ? { v: s.v ?? null, t: s.t ?? null } : { v: null });

/** Marks the edits that put data-table results in, so they don't set off another run. */
const OWN_RESULTS = "dataTableResults";

/** Option on mutations that stay on this client (see lib/univer-collab.ts). */
export const TRANSIENT = "synergyTransient";

const sameValue = (cell: { v?: unknown; t?: unknown } | null | undefined, next: Record<string, unknown>) => {
  const a = cell?.v ?? null;
  const b = next.v ?? null;
  return a === b || (a !== null && b !== null && String(a) === String(b) && typeof a === typeof b);
};

/**
 * Enters values as one undoable edit, leaving out cells that already hold
 * them: with collaborators each client works the tables out, and the same
 * results again are no edit (so results arriving from a peer settle).
 */
async function enter(api: any, unitId: string, sheetId: string, values: { cell: Cell; value: unknown }[]) {
  const ws = api.getActiveWorkbook()?.getSheetBySheetId?.(sheetId)?.getSheet?.();
  const value: Record<number, Record<number, unknown>> = {};
  let changed = 0;
  for (const { cell, value: v } of values) {
    const data = cellData(v);
    const now = ws?.getCellRaw?.(cell.row, cell.column);
    if (now && !now.f && !now.si && sameValue(now, data)) continue;
    if (!now && data.v === null) continue;
    (value[cell.row] ||= {})[cell.column] = data;
    changed++;
  }
  if (!changed) return;
  await settled(api, () => {
    void api.executeCommand("sheet.command.set-range-values", { unitId, subUnitId: sheetId, value, [OWN_RESULTS]: true });
  });
}

// ---- Data tables ----

export type DataTableStore = Map<string, DataTableDef[]>;

/**
 * Works a data table out: each input value (or pair) goes into the input
 * cell(s), the formulas are read after recalculation, the inputs are put
 * back, and the results are entered in one edit. Returns the number of
 * recalculations.
 */
/** Works a data table out on the live sheet (trial inputs, put back after), without entering the results. */
export async function dataTableResults(api: any, def: DataTableDef): Promise<{ results: { cell: Cell; value: unknown }[]; runs: number }> {
  const s = liveSheet(api, def.sheetId);
  const value = (c: Cell) => {
    const v = s.raw(c)?.v;
    return v === undefined ? null : v;
  };
  const jobs = dataTableJobs(def, value);
  if (jobs.length > 2500) throw new Error("A data table can have up to 2,500 results here.");
  const inputs = [def.rowInput, def.colInput].filter((c): c is Cell => !!c);
  const originals = inputs.map((c) => s.snapshot(c));
  if (originals.some((o) => o?.f || o?.si)) throw new Error("Input cells must hold values, not formulas.");
  const results: { cell: Cell; value: unknown }[] = [];
  try {
    for (const job of jobs) {
      await s.write(job.inputs.map((i) => ({ cell: i.cell, data: cellData(i.value) })));
      for (const r of job.reads) results.push({ cell: r.to, value: value(r.from) });
    }
  } finally {
    await s.write(inputs.map((cell, i) => ({ cell, data: restoreData(originals[i]) })));
  }
  return { results, runs: jobs.length };
}

export async function runDataTable(api: any, def: DataTableDef): Promise<number> {
  const { results, runs } = await dataTableResults(api, def);
  await enter(api, api.getActiveWorkbook().getId(), def.sheetId, results);
  return runs;
}

/**
 * Puts values on the live sheet for this client only (not undoable, not sent
 * to collaborators) and waits for the formulas to recalculate. Returns a
 * function that puts every cell back as it was.
 */
export async function trialValues(api: any, sheetId: string, cells: { cell: Cell; data: Record<string, unknown> }[]): Promise<() => Promise<void>> {
  const s = liveSheet(api, sheetId);
  const originals = cells.map(({ cell }) => {
    const x = s.raw(cell);
    return { cell, data: x ? { v: x.v ?? null, t: x.t ?? null, f: x.f ?? null, si: x.si ?? null, p: x.p ? JSON.parse(JSON.stringify(x.p)) : null } : { v: null, f: null, si: null, p: null } };
  });
  await s.write(cells);
  return () => s.write(originals.reverse());
}

/** Validates a new data table: the input cells sit outside the block, on the same sheet. */
export function checkDataTable(def: DataTableDef) {
  const g = def.range;
  if (g.endRow <= g.startRow || g.endColumn <= g.startColumn) throw new Error("Select the inputs and formulas with the cells for the results: at least two rows and two columns.");
  for (const c of [def.rowInput, def.colInput])
    if (c && c.row >= g.startRow && c.row <= g.endRow && c.column >= g.startColumn && c.column <= g.endColumn) throw new Error("An input cell can't be inside the data table.");
}

const EDITS = /^sheet\.command\.(set-range-values|clear-selection-content|clear-selection-all|auto-fill|paste.*)$/;

/**
 * Registers data tables (resource and mutation) and keeps them up to date:
 * after this person's own edits the tables of the workbook are worked out
 * again, like Excel's automatic calculation. Returns { refresh, dispose }.
 */
export function registerDataTables(injector: any, core: any, api: () => any, store: DataTableStore, onChange: () => void, canEdit: () => boolean) {
  const dispose = registerListResource<DataTableDef>(injector, core, {
    resource: DATA_TABLE_RESOURCE,
    mutation: SET_DATA_TABLES_MUTATION,
    field: "tables",
    store,
    onChange,
    fold: foldDataTables,
  });
  let running = false;
  // An edit made while the tables are being worked out: go again afterwards.
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh().catch(() => {});
    }, 400);
  };
  const refresh = async (only?: DataTableDef[]) => {
    const a = api();
    const unitId = a?.getActiveWorkbook?.()?.getId?.();
    const list = only || (unitId && store.get(unitId)) || [];
    if (running || !list.length) return 0;
    running = true;
    let n = 0;
    try {
      for (const d of list) n += await runDataTable(a, d);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
    return n;
  };
  const commands = injector.get(core.ICommandService);
  // A collaborator's edit comes in as a mutation; their results (cells inside a table's result block) don't count.
  const fromPeer = (info: { id: string; params?: any }, options?: any) => {
    if (!options?.fromCollab || info?.id !== "sheet.mutation.set-range-values") return false;
    const p = info.params || {};
    const tables = store.get(p.unitId) || [];
    if (!tables.length) return false;
    const cells = Object.entries(p.cellValue || {}).flatMap(([r, row]) => Object.keys((row as object) || {}).map((c) => ({ row: Number(r), column: Number(c) })));
    const inResults = (c: Cell) =>
      tables.some((d) => {
        const g = d.range;
        return d.sheetId === p.subUnitId && c.row > g.startRow && c.row <= g.endRow && c.column > g.startColumn && c.column <= g.endColumn;
      });
    return cells.length > 0 && !cells.every(inResults);
  };
  const auto = commands.onCommandExecuted((info: { id: string; params?: any }, options?: any) => {
    if (!(EDITS.test(info?.id || "") || fromPeer(info, options)) || !canEdit()) return;
    // While a table is being worked out (a new one may not be stored yet),
    // an edit means going again afterwards; our own results going in don't.
    if (running) {
      if (!info.params?.[OWN_RESULTS]) again = true;
      return;
    }
    const unitId = api()?.getActiveWorkbook?.()?.getId?.();
    if (!unitId || !store.get(unitId)?.length) return;
    schedule();
  });
  return {
    refresh,
    get running() {
      return running;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      auto.dispose();
      dispose();
    },
  };
}

export async function saveList(api: any, mutation: string, unitId: string, list: unknown[]) {
  const ok = await api.executeCommand(mutation, { unitId, value: list });
  if (ok === false) throw new Error("Could not save the change.");
}

export const saveDataTables = (api: any, unitId: string, list: DataTableDef[]) => saveList(api, SET_DATA_TABLES_MUTATION, unitId, list);
export const saveSolverModels = (api: any, unitId: string, list: SolverModel[]) => saveList(api, SET_SOLVER_MUTATION, unitId, list);

export const dataTableCells = (def: DataTableDef) => cellsOf(resultBlock(def.range));

// ---- Solver ----

export type SolverStore = Map<string, SolverModel[]>;

export function registerSolver(injector: any, core: any, store: SolverStore, onChange: () => void) {
  return registerListResource<SolverModel>(injector, core, { resource: SOLVER_RESOURCE, mutation: SET_SOLVER_MUTATION, field: "models", store, onChange, fold: foldSolverModels });
}

type HighsModule = { solve: (lp: string, options?: Record<string, unknown>) => any };
let highs: Promise<HighsModule> | null = null;

/** Loads HiGHS (WebAssembly) on first use, from the app's own vendor route. */
export function loadHighs(): Promise<HighsModule> {
  if (!highs) {
    highs = (async () => {
      const url = "/vendor/highs/highs.mjs";
      const mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
      return (mod.default || mod)({ locateFile: (file: string) => `/vendor/highs/${file}` });
    })();
    highs.catch(() => (highs = null));
  }
  return highs;
}

export type SolverOutcome = { status: string; message: string; objective: number; values: { cell: Cell; value: number }[]; method: string };

const tidy = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-9 ? r : Number(x.toPrecision(12));
};

/**
 * Solves a model on the live sheet. The tries go straight to the cells; the
 * original values are put back afterwards (keepSolution enters the answer).
 */
export async function runSolver(api: any, model: SolverModel): Promise<SolverOutcome> {
  const s = liveSheet(api, model.sheetId);
  const num = (c: Cell) => {
    const v = s.raw(c)?.v;
    return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "boolean" ? Number(v) : v == null ? 0 : NaN;
  };
  let vars: Cell[] = [];
  let originals: ReturnType<typeof s.snapshot>[] = [];
  let evaluations = 0;
  const access: SheetAccess = {
    read: num,
    evaluate: async (cells, x, readBack) => {
      if (!originals.length) {
        vars = cells;
        originals = cells.map((c) => s.snapshot(c));
        if (originals.some((o) => o?.f || o?.si)) throw new Error("Variable cells must hold values, not formulas.");
      }
      if (++evaluations > 20000) throw new Error("Solver stopped after too many trials.");
      await s.write(cells.map((cell, i) => ({ cell, data: { v: x[i], t: 2 } })));
      return readBack(num);
    },
  };
  let result;
  try {
    result = await solveModel(model, access, loadHighs);
  } finally {
    if (originals.length) await s.write(vars.map((cell, i) => ({ cell, data: restoreData(originals[i]) })));
  }
  const values = result.vars.map((cell, i) => ({ cell, value: tidy(result.x[i]) }));
  return { status: result.status, message: result.message, objective: result.objective, values, method: result.method };
}

/** Keeps Solver's answer: the variable cells take it, as one undoable edit. */
export async function keepSolution(api: any, sheetId: string, values: SolverOutcome["values"]) {
  const wb = api.getActiveWorkbook();
  await enter(api, wb.getId(), sheetId, values);
}
