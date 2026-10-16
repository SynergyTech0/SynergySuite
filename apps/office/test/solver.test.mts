// Data tables and Solver: the recalculation plan of a data table, its .xlsx
// form, linear models through HiGHS, nonlinear ones through the penalty
// method, and Excel's solver_* names.
import { test } from "node:test";
import assert from "node:assert/strict";
import highsLoader from "highs";
import { dataTableJobs, patchDataTables, readDataTables, type DataTableDef } from "../lib/data-table.ts";
import { lpText, linearize, modelFromNames, newModel, problemFrom, solveModel, solverNames, type Cell, type Evaluation, type SheetAccess, type SolverModel } from "../lib/solver.ts";

const key = (c: Cell) => `${c.row}:${c.column}`;

test("a two-variable data table needs one recalculation per result cell", () => {
  const def: DataTableDef = { id: "d", sheetId: "s", range: { startRow: 4, endRow: 6, startColumn: 0, endColumn: 2 }, rowInput: { row: 0, column: 1 }, colInput: { row: 1, column: 1 } };
  const grid: Record<string, unknown> = { "4:1": 10, "4:2": 20, "5:0": 1, "6:0": 2 };
  const jobs = dataTableJobs(def, (c) => grid[key(c)]);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs[1], { inputs: [{ cell: { row: 0, column: 1 }, value: 20 }, { cell: { row: 1, column: 1 }, value: 1 }], reads: [{ from: { row: 4, column: 0 }, to: { row: 5, column: 2 } }] });
  const col = dataTableJobs({ ...def, rowInput: null }, (c) => grid[key(c)]);
  assert.equal(col.length, 2, "one per input value down the side");
  assert.deepEqual(col[0].reads.map((r) => r.from), [{ row: 4, column: 1 }, { row: 4, column: 2 }]);
  assert.throws(() => dataTableJobs({ ...def, rowInput: null, colInput: null }, () => 0), /input cell/);
});

test("data tables are TABLE formulas in .xlsx", () => {
  const def: DataTableDef = { id: "d", sheetId: "s", range: { startRow: 4, endRow: 6, startColumn: 0, endColumn: 2 }, rowInput: { row: 0, column: 1 }, colInput: { row: 1, column: 1 } };
  const sheet = `<worksheet><sheetData><row r="6"><c r="A6"><v>1</v></c><c r="B6"><v>11</v></c><c r="C6"><v>21</v></c></row></sheetData></worksheet>`;
  const xml = patchDataTables(sheet, [def, { id: "e", sheetId: "s", range: { startRow: 9, endRow: 11, startColumn: 3, endColumn: 4 }, colInput: { row: 0, column: 0 } }]);
  assert.match(xml, /<c r="B6"><f t="dataTable" ref="B6:C7" dt2D="1" dtr="1" r1="B1" r2="B2"\/><v>11<\/v><\/c>/);
  assert.match(xml, /<\/row><row r="11"><c r="E11"><f t="dataTable" ref="E11:E12" dt2D="0" dtr="0" r1="A1"\/><\/c><\/row><\/sheetData>/);
  const back = readDataTables(xml, "s");
  assert.deepEqual(back.map((d) => [d.range, d.rowInput ?? null, d.colInput ?? null]), [
    [def.range, def.rowInput, def.colInput],
    [{ startRow: 9, endRow: 11, startColumn: 3, endColumn: 4 }, null, { row: 0, column: 0 }],
  ]);
});

/** A tiny sheet: values plus formulas as functions of the values. */
function fakeSheet(values: Record<string, number>, formulas: Record<string, (v: (r: number, c: number) => number) => number>): SheetAccess & { values: Record<string, number> } {
  const get = (r: number, c: number): number => (formulas[`${r}:${c}`] ? formulas[`${r}:${c}`](get) : values[`${r}:${c}`] ?? 0);
  return {
    values,
    read: (c) => get(c.row, c.column),
    evaluate: async (vars, x, readBack): Promise<Evaluation> => {
      vars.forEach((v, i) => (values[key(v)] = x[i]));
      return readBack((c) => get(c.row, c.column));
    },
  };
}

