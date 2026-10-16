// Solver (Data > Solver in Excel): change some variable cells to make an
// objective cell as large or small as possible, or reach a value, subject to
// constraints. The model is worked out from the live formulas: when every
// cell involved turns out to be linear in the variables, the problem goes to
// HiGHS (MIT, simplex and branch-and-bound for integer variables); otherwise
// a penalty method with Nelder-Mead and pattern search handles it (smooth,
// small problems, like Excel's GRG engine is meant for).
//
// Excel keeps a sheet's Solver model in hidden sheet-level names (solver_opt,
// solver_adj, solver_lhs1 ...); the model here maps to and from those.

export const SOLVER_RESOURCE = "SHEET_SYNERGY_SOLVER_PLUGIN";
export const SET_SOLVER_MUTATION = "sheet.mutation.set-solver-models";

export type Cell = { row: number; column: number };
export type Area = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export type Relation = "<=" | ">=" | "=" | "int" | "bin" | "dif";
export type Constraint = { lhs: Area; op: Relation; /** A number, or a cell/range reference on the sheet. */ rhs?: string };
export type SolverModel = {
  sheetId: string;
  objective: Cell | null;
  sense: "max" | "min" | "value";
  target?: number;
  variables: Area[];
  constraints: Constraint[];
  nonNegative: boolean;
  engine: "simplex" | "grg";
  /** Excel settings we don't model, kept for the way back (name -> formula). */
  xlsx?: Record<string, string>;
};

export const newModel = (sheetId: string): SolverModel => ({ sheetId, objective: null, sense: "max", variables: [], constraints: [], nonNegative: true, engine: "simplex" });

// ---- References -------------------------------------------------------------

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const areaRef = (g: Area, abs = false) => {
  const d = abs ? "$" : "";
  const a = `${d}${col(g.startColumn)}${d}${g.startRow + 1}`;
  const b = `${d}${col(g.endColumn)}${d}${g.endRow + 1}`;
  return a === b ? a : `${a}:${b}`;
};
export function parseArea(text: string): Area | null {
  const m = /^\s*(?:(?:'(?:[^']|'')+'|[^!]+)!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const r1 = Number(m[2]) - 1;
  const c1 = colIndex(m[1]);
  const r2 = m[4] ? Number(m[4]) - 1 : r1;
  const c2 = m[3] ? colIndex(m[3]) : c1;
  return { startRow: Math.min(r1, r2), endRow: Math.max(r1, r2), startColumn: Math.min(c1, c2), endColumn: Math.max(c1, c2) };
}
export const cellsOf = (g: Area): Cell[] => {
  const out: Cell[] = [];
  for (let r = g.startRow; r <= g.endRow; r++) for (let c = g.startColumn; c <= g.endColumn; c++) out.push({ row: r, column: c });
  return out;
};

// ---- The problem as numbers -------------------------------------------------

/** One evaluation of the sheet at a point: the objective and each constraint row's left side. */
export type Evaluation = { objective: number; lhs: number[] };
/** Constraint rows (one per cell of each constraint's left side), with their right sides. */
export type Row = { op: "<=" | ">=" | "="; rhs: number };

export type Problem = {
  n: number;
  /** Evaluates the sheet with the variables at x (writes them, recalculates, reads back). */
  evaluate: (x: number[]) => Promise<Evaluation>;
  sense: "max" | "min" | "value";
  target?: number;
  rows: Row[];
  integer: boolean[];
  binary: boolean[];
  lower: number[];
  upper: number[];
  start: number[];
};

export type SolveResult = { status: "optimal" | "feasible" | "infeasible" | "unbounded" | "failed"; x: number[]; objective: number; method: "simplex" | "grg"; message: string };

const TOL = 1e-6;

/**
 * The linear form of the problem, if it is linear: f(x) = c0 + c·x for the
 * objective and every constraint row. Checked at two extra points.
 */
