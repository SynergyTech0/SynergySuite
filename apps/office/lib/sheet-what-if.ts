// Formula auditing and what-if analysis on the live workbook: Show formulas
// (a view switch, per person), trace arrows (worked out from the formulas),
// Goal Seek (tries values in the input cell and lets the formula engine
// recalculate after each one) and the Scenario Manager.
import { formulaAt, traceLevel, type Arrow, type CellAt } from "./formula-refs.ts";
import { goalSeek } from "./goal-seek.ts";
import { rectAfter } from "./protection-rules.mjs";
import { scenarioSummary, SCENARIO_RESOURCE, SET_SCENARIOS_MUTATION, type Scenario, type ScenarioResource, type ScenarioValue } from "./scenarios.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Runs `attach` once the sheet plugins have started (their services, such as
 * the cell interceptors, exist only after the first workbook is created).
 * Returns a disposer for whatever `attach` returned.
 */
export function whenSheetsReady(injector: any, core: any, attach: () => { dispose(): void }): () => void {
  let done: { dispose(): void } | null = null;
  let sub: any = null;
  const tryAttach = () => {
    if (done) return true;
    try {
      done = attach();
      sub?.unsubscribe?.();
      return true;
    } catch {
      return false;
    }
  };
  if (!tryAttach()) sub = injector.get(core.IUniverInstanceService).getTypeOfUnitAdded$(core.UniverInstanceType.UNIVER_SHEET).subscribe(() => tryAttach());
  return () => {
    sub?.unsubscribe?.();
    (done as { dispose(): void } | null)?.dispose();
  };
}

/**
 * Show formulas: formula cells display their formula instead of the result.
 * Only drawing is affected (values read by formulas, copy and export are not).
 * Returns { set(on), dispose() }.
 */
export function registerShowFormulas(injector: any, core: any, sheets: any) {
  let on = false;
  const attach = () => {
    let model: any = null;
    try {
      model = injector.get(sheets.FormulaDataModel);
    } catch {
      /* shared formulas then show their result */
    }
    return injector.get(sheets.SheetInterceptorService).intercept(sheets.INTERCEPTOR_POINT.CELL_CONTENT, {
      effect: core.InterceptorEffectEnum.Style,
      priority: 100,
      handler: (cell: any, pos: any, next: (c: any) => any) => {
        const out = next(cell);
        if (!on) return out;
        const raw = pos.rawData;
        if (!raw?.f && !raw?.si) return out;
        const f: string | null | undefined = raw.f || model?.getFormulaStringByCell?.(pos.row, pos.col, pos.subUnitId, pos.unitId);
        if (!f) return out;
        // Drawn over the cell instead of its result, so values read by
        // formulas, copy and export stay the results.
        const res = { ...(out || raw) };
        res.fontRenderExtension = { ...(res.fontRenderExtension || {}), isSkip: true };
        res.customRender = [
          ...(res.customRender || []),
          {
            zIndex: 2,
            drawWith(ctx: CanvasRenderingContext2D, info: any) {
              const at = info.primaryWithCoord?.isMergedMainCell ? info.primaryWithCoord.mergeInfo : info.primaryWithCoord;
              if (!at) return;
              const st = info.style || {};
              ctx.save();
              ctx.beginPath();
              ctx.rect(at.startX, at.startY, at.endX - at.startX, at.endY - at.startY);
              ctx.clip();
              ctx.font = `${st.it ? "italic " : ""}${st.bl ? "bold " : ""}${st.fs || 11}pt ${st.ff || "Arial"}`;
              ctx.fillStyle = st.cl?.rgb || "#000";
              ctx.textBaseline = "middle";
              ctx.fillText(f, at.startX + 3, (at.startY + at.endY) / 2);
              ctx.restore();
            },
          },
        ];
        return res;
      },
    });
  };
  const dispose = whenSheetsReady(injector, core, attach);
  return {
    set(value: boolean) {
      on = value;
    },
    dispose,
  };
}

/** Redraws the sheet on screen (after a view switch the cells don't know about). */
export function redraw(api: any) {
  try {
    api?.getActiveWorkbook?.()?.getActiveSheet?.()?.refreshCanvas?.();
  } catch {
    /* not rendered yet */
  }
}

// ---- Trace arrows ----

