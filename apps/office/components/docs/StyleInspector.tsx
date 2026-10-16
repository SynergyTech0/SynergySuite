"use client";

// Style inspector: the paragraph and character style at the cursor, the
// direct formatting on top of them, and buttons to clear each level.
import type { Editor } from "@tiptap/core";
import type { DocStyle } from "@/lib/docs/model";

const PARA_LABELS: Record<string, string> = {
  textAlign: "Alignment",
  spaceBefore: "Space before (pt)",
  spaceAfter: "Space after (pt)",
  lineHeight: "Line spacing",
  indLeft: "Indent left (pt)",
  indRight: "Indent right (pt)",
  indFirst: "First line / hanging (pt)",
  keepNext: "Keep with next",
  keepLines: "Keep lines together",
  widowControl: "Widow/orphan control",
  pageBreakBefore: "Page break before",
  borders: "Borders",
  shading: "Shading",
  tabs: "Tab stops",
  dropCap: "Drop cap",
};
export const PARA_DIRECT = Object.keys(PARA_LABELS);

function show(k: string, v: unknown): string {
  if (k === "borders" && v && typeof v === "object") return Object.keys(v).join(", ");
  if (k === "tabs" && Array.isArray(v)) return v.map((t: { pos: number; align: string }) => `${t.pos}pt ${t.align}`).join(", ");
  if (k === "widowControl") return v === false ? "off" : "on";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export function StyleInspector({ editor, styles, onClose, editable }: { editor: Editor; styles: DocStyle[]; onClose: () => void; editable: boolean }) {
  const $f = editor.state.selection.$from;
  const p = $f.parent;
  const styleId = p.type.name === "heading" ? `Heading${p.attrs.level}` : (p.attrs.styleId as string) || "Normal";
  const pStyle = styles.find((s) => s.id === styleId);
  const marks = editor.state.storedMarks || $f.marks();
  const ts = marks.find((m) => m.type.name === "textStyle")?.attrs || {};
  const cStyle = ts.charStyle ? styles.find((s) => s.id === ts.charStyle) : null;
  const paraDirect = PARA_DIRECT.filter((k) => p.attrs[k] !== null && p.attrs[k] !== undefined && p.attrs[k] !== 0);
  const runDirect: string[] = [];
  for (const m of marks) {
    const n = m.type.name;
    if (n === "textStyle") {
      if (m.attrs.fontFamily) runDirect.push(`Font: ${String(m.attrs.fontFamily).split(",")[0].replace(/"/g, "")}`);
      if (m.attrs.fontSize) runDirect.push(`Size: ${m.attrs.fontSize}`);
      if (m.attrs.color) runDirect.push(`Colour: ${m.attrs.color}`);
      if (m.attrs.caps) runDirect.push("All caps");
      if (m.attrs.smallCaps) runDirect.push("Small caps");
      if (m.attrs.charSpacing) runDirect.push(`Spacing: ${m.attrs.charSpacing}pt`);
    } else if (!["link", "comment", "insertion", "deletion"].includes(n)) runDirect.push(n === "highlight" ? `Highlight: ${m.attrs.color}` : n[0].toUpperCase() + n.slice(1));
  }
  const sec = "px-4 py-3 border-b border-slate-100";
  const h = "text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1";
  const clearBtn = "mt-2 text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40";
  return (
    <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print" data-testid="style-inspector">
      <div className="flex items-center justify-between px-4 h-11 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">Style inspector</div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>
      <div className={sec}>
        <div className={h}>Paragraph style</div>
        <div className="text-sm text-slate-800" data-testid="inspector-pstyle">{pStyle?.name || styleId}</div>
        <button className={clearBtn} disabled={!editable || styleId === "Normal"} onClick={() => editor.chain().focus().setParagraphStyle("Normal").run()}>Reset to Normal</button>
      </div>
      <div className={sec}>
        <div className={h}>Paragraph direct formatting</div>
        {paraDirect.length ? (
          <ul className="text-xs text-slate-700 space-y-0.5" data-testid="inspector-pdirect">
            {paraDirect.map((k) => (
              <li key={k}>
                {PARA_LABELS[k]}: <span className="text-slate-500">{show(k, p.attrs[k])}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-slate-400">None</div>
        )}
        <button className={clearBtn} disabled={!editable || !paraDirect.length} data-testid="inspector-clear-para" onClick={() => editor.chain().focus().setParaFormat(Object.fromEntries(PARA_DIRECT.map((k) => [k, null]))).run()}>
          Clear paragraph formatting
        </button>
      </div>
      <div className={sec}>
        <div className={h}>Character style</div>
        <div className="text-sm text-slate-800">{cStyle?.name || "Default paragraph font"}</div>
        <button className={clearBtn} disabled={!editable || !cStyle} onClick={() => editor.chain().focus().setCharStyle(null).run()}>Clear character style</button>
      </div>
      <div className={sec}>
        <div className={h}>Character direct formatting</div>
        {runDirect.length ? (
          <ul className="text-xs text-slate-700 space-y-0.5" data-testid="inspector-rdirect">
            {runDirect.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-slate-400">None</div>
        )}
        <button
          className={clearBtn}
          disabled={!editable || !runDirect.length}
          data-testid="inspector-clear-run"
          onClick={() => {
            const keep = ts.charStyle;
            const ch = editor.chain().focus();
            for (const m of ["bold", "italic", "underline", "strike", "superscript", "subscript", "highlight", "textStyle", "code"]) if (editor.schema.marks[m]) ch.unsetMark(m);
            ch.run();
            if (keep) editor.chain().setCharStyle(String(keep)).run();
          }}
        >
          Clear character formatting
        </button>
      </div>
    </aside>
  );
}
