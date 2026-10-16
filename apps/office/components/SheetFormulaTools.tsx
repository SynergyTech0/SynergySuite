"use client";

// Formulas > Watch Window (cells kept in view with their values while you
// work elsewhere) and Formulas > Evaluate Formula (a formula worked out a
// step at a time).
import { useEffect, useMemo, useState } from "react";
import { Modal } from "./SheetDialogs";
import { FormulaStepper, fromEngine, showValue, type EvalStep, type EvalValue } from "@/lib/formula-eval";

/* eslint-disable @typescript-eslint/no-explicit-any */

const button = "text-sm rounded-full px-4 py-1.5";

type Watch = { sheetId: string; ref: string };
type WatchRow = Watch & { sheet: string; name: string; value: string; formula: string };

const storeKey = (docId: string) => `synergy-sheet-watch:${docId || "local"}`;
function loadWatches(docId: string): Watch[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(docId)) || "[]");
    return Array.isArray(v) ? v.filter((w) => typeof w?.sheetId === "string" && typeof w?.ref === "string") : [];
  } catch {
    return [];
  }
}
function saveWatches(docId: string, list: Watch[]) {
  try {
    localStorage.setItem(storeKey(docId), JSON.stringify(list));
  } catch {
    /* kept for this visit only */
  }
}

const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** The defined name that is exactly this cell, if any. */
function nameOf(wb: any, sheetName: string, ref: string): string {
  try {
    const abs = ref.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
    for (const dn of wb.getDefinedNames?.() || []) {
      const f = String(dn.getFormulaOrRefString?.() || "").replace(/^=/, "");
      const m = /^'?((?:[^'!]|'')+)'?!(.+)$/.exec(f);
      if (m && m[1].replace(/''/g, "'") === sheetName && m[2].toUpperCase() === abs) return dn.getName();
    }
  } catch {
    /* no names */
  }
  return "";
}

