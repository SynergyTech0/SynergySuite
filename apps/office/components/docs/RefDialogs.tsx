"use client";

// Dialogs for the References tab: editing a footnote or endnote, bookmarks,
// captions and cross-references.
import { useMemo, useRef, useState } from "react";
import { MATH_PRESETS, MATH_SNIPPETS, latexToMathml } from "@/lib/slides/math";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import type { PMNode } from "@/lib/docs/model";
import { Modal, btnCls, inputCls, Field } from "./WordDialogs";
import { CAPTION_LABELS, type FieldIndex, type RefShow } from "@/lib/docs/fields";
import type { NoteKind } from "./notes";

export function NoteDialog({ kind, label, content, extensions, onSave, onDelete, onClose }: { kind: NoteKind; label: string; content: PMNode; extensions: Extensions; onSave: (doc: PMNode) => void; onDelete: () => void; onClose: () => void }) {
  const editor = useEditor({ extensions, content: content as never, immediatelyRender: false, autofocus: "end" }, []);
  const tb = "h-7 min-w-7 px-1.5 rounded text-xs text-slate-600 hover:bg-slate-100";
  return (
    <Modal
      title={`${kind === "endnote" ? "Endnote" : "Footnote"} ${label}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onDelete} className={`${btnCls} text-rose-600 hover:bg-rose-50 mr-auto`}>Delete note</button>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={() => editor && onSave(editor.getJSON() as PMNode)} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="note-save">Save</button>
        </>
      }
    >
      {editor && (
        <div className="flex items-center gap-0.5 mb-1 border-b border-slate-100 pb-1">
          <button className={tb} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={tb} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={tb} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <button
            className={tb}
            onClick={() => {
              const u = window.prompt("Link URL", "https://");
              if (u) editor.chain().focus().setLink({ href: u }).run();
            }}
          >
            Link
          </button>
        </div>
      )}
      <div className="word-doc border rounded-md min-h-[90px] px-3 py-2 border-slate-300" data-testid="note-editor">
        <EditorContent editor={editor} />
      </div>
    </Modal>
  );
}

/** A bookmark name Word accepts: a letter first, then letters, digits and underscores (40 at most). */
export function cleanBookmark(s: string): string {
  const t = s.trim().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
  return (/^\p{L}/u.test(t) ? t : `B${t}`).slice(0, 40);
}

export function BookmarkDialog({ names, onAdd, onGo, onDelete, onClose }: { names: string[]; onAdd: (name: string) => void; onGo: (name: string) => void; onDelete: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const clean = name ? cleanBookmark(name) : "";
  return (
    <Modal
      title="Bookmark"
      onClose={onClose}
      footer={
        <>
          <button disabled={!sel} onClick={() => sel && onDelete(sel)} className={`${btnCls} text-rose-600 hover:bg-rose-50 disabled:opacity-40 mr-auto`}>Delete</button>
          <button disabled={!sel} onClick={() => sel && onGo(sel)} className={`${btnCls} text-slate-700 hover:bg-slate-100 disabled:opacity-40`}>Go to</button>
          <button disabled={!clean || names.includes(clean)} onClick={() => onAdd(clean)} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} data-testid="bookmark-add">Add</button>
        </>
      }
    >
      <input autoFocus aria-label="Bookmark name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bookmark name" className="h-8 border border-slate-300 rounded-md px-2 text-sm w-full" />
      {name && clean !== name && <p className="text-[11px] text-slate-400 mt-1">Saved as “{clean}”.</p>}
      <div className="mt-3 border border-slate-200 rounded-md max-h-56 overflow-y-auto">
        {names.length === 0 && <p className="text-xs text-slate-400 p-3">No bookmarks yet.</p>}
        {names.map((n) => (
          <button key={n} onClick={() => setSel(n)} onDoubleClick={() => onGo(n)} className={`block w-full text-left px-3 py-1.5 text-sm ${sel === n ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}>
            {n}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export type CaptionSpec = { label: string; text: string; sep: string; below: boolean };

/** Insert caption: "Figure 3: text", numbered with a SEQ field, above or below the current item. */
export function CaptionDialog({ next, defaultLabel, onInsert, onClose }: { next: (label: string) => number; defaultLabel: string; onInsert: (c: CaptionSpec) => void; onClose: () => void }) {
  const [label, setLabel] = useState(defaultLabel);
  const [text, setText] = useState("");
  const [sep, setSep] = useState(": ");
  const [below, setBelow] = useState(defaultLabel !== "Table");
  const insert = () => onInsert({ label, text, sep, below });
  return (
    <Modal
      title="Caption"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={insert} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="caption-insert">Insert</button>
        </>
      }
    >
      <div className="text-sm mb-3 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 italic text-slate-700" data-testid="caption-preview">
        {label} {next(label)}
        {text ? `${sep}${text}` : ""}
      </div>
      <div className="grid gap-3">
        <Field label="Caption text">
          <input autoFocus className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && insert()} data-testid="caption-text" placeholder="Describe the item" />
        </Field>
        <Field label="Label">
          <select className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="caption-label">
            {CAPTION_LABELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Separator">
          <select className={inputCls} value={sep} onChange={(e) => setSep(e.target.value)}>
            <option value=": ">Colon (Figure 1: text)</option>
            <option value=". ">Period (Figure 1. text)</option>
            <option value=" – ">En dash (Figure 1 – text)</option>
            <option value=" ">None (Figure 1 text)</option>
          </select>
        </Field>
        <Field label="Position">
          <select className={inputCls} value={below ? "below" : "above"} onChange={(e) => setBelow(e.target.value === "below")} data-testid="caption-position">
            <option value="below">Below selected item</option>
            <option value="above">Above selected item</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export type XrefTarget = { kind: "bookmark"; name: string } | { kind: "heading"; pos: number } | { kind: "caption"; pos: number; whole: boolean };
type XrefType = "Heading" | "Bookmark" | (typeof CAPTION_LABELS)[number];

/** Cross-reference: pick a heading, bookmark or caption and what to show. */
export function CrossRefDialog({ index, headings, onInsert, onClose }: { index: FieldIndex; headings: { level: number; text: string; pos: number }[]; onInsert: (t: XrefTarget, show: RefShow) => void; onClose: () => void }) {
  const [type, setType] = useState<XrefType>("Heading");
  const [sel, setSel] = useState(0);
  const [show, setShow] = useState<string>("text");
  const isCaption = type !== "Heading" && type !== "Bookmark";
  const items: { label: string; target: () => XrefTarget }[] =
    type === "Heading"
      ? headings.map((h) => ({ label: `${"\u2003".repeat(h.level - 1)}${h.text || "(empty heading)"}`, target: () => ({ kind: "heading", pos: h.pos }) }))
      : type === "Bookmark"
        ? [...index.bookmarks.values()].filter((b) => !b.name.startsWith("_")).map((b) => ({ label: b.name, target: () => ({ kind: "bookmark", name: b.name }) }))
        : index.captions.filter((c) => c.label === type).map((c) => ({ label: c.text, target: () => ({ kind: "caption", pos: c.pos, whole: show === "whole" }) }));
  const shows: [string, string][] =
    type === "Heading"
      ? [["text", "Heading text"], ["page", "Page number"], ["above", "Above/below"]]
      : type === "Bookmark"
        ? [["text", "Bookmark text"], ["page", "Page number"], ["above", "Above/below"]]
        : [["whole", "Entire caption"], ["text", "Only label and number"], ["number", "Only number"], ["page", "Page number"], ["above", "Above/below"]];
  const insert = () => {
    const it = items[sel];
    if (!it) return;
    onInsert(it.target(), (show === "whole" ? "text" : show) as RefShow);
  };
  return (
    <Modal
      title="Cross-reference"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Close</button>
          <button disabled={!items[sel]} onClick={insert} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} data-testid="xref-insert">Insert</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reference type">
          <select
            className={inputCls}
            value={type}
            data-testid="xref-type"
            onChange={(e) => {
              const t = e.target.value as XrefType;
              setType(t);
              setSel(0);
              setShow(t === "Heading" || t === "Bookmark" ? "text" : "text");
            }}
          >
            <option>Heading</option>
            <option>Bookmark</option>
            {CAPTION_LABELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Insert reference to">
          <select className={inputCls} value={show} onChange={(e) => setShow(e.target.value)} data-testid="xref-show">
            {shows.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 text-xs text-slate-500">For which {isCaption ? `${type.toLowerCase()} caption` : type.toLowerCase()}:</div>
      <div className="mt-1 border border-slate-200 rounded-md max-h-56 overflow-y-auto" role="listbox">
        {items.length === 0 && <p className="text-xs text-slate-400 p-3">Nothing to refer to yet.</p>}
        {items.map((it, i) => (
          <button key={i} role="option" aria-selected={sel === i} data-testid="xref-item" onClick={() => setSel(i)} onDoubleClick={insert} className={`block w-full text-left px-3 py-1.5 text-sm whitespace-pre truncate ${sel === i ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}>
            {it.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Write or edit an equation in LaTeX, with quick inserts and a live preview. */
export function EquationDialog({ value, onApply, onClose }: { value: { latex: string; display: boolean }; onApply: (v: { latex: string; display: boolean }) => void; onClose: () => void }) {
  const [latex, setLatex] = useState(value.latex);
  const [display, setDisplay] = useState(value.display);
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (s: string) => {
    const el = ta.current;
    const a = el?.selectionStart ?? latex.length;
    const b = el?.selectionEnd ?? latex.length;
    setLatex(latex.slice(0, a) + s + latex.slice(b));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + s.length, a + s.length);
    });
  };
  const preview = useMemo(() => {
    try {
      return latex.trim() ? latexToMathml(latex, display) : "";
    } catch {
      return "";
    }
  }, [latex, display]);
  return (
    <Modal
      title="Equation"
      onClose={onClose}
      wide
      footer={
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600 mr-auto">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} data-testid="eq-display" />
            Display (on its own line)
          </label>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button disabled={!latex.trim()} onClick={() => onApply({ latex: latex.trim(), display })} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40`} data-testid="eq-apply">{value.latex ? "Update" : "Insert"}</button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1 mb-2">
        {MATH_SNIPPETS.map((s) => (
          <button key={s.label} type="button" title={s.latex} className="h-8 min-w-8 px-2 rounded border border-slate-200 hover:bg-slate-50 text-sm" onClick={() => insert(s.latex)}>{s.label}</button>
        ))}
        <select className="h-8 rounded border border-slate-200 px-1 text-sm" value="" onChange={(e) => e.target.value && setLatex(e.target.value)} data-testid="eq-preset">
          <option value="">Common equations…</option>
          {MATH_PRESETS.map((p) => (
            <option key={p.label} value={p.latex}>{p.label}</option>
          ))}
        </select>
      </div>
      <textarea ref={ta} autoFocus data-testid="eq-latex" className={`${inputCls} h-20 py-1 font-mono`} value={latex} onChange={(e) => setLatex(e.target.value)} placeholder="x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}" />
      <div className="mt-2 min-h-20 rounded border border-slate-200 bg-slate-50 flex items-center justify-center p-3 overflow-x-auto" data-testid="eq-preview" style={{ fontSize: "16pt", fontFamily: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', math, serif" }}>
        {preview ? <div dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="text-sm text-slate-400">Preview</span>}
      </div>
    </Modal>
  );
}
