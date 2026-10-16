"use client";

// Format panes for gradient fills, shadows and picture cropping (toolbar popovers).
import { useRef, useState } from "react";
import { SHADOW_PRESETS, type Crop, type GradStop, type Gradient, type Shadow } from "@/lib/slides/model";
import { colorAt, gradientCss } from "@/lib/slides/effects";

const inputCls = "h-7 rounded border border-slate-300 px-1 text-xs";
const btn = "rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700";

export const GRADIENT_PRESETS: { label: string; g: Gradient }[] = [
  { label: "Sky", g: { kind: "linear", angle: 90, stops: [{ pos: 0, color: "4F86F7" }, { pos: 100, color: "B7E3FF" }] } },
  { label: "Sunset", g: { kind: "linear", angle: 45, stops: [{ pos: 0, color: "F97316" }, { pos: 100, color: "DB2777" }] } },
  { label: "Forest", g: { kind: "linear", angle: 90, stops: [{ pos: 0, color: "065F46" }, { pos: 100, color: "34D399" }] } },
  { label: "Slate", g: { kind: "linear", angle: 0, stops: [{ pos: 0, color: "0F172A" }, { pos: 100, color: "475569" }] } },
  { label: "Glow", g: { kind: "radial", angle: 0, stops: [{ pos: 0, color: "FFFFFF" }, { pos: 100, color: "6366F1" }] } },
];

/**
 * Gradient editor with any number of stops, as PowerPoint's: click the bar to
 * add a stop, drag a stop to move it, pick its colour and position, remove it
 * (two stays the minimum). Presets fill it in; `onApply(null)` removes the gradient.
 */