export async function linearize(p: Problem): Promise<{ c0: number; c: number[]; a0: number[]; a: number[][] } | null> {
  const base = p.start.map(() => 0);
  const at0 = await p.evaluate(base);
  const c: number[] = [];
  const a: number[][] = p.rows.map(() => []);
  for (let j = 0; j < p.n; j++) {
    const e = base.slice();
    e[j] = 1;
    const v = await p.evaluate(e);
    c.push(v.objective - at0.objective);
    v.lhs.forEach((y, i) => a[i].push(y - at0.lhs[i]));
  }
  const linear = (x: number[], v: Evaluation) => {
    const close = (got: number, want: number) => Math.abs(got - want) <= 1e-7 * Math.max(1, Math.abs(want));
    if (!close(v.objective, at0.objective + c.reduce((s, cj, j) => s + cj * x[j], 0))) return false;
    return v.lhs.every((y, i) => close(y, at0.lhs[i] + a[i].reduce((s, aij, j) => s + aij * x[j], 0)));
  };
  // Two checks: one at a spread-out point, one at 2.5x the unit steps.
  const x1 = p.start.map((_, j) => ((j * 7919) % 13) + 1.5);
  if (!linear(x1, await p.evaluate(x1))) return null;
  const x2 = p.start.map(() => 2.5);
  if (!linear(x2, await p.evaluate(x2))) return null;
  if (![at0.objective, ...c, ...at0.lhs, ...a.flat()].every(Number.isFinite)) return null;
  return { c0: at0.objective, c, a0: at0.lhs, a };
}

const num = (v: number) => (Math.abs(v) < 1e-12 ? "0" : String(Number(v.toPrecision(15))));
const term = (k: number, name: string) => `${k < 0 ? "-" : "+"} ${num(Math.abs(k))} ${name}`;

/** The linear problem in CPLEX LP format, as HiGHS reads it. */
export function lpText(p: Problem, lin: { c0: number; c: number[]; a0: number[]; a: number[][] }): string {
  const v = (j: number) => `x${j}`;
  const lines: string[] = [];
  const objTerms = lin.c.map((k, j) => term(k, v(j))).join(" ");
  const sense = p.sense === "max" ? "Maximize" : "Minimize";
  // "Value of" becomes a constraint, with nothing to optimise.
  lines.push(sense, ` obj: ${p.sense === "value" ? `0 ${v(0)}` : objTerms || `0 ${v(0)}`}`, "Subject To");
  p.rows.forEach((r, i) => {
    const t = lin.a[i].map((k, j) => term(k, v(j))).join(" ");
    lines.push(` c${i}: ${t || `0 ${v(0)}`} ${r.op} ${num(r.rhs - lin.a0[i])}`);
  });
  if (p.sense === "value") lines.push(` target: ${objTerms || `0 ${v(0)}`} = ${num((p.target ?? 0) - lin.c0)}`);
  lines.push("Bounds");
  for (let j = 0; j < p.n; j++) {
    const lo = p.lower[j];
    const hi = p.upper[j];
    if (lo === -Infinity && hi === Infinity) lines.push(` ${v(j)} free`);
    else lines.push(` ${lo === -Infinity ? "-inf" : num(lo)} <= ${v(j)} <= ${hi === Infinity ? "+inf" : num(hi)}`);
  }
  const ints = p.integer.map((on, j) => (on && !p.binary[j] ? v(j) : "")).filter(Boolean);
  const bins = p.binary.map((on, j) => (on ? v(j) : "")).filter(Boolean);
  if (ints.length) lines.push("General", ` ${ints.join(" ")}`);
  if (bins.length) lines.push("Binary", ` ${bins.join(" ")}`);
  lines.push("End");
  return lines.join("\n");
}

type Highs = { solve: (lp: string, options?: Record<string, unknown>) => { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }> } };

export async function solveLinear(p: Problem, lin: NonNullable<Awaited<ReturnType<typeof linearize>>>, highs: Highs): Promise<SolveResult> {
  const r = highs.solve(lpText(p, lin));
  const x = Array.from({ length: p.n }, (_, j) => r.Columns?.[`x${j}`]?.Primal ?? p.start[j]);
  const objective = lin.c0 + lin.c.reduce((s, k, j) => s + k * x[j], 0);
  if (r.Status === "Optimal") return { status: "optimal", x, objective, method: "simplex", message: "Solver found a solution. All constraints and optimality conditions are satisfied." };
  if (r.Status === "Infeasible") return { status: "infeasible", x: p.start, objective: NaN, method: "simplex", message: "Solver could not find a feasible solution." };
  if (r.Status === "Unbounded" || r.Status === "Primal unbounded" || r.Status === "Unbounded or infeasible")
    return { status: "unbounded", x: p.start, objective: NaN, method: "simplex", message: "The objective cell's values do not converge." };
  return { status: "failed", x: p.start, objective: NaN, method: "simplex", message: `Solver stopped: ${r.Status}.` };
}

