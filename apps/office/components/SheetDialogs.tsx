"use client";

// Dialogs for the Data menu: Remove duplicates and Split text to columns.
import { useState } from "react";

const panel = "bg-white rounded-2xl shadow-xl w-full max-w-md p-5";
const button = "text-sm rounded-full px-4 py-1.5";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className="text-base font-medium text-slate-800 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export type DedupeRequest = { headers: string[]; firstRowLooksLikeHeader: boolean; rows: number };

export function RemoveDuplicatesDialog({
  request,
  onClose,
  onApply,
}: {
  request: DedupeRequest;
  onClose: () => void;
  onApply: (columns: number[], hasHeader: boolean) => void;
}) {
  const [hasHeader, setHasHeader] = useState(request.firstRowLooksLikeHeader);
  const [cols, setCols] = useState<boolean[]>(request.headers.map(() => true));
  const label = (i: number) => (hasHeader && request.headers[i] ? request.headers[i] : `Column ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`);
  const chosen = cols.flatMap((on, i) => (on ? [i] : []));
  return (
    <Modal title="Remove duplicates" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">{request.rows} rows selected. Rows that repeat the values in the chosen columns are removed; the first one stays.</p>
      <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
        <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
        Data has header row
      </label>
      <div className="border border-slate-200 rounded-lg max-h-56 overflow-auto p-2 mb-4">
        <label className="flex items-center gap-2 text-sm text-slate-700 py-0.5 font-medium">
          <input type="checkbox" checked={chosen.length === cols.length} onChange={(e) => setCols(cols.map(() => e.target.checked))} />
          Select all
        </label>
        {cols.map((on, i) => (
          <label key={i} className="flex items-center gap-2 text-sm text-slate-700 py-0.5">
            <input type="checkbox" checked={on} onChange={(e) => setCols(cols.map((v, j) => (j === i ? e.target.checked : v)))} />
            {label(i)}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className={`${button} hover:bg-slate-100 text-slate-700`} onClick={onClose}>
          Cancel
        </button>
        <button className={`${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`} disabled={!chosen.length} onClick={() => onApply(chosen, hasHeader)}>
          Remove duplicates
        </button>
      </div>
    </Modal>
  );
}

// Univer's SplitDelimiterEnum flags.
const SEPARATORS = [
  { label: "Detect automatically", value: 0 },
  { label: "Comma", value: 2 },
  { label: "Semicolon", value: 4 },
  { label: "Space", value: 8 },
  { label: "Tab", value: 1 },
  { label: "Custom", value: 16 },
];

export function SplitTextDialog({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (opts: { delimiter?: number; customDelimiter?: string; treatMultipleDelimitersAsOne: boolean }) => void;
}) {
  const [sep, setSep] = useState(0);
  const [custom, setCustom] = useState("");
  const [merge, setMerge] = useState(false);
  return (
    <Modal title="Split text to columns" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">Splits each cell of the selected column into the columns to its right.</p>
      <div className="space-y-1 mb-3">
        {SEPARATORS.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="sep" checked={sep === s.value} onChange={() => setSep(s.value)} />
            {s.label}
            {s.value === 16 && sep === 16 && (
              <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={5} className="ml-1 w-20 border border-slate-300 rounded px-2 py-0.5 text-sm" aria-label="Custom separator" />
            )}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 mb-4">
        <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
        Treat consecutive separators as one
      </label>
      <div className="flex justify-end gap-2">
        <button className={`${button} hover:bg-slate-100 text-slate-700`} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`}
          disabled={sep === 16 && !custom}
          onClick={() => onApply({ ...(sep ? { delimiter: sep } : {}), ...(sep === 16 ? { customDelimiter: custom } : {}), treatMultipleDelimitersAsOne: merge })}
        >
          Split
        </button>
      </div>
    </Modal>
  );
}