test("a linear model goes to HiGHS, with integer constraints", async () => {
  // Maximise 3a + 2b with a + b <= 4, a + 3b <= 6, a <= 3, b integer.
  const sheet = fakeSheet({ "0:0": 0, "0:1": 0 }, {
    "1:0": (v) => 3 * v(0, 0) + 2 * v(0, 1),
    "2:0": (v) => v(0, 0) + v(0, 1),
    "3:0": (v) => v(0, 0) + 3 * v(0, 1),
  });
  const m: SolverModel = {
    ...newModel("s"),
    objective: { row: 1, column: 0 },
    variables: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
    constraints: [
      { lhs: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }, op: "<=", rhs: "4" },
      { lhs: { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0 }, op: "<=", rhs: "6" },
      { lhs: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, op: "<=", rhs: "3" },
      { lhs: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, op: "int" },
    ],
  };
  const { problem } = problemFrom(m, sheet);
  const lin = await linearize(problem);
  assert.ok(lin);
  assert.match(lpText(problem, lin!), /Maximize\n obj: \+ 3 x0 \+ 2 x1\nSubject To\n c0: \+ 1 x0 \+ 1 x1 <= 4/);
  const r = await solveModel(m, sheet, () => highsLoader());
  assert.equal(r.method, "simplex");
  assert.equal(r.status, "optimal");
  assert.deepEqual(r.x, [3, 1]);
  assert.equal(r.objective, 11);
  // Infeasible: a + b >= 10 with a, b <= 3.
  const bad = { ...m, constraints: [...m.constraints, { lhs: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }, op: ">=" as const, rhs: "10" }] };
  assert.equal((await solveModel(bad, sheet, () => highsLoader())).status, "infeasible");
});

test("a nonlinear model is solved by the penalty method", async () => {
  // Minimise (x-3)^2 + (y+1)^2 + 1 with x + y >= 4 (answer x = 4, y = 0).
  const sheet = fakeSheet({ "0:0": 1, "0:1": 1 }, {
    "1:0": (v) => (v(0, 0) - 3) ** 2 + (v(0, 1) + 1) ** 2 + 1,
    "2:0": (v) => v(0, 0) + v(0, 1),
  });
  const m: SolverModel = {
    ...newModel("s"),
    sense: "min",
    engine: "grg",
    nonNegative: false,
    objective: { row: 1, column: 0 },
    variables: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
    constraints: [{ lhs: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }, op: ">=", rhs: "4" }],
  };
  const r = await solveModel(m, sheet, () => highsLoader());
  assert.equal(r.method, "grg");
  assert.equal(r.status, "optimal", r.message);
  assert.ok(Math.abs(r.x[0] - 4) < 0.01 && Math.abs(r.x[1]) < 0.01, JSON.stringify(r.x));
  assert.ok(Math.abs(r.objective - 3) < 0.01);
  // "Value of": find x with x^3 = 27.
  const cube = fakeSheet({ "0:0": 1 }, { "1:0": (v) => v(0, 0) ** 3 });
  const v = await solveModel({ ...newModel("s"), sense: "value", target: 27, objective: { row: 1, column: 0 }, variables: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }] }, cube, () => highsLoader());
  assert.ok(Math.abs(v.x[0] - 3) < 0.001, JSON.stringify(v));
});

test("the model maps to Excel's solver names and back", () => {
  const m: SolverModel = {
    ...newModel("s"),
    sense: "min",
    objective: { row: 9, column: 3 },
    variables: [{ startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 }],
    constraints: [
      { lhs: { startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 }, op: "int" },
      { lhs: { startRow: 6, endRow: 6, startColumn: 1, endColumn: 1 }, op: ">=", rhs: "C7" },
    ],
    xlsx: { solver_tol: "0.05" },
  };
  const names = solverNames(m, "My plan");
  assert.equal(names.solver_opt, "'My plan'!$D$10");
  assert.equal(names.solver_adj, "'My plan'!$B$2:$B$5");
  assert.deepEqual([names.solver_num, names.solver_rel1, names.solver_rhs1, names.solver_rel2, names.solver_rhs2, names.solver_typ, names.solver_tol], ["2", "4", '"integer"', "3", "'My plan'!$C$7", "2", "0.05"]);
  const back = modelFromNames(names, "s")!;
  assert.deepEqual(back, m);
});

