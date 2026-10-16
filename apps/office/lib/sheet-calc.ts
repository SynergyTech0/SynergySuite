// Calculation on the live sheet: spill references (A1#, through Excel's own
// ANCHORARRAY function), the spills of dynamic-array formulas for .xlsx, and
// iterative calculation (circular references calculated round and round).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CALC_RESOURCE, calcSettings, DEFAULT_CALC, spillRefsToAnchorArray, type CalcSettings, type Spill, type SpillInfo } from "./xlsx-calc";

export const SET_CALC_MUTATION = "sheet.mutation.set-calc-settings";

/** A Univer formula-engine module (`@univerjs/engine-formula`), as loaded. */
type Engine = any;

/**
 * ANCHORARRAY(A1): the whole spill of the dynamic-array formula in A1, as a
 * reference (so SUM(A1#), ROWS(A1#), INDEX(A1#, …) see every spilled cell).
 */
function anchorArrayClass(engine: Engine, injector: any) {
  const { BaseFunction, ErrorValueObject, IFormulaRuntimeService, FormulaDataModel } = engine;
  return class AnchorArray extends BaseFunction {
    constructor(name: string) {
      super(name);
    }
    minParams = 1;
    maxParams = 1;
    needsReferenceObject = true;
    isAddress() {
      return true;
    }
    calculate(reference: any) {
      if (reference?.isError?.()) return reference;
      if (!reference?.isReferenceObject?.()) return ErrorValueObject.create("#VALUE!");
      const at = reference.getRangePosition();
      const unitId = reference.getForcedUnitId?.() || reference.getUnitId?.() || this.unitId;
      const sheetId = reference.getForcedSheetId?.() || this.subUnitId;
      const find = (ranges: any) => ranges?.[unitId]?.[sheetId]?.[at.startRow]?.[at.startColumn];
      let range: any = null;
      try {
        // This run's spills first (the anchor may just have been worked out), then the last run's.
        range =
          find(reference.getRuntimeArrayFormulaRange?.()) ||
          find(injector.get(IFormulaRuntimeService).getRuntimeArrayFormulaRange?.()) ||
          find(reference.getArrayFormulaRange?.()) ||
          find(injector.get(FormulaDataModel).getArrayFormulaRange?.());
      } catch {
        range = null;
      }
      // A cell that does not spill: Excel answers #REF!.
      if (!range) return ErrorValueObject.create("#REF!");
      return this.createReferenceObject(reference, { startRow: range.startRow, startColumn: range.startColumn, endRow: range.endRow, endColumn: range.endColumn });
    }
  };
}

/** The engine's results so far in this calculation, cell by cell. */
export function runtimeValues(runtime: any): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const data = runtime?._runtimeData || {};
  for (const [unitId, sheets] of Object.entries(data as Record<string, Record<string, any>>))
    for (const [sheetId, matrix] of Object.entries(sheets || {}))
      matrix?.forValue?.((r: number, c: number, vo: any) => {
        out.set(`${unitId}!${sheetId}!${r}!${c}`, vo?.getValue ? vo.getValue() : vo);
      });
  return out;
}

/**
 * Excel's "maximum change": iteration stops once no result moved by more than
 * this from one time round to the next (any change that isn't a number counts as too much).
 */
export function converged(before: Map<string, unknown>, after: Map<string, unknown>, maxChange: number): boolean {
  for (const [k, v] of after) {
    const was = before.get(k);
    if (typeof v === "number" && typeof was === "number") {
      if (Math.abs(v - was) > maxChange) return false;
    } else if (v !== was) return false;
  }
  return true;
}

