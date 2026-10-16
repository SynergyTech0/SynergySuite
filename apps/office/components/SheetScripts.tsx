"use client";

// Automate: the workbook's scripts (Office Scripts style), an editor, Run,
// and a recorder that writes a script from your edits.
import { useEffect, useState } from "react";
import type { Script } from "@/lib/xlsx-kept";

const btn = "rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const SAMPLE = `function main(workbook) {
  const sheet = workbook.getActiveWorksheet();
  const used = sheet.getUsedRange();
  console.log("Rows in use:", used ? used.getRowCount() : 0);
}
`;

export default function SheetScripts({
  scripts,
  canEdit,
  recording,
  recorded,
  onSave,
  onDelete,
  onRun,
  onRecord,
  onClose,
}: {
  scripts: Script[];
  canEdit: boolean;
  recording: boolean;
  /** Code from a recording stopped outside the panel. */
  recorded?: { code: string; n: number } | null;
  onSave: (s: Script) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRun: (code: string) => Promise<{ ok: boolean; message: string; logs: string[] }>;
  /** Starts recording, or stops and returns the recorded code. */
  onRecord: () => string | null;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(scripts[0]?.id ?? null);
  const current = scripts.find((s) => s.id === currentId) || null;
  const [name, setName] = useState(current?.name || "Script 1");
  const [code, setCode] = useState(current?.code || SAMPLE);
  const [output, setOutput] = useState<{ ok: boolean; message: string; logs: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current) {
      setName(current.name);
      setCode(current.code);
    }
    // Only when another script is picked (not on every save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  const loadRecorded = (text: string) => {
    setCurrentId(null);
    setName(`Recorded ${new Date().toLocaleTimeString()}`);
    setCode(text);
  };
  useEffect(() => {
    if (recorded) loadRecorded(recorded.code);
  }, [recorded]);
  const dirty = !current || current.name !== name || current.code !== code;
  const save = async () => {
    const s: Script = { id: current?.id || `script-${crypto.randomUUID().slice(0, 8)}`, name: name.trim() || "Script", code };
    await onSave(s);
    setCurrentId(s.id);
  };
  return (
    <aside aria-label="Automate panel" className="flex w-[420px] shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-700">Automate</h2>
        <button type="button" aria-label="Close automate" onClick={onClose} className="rounded px-1.5 text-slate-400 hover:bg-slate-200">
          ×
        </button>
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <select
            aria-label="Script"
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
            value={currentId || ""}
            onChange={(e) => {
              setCurrentId(e.target.value || null);
              if (!e.target.value) {
                setName(`Script ${scripts.length + 1}`);
                setCode(SAMPLE);
              }
            }}
          >
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">New script…</option>
          </select>
          <button
            type="button"
            className={`${btn} ${recording ? "!border-red-300 !bg-red-50 !text-red-700" : ""}`}
            disabled={!canEdit}
            onClick={() => {
              const text = onRecord();
              if (text != null) loadRecorded(text);
            }}
          >
            {recording ? "Stop recording" : "Record actions"}
          </button>
        </div>
        <input aria-label="Script name" className="rounded border border-slate-200 bg-white px-2 py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        <textarea
          aria-label="Script code"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded border border-slate-200 bg-white p-2 font-mono text-xs leading-5 text-slate-800"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          readOnly={!canEdit}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const t = e.currentTarget;
              const at = t.selectionStart;
              setCode(code.slice(0, at) + "  " + code.slice(t.selectionEnd));
              requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2));
            }
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${btn} !bg-indigo-600 !text-white !border-indigo-600`}
            disabled={!canEdit || busy || recording}
            onClick={async () => {
              setBusy(true);
              try {
                setOutput(await onRun(code));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Running…" : "Run"}
          </button>
          <button type="button" className={btn} disabled={!canEdit || !dirty} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className={btn} disabled={!canEdit || !current} onClick={() => current && void onDelete(current.id).then(() => setCurrentId(scripts.find((s) => s.id !== current.id)?.id ?? null))}>
            Delete
          </button>
        </div>
        {output && (
          <div role="status" aria-label="Script output" className={`max-h-40 overflow-auto rounded border p-2 font-mono text-[11px] ${output.ok ? "border-slate-200 bg-white text-slate-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            <div>{output.message}</div>
            {output.logs.map((l, i) => (
              <div key={i} className="text-slate-500">
                {l}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-4 text-slate-500">
          Scripts are written like Office Scripts, in TypeScript or JavaScript: <code>workbook.getActiveWorksheet()</code>, <code>getWorksheet(name)</code>, <code>addWorksheet()</code>, <code>getRange(&quot;A1:B2&quot;)</code> with getValues/setValues, setFormula, setNumberFormat, clear and getFormat(). They run in a sandbox with no network or storage access, see a copy of the values, and their changes are applied when they finish. Reading a formula after changing cells recalculates the workbook (data tables included) first, as Excel does. Excel VBA macros in .xlsm files are kept but never run.
        </p>
      </div>
    </aside>
  );
}