/** Watch Window: a floating list of cells with their sheet, name, value and formula, kept up to date. */
export function WatchWindow({ api, docId, onClose }: { api: any; docId: string; onClose: () => void }) {
  const [watches, setWatches] = useState<Watch[]>(() => loadWatches(docId));
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => saveWatches(docId, watches), [docId, watches]);
  useEffect(() => {
    const read = () => {
      const wb = api?.getActiveWorkbook?.();
      if (!wb) return;
      setRows(
        watches.map((w) => {
          const sh = wb.getSheetBySheetId?.(w.sheetId);
          if (!sh) return { ...w, sheet: "(deleted)", name: "", value: "#REF!", formula: "" };
          const r = sh.getRange(w.ref);
          const v = r.getDisplayValue?.() ?? r.getValue?.();
          return { ...w, sheet: sh.getSheetName(), name: nameOf(wb, sh.getSheetName(), w.ref), value: v == null ? "" : String(v), formula: r.getFormula?.() || "" };
        }),
      );
    };
    read();
    const t = setInterval(read, 700);
    return () => clearInterval(t);
  }, [api, watches]);

  const addFromSelection = () => {
    const wb = api?.getActiveWorkbook?.();
    const sh = wb?.getActiveSheet?.();
    const g = sh?.getActiveRange?.()?.getRange?.();
    if (!sh || !g) return;
    const add: Watch[] = [];
    for (let r = g.startRow; r <= g.endRow && add.length < 100; r++)
      for (let c = g.startColumn; c <= g.endColumn && add.length < 100; c++) add.push({ sheetId: sh.getSheetId(), ref: `${colName(c)}${r + 1}` });
    setWatches((list) => [...list, ...add.filter((a) => !list.some((w) => w.sheetId === a.sheetId && w.ref === a.ref))].slice(0, 500));
  };
  const goTo = (w: Watch) => {
    const wb = api?.getActiveWorkbook?.();
    const sh = wb?.getSheetBySheetId?.(w.sheetId);
    if (!sh) return;
    wb.setActiveSheet(sh);
    sh.getRange(w.ref).activate();
  };

  return (
    <section data-testid="watch-window" aria-label="Watch Window" className="fixed bottom-4 right-4 z-40 w-[560px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl no-print">
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-800">Watch Window</h2>
        <div className="flex gap-1">
          <button type="button" className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50" onClick={addFromSelection}>Add watch</button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={picked == null}
            onClick={() => {
              setWatches((list) => list.filter((_, i) => i !== picked));
              setPicked(null);
            }}
          >
            Delete watch
          </button>
          <button type="button" aria-label="Close Watch Window" className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>
      </header>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1 font-medium">Sheet</th>
              <th className="px-2 py-1 font-medium">Name</th>
              <th className="px-2 py-1 font-medium">Cell</th>
              <th className="px-2 py-1 font-medium">Value</th>
              <th className="px-2 py-1 font-medium">Formula</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.sheetId}!${r.ref}`}
                data-watch={`${r.sheet}!${r.ref}`}
                className={`cursor-pointer ${picked === i ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                onClick={() => setPicked(i)}
                onDoubleClick={() => goTo(r)}
              >
                <td className="px-2 py-1 text-slate-700">{r.sheet}</td>
                <td className="px-2 py-1 text-slate-500">{r.name}</td>
                <td className="px-2 py-1 font-mono text-slate-700">{r.ref}</td>
                <td className="px-2 py-1 font-mono text-slate-900" data-watch-value>{r.value}</td>
                <td className="px-2 py-1 font-mono text-slate-500 truncate max-w-[200px]">{r.formula}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-slate-400">Select cells and choose Add watch to keep an eye on them from any sheet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The formula engine working out one expression at a cell (for Evaluate Formula). */
export function liveCalc(engineRef: { injector: any; engine: any } | null, api: any, sheetId: string, row: number, column: number) {
  return async (formula: string): Promise<EvalValue> => {
    if (!engineRef) return { kind: "error", value: "#N/A" };
    const { injector, engine } = engineRef;
    const svc = injector.get(engine.ICalculateFormulaService);
    const runtime = injector.get(engine.IFormulaRuntimeService);
    const config = injector.get(engine.IFormulaCurrentConfigService);
    const wb = api.getActiveWorkbook();
    config.loadDataLite?.();
    const sh = wb.getSheetBySheetId(sheetId);
    runtime.setCurrent?.(row, column, sh?.getMaxRows?.() ?? 1000, sh?.getMaxColumns?.() ?? 26, sheetId, wb.getId());
    try {
      return fromEngine(await svc.calculate(formula));
    } catch {
      return { kind: "error", value: "#VALUE!" };
    }
  };
}

/** Evaluate Formula: the selected cell's formula, worked out one part at a time. */
export function EvaluateFormulaDialog({
  where,
  formula,
  calc,
  onClose,
}: {
  where: string;
  formula: string;
  calc: (formula: string) => Promise<EvalValue>;
  onClose: () => void;
}) {
  const [run, setRun] = useState(0);
  const parsed = useMemo(() => {
    try {
      return { stepper: new FormulaStepper(formula, calc), error: "" };
    } catch (e) {
      return { stepper: null, error: (e as Error).message };
    }
    // A restart parses again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formula, calc, run]);
  const [step, setStep] = useState<EvalStep | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setStep(parsed.stepper?.state() || null), [parsed]);
  const evaluate = async () => {
    if (!parsed.stepper || !step?.next) return;
    setBusy(true);
    try {
      setStep(await parsed.stepper.step());
    } finally {
      setBusy(false);
    }
  };
  const shown = step?.next ? (
    <>
      {step.text.slice(0, step.next.start)}
      <u data-testid="evaluate-next" className="decoration-2 decoration-indigo-600">{step.text.slice(step.next.start, step.next.end)}</u>
      {step.text.slice(step.next.end)}
    </>
  ) : (
    step?.text
  );
  return (
    <Modal title="Evaluate Formula" onClose={onClose}>
      <p className="text-xs text-slate-500">Reference: <span className="font-mono text-slate-700">{where}</span></p>
      {parsed.error ? (
        <p className="mt-3 text-sm text-red-600">This formula can&apos;t be stepped through: {parsed.error}</p>
      ) : (
        <div data-testid="evaluate-text" className="mt-2 min-h-[4rem] max-h-48 overflow-auto rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 break-all">
          {shown}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {step?.next ? "To work out the underlined part, choose Evaluate. The most recent result appears in its place." : step?.result ? `Result: ${showValue(step.result)}` : ""}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        {step?.next ? (
          <button type="button" className={`${button} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} disabled={busy} onClick={() => void evaluate()}>
            Evaluate
          </button>
        ) : (
          <button type="button" className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`} disabled={!parsed.stepper} onClick={() => setRun((n) => n + 1)}>
            Restart
          </button>
        )}
        <button type="button" className={`${button} text-slate-700 hover:bg-slate-100`} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** Asks for a password; `onSubmit` returns an error to show, or null when done. */
export function PasswordDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (password: string) => string | null; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          // Checking takes a moment (Excel's hash goes round 100,000 times): let the button show it first.
          setTimeout(() => {
            setError(onSubmit(pw) || "");
            setBusy(false);
          }, 0);
        }}
      >
        <label className="block text-sm text-slate-700">
          Password
          <input type="password" aria-label="Password" autoFocus className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={`${button} text-slate-700 hover:bg-slate-100`} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy} className={`${button} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`}>{busy ? "Checking…" : "OK"}</button>
        </div>
      </form>
    </Modal>
  );
}