/** Rewrites A1# in the formulas a command is about to enter. */
function rewriteCells(value: any): boolean {
  let changed = false;
  const fix = (cell: any) => {
    if (cell && typeof cell.f === "string" && cell.f.includes("#")) {
      const f = spillRefsToAnchorArray(cell.f);
      if (f !== cell.f) {
        cell.f = f;
        changed = true;
      }
    }
  };
  if (!value || typeof value !== "object") return false;
  if ("f" in value || "v" in value) fix(value);
  else for (const row of Object.values(value)) if (row && typeof row === "object") for (const cell of Object.values(row as object)) fix(cell);
  return changed;
}

/**
 * Registers ANCHORARRAY and the A1# spill reference, and the workbook's
 * calculation settings (resource + mutation, so they reach collaborators and
 * the .xlsx). Returns the settings store's reader and a dispose function.
 */
// ---- 3-D references ------------------------------------------------------------
// Sheet1:Sheet3!A1 means A1 on every sheet from Sheet1 to Sheet3 in tab order.
// Excel allows them only in functions that take a list (SUM, AVERAGE, COUNT,
// MAX, MIN, PRODUCT, STDEV, VAR and their A variants), so they are worked out
// as that list: Sheet1!A1,Sheet2!A1,Sheet3!A1. The cell keeps what was typed;
// only the calculation sees the list (see registerCalc).

const CELL_REF = "\\$?[A-Za-z]{1,3}\\$?\\d+(?::\\$?[A-Za-z]{1,3}\\$?\\d+)?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+";
const SPAN_3D = new RegExp(`(^|[^\\w.'!])(?:'((?:[^':]|'')+):((?:[^':]|'')+)'|([A-Za-z_\\u00c0-\\uffff][\\w.\\u00c0-\\uffff]*):([A-Za-z_\\u00c0-\\uffff][\\w.\\u00c0-\\uffff]*))!(${CELL_REF})(?![\\w(])`, "g");
const quoteName = (n: string) => (/^[A-Za-z_][\w.]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/** True when a formula has a 3-D reference. */
export const has3dRef = (formula: string) => formula.includes(":") && formula.includes("!") && expand3dRefs(formula, null) !== formula;

/** A formula with each 3-D reference written out as a list of one reference per sheet (tab order). Unknown sheets: #REF!. */
export function expand3dRefs(formula: string, sheets: string[] | null): string {
  if (!formula.includes("!") || !formula.includes(":")) return formula;
  // Not inside text in quotes.
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(SPAN_3D, (whole, lead: string, q1?: string, q2?: string, n1?: string, n2?: string, ref?: string) => {
            const a = q1 != null ? q1.replace(/''/g, "'") : n1!;
            const b = q2 != null ? q2.replace(/''/g, "'") : n2!;
            // A:B!… that is really a range on one sheet can't happen: a sheet name never looks like a column.
            if (!sheets) return `${lead}#3D`;
            const lower = sheets.map((n) => n.toLowerCase());
            let from = lower.indexOf(a.toLowerCase());
            let to = lower.indexOf(b.toLowerCase());
            if (from < 0 || to < 0) return `${lead}#REF!`;
            if (from > to) [from, to] = [to, from];
            return lead + sheets.slice(from, to + 1).map((n) => `${quoteName(n)}!${ref}`).join(",");
          }),
    )
    .join("");
}