/** How far a point is from satisfying the constraints (0 when it does). */
export function violation(p: Pick<Problem, "rows" | "lower" | "upper" | "integer" | "binary">, x: number[], lhs: number[]): number {
  let v = 0;
  p.rows.forEach((r, i) => {
    const d = lhs[i] - r.rhs;
    if (r.op === "<=" && d > 0) v += d;
    else if (r.op === ">=" && d < 0) v -= d;
    else if (r.op === "=") v += Math.abs(d);
  });
  x.forEach((xi, j) => {
    if (xi < p.lower[j]) v += p.lower[j] - xi;
    if (xi > p.upper[j]) v += xi - p.upper[j];
  });
  return v;
}

/**
 * Nonlinear problems: minimise the objective (or its distance to the target)
 * plus a growing penalty for broken constraints, with Nelder-Mead and then a
 * pattern search to polish. Integer variables are rounded at the end.
 */
export async function solveNonlinear(p: Problem, options: { maxEvaluations?: number } = {}): Promise<SolveResult> {
  const budget = options.maxEvaluations ?? 4000;
  let used = 0;
  const sign = p.sense === "max" ? -1 : 1;
  const clamp = (x: number[]) => x.map((v, j) => Math.min(p.upper[j], Math.max(p.lower[j], v)));
  const cache = new Map<string, Evaluation>();
  const evalAt = async (x: number[]) => {
    const key = x.map((v) => v.toPrecision(12)).join(",");
    let v = cache.get(key);
    if (!v) {
      used++;
      v = await p.evaluate(x);
      cache.set(key, v);
    }
    return v;
  };
  const goal = (v: Evaluation) => (p.sense === "value" ? Math.abs(v.objective - (p.target ?? 0)) : sign * v.objective);
  let weight = 10;
  const score = async (x: number[]) => {
    const y = clamp(x);
    const v = await evalAt(y);
    const g = goal(v);
    if (!Number.isFinite(g)) return Infinity;
    return g + weight * violation(p, y, v.lhs) * (1 + Math.abs(g));
  };
  let best = clamp(p.start);
  for (let round = 0; round < 6 && used < budget; round++) {
    best = await nelderMead(score, best, Math.min(budget - used, 600 + 100 * p.n), () => used >= budget);
    best = await patternSearch(score, clamp(best), Math.min(budget - used, 400), () => used >= budget);
    const v = await evalAt(clamp(best));
    if (violation(p, clamp(best), v.lhs) <= TOL * 10) break;
    weight *= 10;
  }
  let x = clamp(best);
  if (p.integer.some(Boolean)) x = x.map((v, j) => (p.integer[j] || p.binary[j] ? Math.round(v) : v));
  const v = await p.evaluate(x);
  const feasible = violation(p, x, v.lhs) <= 1e-4 * (1 + Math.abs(v.objective));
  if (!feasible) return { status: "infeasible", x, objective: v.objective, method: "grg", message: "Solver could not find a feasible solution." };
  if (p.sense === "value" && Math.abs(v.objective - (p.target ?? 0)) > 1e-4 * (1 + Math.abs(p.target ?? 0)))
    return { status: "feasible", x, objective: v.objective, method: "grg", message: "Solver could not reach the target value; the closest point found is shown." };
  return { status: "optimal", x, objective: v.objective, method: "grg", message: "Solver found a solution. All constraints are satisfied (a local optimum for nonlinear models)." };
}

async function nelderMead(f: (x: number[]) => Promise<number>, x0: number[], maxEval: number, stop: () => boolean): Promise<number[]> {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, j) => x0.map((v, k) => (k === j ? v + (Math.abs(v) > 1e-9 ? 0.1 * Math.abs(v) : 0.5) : v)))];
  let values = await Promise.all(simplex.map(f));
  let evals = n + 1;
  while (evals < maxEval && !stop()) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    const spread = Math.abs(values[n] - values[0]);
    const size = Math.max(...simplex.map((p) => Math.max(...p.map((v, j) => Math.abs(v - simplex[0][j])))));
    if (spread < 1e-10 * (1 + Math.abs(values[0])) && size < 1e-8) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1);
    const fr = await f(xr);
    evals++;
    if (fr < values[0]) {
      const xe = along(-2);
      const fe = await f(xe);
      evals++;
      [simplex[n], values[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [xr, fr];
    } else {
      const xc = along(fr < values[n] ? -0.5 : 0.5);
      const fc = await f(xc);
      evals++;
      if (fc < Math.min(fr, values[n])) [simplex[n], values[n]] = [xc, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = await f(simplex[i]);
          evals++;
        }
      }
    }
  }
  const i = values.indexOf(Math.min(...values));
  return simplex[i];
}

