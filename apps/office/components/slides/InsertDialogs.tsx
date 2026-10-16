"use client";

// Insert dialogs: equation editor, icon picker and SmartArt-style diagrams.
import { useMemo, useRef, useState } from "react";
import type { MathEl, NewElement, Slide } from "@/lib/slides/model";
import { MATH_PRESETS, MATH_SNIPPETS, latexToMathml } from "@/lib/slides/math";
import { ICON_SETS, searchIcons } from "@/lib/slides/icons";
import { DIAGRAMS, buildDiagram, parseOutline, type DiagramKind } from "@/lib/slides/smartart";
import { Modal } from "./DeckDialogs";
import { ScaledSlide, type DeckLook } from "./SlideView";

const btn = "rounded px-3 py-1.5 hover:bg-slate-100";
const primary = "rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-40";

/** Write or edit an equation in LaTeX with a live preview and quick inserts. */
export function MathDialog({ value, onApply, onClose }: { value?: Pick<MathEl, "latex" | "size" | "color">; onApply: (v: { latex: string; size: number; color?: string }) => void; onClose: () => void }) {
  const [latex, setLatex] = useState(value?.latex || "");
  const [size, setSize] = useState(String(value?.size || 28));
  const [color, setColor] = useState(value?.color || "");
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (s: string) => {
    const el = ta.current;
    const a = el?.selectionStart ?? latex.length, b = el?.selectionEnd ?? latex.length;
    const next = latex.slice(0, a) + s + latex.slice(b);
    setLatex(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };
  const preview = useMemo(() => (latex.trim() ? latexToMathml(latex) : ""), [latex]);
  const pt = Math.max(8, Math.min(120, Number(size) || 28));
  return (
    <Modal title="Equation" testId="math-dialog" onClose={onClose} wide>
      <div className="flex flex-wrap gap-1">
        {MATH_SNIPPETS.map((s) => (
          <button key={s.label} type="button" title={s.latex} className="h-8 min-w-8 px-2 rounded border border-slate-200 hover:bg-slate-50" onClick={() => insert(s.latex)}>{s.label}</button>
        ))}
        <select className="h-8 rounded border border-slate-200 px-1" value="" onChange={(e) => e.target.value && setLatex(e.target.value)} data-testid="math-preset">
          <option value="">Common equations…</option>
          {MATH_PRESETS.map((p) => <option key={p.label} value={p.latex}>{p.label}</option>)}
        </select>
      </div>
      <label className="block text-slate-600">LaTeX
        <textarea ref={ta} autoFocus data-testid="math-latex" className="mt-1 w-full h-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm" value={latex} onChange={(e) => setLatex(e.target.value)} placeholder="x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}" />
      </label>
      <div className="min-h-24 rounded border border-slate-200 bg-slate-50 flex items-center justify-center p-3 overflow-x-auto" data-testid="math-preview" style={{ fontSize: "22pt", fontFamily: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', math, serif", color: color ? `#${color}` : undefined }}>
        {preview ? <div dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="text-sm text-slate-400">Preview</span>}
      </div>
      <div className="flex items-center gap-3 text-slate-600">
        <label className="flex items-center gap-2">Size (pt)<input type="number" min={8} max={120} className="w-20 h-8 rounded border border-slate-300 px-2" value={size} onChange={(e) => setSize(e.target.value)} data-testid="math-size" /></label>
        <label className="flex items-center gap-2">Colour<input type="color" className="h-8 w-10 rounded border border-slate-300" value={`#${color || "000000"}`} onChange={(e) => setColor(e.target.value.slice(1).toUpperCase())} /></label>
        {color && <button type="button" className="text-xs underline" onClick={() => setColor("")}>Automatic</button>}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!latex.trim()} data-testid="math-apply" onClick={() => { onApply({ latex: latex.trim(), size: pt, ...(color ? { color } : {}) }); onClose(); }}>{value ? "Update" : "Insert"}</button>
      </div>
    </Modal>
  );
}

function IconSvg({ svg, size = 24 }: { svg: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Pick an icon (Lucide) to insert as a vector shape. */
export function IconPicker({ onPick, onClose }: { onPick: (name: string, svg: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [set, setSet] = useState(ICON_SETS[0].name);
  const list = q.trim() ? searchIcons(q) : ICON_SETS.find((s) => s.name === set)?.icons || [];
  return (
    <Modal title="Insert icon" testId="icon-dialog" onClose={onClose} wide>
      <input autoFocus data-testid="icon-search" className="w-full h-8 rounded border border-slate-300 px-2" placeholder="Search icons (e.g. chart, user, arrow)" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q.trim() && (
        <div className="flex flex-wrap gap-1">
          {ICON_SETS.map((s) => (
            <button key={s.name} type="button" className={`text-xs rounded-full px-2.5 py-1 border ${s.name === set ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => setSet(s.name)}>{s.name}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-10 gap-1 max-h-72 overflow-y-auto text-slate-700">
        {list.map(([name, svg]) => (
          <button key={name} type="button" title={name.replace(/-/g, " ")} data-testid={`icon-${name}`} className="h-11 rounded hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-center" onClick={() => { onPick(name, svg); onClose(); }}>
            <IconSvg svg={svg} />
          </button>
        ))}
        {!list.length && <div className="col-span-10 text-center text-slate-400 py-6">No icons match.</div>}
      </div>
      <div className="text-[11px] text-slate-400">Icons from Lucide (ISC licence). Inserted icons are shapes: recolour them with Outline.</div>
    </Modal>
  );
}

const SAMPLE: Record<DiagramKind, string> = {
  process: "Plan\nBuild\nTest\nLaunch",
  cycle: "Plan\nDo\nCheck\nAct",
  hierarchy: "CEO\n  Sales\n    East\n    West\n  Engineering\n  Finance",
  list: "Goals\n  Grow revenue\n  Enter two markets\nRisks\n  Hiring\nNext steps\n  Approve budget",
  pyramid: "Vision\nStrategy\nTactics\nOperations",
};

/** Insert a SmartArt-style diagram from an outline. */
export function DiagramDialog({ look, accent, initial, onInsert, onClose }: { look: DeckLook; accent: string; /** editing a graphic's data model (the Text Pane) */ initial?: { kind: DiagramKind; text: string }; onInsert: (kind: DiagramKind, text: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<DiagramKind>(initial?.kind || "process");
  const [text, setText] = useState(initial?.text ?? SAMPLE.process);
  const [edited, setEdited] = useState(!!initial);
  const preview: Slide = useMemo(() => {
    const els = buildDiagram(kind, parseOutline(text), { x: look.W * 0.08, y: look.H * 0.12, w: look.W * 0.84, h: look.H * 0.76 }, accent, "preview");
    return { id: "preview", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: els.map((e, i) => ({ ...e, id: `p${i}`, z: i + 1 }) as NewElement & { id: string; z: number }) as Slide["elements"] };
  }, [kind, text, look.W, look.H, accent]);
  return (
    <Modal title={initial ? "SmartArt Text Pane" : "SmartArt graphic"} testId="diagram-dialog" onClose={onClose} wide>
      <div className="flex gap-1 flex-wrap">
        {DIAGRAMS.map((d) => (
          <button key={d.id} type="button" title={d.hint} data-testid={`diagram-${d.id}`} className={`rounded px-3 py-1.5 border text-sm ${d.id === kind ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { setKind(d.id); if (!edited) setText(SAMPLE[d.id]); }}>{d.label}</button>
        ))}
      </div>
      <div className="flex gap-3">
        <label className="w-48 shrink-0 text-slate-600 text-xs">Text (one item per line, indent with two spaces for a sub-item)
          <textarea data-testid="diagram-text" className="mt-1 w-full h-48 rounded border border-slate-300 px-2 py-1 text-sm font-mono" value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const t = e.currentTarget, a = t.selectionStart, ls = text.lastIndexOf("\n", a - 1) + 1;
            const next = e.shiftKey ? (text.slice(ls, ls + 2) === "  " ? text.slice(0, ls) + text.slice(ls + 2) : text) : text.slice(0, ls) + "  " + text.slice(ls);
            setText(next);
            setEdited(true);
            const pos = Math.max(ls, a + (next.length - text.length));
            requestAnimationFrame(() => t.setSelectionRange(pos, pos));
          }} />
        </label>
        <div className="flex-1 min-w-0 rounded border border-slate-200 overflow-hidden self-start" data-testid="diagram-preview">
          <ScaledSlide slide={preview} look={look} width={360} />
        </div>
      </div>
      <div className="text-xs text-slate-500">{DIAGRAMS.find((d) => d.id === kind)?.hint}. {initial ? "The outline is the graphic's data model: the shapes are laid out again from it, and PowerPoint's Text Pane shows the same items." : "Text typed into the shapes later goes back into the outline (Text Pane), and the graphic stays SmartArt in PowerPoint."}</div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!parseOutline(text).length} data-testid="diagram-insert" onClick={() => { onInsert(kind, text); onClose(); }}>{initial ? "Update" : "Insert"}</button>
      </div>
    </Modal>
  );
}