export function registerCalc(
  injector: any,
  core: any,
  engine: Engine,
  o: { store: Map<string, CalcSettings>; onChange: () => void; onCircular?: () => void },
) {
  const functions = injector.get(engine.IFunctionService);
  const AnchorArray = anchorArrayClass(engine, injector);
  functions.registerExecutors(new AnchorArray("ANCHORARRAY"));

  const commands = injector.get(core.ICommandService);
  const before = commands.beforeCommandExecuted((info: { id: string; params?: any }) => {
    if (info?.id !== "sheet.command.set-range-values" && info?.id !== "sheet.mutation.set-range-values") return;
    const p = info.params;
    if (p?.value) rewriteCells(p.value);
    if (p?.cellValue) rewriteCells(p.cellValue);
  });

  const config = injector.get(core.IConfigService);
  const apply = (unitId: string) => {
    const s = o.store.get(unitId) || DEFAULT_CALC;
    // The engine goes round a circular reference this many times.
    config.setConfig(engine.ENGINE_FORMULA_CYCLE_REFERENCE_COUNT, s.iterate ? s.maxIterations : 1);
  };
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: CALC_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: any) => {
      o.store.set(unitId, calcSettings(value));
      apply(unitId);
      o.onChange();
    },
    onUnLoad: (unitId: string) => {
      o.store.delete(unitId);
      o.onChange();
    },
    toJson: (unitId: string) => JSON.stringify(o.store.get(unitId) || DEFAULT_CALC),
    parseJson: (json: string) => JSON.parse(json),
  });
  const mutation = commands.registerCommand({
    id: SET_CALC_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: CalcSettings }) => {
      if (!params?.unitId || !params.value) return false;
      o.store.set(params.unitId, calcSettings(params.value));
      apply(params.unitId);
      o.onChange();
      return true;
    },
  });

  // Iteration stops early once the results move less than the maximum change.
  let restoreStep: (() => void) | null = null;
  try {
    const calc = injector.get(engine.ICalculateFormulaService);
    const runtime = injector.get(engine.IFormulaRuntimeService);
    const step = calc?._executeStep;
    if (typeof step === "function") {
      calc._executeStep = async function (this: unknown, ...args: unknown[]) {
        const unitId = injector.get(core.IUniverInstanceService).getFocusedUnit?.()?.getUnitId?.();
        const s = (unitId && o.store.get(unitId)) || [...o.store.values()][0];
        const before = s?.iterate && runtime.getFormulaCycleIndex?.() > 0 ? runtimeValues(runtime) : null;
        const result = await step.apply(calc, args);
        if (before && runtime.isCycleDependency?.() && converged(before, runtimeValues(runtime), s!.maxChange)) runtime.disableCycleDependency?.();
        return result;
      };
      restoreStep = () => {
        calc._executeStep = step;
      };
    }
  } catch {
    restoreStep = null;
  }

  // 3-D references: the engine's lexer sees them as lists of references.
  let restoreLexer: (() => void) | null = null;
  let sheetsChanged: { dispose(): void } | null = null;
  try {
    const lexer = engine.Lexer ? injector.get(engine.Lexer) : null;
    const instances = injector.get(core.IUniverInstanceService);
    const tree = lexer?.treeBuilder;
    if (lexer && typeof tree === "function") {
      const sheetNames = () => {
        const unitId = lexer._formulaCurrentConfigService?.getExecuteUnitId?.();
        const wb = (unitId && instances.getUnit?.(unitId)) || instances.getFocusedUnit?.();
        const ids: string[] = wb?.getSheetOrders?.() || [];
        return ids.map((id) => wb.getSheetBySheetId(id)?.getName?.() ?? "");
      };
      lexer.treeBuilder = function (formula: string, ...rest: unknown[]) {
        const expanded = typeof formula === "string" && formula.includes(":") && formula.includes("!") ? expand3dRefs(formula, sheetNames()) : formula;
        return tree.call(lexer, expanded, ...rest);
      };
      restoreLexer = () => {
        lexer.treeBuilder = tree;
      };
      // Which sheets a 3-D reference spans changes when sheets come, go, move or are renamed.
      const STRUCTURE = new Set(["sheet.mutation.insert-sheet", "sheet.mutation.remove-sheet", "sheet.mutation.set-worksheet-order", "sheet.mutation.set-worksheet-name"]);
      sheetsChanged = commands.onCommandExecuted((info: { id: string }) => {
        if (!STRUCTURE.has(info?.id)) return;
        const wb = instances.getFocusedUnit?.();
        const clear: Record<string, string> = {};
        for (const sh of wb?.getSheets?.() || []) {
          sh.getCellMatrix?.()?.forValue?.((_r: number, _c: number, cell: { f?: string }) => {
            if (cell?.f && has3dRef(cell.f)) {
              clear[sh.getSheetId()] = "1";
              return false;
            }
          });
        }
        const has3d = Object.keys(clear).length > 0;
        // Their dependencies are worked out again (the engine keeps parsed
        // formulas by their text, so those go too), then everything recalculates.
        if (has3d)
          setTimeout(
            () => {
              try {
                injector.get(engine.IFormulaDependencyGenerator)?._disposeByUnitId?.(wb.getUnitId());
              } catch {
                /* recalculates with what it has */
              }
              commands.executeCommand(
                "formula.mutation.set-formula-calculation-start",
                { forceCalculation: true, dirtyRanges: [], dirtyNameMap: {}, dirtyDefinedNameMap: {}, dirtySuperTableMap: {}, dirtyUnitFeatureMap: {}, dirtyUnitOtherFormulaMap: {}, clearDependencyTreeCache: { [wb.getUnitId()]: clear } },
                { onlyLocal: true },
              );
            },
            0,
          );
      });
    }
  } catch {
    restoreLexer = null;
  }

  // Without iterative calculation a circular reference is a mistake: say so
  // (once per run of calculation that has one).
  let calcEnd: { dispose(): void } | null = null;
  try {
    const runtime = injector.get(engine.IFormulaRuntimeService);
    const done = commands.onCommandExecuted((info: { id: string }) => {
      if (info?.id !== "formula.mutation.set-formula-calculation-notification") return;
      try {
        if (runtime.isCycleDependency?.()) {
          const unitId = injector.get(core.IUniverInstanceService).getFocusedUnit?.()?.getUnitId?.();
          if (!o.store.get(unitId)?.iterate) o.onCircular?.();
        }
      } catch {
        /* the warning is a courtesy */
      }
    });
    calcEnd = done;
  } catch {
    calcEnd = null;
  }

  return () => {
    before.dispose();
    resource.dispose();
    mutation.dispose();
    calcEnd?.dispose();
    restoreStep?.();
    restoreLexer?.();
    sheetsChanged?.dispose();
    try {
      functions.unregisterExecutors("ANCHORARRAY");
    } catch {
      /* gone with the engine */
    }
  };
}

