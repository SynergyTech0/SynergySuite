"use client";

// A form control over the grid. Univer places, moves and resizes it (a
// floating DOM drawing); clicking it works the control and its linked cell.
import { useState, useSyncExternalStore } from "react";
import { Modal } from "./SheetDialogs";
import { slicerBus } from "@/lib/sheet-slicers";
import { controlState, FORM_CONTROL_LABELS, formControlBus, newFormControl, splitRef, stepValue, type FormControlData, type FormControlKind } from "@/lib/form-controls";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const font = { fontFamily: "Segoe UI, Calibri, Carlito, Arial, sans-serif", fontSize: 12 };

export default function SheetFormControl({ data, floatDomId }: { data?: FormControlData; floatDomId?: string }) {
  useSyncExternalStore(slicerBus.subscribe, () => slicerBus.version, () => 0);
  if (!data || !floatDomId) return null;
  const read = (ref?: string) => (ref ? formControlBus.read?.(floatDomId, ref) ?? null : null);
  const linked = read(data.link)?.[0]?.[0];
  const st = controlState(data, linked);
  const can = formControlBus.canEdit;
  const set = (next: FormControlData, cell: unknown) => can && formControlBus.set?.(floatDomId, next, cell);
  const label = `${data.text || data.kind}`;
  const shell = (body: React.ReactNode, extra = "") => (
    <div data-form-control={data.kind} aria-label={`Form control ${label}`} role="group" className={`absolute inset-0 flex items-center overflow-hidden text-slate-800 ${extra}`} style={font} onPointerDown={stop} onMouseDown={stop}>
      {body}
    </div>
  );
  switch (data.kind) {
    case "checkbox":
      return shell(
        <label className="flex w-full items-center gap-1.5 px-1">
          <input type="checkbox" checked={st.checked} disabled={!can} onChange={(e) => set({ ...data, checked: e.target.checked }, e.target.checked)} />
          <span className="truncate">{data.text}</span>
        </label>,
      );
    case "option":
      return shell(
        <label className="flex w-full items-center gap-1.5 px-1">
          <input type="radio" checked={st.checked} disabled={!can} onChange={() => can && formControlBus.pickOption?.(floatDomId)} />
          <span className="truncate">{data.text}</span>
        </label>,
      );
    case "button":
      return shell(
        <button type="button" className="h-full w-full rounded border border-slate-400 bg-slate-100 hover:bg-slate-200" onClick={() => formControlBus.press?.(data)}>
          {data.text}
        </button>,
      );
    case "spin":
      return shell(
        <div className="flex h-full w-full flex-col">
          <button type="button" aria-label="Spin up" disabled={!can} className="flex-1 border border-slate-400 bg-slate-100 text-[10px] leading-none" onClick={() => set({ ...data, value: stepValue({ ...data, value: st.value }, data.step ?? 1) }, stepValue({ ...data, value: st.value }, data.step ?? 1))}>
            ▲
          </button>
          <button type="button" aria-label="Spin down" disabled={!can} className="flex-1 border border-t-0 border-slate-400 bg-slate-100 text-[10px] leading-none" onClick={() => set({ ...data, value: stepValue({ ...data, value: st.value }, -(data.step ?? 1)) }, stepValue({ ...data, value: st.value }, -(data.step ?? 1)))}>
            ▼
          </button>
        </div>,
      );
    case "scroll":
      return shell(
        <input
          type="range"
          aria-label="Scroll bar"
          className="h-full w-full"
          style={data.horizontal ? undefined : { writingMode: "vertical-lr" as const }}
          min={data.min ?? 0}
          max={data.max ?? 100}
          step={data.step ?? 1}
          value={st.value}
          disabled={!can}
          onChange={(e) => set({ ...data, value: Number(e.target.value) }, Number(e.target.value))}
        />,
      );
    case "combo":
    case "list": {
      const items = (read(data.input) || []).map((r) => r.find((v) => v != null && v !== "") ?? "");
      const pick = (n: number) => set({ ...data, value: n }, n);
      return data.kind === "combo"
        ? shell(
            <select aria-label={`Combo box ${data.text || ""}`.trim()} className="h-full w-full border border-slate-400 bg-white" value={st.value || 0} disabled={!can} onChange={(e) => pick(Number(e.target.value))}>
              <option value={0} disabled hidden />
              {items.map((v, i) => (
                <option key={i} value={i + 1}>
                  {String(v)}
                </option>
              ))}
            </select>,
          )
        : shell(
            <ul role="listbox" aria-label={`List box ${data.text || ""}`.trim()} className="h-full w-full overflow-auto border border-slate-400 bg-white">
              {items.map((v, i) => (
                <li key={i} role="option" aria-selected={st.value === i + 1} className={`cursor-default px-1 ${st.value === i + 1 ? "bg-indigo-600 text-white" : ""}`} onClick={() => pick(i + 1)}>
                  {String(v)}
                </li>
              ))}
            </ul>,
          );
    }
    case "label":
      return shell(<span className="w-full whitespace-pre-wrap px-1">{data.text}</span>);
    case "group":
      return (
        <fieldset data-form-control="group" aria-label={`Form control ${label}`} className="absolute inset-0 rounded border border-slate-400 px-2" style={font}>
          <legend className="px-1 text-slate-700">{data.text}</legend>
        </fieldset>
      );
  }
}

