"use client";

// Dialogs for sparklines, shapes and what-if analysis (Goal Seek, Scenario Manager).
import { useState } from "react";
import { Modal } from "./SheetDialogs";
import { SPARK_DEFAULTS, type SparkType, type SparklineGroup } from "@/lib/sparkline";
import { parseRect, rectText, type Rect } from "@/lib/sheet-protection";
import { SHAPE_LABELS, type ShapeData, type ShapeKind } from "@/lib/sheet-shapes";
import { isPreset, PRESET_NAMES, presetLabel } from "@/lib/shape-presets";
import { cellRef, MAX_SCENARIO_CELLS, parseCellList, typedValue, type Scenario, type ScenarioValue } from "@/lib/scenarios";

const button = "text-sm rounded-full px-4 py-1.5";
const primary = `${button} bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40`;
const plain = `${button} hover:bg-slate-100 text-slate-700`;
const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

export type SheetRef = { sheetId: string; rect: Rect };
export type SheetInfo = { id: string; name: string };

const quoteName = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** "Sheet2!B2:F2", "'My data'!A1" or "B2:F2" (on the sheet in view). */
export function parseSheetRef(text: string, sheets: SheetInfo[], activeSheetId: string): SheetRef | null {
  const m = /^\s*(?:(?:'((?:[^']|'')+)'|([^!']+))!)?(.+)$/.exec(text);
  if (!m) return null;
  const name = m[1] != null ? m[1].replace(/''/g, "'") : m[2]?.trim();
  const sheetId = name ? sheets.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id : activeSheetId;
  const rect = parseRect(m[3]);
  return sheetId && rect ? { sheetId, rect } : null;
}

export function sheetRefText(ref: SheetRef, sheets: SheetInfo[], activeSheetId: string): string {
  const text = rectText(ref.rect);
  if (ref.sheetId === activeSheetId) return text;
  const name = sheets.find((s) => s.id === ref.sheetId)?.name;
  return name ? `${quoteName(name)}!${text}` : text;
}

// ---- Sparklines ----

export type SparklineRequest = {
  /** The group being edited, if the selection sits on a sparkline. */
  group?: SparklineGroup;
  data: string;
  location: string;
  type: SparkType;
};

export function SparklineDialog({
  request,
  onClose,
  onApply,
  onClear,
}: {
  request: SparklineRequest;
  onClose: () => void;
  onApply: (v: { data: string; location: string; style: Omit<SparklineGroup, "id" | "sheetId" | "items"> }) => void;
  onClear?: () => void;
}) {
  const g = request.group;
  const [type, setType] = useState<SparkType>(g?.type || request.type);
  const [data, setData] = useState(request.data);
  const [location, setLocation] = useState(request.location);
  const [color, setColor] = useState(g?.color || SPARK_DEFAULTS.color);
  const [markerColor, setMarkerColor] = useState(g?.markerColor || SPARK_DEFAULTS.markerColor);
  const [negativeColor, setNegativeColor] = useState(g?.negativeColor || SPARK_DEFAULTS.negativeColor);
  const [flags, setFlags] = useState({ markers: !!g?.markers, high: !!g?.high, low: !!g?.low, first: !!g?.first, last: !!g?.last, negative: !!g?.negative });
  const flag = (k: keyof typeof flags, label: string) => (
    <label className="flex items-center gap-1.5 text-sm text-slate-700" key={k}>
      <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} disabled={k === "markers" && type !== "line"} />
      {label}
    </label>
  );
  return (
    <Modal title={g ? "Edit sparklines" : "Insert sparklines"} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Sparkline type">
          {(["line", "column", "winloss"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`flex-1 rounded border px-2 py-1 text-sm ${type === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-700"}`}>
              {t === "line" ? "Line" : t === "column" ? "Column" : "Win/Loss"}
            </button>
          ))}
        </div>
        <label className="block text-sm text-slate-700">
          Data range
          <input className={input} value={data} onChange={(e) => setData(e.target.value)} placeholder="A2:F4" aria-label="Data range" />
        </label>
        <label className="block text-sm text-slate-700">
          Location range
          <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="G2:G4" aria-label="Location range" disabled={!!g} />
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {flag("markers", "Markers")}
          {flag("high", "High point")}
          {flag("low", "Low point")}
          {flag("first", "First point")}
          {flag("last", "Last point")}
          {flag("negative", "Negative points")}
        </div>
        <div className="flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            Color <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="Sparkline color" />
          </label>
          <label className="flex items-center gap-1.5">
            Points <input type="color" value={markerColor} onChange={(e) => setMarkerColor(e.target.value.toUpperCase())} aria-label="Marker color" />
          </label>
          <label className="flex items-center gap-1.5">
            Negative <input type="color" value={negativeColor} onChange={(e) => setNegativeColor(e.target.value.toUpperCase())} aria-label="Negative color" />
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {onClear && (
          <button className={`${plain} mr-auto text-red-600`} onClick={onClear}>
            Clear sparklines
          </button>
        )}
        <button className={plain} onClick={onClose}>
          Cancel
        </button>
        <button
          className={primary}
          disabled={!data.trim() || (!g && !location.trim())}
          onClick={() => {
            const style: Omit<SparklineGroup, "id" | "sheetId" | "items"> = { type, color, negativeColor, markerColor };
            for (const [k, on] of Object.entries(flags)) if (on && (k !== "markers" || type === "line")) (style as Record<string, unknown>)[k] = true;
            if (g?.lineWeight != null) style.lineWeight = g.lineWeight;
            if (g?.xlsx) style.xlsx = g.xlsx;
            onApply({ data, location, style });
          }}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}