test("data tables and Solver models round-trip through .xlsx", async () => {
  const { univerToXlsx, xlsxToUniver } = await import("../lib/xlsx.ts");
  const { DATA_TABLE_RESOURCE } = await import("../lib/data-table.ts");
  const { SOLVER_RESOURCE } = await import("../lib/solver.ts");
  const JSZip = (await import("jszip")).default;
  const def: DataTableDef = { id: "d", sheetId: "sheet-1", range: { startRow: 3, endRow: 5, startColumn: 0, endColumn: 1 }, colInput: { row: 0, column: 0 } };
  const model: SolverModel = { ...newModel("sheet-1"), objective: { row: 1, column: 0 }, variables: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }], constraints: [{ lhs: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, op: "<=", rhs: "10" }] };
  const book = {
    id: "u",
    name: "W",
    appVersion: "",
    locale: "enUS",
    styles: {},
    sheetOrder: ["sheet-1"],
    sheets: {
      "sheet-1": {
        id: "sheet-1",
        name: "Plan",
        cellData: { 0: { 0: { v: 2 } }, 1: { 0: { f: "=A1*3", v: 6 } }, 3: { 1: { f: "=A2", v: 6 } }, 4: { 0: { v: 1 }, 1: { v: 3 } }, 5: { 0: { v: 5 }, 1: { v: 15 } } },
      },
    },
    resources: [
      { name: DATA_TABLE_RESOURCE, data: JSON.stringify({ tables: [def] }) },
      { name: SOLVER_RESOURCE, data: JSON.stringify({ models: [model] }) },
    ],
  };
  const bytes = await univerToXlsx(book as any);
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheet, /<c r="B5"><f t="dataTable" ref="B5:B6" dt2D="0" dtr="0" r1="A1"\/><v>3<\/v><\/c>/);
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  assert.match(wbXml, /<definedName name="solver_opt" localSheetId="0" hidden="1">Plan!\$A\$2<\/definedName>/);
  const back = await xlsxToUniver(bytes);
  const res = (n: string) => JSON.parse(back.resources!.find((r) => r.name === n)!.data);
  assert.deepEqual(res(DATA_TABLE_RESOURCE).tables.map((t: DataTableDef) => [t.range, t.colInput]), [[def.range, def.colInput]]);
  assert.deepEqual(res(SOLVER_RESOURCE).models[0].constraints, model.constraints);
  assert.equal(res(SOLVER_RESOURCE).models[0].objective.row, 1);
  const cells = back.sheets["sheet-1"].cellData!;
  assert.deepEqual([cells[4][1].v, cells[5][1].v, cells[4][1].f ?? null], [3, 15, null], "results stay values");
  assert.equal(back.resources!.some((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN" && r.data.includes("solver_")), false, "solver names are not ordinary names");
});

test("data tables and Solver models move with inserted rows", async () => {
  const { foldDataTables, foldSolverModels } = await import("../lib/sheet-analysis.ts");
  const ins = { id: "sheet.mutation.insert-row", params: { subUnitId: "s", range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 25 } } };
  const def: DataTableDef = { id: "d", sheetId: "s", range: { startRow: 4, endRow: 6, startColumn: 0, endColumn: 2 }, rowInput: { row: 0, column: 1 }, colInput: { row: 1, column: 1 } };
  const [moved] = foldDataTables([def], ins);
  assert.deepEqual([moved.range.startRow, moved.range.endRow, moved.rowInput, moved.colInput], [6, 8, { row: 0, column: 1 }, { row: 3, column: 1 }]);
  const other = [{ ...def, sheetId: "t" }];
  assert.equal(foldDataTables(other, ins), other, "other sheets are untouched");
  const m: SolverModel = { ...newModel("s"), objective: { row: 5, column: 0 }, variables: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }], constraints: [{ lhs: { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0 }, op: "<=", rhs: "$C$4" }] };
  const [mm] = foldSolverModels([m], ins);
  assert.deepEqual([mm.objective, mm.constraints[0].lhs.startRow, mm.constraints[0].rhs, mm.variables[0].startRow], [{ row: 7, column: 0 }, 5, "$C$6", 0]);
  assert.deepEqual(foldSolverModels([m], { id: "sheet.mutation.remove-sheet", params: { subUnitId: "s" } }), []);
});