export type TraceState = { arrows: Arrow[]; precedents: CellAt[]; dependents: CellAt[] };
export const NO_TRACE: TraceState = { arrows: [], precedents: [], dependents: [] };

const key = (a: Arrow) => JSON.stringify([a.from, a.to]);
const cellKey = (c: CellAt) => `${c.sheetId}:${c.row}:${c.column}`;

/**
 * One more level of arrows (Excel adds a level per click): from the selected
 * cell the first time, then from the cells the last level reached.
 */
export function traceMore(book: any, state: TraceState, start: CellAt, direction: "precedents" | "dependents"): { state: TraceState; added: number } {
  const frontier = state[direction].length ? state[direction] : [start];
  const arrows = traceLevel(book, frontier, direction);
  const seen = new Set(state.arrows.map(key));
  // A reference used twice in a formula is still one arrow.
  const fresh = arrows.filter((a) => !seen.has(key(a)) && (seen.add(key(a)), true));
  // The next level starts from the formula cells this one reached.
  const next = new Map<string, CellAt>();
  for (const a of fresh) {
    if (direction === "dependents") next.set(cellKey(a.to), a.to);
    else
      for (let r = a.from.startRow; r <= Math.min(a.from.endRow, a.from.startRow + 1000); r++)
        for (let c = a.from.startColumn; c <= Math.min(a.from.endColumn, a.from.startColumn + 200); c++) {
          const at = { sheetId: a.from.sheetId, row: r, column: c };
          if (formulaAt(book, at)) next.set(cellKey(at), at);
        }
  }
  return {
    added: fresh.length,
    state: { ...state, arrows: [...state.arrows, ...fresh], [direction]: fresh.length ? [...next.values()] : frontier },
  };
}

// ---- Goal Seek ----

type Cell = { sheetId: string; row: number; column: number };

const numberOf = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/**
 * Waits for the formula engine to finish the calculation a change starts.
 * Only a calculation that starts once the change is made counts: one already
 * under way when it is made can end first, with the old values.
 */
export function settled(api: any, run: () => void, timeout = 3000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let armed = false;
    let started = false;
    const subs: any[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const s of subs) s?.dispose?.();
      resolve();
    };
    // No calculation within the timeout: the change needed none. One that has started gets longer to end.
    let timer = setTimeout(() => (started ? (timer = setTimeout(finish, timeout * 10)) : finish()), timeout);
    try {
      const formula = api.getFormula();
      subs.push(
        formula.calculationStart(() => {
          if (armed) started = true;
        }),
      );
      subs.push(
        formula.calculationEnd(() => {
          if (started) finish();
        }),
      );
    } catch {
      /* no engine events: fall back to the timeout */
    }
    armed = true;
    run();
  });
}

export type GoalSeekOutcome = { found: boolean; value: number; result: number; iterations: number; message: string };

/**
 * Excel's Goal Seek: changes `byChanging` until the formula in `setCell`
 * reaches `toValue`. The tries go straight to the cells (no undo steps); the
 * answer is then entered as one ordinary, undoable edit.
 */
export async function runGoalSeek(api: any, setCell: Cell, toValue: number, byChanging: Cell, label: { set: string }): Promise<GoalSeekOutcome> {
  const wb = api.getActiveWorkbook();
  const unitId = wb.getId();
  const target = wb.getSheetBySheetId(setCell.sheetId);
  const input = wb.getSheetBySheetId(byChanging.sheetId);
  if (!target || !input) throw new Error("That sheet doesn't exist.");
  const raw = (sheet: any, c: Cell) => sheet.getSheet().getCellRaw(c.row, c.column);
  const formula = target.getRange(setCell.row, setCell.column).getFormula?.();
  if (!formula && !raw(target, setCell)?.f && !raw(target, setCell)?.si) throw new Error("The Set cell must contain a formula.");
  // A copy: the model updates cell objects in place.
  const live = raw(input, byChanging);
  const before = live ? { v: live.v, t: live.t, f: live.f, si: live.si } : null;
  if (before?.f || before?.si) throw new Error("The By changing cell must contain a value, not a formula.");
  const start = numberOf(before?.v);
  const write = (cell: Record<string, unknown> | null) =>
    settled(api, () =>
      api.syncExecuteCommand("sheet.mutation.set-range-values", {
        unitId,
        subUnitId: byChanging.sheetId,
        cellValue: { [byChanging.row]: { [byChanging.column]: cell } },
      }),
    );
  const read = () => numberOf(raw(target, setCell)?.v);
  let result;
  try {
    result = await goalSeek(
      async (x) => {
        await write({ v: x, t: 2 });
        return read();
      },
      toValue,
      Number.isFinite(start) ? start : 0,
    );
  } finally {
    // Put the old value back before entering the answer as one edit.
    await write(before ? { v: before.v ?? null, t: before.t ?? null } : { v: null });
  }
  await settled(api, () => input.getRange(byChanging.row, byChanging.column).setValue(result.value));
  const shown = (n: number) => String(Math.round(n * 1e9) / 1e9);
  const message = result.found
    ? `Goal Seeking with Cell ${label.set} found a solution.\nTarget value: ${shown(toValue)}\nCurrent value: ${shown(read())}`
    : `Goal Seeking with Cell ${label.set} may not have found a solution.\nTarget value: ${shown(toValue)}\nCurrent value: ${shown(read())}`;
  return { ...result, message: `${message}\nUndo (Ctrl+Z) puts the old value back.` };
}