/** Changes the workbook's calculation settings (for everyone) and recalculates. */
export function setCalcSettings(api: any, value: CalcSettings) {
  const wb = api.getActiveWorkbook();
  api.syncExecuteCommand(SET_CALC_MUTATION, { unitId: wb.getId(), value: calcSettings(value) });
  try {
    api.getFormula().executeCalculation();
  } catch {
    /* the next edit recalculates */
  }
}

/** The spills of the workbook's dynamic-array formulas, with the spilled values. */
export function liveSpills(injector: any, engine: Engine, unitId: string): SpillInfo {
  const out: SpillInfo = {};
  let ranges: any;
  let cells: any;
  try {
    const model = injector.get(engine.FormulaDataModel);
    ranges = model.getArrayFormulaRange?.()?.[unitId] || {};
    cells = model.getArrayFormulaCellData?.()?.[unitId] || {};
  } catch {
    return out;
  }
  for (const [sheetId, rows] of Object.entries(ranges as Record<string, Record<string, Record<string, any>>>)) {
    const spills: Spill[] = [];
    for (const [r, cols] of Object.entries(rows || {}))
      for (const [c, g] of Object.entries(cols || {})) if (g) spills.push({ row: Number(r), column: Number(c), endRow: g.endRow, endColumn: g.endColumn });
    if (!spills.length) continue;
    const values: Record<number, Record<number, unknown>> = {};
    for (const [r, cols] of Object.entries((cells?.[sheetId] || {}) as Record<string, Record<string, any>>))
      for (const [c, cell] of Object.entries(cols || {})) if (cell && cell.v !== undefined) (values[Number(r)] ||= {})[Number(c)] = cell.v;
    out[sheetId] = { spills, values };
  }
  return out;
}
