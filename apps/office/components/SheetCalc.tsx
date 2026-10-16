"use client";

// Formulas > Calculation options: iterative calculation for circular references.
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import type { CalcSettings } from "@/lib/xlsx-calc";

const button = "text-sm rounded-full px-4 py-1.5";
const input = "w-28 rounded border border-slate-300 px-2 py-1 text-sm";

export function CalcOptionsDialog({ value, canEdit, onSave, onClose }: { value: CalcSettings; canEdit: boolean; onSave: (v: CalcSettings) => void; onClose: () => void }) {
  const [iterate, setIterate] = useState(value.iterate);
  const [count, setCount] = useState(String(value.maxIterations));
  const [delta, setDelta] = useState(String(value.maxChange));
  const n = Number(count);
  const d = Number(delta);
  const valid = Number.isInteger(n) && n >= 1 && n <= 32767 && Number.isFinite(d) && d >= 0;
  return (
    <Modal title="Calculation options" onClose={onClose}>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={iterate} disabled={!canEdit} onChange={(e) => setIterate(e.target.checked)} />
        Enable iterative calculation
      </label>
      <p className="text-xs text-slate-500 mt-1 mb-3">Formulas that refer to their own cell, directly or through others, are worked out round and round instead of being treated as a mistake.</p>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-2 items-center text-sm text-slate-700">
        <label htmlFor="calc-count">Maximum iterations</label>
        <input id="calc-count" className={input} value={count} disabled={!canEdit || !iterate} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        <label htmlFor="calc-delta">Maximum change</label>
        <input id="calc-delta" className={input} value={delta} disabled={!canEdit || !iterate} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" />
      </div>
      {!valid && <p className="text-xs text-red-600 mt-2">Iterations must be a whole number from 1 to 32,767, and the change 0 or more.</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className={`${button} hover:bg-slate-100 text-slate-700`} onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={`${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`}
          disabled={!canEdit || !valid}
          onClick={() => onSave({ iterate, maxIterations: n, maxChange: d })}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}