// ---- Scenario Manager ----

export type ScenarioStore = Map<string, Scenario[]>;

const STRUCTURAL = /^sheet\.mutation\.(insert-row|remove-rows|insert-col|remove-col|move-rows|move-columns|remove-sheet)$/;

/** Scenarios after a structural edit: their cells move with rows and columns. */
export function foldScenarios(list: Scenario[], op: { id: string; params?: any }): Scenario[] {
  let changed = false;
  const next: Scenario[] = [];
  for (const s of list) {
    const cells = s.cells.flatMap((c) => {
      const r = rectAfter({ startRow: c.row, endRow: c.row, startColumn: c.column, endColumn: c.column }, s.sheetId, op);
      if (!r) return [];
      return r.startRow === c.row && r.startColumn === c.column ? [c] : [{ ...c, row: r.startRow, column: r.startColumn }];
    });
    if (cells.length !== s.cells.length || cells.some((c, i) => c !== s.cells[i])) changed = true;
    if (cells.length) next.push(cells.every((c, i) => c === s.cells[i]) && cells.length === s.cells.length ? s : { ...s, cells });
  }
  return changed ? next : list;
}

/** Registers the scenarios resource and mutation; returns a disposer. */
export function registerScenarios(injector: any, core: any, store: ScenarioStore, onChange: () => void): () => void {
  const resource = injector.get(core.IResourceManagerService).registerPluginResource({
    pluginName: SCENARIO_RESOURCE,
    businesses: [core.UniverInstanceType.UNIVER_SHEET],
    onLoad: (unitId: string, value: ScenarioResource) => {
      store.set(unitId, Array.isArray(value?.scenarios) ? value.scenarios : []);
      onChange();
    },
    onUnLoad: (unitId: string) => {
      store.delete(unitId);
      onChange();
    },
    toJson: (unitId: string) => JSON.stringify({ scenarios: store.get(unitId) || [] }),
    parseJson: (json: string) => JSON.parse(json) as ScenarioResource,
  });
  const commands = injector.get(core.ICommandService);
  const mutation = commands.registerCommand({
    id: SET_SCENARIOS_MUTATION,
    type: core.CommandType.MUTATION,
    handler: (_accessor: unknown, params?: { unitId: string; value: Scenario[] }) => {
      if (!params?.unitId || !Array.isArray(params.value)) return false;
      store.set(params.unitId, params.value);
      onChange();
      return true;
    },
  });
  const follow = commands.onCommandExecuted((info: { id: string; params?: any }) => {
    if (!STRUCTURAL.test(info?.id || "")) return;
    const unitId = info.params?.unitId;
    const list = unitId && store.get(unitId);
    if (!list?.length) return;
    const next = foldScenarios(list, info);
    if (next !== list) {
      store.set(unitId, next);
      onChange();
    }
  });
  return () => {
    resource.dispose();
    mutation.dispose();
    follow.dispose();
  };
}

export async function saveScenarios(api: any, unitId: string, list: Scenario[]) {
  const ok = await api.executeCommand(SET_SCENARIOS_MUTATION, { unitId, value: list });
  if (ok === false) throw new Error("Could not save the scenarios.");
}

