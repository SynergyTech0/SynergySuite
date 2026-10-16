"use client";

// Design > Watermark and Design > Page borders.
import { useState } from "react";
import { Modal, btnCls, inputCls, Field, FONT_CHOICES } from "./WordDialogs";
import { WATERMARK_PRESETS, type Watermark, type PageBorders } from "@/lib/docs/page-design";
import type { BorderLine } from "@/lib/docs/para-format";

const ok = `${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`;
const cancel = `${btnCls} text-slate-600 hover:bg-slate-100`;

export function WatermarkDialog({ value, onApply, onClose }: { value?: Watermark; onApply: (w: Watermark | null) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"none" | "text" | "picture">(value ? value.kind : "text");
  const [text, setText] = useState(value?.text || "DRAFT");
  const [font, setFont] = useState(value?.font || "Calibri");
  const [size, setSize] = useState(value?.size || 0);
  const [color, setColor] = useState(value?.color || "#c0c0c0");
  const [semi, setSemi] = useState(value?.semitransparent !== false);
  const [layout, setLayout] = useState<"diagonal" | "horizontal">(value?.layout || "diagonal");
  const [image, setImage] = useState(value?.image || "");
  const [washout, setWashout] = useState(value?.washout !== false);
  const [scale, setScale] = useState(value?.scale || 0);
  const pick = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setImage(String(r.result || ""));
    r.readAsDataURL(f);
  };
  const apply = () => {
    if (kind === "none") return onApply(null);
    if (kind === "picture") return onApply(image ? { kind: "picture", image, washout, scale } : null);
    onApply(text.trim() ? { kind: "text", text: text.trim(), font, size, color, semitransparent: semi, layout } : null);
  };
  const radio = (k: typeof kind, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="radio" name="wm-kind" aria-label={label} checked={kind === k} onChange={() => setKind(k)} /> {label}
    </label>
  );
  return (
    <Modal
      title="Watermark"
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Cancel</button>
          <button className={ok} data-testid="watermark-ok" onClick={apply}>OK</button>
        </>
      }
    >
      <div className="space-y-3">
        {radio("none", "No watermark")}
        {radio("picture", "Picture watermark")}
        {kind === "picture" && (
          <div className="pl-6 grid grid-cols-3 gap-2 items-end">
            <Field label="Picture">
              <input type="file" accept="image/png,image/jpeg,image/gif" aria-label="Watermark picture" className="text-xs" onChange={(e) => pick(e.target.files?.[0])} />
            </Field>
            <Field label="Scale">
              <select aria-label="Watermark scale" className={inputCls} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                <option value={0}>Auto</option>
                {[0.5, 1, 1.5, 2].map((v) => (
                  <option key={v} value={v}>{v * 100}%</option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm h-8">
              <input type="checkbox" checked={washout} onChange={(e) => setWashout(e.target.checked)} /> Washout
            </label>
          </div>
        )}
        {radio("text", "Text watermark")}
        {kind === "text" && (
          <div className="pl-6 grid grid-cols-2 gap-2">
            <Field label="Text">
              <input list="wm-presets" aria-label="Watermark text" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
              <datalist id="wm-presets">
                {WATERMARK_PRESETS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="Font">
              <select aria-label="Watermark font" className={inputCls} value={font} onChange={(e) => setFont(e.target.value)}>
                {FONT_CHOICES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Size">
              <select aria-label="Watermark size" className={inputCls} value={size} onChange={(e) => setSize(Number(e.target.value))}>
                <option value={0}>Auto</option>
                {[36, 54, 72, 90, 105, 120, 144].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Colour">
              <input type="color" aria-label="Watermark colour" className="h-8 w-16" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={semi} onChange={(e) => setSemi(e.target.checked)} /> Semitransparent
            </label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" name="wm-layout" checked={layout === "diagonal"} onChange={() => setLayout("diagonal")} /> Diagonal
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="wm-layout" aria-label="Horizontal" checked={layout === "horizontal"} onChange={() => setLayout("horizontal")} /> Horizontal
              </label>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const STYLES: BorderLine["style"][] = ["single", "double", "dotted", "dashed", "thick"];

export function PageBordersDialog({ value, onApply, onClose }: { value?: PageBorders; onApply: (b: PageBorders | null) => void; onClose: () => void }) {
  const first = value?.top || value?.left || value?.bottom || value?.right;
  const [setting, setSetting] = useState<"none" | "box">(first ? "box" : "box");
  const [style, setStyle] = useState<BorderLine["style"]>(first?.style || "single");
  const [size, setSize] = useState(first?.size || 0.5);
  const [color, setColor] = useState(first?.color || "#000000");
  const [space, setSpace] = useState(first?.space ?? 24);
  const [offsetFrom, setOffsetFrom] = useState<"page" | "text">(value?.offsetFrom || "page");
  const [display, setDisplay] = useState<NonNullable<PageBorders["display"]>>(value?.display || "allPages");
  const [sides, setSides] = useState<Record<"top" | "left" | "bottom" | "right", boolean>>({ top: !value || !!value.top, left: !value || !!value.left, bottom: !value || !!value.bottom, right: !value || !!value.right });
  const apply = () => {
    if (setting === "none") return onApply(null);
    const line: BorderLine = { style, size, color, space: Math.min(31, Math.max(0, space)) };
    const b: PageBorders = { offsetFrom, ...(display !== "allPages" ? { display } : {}) };
    for (const k of ["top", "left", "bottom", "right"] as const) if (sides[k]) b[k] = line;
    onApply(b.top || b.left || b.bottom || b.right ? b : null);
  };
  return (
    <Modal
      title="Page borders"
      onClose={onClose}
      footer={
        <>
          <button className={cancel} onClick={onClose}>Cancel</button>
          <button className={ok} data-testid="page-borders-ok" onClick={apply}>OK</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Setting">
          <select aria-label="Page border setting" className={inputCls} value={setting} onChange={(e) => setSetting(e.target.value as "none" | "box")}>
            <option value="none">None</option>
            <option value="box">Box</option>
          </select>
        </Field>
        <Field label="Style">
          <select aria-label="Page border style" className={inputCls} value={style} onChange={(e) => setStyle(e.target.value as BorderLine["style"])}>
            {STYLES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Width (pt)">
          <select aria-label="Page border width" className={inputCls} value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Colour">
          <input type="color" aria-label="Page border colour" className="h-8 w-16" value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <Field label="Measure from">
          <select aria-label="Measure from" className={inputCls} value={offsetFrom} onChange={(e) => setOffsetFrom(e.target.value as "page" | "text")}>
            <option value="page">Edge of page</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field label="Distance (pt)">
          <input type="number" aria-label="Page border distance" min={0} max={31} className={inputCls} value={space} onChange={(e) => setSpace(Number(e.target.value))} />
        </Field>
        <Field label="Apply to">
          <select aria-label="Page border apply to" className={inputCls} value={display} onChange={(e) => setDisplay(e.target.value as NonNullable<PageBorders["display"]>)}>
            <option value="allPages">Whole section</option>
            <option value="firstPage">This section - first page only</option>
            <option value="notFirstPage">This section - all except first page</option>
          </select>
        </Field>
        <div className="flex gap-3 items-end text-sm">
          {(["top", "left", "bottom", "right"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={sides[k]} onChange={(e) => setSides({ ...sides, [k]: e.target.checked })} /> {k}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
