"use client";

// Layout for pictures and shapes: text wrapping, position and size; for
// shapes also the geometry, fill, outline and text colour.
import { useState } from "react";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import { SHAPES, WRAPS, shapeSvg } from "@/lib/docs/drawing";

type Attrs = Record<string, unknown>;

export function LayoutDialog({ kind, attrs, insert, onApply, onDelete, onClose }: { kind: "image" | "shape"; attrs: Attrs; insert?: boolean; onApply: (a: Attrs) => void; onDelete?: () => void; onClose: () => void }) {
  const [a, setA] = useState<Attrs>(attrs);
  const set = (k: string, v: unknown) => setA((x) => ({ ...x, [k]: v }));
  const wrap = String(a.wrap || "inline");
  const free = wrap === "behind" || wrap === "front";
  const ratio = Number(attrs.width) && Number(attrs.height) ? Number(attrs.height) / Number(attrs.width) : 0;
  const [lock, setLock] = useState(kind === "image");
  const color = (k: string, label: string, testid: string) => {
    const v = String(a[k] || "none");
    return (
      <Field label={label}>
        <div className="flex items-center gap-2 h-8">
          <input type="color" className="h-8 w-10 rounded border border-slate-300" value={v === "none" ? "#ffffff" : v} disabled={v === "none"} onChange={(e) => set(k, e.target.value)} data-testid={testid} />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={v === "none"} onChange={(e) => set(k, e.target.checked ? "none" : k === "fill" ? "#4472c4" : "#2f528f")} />
            None
          </label>
        </div>
      </Field>
    );
  };
  return (
    <Modal
      title={kind === "image" ? "Picture layout" : a.textBox ? "Text box" : "Shape"}
      onClose={onClose}
      wide
      footer={
        <>
          {onDelete && <button onClick={onDelete} className={`${btnCls} text-rose-600 hover:bg-rose-50 mr-auto`}>Delete</button>}
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={() => onApply(a)} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="layout-apply">{insert ? "Insert" : "OK"}</button>
        </>
      }
    >
      {kind === "shape" && !a.textBox && (
        <div className="flex flex-wrap gap-1 mb-3" role="listbox" aria-label="Shape">
          {SHAPES.map((s) => (
            <button key={s.id} title={s.label} aria-selected={a.kind === s.id} data-testid={`shape-${s.id}`} onClick={() => set("kind", s.id)} className={`w-12 h-10 rounded border flex items-center justify-center ${a.kind === s.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <span dangerouslySetInnerHTML={{ __html: shapeSvg(s.id, 32, s.id === "line" ? 2 : 22, "#c7d2fe", "#4f46e5", 1.5) }} />
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Wrap text">
          <select className={inputCls} value={wrap} onChange={(e) => set("wrap", e.target.value)} data-testid="layout-wrap">
            {WRAPS.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </Field>
        {free ? (
          <>
            <Field label="Horizontal offset (px)">
              <input type="number" className={inputCls} value={Number(a.offsetX) || 0} onChange={(e) => set("offsetX", Number(e.target.value) || null)} data-testid="layout-x" />
            </Field>
            <Field label="Vertical offset (px)">
              <input type="number" className={inputCls} value={Number(a.offsetY) || 0} onChange={(e) => set("offsetY", Number(e.target.value) || null)} data-testid="layout-y" />
            </Field>
          </>
        ) : (
          <Field label="Position">
            <select className={inputCls} value={String(a.align || "left")} onChange={(e) => set("align", e.target.value === "left" ? null : e.target.value)} data-testid="layout-align">
              <option value="left">Left</option>
              {wrap !== "square" && wrap !== "tight" && <option value="center">Centre</option>}
              <option value="right">Right</option>
            </select>
          </Field>
        )}
        {!free && <div />}
        <Field label="Width (px)">
          <input
            type="number"
            min={8}
            className={inputCls}
            value={Number(a.width) || ""}
            data-testid="layout-width"
            onChange={(e) => {
              const w = Number(e.target.value) || null;
              setA((x) => ({ ...x, width: w, ...(lock && ratio && w ? { height: Math.round(w * ratio) } : {}) }));
            }}
          />
        </Field>
        <Field label="Height (px)">
          <input
            type="number"
            min={0}
            className={inputCls}
            value={Number(a.height) || ""}
            data-testid="layout-height"
            onChange={(e) => {
              const h = Number(e.target.value) || null;
              setA((x) => ({ ...x, height: h, ...(lock && ratio && h ? { width: Math.round(h / ratio) } : {}) }));
            }}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          Lock aspect ratio
        </label>
        {kind === "shape" && (
          <>
            {color("fill", "Fill", "layout-fill")}
            {color("stroke", "Outline", "layout-stroke")}
            <Field label="Outline weight (pt)">
              <input type="number" min={0} step={0.25} className={inputCls} value={Number(a.strokeWidth) || 0} onChange={(e) => set("strokeWidth", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Text colour">
              <input type="color" className="h-8 w-10 rounded border border-slate-300" value={String(a.color || "#000000")} onChange={(e) => set("color", e.target.value)} />
            </Field>
            <Field label="Text position">
              <select className={inputCls} value={String(a.valign || "middle")} onChange={(e) => set("valign", e.target.value)}>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