async function patternSearch(f: (x: number[]) => Promise<number>, x0: number[], maxEval: number, stop: () => boolean): Promise<number[]> {
  let x = x0.slice();
  let fx = await f(x);
  let step = Math.max(1e-3, ...x.map((v) => Math.abs(v) * 0.05));
  let evals = 1;
  while (step > 1e-9 && evals < maxEval && !stop()) {
    let moved = false;
    for (let j = 0; j < x.length && evals < maxEval; j++)
      for (const d of [step, -step]) {
        const y = x.slice();
        y[j] += d;
        const fy = await f(y);
        evals++;
        if (fy < fx) {
          x = y;
          fx = fy;
          moved = true;
          break;
        }
      }
    if (!moved) step /= 2;
  }
  return x;
}

// ---- Excel's solver_* names --------------------------------------------------

const REL: Record<Relation, number> = { "<=": 1, "=": 2, ">=": 3, int: 4, bin: 5, dif: 6 };
const REL_BACK: Record<string, Relation> = { 1: "<=", 2: "=", 3: ">=", 4: "int", 5: "bin", 6: "dif" };

const quote = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** The model as Excel's hidden sheet-level names (name -> formula, without "="). */
export function solverNames(m: SolverModel, sheetName: string): Record<string, string> {
  const at = (g: Area) => `${quote(sheetName)}!${areaRef(g, true)}`;
  const out: Record<string, string> = { ...(m.xlsx || {}) };
  if (m.objective) out.solver_opt = at({ startRow: m.objective.row, endRow: m.objective.row, startColumn: m.objective.column, endColumn: m.objective.column });
  out.solver_typ = String(m.sense === "max" ? 1 : m.sense === "min" ? 2 : 3);
  out.solver_val = String(m.target ?? 0);
  if (m.variables.length) out.solver_adj = m.variables.map(at).join(",");
  out.solver_num = String(m.constraints.length);
  m.constraints.forEach((c, i) => {
    out[`solver_lhs${i + 1}`] = at(c.lhs);
    out[`solver_rel${i + 1}`] = String(REL[c.op]);
    const rhs = c.op === "int" ? "integer" : c.op === "bin" ? "binary" : c.op === "dif" ? "AllDifferent" : c.rhs ?? "0";
    const g = parseArea(rhs);
    out[`solver_rhs${i + 1}`] = g ? at(g) : /^-?[\d.]+(e-?\d+)?$/i.test(rhs.trim()) ? rhs.trim() : `"${rhs}"`;
  });
  out.solver_neg = m.nonNegative ? "1" : "2";
  out.solver_eng = m.engine === "simplex" ? "2" : "1";
  out.solver_ver = out.solver_ver || "3";
  return out;
}

/** A model from Excel's names (sheet-level, for one sheet), or null when there is none. */
export function modelFromNames(names: Record<string, string>, sheetId: string): SolverModel | null {
  if (!names.solver_opt && !names.solver_adj) return null;
  const strip = (f: string) => f.replace(/^=/, "").trim();
  const areas = (f: string) =>
    strip(f)
      .split(",")
      .map((x) => parseArea(x))
      .filter((g): g is Area => !!g);
  const m = newModel(sheetId);
  const opt = names.solver_opt && parseArea(strip(names.solver_opt));
  m.objective = opt ? { row: opt.startRow, column: opt.startColumn } : null;
  m.sense = names.solver_typ === "2" ? "min" : names.solver_typ === "3" ? "value" : "max";
  if (m.sense === "value" && names.solver_val != null && strip(names.solver_val) !== "") m.target = Number(strip(names.solver_val)) || 0;
  m.variables = names.solver_adj ? areas(names.solver_adj) : [];
  const count = Number(strip(names.solver_num || "0")) || 0;
  for (let i = 1; i <= count; i++) {
    const lhs = names[`solver_lhs${i}`] && parseArea(strip(names[`solver_lhs${i}`]));
    const op = REL_BACK[strip(names[`solver_rel${i}`] || "")];
    if (!lhs || !op) continue;
    const rhsRaw = strip(names[`solver_rhs${i}`] || "0").replace(/^"(.*)"$/, "$1");
    const g = parseArea(rhsRaw);
    m.constraints.push({ lhs, op, ...(op === "int" || op === "bin" || op === "dif" ? {} : { rhs: g ? areaRef(g) : rhsRaw }) });
  }
  m.nonNegative = strip(names.solver_neg || "1") !== "2";
  m.engine = strip(names.solver_eng || "1") === "2" ? "simplex" : "grg";
  const known = /^solver_(opt|typ|val|adj|num|lhs\d+|rel\d+|rhs\d+|neg|eng|ver)$/;
  const rest = Object.fromEntries(Object.entries(names).filter(([k]) => !known.test(k)));
  if (Object.keys(rest).length) m.xlsx = rest;
  return m;
}