export function GradientForm({ value, base, onApply }: { value?: Gradient; base?: string | null; onApply: (g: Gradient | null) => void }) {
  const init: GradStop[] = value?.stops?.length && value.stops.length >= 2 ? value.stops.map((s) => ({ ...s })) : [{ pos: 0, color: value?.stops[0]?.color || base || "4472C4" }, { pos: 100, color: "FFFFFF" }];
  const [stops, setStops] = useState<GradStop[]>(init);
  const [at, setAt] = useState(0);
  const [angle, setAngle] = useState(String(value?.angle ?? 90));
  const [kind, setKind] = useState<Gradient["kind"]>(value?.kind || "linear");
  const bar = useRef<HTMLDivElement>(null);
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const cur: Gradient = { kind, angle: Number(angle) || 0, stops: sorted };
  const sel = stops[Math.min(at, stops.length - 1)];
  const setStop = (i: number, p: Partial<GradStop>) => setStops((ss) => ss.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const posOf = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((clientX - r.left) / Math.max(1, r.width)) * 100)));
  };
  const addAt = (pos: number) => {
    setStops((ss) => [...ss, { pos, color: colorAt(ss, pos) }]);
    setAt(stops.length);
  };
  const drag = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAt(i);
    const move = (ev: PointerEvent) => setStop(i, { pos: posOf(ev.clientX) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const load = (g: Gradient) => { setStops(g.stops.map((s) => ({ ...s }))); setKind(g.kind); setAngle(String(g.angle)); setAt(0); };
  return (
    <div className="space-y-2 text-xs text-slate-700 w-[240px]" data-testid="grad-form" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex gap-1">
        {GRADIENT_PRESETS.map((p) => (
          <button key={p.label} type="button" title={p.label} data-testid={`grad-preset-${p.label.toLowerCase()}`} className="w-7 h-7 rounded border border-slate-300" style={{ background: gradientCss(p.g) }} onClick={() => onApply(p.g)} onContextMenu={(e) => { e.preventDefault(); load(p.g); }} />
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Gradient stops</div>
      <div className="relative pb-3">
        <div
          ref={bar}
          data-testid="grad-bar"
          title="Click to add a stop"
          className="h-5 rounded border border-slate-300 cursor-copy"
          style={{ background: gradientCss({ kind: "linear", angle: 0, stops: sorted }) }}
          onPointerDown={(e) => addAt(posOf(e.clientX))}
        />
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            data-testid={`grad-stop-${i}`}
            aria-label={`Stop ${i + 1} at ${s.pos}%`}
            aria-pressed={i === at}
            className={`absolute top-4 -ml-1.5 w-3 h-3 rotate-45 border ${i === at ? "border-indigo-600 ring-2 ring-indigo-300" : "border-slate-500"}`}
            style={{ left: `${s.pos}%`, background: `#${s.color}` }}
            onPointerDown={drag(i)}
          />
        ))}
      </div>
      {sel && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">Colour<input type="color" data-testid="grad-stop-color" value={`#${sel.color}`} onChange={(e) => setStop(at, { color: e.target.value.slice(1).toUpperCase() })} /></label>
          <label className="flex items-center gap-1">Position<input type="number" min={0} max={100} data-testid="grad-stop-pos" className={`${inputCls} w-12`} value={sel.pos} onChange={(e) => setStop(at, { pos: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />%</label>
          <button type="button" data-testid="grad-stop-remove" disabled={stops.length <= 2} title="Remove gradient stop" className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50 disabled:opacity-40" onClick={() => { setStops((ss) => ss.filter((_, k) => k !== at)); setAt(0); }}>Remove</button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <select className={inputCls} data-testid="grad-kind" value={kind} onChange={(e) => setKind(e.target.value as Gradient["kind"])}>
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        {kind === "linear" && <label className="flex items-center gap-1">Angle<input type="number" data-testid="grad-angle" className={`${inputCls} w-14`} value={angle} onChange={(e) => setAngle(e.target.value)} />°</label>}
      </div>
      <div className="h-4 rounded border border-slate-200" data-testid="grad-preview" style={{ background: gradientCss(cur) }} />
      <div className="flex gap-2">
        <button type="button" className={btn} data-testid="grad-apply" onClick={() => onApply(cur)}>Apply gradient</button>
        {value && <button type="button" className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50" data-testid="grad-remove" onClick={() => onApply(null)}>Remove</button>}
      </div>
    </div>
  );
}

export function ShadowForm({ value, onApply }: { value?: Shadow; onApply: (s: Shadow | null) => void }) {
  const [color, setColor] = useState(value?.color || "000000");
  return (
    <div className="flex flex-col text-sm" data-testid="shadow-form">
      <button type="button" data-testid="shadow-none" className={`text-left px-2 py-1.5 rounded hover:bg-slate-50 ${!value ? "text-indigo-700 font-medium" : ""}`} onClick={() => onApply(null)}>No shadow</button>
      {SHADOW_PRESETS.map((p) => (
        <button key={p.id} type="button" data-testid={`shadow-${p.id}`} className="text-left px-2 py-1.5 rounded hover:bg-slate-50" onClick={() => onApply({ ...p.s, color })}>{p.label}</button>
      ))}
      <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">Colour<input type="color" value={`#${color}`} onChange={(e) => { const c = e.target.value.slice(1).toUpperCase(); setColor(c); if (value) onApply({ ...value, color: c }); }} /></label>
    </div>
  );
}

/** Crop in percent of the picture from each edge. */
export function CropForm({ value, onApply }: { value?: Crop; onApply: (c: Crop | null) => void }) {
  const pc = (n: number | undefined) => String(Math.round((n || 0) * 1000) / 10);
  const [v, setV] = useState({ l: pc(value?.l), t: pc(value?.t), r: pc(value?.r), b: pc(value?.b) });
  const f = (k: keyof typeof v, label: string) => (
    <label className="flex items-center gap-1">{label}<input type="number" min={0} max={95} step={1} data-testid={`crop-${k}`} className={`${inputCls} w-14 ml-auto`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />%</label>
  );
  const num = (s: string) => Math.min(0.95, Math.max(0, (Number(s) || 0) / 100));
  const apply = () => {
    const c = { l: num(v.l), t: num(v.t), r: num(v.r), b: num(v.b) };
    if (c.l + c.r >= 0.98 || c.t + c.b >= 0.98) return alert("The crop leaves nothing of the picture.");
    onApply(c.l || c.t || c.r || c.b ? c : null);
  };
  return (
    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 w-56" data-testid="crop-form" onKeyDown={(e) => e.stopPropagation()}>
      {f("l", "Left")}{f("r", "Right")}{f("t", "Top")}{f("b", "Bottom")}
      <button type="button" className={btn} data-testid="crop-apply" onClick={apply}>Crop</button>
      <button type="button" className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50" data-testid="crop-reset" onClick={() => onApply(null)}>Reset</button>
    </div>
  );
}