const cellData = (v: ScenarioValue) => (v == null ? { v: null } : typeof v === "number" ? { v, t: 2 } : typeof v === "boolean" ? { v: v ? 1 : 0, t: 3 } : { v, t: 1 });

/** Shows a scenario: its values go into the changing cells (one undo step each). */
export async function showScenario(api: any, s: Scenario) {
  const sheet = api.getActiveWorkbook().getSheetBySheetId(s.sheetId);
  if (!sheet) throw new Error("The scenario's sheet no longer exists.");
  for (const c of s.cells) sheet.getRange(c.row, c.column).setValue(c.value == null ? "" : c.value);
}

/**
 * Builds a Scenario Summary sheet: each scenario is applied in turn (directly,
 * without undo steps), the result cells are read after recalculation, and the
 * original values are put back. Returns the new sheet's name.
 */
export async function runScenarioSummary(api: any, list: Scenario[], resultCells: { row: number; column: number }[]): Promise<string> {
  if (!list.length) throw new Error("Add a scenario first.");
  const wb = api.getActiveWorkbook();
  const sheetId = list[0].sheetId;
  const sheet = wb.getSheetBySheetId(sheetId);
  if (!sheet) throw new Error("The scenarios' sheet no longer exists.");
  const unitId = wb.getId();
  const raw = (r: number, c: number) => sheet.getSheet().getCellRaw(r, c);
  const valueAt = (r: number, c: number): ScenarioValue => {
    const v = raw(r, c)?.v;
    return v === undefined ? null : (v as ScenarioValue);
  };
  const changing: { row: number; column: number }[] = [];
  for (const s of list) for (const c of s.cells) if (!changing.some((x) => x.row === c.row && x.column === c.column)) changing.push({ row: c.row, column: c.column });
  // Copies: the model updates cell objects in place.
  const originals = changing.map((c) => {
    const cell = raw(c.row, c.column);
    return cell ? { v: cell.v ?? null, t: cell.t ?? null, f: cell.f, si: cell.si } : null;
  });
  if (originals.some((o) => o?.f || o?.si)) throw new Error("Changing cells must hold values, not formulas.");
  const current = { changing: changing.map((c) => valueAt(c.row, c.column)), results: resultCells.map((c) => valueAt(c.row, c.column)) };
  const write = (values: Map<string, Record<string, unknown>>) =>
    settled(api, () => {
      const cellValue: Record<number, Record<number, unknown>> = {};
      for (const c of changing) {
        const v = values.get(`${c.row}:${c.column}`);
        if (v) (cellValue[c.row] ||= {})[c.column] = v;
      }
      api.syncExecuteCommand("sheet.mutation.set-range-values", { unitId, subUnitId: sheetId, cellValue });
    });
  const perScenario: ScenarioValue[][] = resultCells.map(() => []);
  try {
    for (const s of list) {
      const values = new Map<string, Record<string, unknown>>();
      changing.forEach((c, i) => {
        const own = s.cells.find((x) => x.row === c.row && x.column === c.column);
        values.set(`${c.row}:${c.column}`, own ? cellData(own.value) : originals[i] ? { v: originals[i]!.v, t: originals[i]!.t } : { v: null });
      });
      await write(values);
      resultCells.forEach((c, i) => perScenario[i].push(valueAt(c.row, c.column)));
    }
  } finally {
    const back = new Map<string, Record<string, unknown>>();
    changing.forEach((c, i) => back.set(`${c.row}:${c.column}`, originals[i] ? { v: originals[i]!.v, t: originals[i]!.t } : { v: null }));
    await write(back);
  }
  const table = scenarioSummary(list, changing, current, resultCells.map((cell, i) => ({ cell, perScenario: perScenario[i] })));
  const width = Math.max(...table.map((r) => r.length));
  const names = new Set((wb.getSheets() as any[]).map((s) => s.getSheetName()));
  let name = "Scenario Summary";
  for (let n = 2; names.has(name); n++) name = `Scenario Summary ${n}`;
  const out = wb.insertSheet(name);
  out.getRange(0, 0, table.length, width).setValues(table.map((r) => [...r, ...Array(width - r.length).fill(null)].map((v) => (v == null ? "" : v))));
  out.getRange(0, 0, 1, width).setFontWeight("bold");
  out.setColumnWidth?.(0, 110);
  out.activate?.();
  return name;
}
