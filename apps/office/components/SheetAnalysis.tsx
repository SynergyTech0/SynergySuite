"use client";

// Dialogs for data tables (What-If Analysis > Data Table) and Solver.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import { areaRef, parseArea, type Relation, type SolverModel } from "@/lib/solver";

const button = "text-sm rounded-full px-4 py-1.5";
const primary = `${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`;
const plain = `${button} hover:bg-slate-100 text-slate-700 disabled:opacity-40`;
const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

/** Run an action and show its error in the dialog instead of an alert. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

// ---- Data table ----

export function DataTableDialog({
  range,
  onClose,
  onApply,
}: {
  /** The selected block, as text (B4:D9). */
  range: string;
  onClose: () => void;
  onApply: (v: { rowInput: string; colInput: string }) => Promise<void>;
}) {
  const [rowInput, setRowInput] = useState("");
  const [colInput, setColInput] = useState("");
  const { busy, error, run } = useBusy();
  return (
    <Modal title="Data table" onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-slate-500 mb-3">
        {range}: input values along the top row and/or down the first column, the formulas in the other edge. Each result is the formula with the input cell set to that value.
      </p>
      <div className="space-y-3">
        <label className="block text-sm text-slate-700">
          Row input cell
          <input className={input} value={rowInput} onChange={(e) => setRowInput(e.target.value)} aria-label="Row input cell" autoFocus />
        </label>
        <label className="block text-sm text-slate-700">
          Column input cell
          <input className={input} value={colInput} onChange={(e) => setColInput(e.target.value)} aria-label="Column input cell" />
        </label>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className={plain} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={primary} disabled={busy || (!rowInput.trim() && !colInput.trim())} onClick={() => run(async () => (await onApply({ rowInput, colInput }), onClose()))}>
          {busy ? "Calculating…" : "OK"}
        </button>
      </div>
    </Modal>
  );
}

// ---- Solver ----

const OPS: { op: Relation; label: string }[] = [
  { op: "<=", label: "<=" },
  { op: "=", label: "=" },
  { op: ">=", label: ">=" },
  { op: "int", label: "int" },
  { op: "bin", label: "bin" },
];

type Draft = { objective: string; sense: SolverModel["sense"]; target: string; variables: string; constraints: { lhs: string; op: Relation; rhs: string }[]; nonNegative: boolean; engine: SolverModel["engine"] };

const draftOf = (m: SolverModel): Draft => ({
  objective: m.objective ? areaRef({ startRow: m.objective.row, endRow: m.objective.row, startColumn: m.objective.column, endColumn: m.objective.column }, true) : "",
  sense: m.sense,
  target: m.target != null ? String(m.target) : "0",
  variables: m.variables.map((g) => areaRef(g, true)).join(","),
  constraints: m.constraints.map((k) => ({ lhs: areaRef(k.lhs, true), op: k.op, rhs: k.rhs ?? "" })),
  nonNegative: m.nonNegative,
  engine: m.engine,
});

/** The model the dialog describes (throws with a message when something doesn't parse). */
export function modelOf(d: Draft, base: SolverModel): SolverModel {
  const one = (t: string, what: string) => {
    const g = parseArea(t);
    if (!g || g.startRow !== g.endRow || g.startColumn !== g.endColumn) throw new Error(`${what} must be a single cell, such as $D$10.`);
    return { row: g.startRow, column: g.startColumn };
  };
  const variables = d.variables
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const g = parseArea(t);
      if (!g) throw new Error(`${t} is not a cell or range.`);
      return g;
    });
  const target = Number(d.target);
  if (d.sense === "value" && !Number.isFinite(target)) throw new Error("Enter the value the objective should reach.");
  const m: SolverModel = {
    ...base,
    objective: d.objective.trim() ? one(d.objective, "The objective") : null,
    sense: d.sense,
    variables,
    constraints: d.constraints.map((k) => {
      const lhs = parseArea(k.lhs);
      if (!lhs) throw new Error(`${k.lhs || "A constraint"} is not a cell or range.`);
      return k.op === "int" || k.op === "bin" ? { lhs, op: k.op } : { lhs, op: k.op, rhs: k.rhs.trim() };
    }),
    nonNegative: d.nonNegative,
    engine: d.engine,
  };
  if (d.sense === "value") m.target = target;
  else delete m.target;
  return m;
}

export type SolverAnswer = { status: string; message: string; objective: number; values: { label: string; value: number }[] };