// ---- Goal Seek ----

export type GoalSeekRequest = { setCell: string; byChanging: string };

export function GoalSeekDialog({
  request,
  onClose,
  onRun,
}: {
  request: GoalSeekRequest;
  onClose: () => void;
  /** Runs the search; resolves with a status line, and whether to offer Undo. */
  onRun: (v: { setCell: string; toValue: number; byChanging: string }) => Promise<{ message: string; changed: boolean }>;
}) {
  const [setCell, setSetCell] = useState(request.setCell);
  const [toValue, setToValue] = useState("");
  const [byChanging, setByChanging] = useState(request.byChanging);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const target = Number(toValue);
  return (
    <Modal title="Goal Seek" onClose={running ? () => {} : onClose}>
      {result ? (
        <>
          <p className="text-sm text-slate-700 whitespace-pre-line" role="status">
            {result}
          </p>
          <div className="mt-4 flex justify-end">
            <button className={primary} onClick={onClose}>
              OK
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <label className="block text-sm text-slate-700">
              Set cell
              <input className={input} value={setCell} onChange={(e) => setSetCell(e.target.value)} aria-label="Set cell" />
            </label>
            <label className="block text-sm text-slate-700">
              To value
              <input className={input} value={toValue} onChange={(e) => setToValue(e.target.value)} aria-label="To value" inputMode="decimal" autoFocus />
            </label>
            <label className="block text-sm text-slate-700">
              By changing cell
              <input className={input} value={byChanging} onChange={(e) => setByChanging(e.target.value)} aria-label="By changing cell" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className={plain} onClick={onClose} disabled={running}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={running || !setCell.trim() || !byChanging.trim() || toValue.trim() === "" || !Number.isFinite(target)}
              onClick={async () => {
                setRunning(true);
                try {
                  const r = await onRun({ setCell, toValue: target, byChanging });
                  setResult(r.message);
                } catch (e) {
                  setResult((e as Error).message);
                } finally {
                  setRunning(false);
                }
              }}
            >
              {running ? "Searching…" : "OK"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- Shapes and text boxes ----

export function ShapeDialog({
  initial,
  editing,
  onClose,
  onApply,
  onDelete,
}: {
  initial: ShapeData;
  editing: boolean;
  onClose: () => void;
  onApply: (data: ShapeData) => void;
  onDelete?: () => void;
}) {
  const [s, setS] = useState<ShapeData>(initial);
  const set = (patch: Partial<ShapeData>) => setS({ ...s, ...patch });
  const isLine = s.kind === "line";
  return (
    <Modal title={editing ? "Format shape" : s.kind === "textbox" ? "Insert text box" : "Insert shape"} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm text-slate-700">
          Shape
          <select
            className={input}
            value={s.prst && s.kind === "rect" && isPreset(s.prst) ? `prst:${s.prst}` : s.kind}
            onChange={(e) => (e.target.value.startsWith("prst:") ? set({ kind: "rect", prst: e.target.value.slice(5) }) : set({ kind: e.target.value as ShapeKind, prst: undefined }))}
            aria-label="Shape"
          >
            {(Object.keys(SHAPE_LABELS) as ShapeKind[]).filter((k) => k !== "group" || s.kind === "group").map((k) => (
              <option key={k} value={k}>
                {SHAPE_LABELS[k]}
              </option>
            ))}
            <optgroup label="All shapes">
              {PRESET_NAMES.map((name) => (
                <option key={name} value={`prst:${name}`}>
                  {presetLabel(name)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {!isLine && (
          <label className="block text-sm text-slate-700">
            Text
            <textarea className={input} rows={3} value={s.text} onChange={(e) => set({ text: e.target.value })} aria-label="Shape text" />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
          {!isLine && (
            <label className="flex items-center gap-1.5">
              Fill <input type="color" value={s.fill || "#FFFFFF"} disabled={!s.fill} onChange={(e) => set({ fill: e.target.value.toUpperCase() })} aria-label="Fill color" />
              <input type="checkbox" checked={!s.fill} onChange={(e) => set({ fill: e.target.checked ? null : "#4472C4" })} aria-label="No fill" /> none
            </label>
          )}
          <label className="flex items-center gap-1.5">
            Line <input type="color" value={s.line || "#000000"} disabled={!s.line} onChange={(e) => set({ line: e.target.value.toUpperCase() })} aria-label="Line color" />
            <input type="checkbox" checked={!s.line} onChange={(e) => set({ line: e.target.checked ? null : "#2F528F" })} aria-label="No line" /> none
          </label>
          <label className="flex items-center gap-1.5">
            Weight
            <input className="w-16 rounded border border-slate-300 px-1 py-0.5" type="number" min={0.25} max={20} step={0.25} value={s.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) || 0.75 })} aria-label="Line weight" /> pt
          </label>
        </div>
        {!isLine && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-1.5">
              Size
              <input className="w-14 rounded border border-slate-300 px-1 py-0.5" type="number" min={6} max={96} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 11 })} aria-label="Font size" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!s.bold} onChange={(e) => set({ bold: e.target.checked })} /> Bold
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!s.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
            </label>
            <label className="flex items-center gap-1.5">
              Text <input type="color" value={s.color} onChange={(e) => set({ color: e.target.value.toUpperCase() })} aria-label="Text color" />
            </label>
            <select className="rounded border border-slate-300 px-1 py-0.5" value={s.align} onChange={(e) => set({ align: e.target.value as ShapeData["align"] })} aria-label="Horizontal alignment">
              <option value="l">Left</option>
              <option value="ctr">Center</option>
              <option value="r">Right</option>
            </select>
            <select className="rounded border border-slate-300 px-1 py-0.5" value={s.vAlign} onChange={(e) => set({ vAlign: e.target.value as ShapeData["vAlign"] })} aria-label="Vertical alignment">
              <option value="t">Top</option>
              <option value="ctr">Middle</option>
              <option value="b">Bottom</option>
            </select>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {onDelete && (
          <button className={`${plain} mr-auto text-red-600`} onClick={onDelete}>
            Delete shape
          </button>
        )}
        <button className={plain} onClick={onClose}>
          Cancel
        </button>
        <button className={primary} onClick={() => onApply(s)}>
          OK
        </button>
      </div>
    </Modal>
  );
}

// ---- Scenario Manager ----

type Draft = { id: string | null; name: string; cells: string; comment: string; values: string[] | null };

export function ScenarioDialog({
  scenarios,
  sheetId,
  canEdit,
  selection,
  valuesOf,
  onSave,
  onShow,
  onSummary,
  onClose,
}: {
  scenarios: Scenario[];
  sheetId: string;
  canEdit: boolean;
  /** The selected cells as text, for a new scenario's changing cells. */
  selection: () => string;
  /** The values in the given cells now. */
  valuesOf: (cells: { row: number; column: number }[]) => ScenarioValue[];
  onSave: (list: Scenario[]) => Promise<void>;
  onShow: (s: Scenario) => Promise<void>;
  onSummary: (resultCells: string) => Promise<string>;
  onClose: () => void;
}) {
  const mine = scenarios.filter((s) => s.sheetId === sheetId);
  const [selected, setSelected] = useState<string | null>(mine[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = mine.find((s) => s.id === selected) || null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = (v: ScenarioValue) => (v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));

  if (draft?.values) {
    const cells = parseCellList(draft.cells) || [];
    return (
      <Modal title="Scenario values" onClose={() => setDraft({ ...draft, values: null })}>
        <p className="mb-2 text-sm text-slate-500">Enter values for each of the changing cells.</p>
        <div className="max-h-72 space-y-2 overflow-auto">
          {cells.map((c, i) => (
            <label key={i} className="flex items-center gap-2 text-sm text-slate-700">
              <span className="w-14 text-right">{cellRef(c)}</span>
              <input className={input} value={draft.values![i] ?? ""} onChange={(e) => setDraft({ ...draft, values: draft.values!.map((v, j) => (j === i ? e.target.value : v)) })} aria-label={`Value for ${cellRef(c)}`} />
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className={plain} onClick={() => setDraft({ ...draft, values: null })}>
            Back
          </button>
          <button
            className={primary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const s: Scenario = { id: draft.id || crypto.randomUUID(), sheetId, name: draft.name.trim(), cells: cells.map((c, i) => ({ ...c, value: typedValue(draft.values![i] ?? "") })), ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}) };
                const old = mine.find((x) => x.id === draft.id);
                await onSave(old ? scenarios.map((x) => (x.id === old.id ? { ...old, ...s, comment: s.comment } : x)) : [...scenarios, s]);
                setSelected(s.id);
                setDraft(null);
              })
            }
          >
            OK
          </button>
        </div>
      </Modal>
    );
  }

  if (draft) {
    const cells = parseCellList(draft.cells);
    const nameTaken = mine.some((s) => s.id !== draft.id && s.name.toLowerCase() === draft.name.trim().toLowerCase());
    return (
      <Modal title={draft.id ? "Edit scenario" : "Add scenario"} onClose={() => setDraft(null)}>
        <div className="space-y-3">
          <label className="block text-sm text-slate-700">
            Scenario name
            <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Scenario name" autoFocus />
          </label>
          <label className="block text-sm text-slate-700">
            Changing cells
            <input className={input} value={draft.cells} onChange={(e) => setDraft({ ...draft, cells: e.target.value })} aria-label="Changing cells" placeholder="B1,B2:B4" />
          </label>
          <label className="block text-sm text-slate-700">
            Comment
            <textarea className={input} rows={2} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} aria-label="Comment" />
          </label>
          {nameTaken && <p className="text-sm text-red-600">A scenario with that name already exists.</p>}
          {draft.cells.trim() && !cells && <p className="text-sm text-red-600">Enter up to {MAX_SCENARIO_CELLS} cells, such as B1,B2:B4.</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className={plain} onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button
            className={primary}
            disabled={!draft.name.trim() || !cells || nameTaken}
            onClick={() => {
              const old = mine.find((x) => x.id === draft.id);
              const now = valuesOf(cells!);
              setDraft({ ...draft, values: cells!.map((c, i) => show(old?.cells.find((x) => x.row === c.row && x.column === c.column)?.value ?? now[i])) });
            }}
          >
            Next
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Scenario Manager" onClose={onClose}>
      {summary !== null ? (
        <div className="space-y-3">
          <label className="block text-sm text-slate-700">
            Result cells
            <input className={input} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Result cells" placeholder="C5" autoFocus />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className={plain} onClick={() => setSummary(null)}>
              Back
            </button>
            <button
              className={primary}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await onSummary(summary);
                  onClose();
                })
              }
            >
              {busy ? "Working…" : "OK"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-3">
            <ul className="h-40 flex-1 overflow-auto rounded border border-slate-200 text-sm" role="listbox" aria-label="Scenarios">
              {mine.length === 0 && <li className="p-2 text-slate-400">No scenarios defined. Choose Add to add scenarios.</li>}
              {mine.map((s) => (
                <li key={s.id} role="option" aria-selected={s.id === selected} onClick={() => setSelected(s.id)} onDoubleClick={() => void run(() => onShow(s))} className={`cursor-pointer px-2 py-1 ${s.id === selected ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}>
                  {s.name}
                </li>
              ))}
            </ul>
            <div className="flex w-28 flex-col gap-1.5">
              <button className={`${plain} border border-slate-300`} disabled={!canEdit} onClick={() => setDraft({ id: null, name: "", cells: selection(), comment: "", values: null })}>
                Add…
              </button>
              <button className={`${plain} border border-slate-300`} disabled={!canEdit || !current} onClick={() => setDraft({ id: current!.id, name: current!.name, cells: current!.cells.map(cellRef).join(","), comment: current!.comment || "", values: null })}>
                Edit…
              </button>
              <button className={`${plain} border border-slate-300`} disabled={!canEdit || !current || busy} onClick={() => run(() => onSave(scenarios.filter((s) => s.id !== current!.id)))}>
                Delete
              </button>
              <button className={`${plain} border border-slate-300`} disabled={!canEdit || !mine.length} onClick={() => setSummary("")}>
                Summary…
              </button>
            </div>
          </div>
          {current && (
            <p className="mt-2 text-xs text-slate-500">
              Changing cells: {current.cells.map(cellRef).join(", ")}
              {current.comment ? ` · ${current.comment}` : ""}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className={primary} disabled={!canEdit || !current || busy} onClick={() => run(() => onShow(current!))}>
              Show
            </button>
            <button className={plain} onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