// ---- From a model to a problem ------------------------------------------------

export type SheetAccess = {
  /** Current value of a cell (numbers only; anything else is NaN). */
  read: (c: Cell) => number;
  /** Puts the variables at x, recalculates, and calls back to read results. */
  evaluate: (vars: Cell[], x: number[], readBack: (read: (c: Cell) => number) => Evaluation) => Promise<Evaluation>;
};

/** The numeric problem for a model on a sheet. */
export function problemFrom(m: SolverModel, sheet: SheetAccess): { problem: Problem; vars: Cell[] } {
  if (!m.objective && m.sense !== "value") throw new Error("Set an objective cell.");
  if (!m.objective) throw new Error("Set an objective cell.");
  const vars: Cell[] = [];
  for (const g of m.variables) for (const c of cellsOf(g)) if (!vars.some((v) => v.row === c.row && v.column === c.column)) vars.push(c);
  if (!vars.length) throw new Error("Choose the variable cells to change.");
  if (vars.length > 200) throw new Error("Solver handles up to 200 variable cells.");
  const index = (c: Cell) => vars.findIndex((v) => v.row === c.row && v.column === c.column);
  const n = vars.length;
  const integer = vars.map(() => false);
  const binary = vars.map(() => false);
  const lower = vars.map(() => (m.nonNegative ? 0 : -Infinity));
  const upper = vars.map(() => Infinity);
  const rows: Row[] = [];
  const lhsCells: Cell[] = [];
  for (const k of m.constraints) {
    const cells = cellsOf(k.lhs);
    if (k.op === "dif") throw new Error("AllDifferent constraints are not supported.");
    if (k.op === "int" || k.op === "bin") {
      for (const c of cells) {
        const j = index(c);
        if (j < 0) throw new Error(`${areaRef(k.lhs)} must be variable cells to be ${k.op === "int" ? "integer" : "binary"}.`);
        integer[j] = true;
        if (k.op === "bin") {
          binary[j] = true;
          lower[j] = Math.max(lower[j] === -Infinity ? 0 : lower[j], 0);
          upper[j] = 1;
        }
      }
      continue;
    }
    const rhsText = (k.rhs ?? "0").trim();
    const rhsArea = parseArea(rhsText);
    const rhsCells = rhsArea ? cellsOf(rhsArea) : null;
    if (rhsCells && rhsCells.length !== 1 && rhsCells.length !== cells.length) throw new Error(`${areaRef(k.lhs)} and ${rhsText} must be the same size.`);
    const constant = rhsCells ? NaN : Number(rhsText);
    if (!rhsCells && !Number.isFinite(constant)) throw new Error(`${rhsText} is not a number or a cell.`);
    cells.forEach((c, i) => {
      const rhs = rhsCells ? sheet.read(rhsCells.length === 1 ? rhsCells[0] : rhsCells[i]) : constant;
      if (!Number.isFinite(rhs)) throw new Error(`The constraint value for ${areaRef(k.lhs)} is not a number.`);
      rows.push({ op: k.op as Row["op"], rhs });
      lhsCells.push(c);
    });
  }
  const objective = m.objective;
  const problem: Problem = {
    n,
    sense: m.sense,
    target: m.target,
    rows,
    integer,
    binary,
    lower,
    upper,
    start: vars.map((v) => {
      const x = sheet.read(v);
      return Number.isFinite(x) ? x : 0;
    }),
    evaluate: (x) => sheet.evaluate(vars, x, (read) => ({ objective: read(objective), lhs: lhsCells.map(read) })),
  };
  return { problem, vars };
}

/** Solves: HiGHS when the model is linear (and simplex was asked for or it's linear anyway), else the nonlinear method. */
export async function solveModel(m: SolverModel, sheet: SheetAccess, loadHighs: () => Promise<Highs>): Promise<SolveResult & { vars: Cell[] }> {
  const { problem, vars } = problemFrom(m, sheet);
  const lin = await linearize(problem);
  if (lin) return { ...(await solveLinear(problem, lin, await loadHighs())), vars };
  if (m.engine === "simplex" && !problem.integer.some(Boolean)) {
    // Simplex was asked for but the model isn't linear: say so, as Excel does, then use the nonlinear method.
    const r = await solveNonlinear(problem);
    return { ...r, message: `The model is not linear, so the nonlinear method was used. ${r.message}`, vars };
  }
  return { ...(await solveNonlinear(problem)), vars };
}