export function SolverDialog({
  model,
  canEdit,
  onSave,
  onSolve,
  onKeep,
  onClose,
}: {
  model: SolverModel;
  canEdit: boolean;
  onSave: (m: SolverModel) => Promise<void>;
  onSolve: (m: SolverModel) => Promise<SolverAnswer>;
  onKeep: () => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(model));
  const [adding, setAdding] = useState<{ lhs: string; op: Relation; rhs: string } | null>(null);
  const [answer, setAnswer] = useState<SolverAnswer | null>(null);
  const { busy, error, run } = useBusy();
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const closeAndSave = () =>
    run(async () => {
      if (canEdit) await onSave(modelOf(d, model));
      onClose();
    });

  if (answer)
    return (
      <Modal title="Solver results" onClose={() => {}}>
        <p className="text-sm text-slate-700" role="status">
          {answer.message}
        </p>
        {Number.isFinite(answer.objective) && (
          <dl className="mt-3 text-sm text-slate-700 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-slate-500">Objective</dt>
            <dd aria-label="Objective value">{Number(answer.objective.toPrecision(12))}</dd>
            {answer.values.slice(0, 12).map((v) => (
              <div key={v.label} className="contents">
                <dt className="text-slate-500">{v.label}</dt>
                <dd>{v.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {answer.status === "optimal" || answer.status === "feasible" ? (
            <>
              <button className={plain} onClick={onClose} disabled={busy}>
                Restore original values
              </button>
              <button className={primary} onClick={() => run(async () => (await onKeep(), onClose()))} disabled={busy}>
                Keep Solver solution
              </button>
            </>
          ) : (
            <button className={primary} onClick={() => setAnswer(null)}>
              Back
            </button>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal title="Solver parameters" onClose={busy ? () => {} : closeAndSave}>
      <div className="space-y-3 w-[min(32rem,80vw)]">
        <label className="block text-sm text-slate-700">
          Set objective
          <input className={input} value={d.objective} onChange={(e) => set({ objective: e.target.value })} aria-label="Set objective" />
        </label>
        <div className="flex items-center gap-3 text-sm text-slate-700" role="radiogroup" aria-label="To">
          <span>To:</span>
          {(["max", "min", "value"] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" name="solver-sense" checked={d.sense === s} onChange={() => set({ sense: s })} />
              {s === "max" ? "Max" : s === "min" ? "Min" : "Value of"}
            </label>
          ))}
          <input className={`${input} !w-24`} value={d.target} onChange={(e) => set({ target: e.target.value })} disabled={d.sense !== "value"} aria-label="Target value" />
        </div>
        <label className="block text-sm text-slate-700">
          By changing variable cells
          <input className={input} value={d.variables} onChange={(e) => set({ variables: e.target.value })} aria-label="By changing variable cells" />
        </label>
        <div>
          <div className="text-sm text-slate-700 mb-1">Subject to the constraints</div>
          <ul className="border border-slate-200 rounded min-h-[3rem] max-h-40 overflow-auto text-sm" aria-label="Constraints">
            {d.constraints.map((k, i) => (
              <li key={i} className="flex items-center justify-between px-2 py-0.5 hover:bg-slate-50">
                <span>
                  {k.lhs} {k.op === "int" ? "= integer" : k.op === "bin" ? "= binary" : `${k.op} ${k.rhs}`}
                </span>
                <button className="text-xs text-slate-500 hover:text-red-600" onClick={() => set({ constraints: d.constraints.filter((_, j) => j !== i) })} aria-label={`Delete constraint ${i + 1}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {adding ? (
            <div className="mt-2 flex items-center gap-2">
              <input className={input} value={adding.lhs} onChange={(e) => setAdding({ ...adding, lhs: e.target.value })} aria-label="Cell reference" placeholder="$B$2:$B$5" autoFocus />
              <select className="rounded border border-slate-300 px-1 py-1 text-sm" value={adding.op} onChange={(e) => setAdding({ ...adding, op: e.target.value as Relation })} aria-label="Relation">
                {OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input className={input} value={adding.op === "int" || adding.op === "bin" ? "" : adding.rhs} onChange={(e) => setAdding({ ...adding, rhs: e.target.value })} aria-label="Constraint" placeholder="10 or $C$7" disabled={adding.op === "int" || adding.op === "bin"} />
              <button
                className={plain}
                disabled={!adding.lhs.trim() || (adding.op !== "int" && adding.op !== "bin" && !adding.rhs.trim())}
                onClick={() => {
                  set({ constraints: [...d.constraints, adding] });
                  setAdding(null);
                }}
              >
                Add
              </button>
            </div>
          ) : (
            <button className={`${plain} mt-1 !px-2`} onClick={() => setAdding({ lhs: "", op: "<=", rhs: "" })} disabled={!canEdit}>
              Add constraint
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={d.nonNegative} onChange={(e) => set({ nonNegative: e.target.checked })} />
          Make unconstrained variables non-negative
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Solving method
          <select className="rounded border border-slate-300 px-1 py-1 text-sm" value={d.engine} onChange={(e) => set({ engine: e.target.value as Draft["engine"] })} aria-label="Solving method">
            <option value="simplex">Simplex LP</option>
            <option value="grg">GRG Nonlinear</option>
          </select>
        </label>
        <p className="text-xs text-slate-500">Linear models (with integer and binary constraints) are solved exactly by HiGHS; others by a nonlinear search for small, smooth problems.</p>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-between gap-2">
        <button className={plain} onClick={() => setD(draftOf({ ...model, objective: null, variables: [], constraints: [], sense: "max", nonNegative: true, engine: "simplex" }))} disabled={busy || !canEdit}>
          Reset all
        </button>
        <div className="flex gap-2">
          <button className={plain} onClick={closeAndSave} disabled={busy}>
            Close
          </button>
          <button
            className={primary}
            disabled={busy || !canEdit}
            onClick={() =>
              run(async () => {
                const m = modelOf(d, model);
                await onSave(m);
                setAnswer(await onSolve(m));
              })
            }
          >
            {busy ? "Solving…" : "Solve"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