const KINDS: FormControlKind[] = ["checkbox", "option", "spin", "scroll", "combo", "list", "button", "label", "group"];

/** Insert > Form control: the kind, its text and its linked cell (and for some, a range or limits). */
export function FormControlDialog({ onInsert, onClose }: { onInsert: (d: FormControlData) => void; onClose: () => void }) {
  const [d, setD] = useState<FormControlData>(newFormControl("checkbox"));
  const [error, setError] = useState<string | null>(null);
  const field = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";
  const numberField = (label: string, key: "min" | "max" | "step" | "page") => (
    <label className="block text-sm text-slate-700">
      {label}
      <input type="number" className={field} aria-label={label} value={d[key] ?? 0} onChange={(e) => setD({ ...d, [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <Modal title="Insert form control" onClose={onClose}>
      <form
        className="w-[min(26rem,85vw)] space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (d.link && !splitRef(d.link)) return setError("The cell link must be a cell, such as $B$2.");
          if ((d.kind === "combo" || d.kind === "list") && !(d.input && splitRef(d.input))) return setError("Give the range of items, such as $A$1:$A$5.");
          if ((d.kind === "spin" || d.kind === "scroll") && (d.min ?? 0) >= (d.max ?? 100)) return setError("The maximum must be more than the minimum.");
          onInsert(d);
        }}
      >
        <label className="block text-sm text-slate-700">
          Control
          <select className={field} aria-label="Control" value={d.kind} onChange={(e) => setD({ ...newFormControl(e.target.value as FormControlKind), link: d.link })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {FORM_CONTROL_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {!["spin", "scroll", "combo", "list"].includes(d.kind) && (
          <label className="block text-sm text-slate-700">
            Text
            <input className={field} aria-label="Text" value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} />
          </label>
        )}
        {!["button", "label", "group"].includes(d.kind) && (
          <label className="block text-sm text-slate-700">
            Cell link
            <input className={field} aria-label="Cell link" placeholder="$B$2" value={d.link || ""} onChange={(e) => setD({ ...d, link: e.target.value.trim() || undefined })} />
          </label>
        )}
        {(d.kind === "combo" || d.kind === "list") && (
          <label className="block text-sm text-slate-700">
            Input range
            <input className={field} aria-label="Input range" placeholder="$A$1:$A$5" value={d.input || ""} onChange={(e) => setD({ ...d, input: e.target.value.trim() || undefined })} />
          </label>
        )}
        {(d.kind === "spin" || d.kind === "scroll") && (
          <div className="grid grid-cols-2 gap-2">
            {numberField("Minimum", "min")}
            {numberField("Maximum", "max")}
            {numberField("Increment", "step")}
            {d.kind === "scroll" && numberField("Page change", "page")}
          </div>
        )}
        {d.kind === "button" && (
          <label className="block text-sm text-slate-700">
            Macro (kept for Excel; macros don't run here)
            <input className={field} aria-label="Macro" value={d.macro || ""} onChange={(e) => setD({ ...d, macro: e.target.value.trim() || undefined })} />
          </label>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="rounded-full px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700">
            Insert
          </button>
        </div>
      </form>
    </Modal>
  );
}
