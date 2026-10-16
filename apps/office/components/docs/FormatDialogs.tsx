"use client";

// Format > Font, Tabs, Borders and shading, and Insert > Drop cap.
import { useState } from "react";
import { Modal, btnCls, inputCls, Field, FONT_CHOICES } from "./WordDialogs";
import { bordersCss, parseJson, type BorderLine, type ParaBorders, type TabStop } from "@/lib/docs/para-format";

const ok = `${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`;
const cancel = `${btnCls} text-slate-600 hover:bg-slate-100`;
const Footer = ({ onClose, onOk, testid }: { onClose: () => void; onOk: () => void; testid: string }) => (
  <>
    <button onClick={onClose} className={cancel}>Cancel</button>
    <button onClick={onOk} className={ok} data-testid={testid}>OK</button>
  </>
);

export type FontValue = {
  fontFamily?: string | null;
  fontSize?: string | null;
  color?: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  caps: boolean;
  smallCaps: boolean;
  charSpacing: number;
};

export function FontDialog({ value, onApply, onClose }: { value: FontValue; onApply: (v: FontValue) => void; onClose: () => void }) {
  const [v, setV] = useState<FontValue>(value);
  const set = <K extends keyof FontValue>(k: K, x: FontValue[K]) => setV((o) => ({ ...o, [k]: x }));
  const check = (k: "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript" | "caps" | "smallCaps", label: string) => (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" aria-label={label} checked={v[k]} onChange={(e) => setV((o) => ({ ...o, [k]: e.target.checked, ...(k === "superscript" && e.target.checked ? { subscript: false } : {}), ...(k === "subscript" && e.target.checked ? { superscript: false } : {}), ...(k === "caps" && e.target.checked ? { smallCaps: false } : {}), ...(k === "smallCaps" && e.target.checked ? { caps: false } : {}) }))} />
      {label}
    </label>
  );
  const size = parseFloat(String(v.fontSize || "")) || "";
  return (
    <Modal title="Font" onClose={onClose} footer={<Footer onClose={onClose} onOk={() => onApply(v)} testid="font-ok" />}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Font">
          <select aria-label="Font" className={inputCls} value={v.fontFamily || ""} onChange={(e) => set("fontFamily", e.target.value || null)}>
            <option value="">(style)</option>
            {FONT_CHOICES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            {v.fontFamily && !FONT_CHOICES.includes(v.fontFamily) && <option value={v.fontFamily}>{v.fontFamily}</option>}
          </select>
        </Field>
        <Field label="Size (pt)">
          <input aria-label="Font size" type="number" min={1} max={400} step={0.5} className={inputCls} value={size} onChange={(e) => set("fontSize", e.target.value ? `${e.target.value}pt` : null)} />
        </Field>
        <Field label="Colour">
          <input aria-label="Font colour" type="color" className="h-8 w-full rounded border border-slate-300" value={v.color || "#000000"} onChange={(e) => set("color", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-4">
        {check("bold", "Bold")}
        {check("italic", "Italic")}
        {check("underline", "Underline")}
        {check("strike", "Strikethrough")}
        {check("superscript", "Superscript")}
        {check("subscript", "Subscript")}
        {check("smallCaps", "Small caps")}
        {check("caps", "All caps")}
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4">
        <Field label="Character spacing">
          <select aria-label="Character spacing" className={inputCls} value={v.charSpacing > 0 ? "expanded" : v.charSpacing < 0 ? "condensed" : "normal"} onChange={(e) => set("charSpacing", e.target.value === "normal" ? 0 : e.target.value === "expanded" ? Math.abs(v.charSpacing) || 1 : -(Math.abs(v.charSpacing) || 1))}>
            <option value="normal">Normal</option>
            <option value="expanded">Expanded</option>
            <option value="condensed">Condensed</option>
          </select>
        </Field>
        <Field label="By (pt)">
          <input aria-label="Spacing by" type="number" step={0.1} min={0} className={inputCls} disabled={!v.charSpacing} value={Math.abs(v.charSpacing) || ""} onChange={(e) => set("charSpacing", Math.sign(v.charSpacing || 1) * Math.abs(Number(e.target.value) || 0))} />
        </Field>
      </div>
      <div className="mt-4 border border-slate-200 rounded-md h-16 grid place-items-center overflow-hidden" data-testid="font-preview">
        <span
          style={{
            fontFamily: v.fontFamily || undefined,
            fontSize: v.fontSize || undefined,
            color: v.color || undefined,
            fontWeight: v.bold ? 700 : undefined,
            fontStyle: v.italic ? "italic" : undefined,
            textDecoration: [v.underline ? "underline" : "", v.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
            textTransform: v.caps ? "uppercase" : undefined,
            fontVariant: v.smallCaps ? "small-caps" : undefined,
            letterSpacing: v.charSpacing ? `${v.charSpacing}pt` : undefined,
            verticalAlign: v.superscript ? "super" : v.subscript ? "sub" : undefined,
          }}
        >
          The quick brown fox
        </span>
      </div>
    </Modal>
  );
}

const ALIGNS: TabStop["align"][] = ["left", "center", "right", "decimal"];
export function TabsDialog({ value, onApply, onClose }: { value: unknown; onApply: (tabs: TabStop[] | null) => void; onClose: () => void }) {
  const [tabs, setTabs] = useState<TabStop[]>(parseJson<TabStop[]>(value) || []);
  const [pos, setPos] = useState("");
  const [align, setAlign] = useState<TabStop["align"]>("left");
  const [leader, setLeader] = useState<"" | NonNullable<TabStop["leader"]>>("");
  const add = () => {
    const p = Number(pos);
    if (!(p > 0)) return;
    setTabs((t) => [...t.filter((x) => Math.abs(x.pos - p) > 0.5), { pos: p, align, ...(leader ? { leader } : {}) }].sort((a, b) => a.pos - b.pos));
    setPos("");
  };
  return (
    <Modal title="Tabs" onClose={onClose} footer={<Footer onClose={onClose} onOk={() => onApply(tabs.length ? tabs : null)} testid="tabs-ok" />}>
      <div className="grid grid-cols-4 gap-2 items-end">
        <Field label="Tab stop position (pt)">
          <input aria-label="Tab stop position" type="number" min={1} className={inputCls} value={pos} onChange={(e) => setPos(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        </Field>
        <Field label="Alignment">
          <select aria-label="Tab alignment" className={inputCls} value={align} onChange={(e) => setAlign(e.target.value as TabStop["align"])}>
            {ALIGNS.map((a) => (
              <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
            ))}
          </select>
        </Field>
        <Field label="Leader">
          <select aria-label="Tab leader" className={inputCls} value={leader} onChange={(e) => setLeader(e.target.value as typeof leader)}>
            <option value="">None</option>
            <option value="dot">.......</option>
            <option value="hyphen">-------</option>
            <option value="underscore">______</option>
          </select>
        </Field>
        <button className={`${btnCls} border border-slate-300 hover:bg-slate-50`} onClick={add} data-testid="tab-set">Set</button>
      </div>
      <div className="mt-3 border border-slate-200 rounded-md divide-y divide-slate-100 min-h-16" data-testid="tab-list">
        {tabs.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No tab stops: tabs go to every 0.5 in (36 pt).</div>}
        {tabs.map((t) => (
          <div key={t.pos} className="px-3 py-1.5 flex items-center text-sm">
            <span className="w-24 tabular-nums">{t.pos} pt</span>
            <span className="w-24 text-slate-600">{t.align}</span>
            <span className="flex-1 text-slate-500">{t.leader || ""}</span>
            <button className="text-xs text-rose-600 hover:underline" onClick={() => setTabs((x) => x.filter((y) => y !== t))}>Clear</button>
          </div>
        ))}
      </div>
      {tabs.length > 0 && (
        <button className="mt-2 text-xs text-slate-600 hover:underline" onClick={() => setTabs([])}>Clear all</button>
      )}
    </Modal>
  );
}

const SIDES = ["top", "bottom", "left", "right"] as const;
export function BordersDialog({ borders, shading, onApply, onClose }: { borders: unknown; shading: unknown; onApply: (b: ParaBorders | null, shading: string | null) => void; onClose: () => void }) {
  const initial = parseJson<ParaBorders>(borders) || {};
  const first = SIDES.map((s) => initial[s]).find(Boolean);
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(SIDES.map((s) => [s, !!initial[s]])));
  const [line, setLine] = useState<BorderLine>(first || { style: "single", size: 0.5, color: "#000000", space: 1 });
  const [fill, setFill] = useState(typeof shading === "string" ? shading : "");
  const preset = (p: "none" | "box" | "bottom") => setOn(Object.fromEntries(SIDES.map((s) => [s, p === "box" || (p === "bottom" && s === "bottom")])));
  const result = (): ParaBorders | null => {
    const b: ParaBorders = {};
    for (const s of SIDES) if (on[s]) b[s] = { ...line, space: s === "left" || s === "right" ? Math.max(line.space, 4) : line.space };
    return Object.keys(b).length ? b : null;
  };
  return (
    <Modal title="Borders and shading" onClose={onClose} footer={<Footer onClose={onClose} onOk={() => onApply(result(), fill || null)} testid="borders-ok" />}>
      <div className="flex gap-2 mb-3">
        {(["none", "box", "bottom"] as const).map((p) => (
          <button key={p} className={`${btnCls} border border-slate-300 hover:bg-slate-50 capitalize`} onClick={() => preset(p)} data-testid={`borders-${p}`}>{p === "bottom" ? "Bottom only" : p}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {SIDES.map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-xs capitalize">
            <input type="checkbox" aria-label={`Border ${s}`} checked={!!on[s]} onChange={(e) => setOn((o) => ({ ...o, [s]: e.target.checked }))} /> {s}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Style">
          <select aria-label="Border style" className={inputCls} value={line.style} onChange={(e) => setLine((l) => ({ ...l, style: e.target.value as BorderLine["style"] }))}>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="dotted">Dotted</option>
            <option value="dashed">Dashed</option>
            <option value="thick">Thick</option>
          </select>
        </Field>
        <Field label="Width (pt)">
          <select aria-label="Border width" className={inputCls} value={String(line.size)} onChange={(e) => setLine((l) => ({ ...l, size: Number(e.target.value) }))}>
            {[0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </Field>
        <Field label="Colour">
          <input aria-label="Border colour" type="color" className="h-8 w-full rounded border border-slate-300" value={line.color} onChange={(e) => setLine((l) => ({ ...l, color: e.target.value }))} />
        </Field>
        <Field label="Shading">
          <div className="flex items-center gap-1 h-8">
            <input aria-label="Shading" type="color" className="h-8 w-10 rounded border border-slate-300" value={fill || "#ffffff"} onChange={(e) => setFill(e.target.value)} disabled={!fill} />
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={!fill} onChange={(e) => setFill(e.target.checked ? "" : "#f2f2f2")} aria-label="No shading" /> None
            </label>
          </div>
        </Field>
      </div>
      <div className="mt-4 p-4 bg-slate-50 rounded-md">
        <p className="text-xs text-slate-600" ref={(el) => {
            if (el) el.style.cssText = bordersCss(result(), fill || null);
          }} data-testid="borders-preview">
          A paragraph with these borders and shading.
        </p>
      </div>
    </Modal>
  );
}

export function DropCapDialog({ value, onApply, onClose }: { value: unknown; onApply: (v: string | null) => void; onClose: () => void }) {
  const m = /^(drop|margin):(\d+)$/.exec(String(value || ""));
  const [kind, setKind] = useState<"none" | "drop" | "margin">((m?.[1] as "drop" | "margin") || "none");
  const [lines, setLines] = useState(Number(m?.[2]) || 3);
  return (
    <Modal title="Drop cap" onClose={onClose} footer={<Footer onClose={onClose} onOk={() => onApply(kind === "none" ? null : `${kind}:${lines}`)} testid="dropcap-ok" />}>
      <div className="flex gap-2 mb-4">
        {(["none", "drop", "margin"] as const).map((k) => (
          <button key={k} className={`${btnCls} border ${kind === k ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:bg-slate-50"}`} onClick={() => setKind(k)} data-testid={`dropcap-${k}`}>
            {k === "none" ? "None" : k === "drop" ? "Dropped" : "In margin"}
          </button>
        ))}
      </div>
      <Field label="Lines to drop">
        <input aria-label="Lines to drop" type="number" min={2} max={10} className={inputCls} value={lines} disabled={kind === "none"} onChange={(e) => setLines(Math.max(2, Math.min(10, Number(e.target.value) || 3)))} />
      </Field>
    </Modal>
  );
}
