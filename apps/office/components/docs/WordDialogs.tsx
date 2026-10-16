"use client";

// Word-style dialogs and panes for the document editor: Page Setup, Headers
// and Footers, the Styles pane, the style gallery and Modify/New Style.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import {
  type DocSettings,
  type DocStyle,
  type PMNode,
  type ParaProps,
  type RunProps,
  type Section,
  MARGIN_PRESETS,
  PAGE_SIZES,
  cleanStyleId,
  cssFont,
  cssLineHeight,
  resolveStyle,
} from "@/lib/docs/model";
import { headerFooterFor, type HFKind, type HFType } from "./PrintLayer";

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/30 grid place-items-center no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className={`bg-white rounded-xl shadow-2xl ${wide ? "w-[760px]" : "w-[520px]"} max-w-[95vw] max-h-[92vh] flex flex-col`}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
        </div>
        <div className="p-5 overflow-y-auto text-sm text-slate-700">{children}</div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

export const inputCls = "h-8 border border-slate-300 rounded-md px-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-300";
export const btnCls = "h-8 px-3 rounded-md text-sm";
export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs text-slate-500">
    {label}
    {children}
  </label>
);
const inch = (pt: number) => String(Math.round((pt / 72) * 100) / 100);
const fromInch = (s: string, f: number) => {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 72 * 100) / 100 : f;
};

// ---- Page Setup ----
export function PageSetupDialog({
  section,
  isLast,
  onApply,
  onClose,
}: {
  section: Section;
  isLast: boolean;
  onApply: (s: Section, scope: "section" | "all") => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<Section>(() => JSON.parse(JSON.stringify(section)));
  const [scope, setScope] = useState<"section" | "all">("section");
  const sizeId = PAGE_SIZES.find((p) => (Math.abs(p.w - s.pageWidth) < 2 && Math.abs(p.h - s.pageHeight) < 2) || (Math.abs(p.h - s.pageWidth) < 2 && Math.abs(p.w - s.pageHeight) < 2))?.id || "custom";
  const setSize = (id: string) => {
    const p = PAGE_SIZES.find((x) => x.id === id);
    if (!p) return;
    const land = s.orientation === "landscape";
    setS({ ...s, pageWidth: land ? p.h : p.w, pageHeight: land ? p.w : p.h });
  };
  const setOrient = (o: "portrait" | "landscape") => {
    if (o === s.orientation) return;
    setS({ ...s, orientation: o, pageWidth: s.pageHeight, pageHeight: s.pageWidth, margins: { ...s.margins, top: s.margins.left, bottom: s.margins.right, left: s.margins.bottom, right: s.margins.top } });
  };
  const m = s.margins;
  const setM = (k: keyof Section["margins"], v: string) => setS({ ...s, margins: { ...m, [k]: fromInch(v, m[k] || 0) } });
  const cols = s.columns?.count || 1;
  return (
    <Modal
      title="Page setup"
      onClose={onClose}
      footer={
        <>
          <select aria-label="Apply to" value={scope} onChange={(e) => setScope(e.target.value as "section" | "all")} className="h-8 border border-slate-300 rounded-md px-2 mr-auto">
            <option value="section">Apply to: this section</option>
            <option value="all">Apply to: whole document</option>
          </select>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={() => onApply(s, scope)} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`}>OK</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paper size">
          <select aria-label="Paper size" className={inputCls} value={sizeId} onChange={(e) => setSize(e.target.value)}>
            {PAGE_SIZES.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Orientation">
          <div className="flex gap-2">
            {(["portrait", "landscape"] as const).map((o) => (
              <button key={o} onClick={() => setOrient(o)} className={`${btnCls} flex-1 border ${s.orientation === o ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300"}`}>
                {o === "portrait" ? "Portrait" : "Landscape"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Width (in)">
          <input aria-label="Page width" className={inputCls} value={inch(s.pageWidth)} onChange={(e) => setS({ ...s, pageWidth: Math.max(72, fromInch(e.target.value, s.pageWidth)) })} />
        </Field>
        <Field label="Height (in)">
          <input aria-label="Page height" className={inputCls} value={inch(s.pageHeight)} onChange={(e) => setS({ ...s, pageHeight: Math.max(72, fromInch(e.target.value, s.pageHeight)) })} />
        </Field>
      </div>
      <div className="mt-4 mb-1 text-xs font-semibold text-slate-600">Margins (in)</div>
      <div className="flex flex-wrap gap-1 mb-2">
        {MARGIN_PRESETS.map((p) => (
          <button key={p.id} onClick={() => setS({ ...s, margins: { ...m, top: p.m[0], right: p.m[1], bottom: p.m[2], left: p.m[3] } })} className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-50">
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(["top", "bottom", "left", "right", "header", "footer", "gutter"] as const).map((k) => (
          <Field key={k} label={k === "header" ? "Header from top" : k === "footer" ? "Footer from bottom" : k === "gutter" ? "Gutter (inside)" : k[0].toUpperCase() + k.slice(1)}>
            <input aria-label={`Margin ${k}`} className={inputCls} defaultValue={inch(m[k] || 0)} onBlur={(e) => setM(k, e.target.value)} />
          </Field>
        ))}
      </div>
      <div className="mt-4 mb-1 text-xs font-semibold text-slate-600">Columns</div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <Field label="Number of columns">
          <select aria-label="Columns" className={inputCls} value={cols} onChange={(e) => {
            const n = Number(e.target.value);
            setS({ ...s, columns: n > 1 ? { count: n, space: s.columns?.space ?? 36, separator: s.columns?.separator } : undefined });
          }}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Spacing (in)">
          <input aria-label="Column spacing" className={inputCls} disabled={cols < 2} defaultValue={inch(s.columns?.space ?? 36)} onBlur={(e) => s.columns && setS({ ...s, columns: { ...s.columns, space: fromInch(e.target.value, s.columns.space) } })} />
        </Field>
        <label className="flex items-center gap-2 text-xs text-slate-600 h-8">
          <input type="checkbox" disabled={cols < 2} checked={!!s.columns?.separator} onChange={(e) => s.columns && setS({ ...s, columns: { ...s.columns, separator: e.target.checked } })} />
          Line between
        </label>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field label="Vertical alignment">
          <select aria-label="Vertical alignment" className={inputCls} value={s.vAlign || "top"} onChange={(e) => setS({ ...s, vAlign: e.target.value === "top" ? undefined : (e.target.value as Section["vAlign"]) })}>
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
            <option value="both">Justified</option>
          </select>
        </Field>
        <Field label="Section start">
          <select aria-label="Section start" className={inputCls} value={s.type || "nextPage"} onChange={(e) => setS({ ...s, type: e.target.value as Section["type"] })}>
            <option value="nextPage">New page</option>
            <option value="continuous">Continuous</option>
            <option value="evenPage">Even page</option>
            <option value="oddPage">Odd page</option>
          </select>
        </Field>
        <Field label="Page numbers start at">
          <input aria-label="Page number start" className={inputCls} placeholder="Continue" defaultValue={s.pageNumberStart ?? ""} onBlur={(e) => setS({ ...s, pageNumberStart: e.target.value.trim() ? Math.max(0, Math.round(Number(e.target.value)) || 1) : undefined })} />
        </Field>
        <Field label="Number format">
          <select aria-label="Number format" className={inputCls} value={s.pageNumberFormat || "decimal"} onChange={(e) => setS({ ...s, pageNumberFormat: e.target.value as Section["pageNumberFormat"] })}>
            <option value="decimal">1, 2, 3</option>
            <option value="lowerRoman">i, ii, iii</option>
            <option value="upperRoman">I, II, III</option>
            <option value="lowerLetter">a, b, c</option>
            <option value="upperLetter">A, B, C</option>
          </select>
        </Field>
      </div>
      {!isLast && <p className="mt-3 text-[11px] text-slate-400">This document has several sections; the cursor is in one of the earlier ones.</p>}
    </Modal>
  );
}

// ---- Headers and footers ----
const EMPTY_DOC: PMNode = { type: "doc", content: [{ type: "paragraph" }] };

export function HeaderFooterDialog({
  sections,
  index,
  settings,
  initialKind,
  initialType,
  extensions,
  uploadImage,
  onSave,
  onClose,
}: {
  sections: Section[];
  index: number;
  settings: DocSettings;
  initialKind: HFKind;
  initialType: HFType;
  extensions: Extensions;
  /** store a picture with the document; its address, or null when it could not be stored */
  uploadImage?: (file: File) => Promise<string | null>;
  onSave: (section: Section, settings: DocSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Section>(() => JSON.parse(JSON.stringify(sections[index])));
  const [even, setEven] = useState(!!settings.evenAndOddHeaders);
  const [kind, setKind] = useState<HFKind>(initialKind);
  const [type, setType] = useState<HFType>(initialType);
  const all = useMemo(() => sections.map((s, i) => (i === index ? draft : s)), [sections, index, draft]);
  const own = draft[kind]?.[type];
  const linked = !own && index > 0;
  const shown = own || headerFooterFor(all, index, kind, type).doc || EMPTY_DOC;
  const editor = useEditor({ extensions, content: shown as never, immediatelyRender: false, editable: !linked }, []);
  const keyOf = `${kind}:${type}`;
  // switch the mini editor to the chosen header/footer
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(shown as never);
    editor.setEditable(!linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, keyOf, linked]);
  const store = (k: HFKind, t: HFType, doc: PMNode | undefined) => setDraft((d) => ({ ...d, [k]: { ...(d[k] || {}), [t]: doc } }));
  const capture = () => {
    if (editor && !linked) store(kind, type, editor.getJSON() as PMNode);
  };
  const choose = (k: HFKind, t: HFType) => {
    capture();
    setKind(k);
    setType(t);
  };
  const setLinked = (on: boolean) => {
    if (on) {
      setDraft((d) => {
        const set = { ...(d[kind] || {}) };
        delete set[type];
        return { ...d, [kind]: Object.keys(set).length ? set : undefined };
      });
    } else store(kind, type, JSON.parse(JSON.stringify(headerFooterFor(all, index - 1, kind, type).doc || EMPTY_DOC)));
  };
  const save = () => {
    let out = draft;
    if (editor && !linked) out = { ...draft, [kind]: { ...(draft[kind] || {}), [type]: editor.getJSON() as PMNode } };
    onSave(out, { ...settings, evenAndOddHeaders: even || undefined });
  };
  const types: HFType[] = ["default", ...(draft.titlePage ? (["first"] as const) : []), ...(even ? (["even"] as const) : [])];
  const tb = "h-7 min-w-7 px-1.5 rounded text-xs text-slate-600 hover:bg-slate-100";
  return (
    <Modal
      title="Headers and footers"
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={save} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`}>Save</button>
        </>
      }
    >
      <div className="flex items-center gap-4 mb-3">
        <div className="flex rounded-md border border-slate-300 overflow-hidden">
          {(["headers", "footers"] as const).map((k) => (
            <button key={k} onClick={() => choose(k, types.includes(type) ? type : "default")} className={`px-3 h-8 text-sm ${kind === k ? "bg-indigo-600 text-white" : "hover:bg-slate-50"}`}>
              {k === "headers" ? "Header" : "Footer"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={!!draft.titlePage} onChange={(e) => { capture(); setDraft((d) => ({ ...d, titlePage: e.target.checked || undefined })); if (!e.target.checked && type === "first") setType("default"); }} />
          Different first page
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={even} onChange={(e) => { capture(); setEven(e.target.checked); if (!e.target.checked && type === "even") setType("default"); }} />
          Different odd &amp; even pages
        </label>
        {index > 0 && (
          <label className="flex items-center gap-1.5 text-xs ml-auto">
            <input type="checkbox" checked={linked} onChange={(e) => { capture(); setLinked(e.target.checked); }} />
            Link to previous
          </label>
        )}
      </div>
      <div className="flex gap-1 mb-2">
        {types.map((t) => (
          <button key={t} onClick={() => choose(kind, t)} className={`text-xs rounded-full px-3 py-1 border ${type === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300"}`}>
            {t === "default" ? (even ? "Odd pages" : "All pages") : t === "first" ? "First page" : "Even pages"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400 self-center">Section {index + 1} of {sections.length}</span>
      </div>
      {editor && (
        <div className="flex items-center gap-0.5 mb-1 border-b border-slate-100 pb-1">
          <button className={tb} disabled={linked} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={tb} disabled={linked} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={tb} disabled={linked} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={tb} disabled={linked} onClick={() => editor.chain().focus().setTextAlign(a).run()}>{a === "left" ? "Left" : a === "center" ? "Center" : "Right"}</button>
          ))}
          <span className="w-px h-4 bg-slate-200 mx-1" />
          <button className={tb} disabled={linked} data-testid="hf-page-number" onClick={() => editor.chain().focus().insertContent({ type: "pageField", attrs: { kind: "page" } }).run()}>Page number</button>
          <button className={tb} disabled={linked} onClick={() => editor.chain().focus().insertContent({ type: "pageField", attrs: { kind: "pages" } }).run()}>Number of pages</button>
          <span className="w-px h-4 bg-slate-200 mx-1" />
          {uploadImage && (
            <label className={`${tb} cursor-pointer ${linked ? "opacity-50 pointer-events-none" : ""}`} data-testid="hf-picture">
              Picture
              <input
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="hf-picture-input"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const src = await uploadImage(f);
                  if (!src) return;
                  const size = await new Promise<{ w: number; h: number } | null>((res) => {
                    const im = new Image();
                    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
                    im.onerror = () => res(null);
                    im.src = src;
                  });
                  // a logo-sized picture: at most an inch high
                  const scale = size ? Math.min(1, 96 / size.h, 600 / size.w) : 1;
                  editor.chain().focus().insertContent({ type: "image", attrs: { src, ...(size ? { width: Math.round(size.w * scale), height: Math.round(size.h * scale) } : {}) } }).run();
                }}
              />
            </label>
          )}
          <button className={tb} disabled={linked} data-testid="hf-table" onClick={() => editor.chain().focus().insertTable({ rows: 1, cols: 3, withHeaderRow: false }).run()}>
            Table
          </button>
        </div>
      )}
      <div className={`word-doc border rounded-md min-h-[90px] px-3 py-2 ${linked ? "bg-slate-50 border-slate-200 text-slate-400" : "border-slate-300"}`} data-testid="hf-editor">
        <EditorContent editor={editor} />
      </div>
      {linked && <p className="mt-2 text-[11px] text-slate-400">Same as the previous section. Untick “Link to previous” to give this section its own.</p>}
    </Modal>
  );
}

// ---- Styles ----
export function styleSample(styles: DocStyle[], s: DocStyle): React.CSSProperties {
  const r = resolveStyle(styles, s.id).run;
  return {
    fontFamily: r.font ? cssFont(r.font) : undefined,
    fontSize: r.size ? `${Math.min(16, Math.max(10, r.size))}pt` : undefined,
    color: r.color,
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? "italic" : undefined,
    textDecoration: r.underline ? "underline" : undefined,
  };
}

/** Styles shown in the gallery: quick styles, plus any in use. */
export function galleryStyles(styles: DocStyle[]): DocStyle[] {
  const order = ["Normal", "NoSpacing", "Heading1", "Heading2", "Heading3", "Title", "Subtitle", "SubtleEmphasis", "Emphasis", "IntenseEmphasis", "Strong", "Quote"];
  return styles
    .filter((s) => s.gallery && !s.hidden)
    .sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
}

export function StyleGallery({ styles, current, onApply, onMore, onUpdate, onModify }: { styles: DocStyle[]; current: string; onApply: (s: DocStyle) => void; onMore: () => void; onUpdate?: (s: DocStyle) => void; onModify?: (s: DocStyle) => void }) {
  const [ctx, setCtx] = useState<{ s: DocStyle; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const off = () => setCtx(null);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [ctx]);
  return (
    <div className="flex items-stretch gap-0.5 border border-slate-200 rounded-md px-0.5 h-8 shrink-0" data-testid="style-gallery">
      {ctx && (onUpdate || onModify) && (
        <div className="fixed z-50 min-w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()} data-testid="gallery-menu">
          {onUpdate && (
            <button className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" data-testid="gallery-update" onClick={() => (onUpdate(ctx.s), setCtx(null))}>
              Update {ctx.s.name} to match selection
            </button>
          )}
          {onModify && (
            <button className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => (onModify(ctx.s), setCtx(null))}>
              Modify…
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-0.5 overflow-x-auto max-w-[360px]">
        {galleryStyles(styles).map((s) => (
          <button
            key={s.id}
            title={s.name}
            data-style-id={s.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onApply(s)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ s, x: e.clientX, y: e.clientY + 4 });
            }}
            className={`h-7 px-2 rounded text-[12px] whitespace-nowrap leading-none ${current === s.id ? "bg-indigo-100 ring-1 ring-indigo-300" : "hover:bg-slate-100"}`}
            style={{ ...styleSample(styles, s), fontSize: 12 }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <button onClick={onMore} title="Styles pane" className="px-1 text-slate-500 hover:bg-slate-100 rounded text-xs">▾</button>
    </div>
  );
}

export function StylesPane({
  styles,
  current,
  currentChar,
  inUse,
  canEdit,
  onApply,
  onModify,
  onNew,
  onUpdate,
  onClose,
}: {
  styles: DocStyle[];
  current: string;
  currentChar: string | null;
  inUse: Set<string>;
  canEdit: boolean;
  onApply: (s: DocStyle) => void;
  onModify: (s: DocStyle) => void;
  onNew: () => void;
  onUpdate: (s: DocStyle) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const list = styles.filter((s) => !s.hidden && (all || s.gallery || inUse.has(s.id) || !s.builtin));
  return (
    <aside className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto no-print" data-testid="styles-pane">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center">
        <h2 className="text-sm font-semibold text-slate-800">Styles</h2>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 text-sm">✕</button>
      </div>
      <div className="py-1">
        {list.map((s) => {
          const active = s.type === "character" ? currentChar === s.id : current === s.id;
          return (
            <div key={s.id} className={`group flex items-center px-3 py-1.5 ${active ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
              <button onClick={() => onApply(s)} className="flex-1 text-left truncate" style={{ ...styleSample(styles, s), fontSize: Math.min(15, Math.max(11, (resolveStyle(styles, s.id).run.size || 11) * 1.1)) }} title={`Apply ${s.name}`} data-pane-style={s.id}>
                {s.name}
              </button>
              <span className="text-[10px] text-slate-400 mr-1">{s.type === "character" ? "a" : "¶"}</span>
              {canEdit && (
                <span className="hidden group-hover:flex gap-1">
                  <button onClick={() => onUpdate(s)} title="Update to match selection" className="text-[11px] text-slate-500 hover:text-indigo-700">⟳</button>
                  <button onClick={() => onModify(s)} title="Modify…" className="text-[11px] text-slate-500 hover:text-indigo-700" data-modify-style={s.id}>✎</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-100 p-3 flex items-center gap-2">
        {canEdit && <button onClick={onNew} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2.5 py-1" data-testid="new-style">New style…</button>}
        <label className="ml-auto text-[11px] text-slate-500 flex items-center gap-1">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all
        </label>
      </div>
    </aside>
  );
}

export const FONT_CHOICES = ["Calibri", "Calibri Light", "Cambria", "Arial", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Courier New", "Consolas", "Aptos"];

export function StyleDialog({
  styles,
  style,
  initial,
  onSave,
  onClose,
}: {
  styles: DocStyle[];
  /** the style being modified; absent for a new style */
  style?: DocStyle;
  /** a new style's starting formatting (from the selection) */
  initial?: { type: "paragraph" | "character"; run: RunProps; para: ParaProps; basedOn?: string };
  onSave: (s: DocStyle) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<DocStyle>(() =>
    style
      ? JSON.parse(JSON.stringify(style))
      : { id: "", name: "", type: initial?.type || "paragraph", basedOn: initial?.basedOn || (initial?.type === "character" ? undefined : "Normal"), next: "Normal", gallery: true, run: { ...(initial?.run || {}) }, para: { ...(initial?.para || {}) } },
  );
  const eff = resolveStyle([...styles.filter((x) => x.id !== s.id), { ...s, id: s.id || "__new" }], s.id || "__new");
  const run = s.run;
  const para = s.para || {};
  const setRun = (r: Partial<RunProps>) => setS({ ...s, run: { ...run, ...r } });
  const setPara = (p: Partial<ParaProps>) => setS({ ...s, para: { ...para, ...p } });
  const numOr = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const toggle = (k: "bold" | "italic" | "underline") => setRun({ [k]: !eff.run[k] });
  const nameTaken = !style && styles.some((x) => x.name.toLowerCase() === s.name.trim().toLowerCase());
  const save = () => {
    const name = s.name.trim();
    if (!name || nameTaken) return;
    let id = s.id;
    if (!style) {
      id = cleanStyleId(name);
      while (styles.some((x) => x.id === id)) id += "1";
    }
    onSave({ ...s, id, name });
  };
  const preview: React.CSSProperties = {
    fontFamily: eff.run.font ? cssFont(eff.run.font) : undefined,
    fontSize: eff.run.size ? `${eff.run.size}pt` : undefined,
    color: eff.run.color,
    fontWeight: eff.run.bold ? 700 : 400,
    fontStyle: eff.run.italic ? "italic" : "normal",
    textDecoration: eff.run.underline ? "underline" : "none",
    textAlign: eff.para.align,
    lineHeight: cssLineHeight(eff.para.lineHeight),
    paddingLeft: eff.para.indentLeft ? `${eff.para.indentLeft}pt` : undefined,
    textIndent: eff.para.indentFirst ? `${eff.para.indentFirst}pt` : undefined,
  };
  const paras = styles.filter((x) => x.type === "paragraph" && x.id !== s.id);
  return (
    <Modal
      title={style ? `Modify style: ${style.name}` : "Create new style"}
      onClose={onClose}
      footer={
        <>
          <label className="mr-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={!!s.gallery} onChange={(e) => setS({ ...s, gallery: e.target.checked })} /> Show in the style gallery
          </label>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={save} disabled={!s.name.trim() || nameTaken} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`} data-testid="style-save">OK</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input aria-label="Style name" className={inputCls} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} autoFocus={!style} />
        </Field>
        <Field label="Style type">
          <select aria-label="Style type" className={inputCls} value={s.type} disabled={!!style} onChange={(e) => setS({ ...s, type: e.target.value as DocStyle["type"], basedOn: e.target.value === "character" ? undefined : s.basedOn || "Normal" })}>
            <option value="paragraph">Paragraph</option>
            <option value="character">Character</option>
          </select>
        </Field>
        {s.type === "paragraph" && (
          <>
            <Field label="Based on">
              <select aria-label="Based on" className={inputCls} value={s.basedOn || ""} disabled={s.id === "Normal"} onChange={(e) => setS({ ...s, basedOn: e.target.value || undefined })}>
                <option value="">(no style)</option>
                {paras.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Style for following paragraph">
              <select aria-label="Next style" className={inputCls} value={s.next || ""} onChange={(e) => setS({ ...s, next: e.target.value || undefined })}>
                <option value="">(same style)</option>
                {styles.filter((x) => x.type === "paragraph").map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
      {nameTaken && <p className="text-[11px] text-red-500 mt-1">A style with that name already exists.</p>}
      <div className="mt-4 mb-1 text-xs font-semibold text-slate-600">Formatting</div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Style font" className="h-8 border border-slate-300 rounded-md px-2" value={run.font || ""} onChange={(e) => setRun({ font: e.target.value || undefined })}>
          <option value="">{eff.run.font && !run.font ? `(${eff.run.font})` : "(inherit)"}</option>
          {[...new Set([...FONT_CHOICES, ...(run.font ? [run.font] : [])])].map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <input aria-label="Style size" className="h-8 w-16 border border-slate-300 rounded-md px-2" placeholder={String(eff.run.size || "")} value={run.size ?? ""} onChange={(e) => setRun({ size: numOr(e.target.value) })} />
        <button className={`h-8 w-8 border rounded ${eff.run.bold ? "bg-indigo-100 border-indigo-300" : "border-slate-300"}`} onClick={() => toggle("bold")} aria-label="Style bold"><b>B</b></button>
        <button className={`h-8 w-8 border rounded ${eff.run.italic ? "bg-indigo-100 border-indigo-300" : "border-slate-300"}`} onClick={() => toggle("italic")} aria-label="Style italic"><i>I</i></button>
        <button className={`h-8 w-8 border rounded ${eff.run.underline ? "bg-indigo-100 border-indigo-300" : "border-slate-300"}`} onClick={() => toggle("underline")} aria-label="Style underline"><u>U</u></button>
        <input aria-label="Style color" type="color" className="h-8 w-10 border border-slate-300 rounded" value={eff.run.color || "#000000"} onChange={(e) => setRun({ color: e.target.value })} />
      </div>
      {s.type === "paragraph" && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Field label="Alignment">
            <select aria-label="Style alignment" className={inputCls} value={para.align || ""} onChange={(e) => setPara({ align: (e.target.value || undefined) as ParaProps["align"] })}>
              <option value="">(inherit)</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </Field>
          <Field label="Line spacing">
            <select aria-label="Style line spacing" className={inputCls} value={para.lineHeight || ""} onChange={(e) => setPara({ lineHeight: e.target.value || undefined })}>
              <option value="">(inherit)</option>
              {["1", "1.08", "1.15", "1.5", "2", "2.5", "3"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Space before (pt)">
            <input aria-label="Style space before" className={inputCls} placeholder={String(eff.para.spaceBefore ?? "")} value={para.spaceBefore ?? ""} onChange={(e) => setPara({ spaceBefore: numOr(e.target.value) })} />
          </Field>
          <Field label="Space after (pt)">
            <input aria-label="Style space after" className={inputCls} placeholder={String(eff.para.spaceAfter ?? "")} value={para.spaceAfter ?? ""} onChange={(e) => setPara({ spaceAfter: numOr(e.target.value) })} />
          </Field>
          <Field label="Indent left (pt)">
            <input aria-label="Style indent" className={inputCls} placeholder={String(eff.para.indentLeft ?? "")} value={para.indentLeft ?? ""} onChange={(e) => setPara({ indentLeft: numOr(e.target.value) })} />
          </Field>
          <Field label="First line (pt, − hanging)">
            <input aria-label="Style first line" className={inputCls} placeholder={String(eff.para.indentFirst ?? "")} value={para.indentFirst ?? ""} onChange={(e) => setPara({ indentFirst: numOr(e.target.value) })} />
          </Field>
        </div>
      )}
      <div className="mt-4 border border-slate-200 rounded-md p-3 bg-slate-50">
        <div style={preview}>The quick brown fox jumps over the lazy dog. {s.name || "New style"} preview text.</div>
      </div>
    </Modal>
  );
}

/** Formatting of the paragraph and run at the selection, as style props. */
export function selectionFormatting(editor: Editor): { run: RunProps; para: ParaProps } {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  const a = node.attrs as Record<string, unknown>;
  const para: ParaProps = {};
  if (a.textAlign && a.textAlign !== "left") para.align = a.textAlign as ParaProps["align"];
  for (const [k, p] of [["spaceBefore", "spaceBefore"], ["spaceAfter", "spaceAfter"], ["indLeft", "indentLeft"], ["indRight", "indentRight"], ["indFirst", "indentFirst"]] as const) if (typeof a[k] === "number") para[p] = a[k] as number;
  if (a.lineHeight) para.lineHeight = String(a.lineHeight);
  const run: RunProps = {};
  const marks = editor.state.storedMarks || $from.marks();
  for (const m of marks) {
    if (m.type.name === "bold") run.bold = true;
    if (m.type.name === "italic") run.italic = true;
    if (m.type.name === "underline") run.underline = true;
    if (m.type.name === "strike") run.strike = true;
    if (m.type.name === "textStyle") {
      const fam = m.attrs.fontFamily as string | null;
      if (fam) run.font = fam.split(",")[0].trim().replace(/^["']|["']$/g, "");
      const fs = m.attrs.fontSize as string | null;
      if (fs) run.size = fs.endsWith("px") ? Math.round(parseFloat(fs) * 0.75 * 2) / 2 : parseFloat(fs);
      if (m.attrs.color) run.color = m.attrs.color as string;
    }
  }
  return { run, para };
}

/** Word's Paragraph dialog: alignment, indents and spacing as direct formatting. */
export function ParagraphDialog({ node, onApply, onClose }: { node: { attrs: Record<string, unknown> }; onApply: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const a = node.attrs;
  const n = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const [align, setAlign] = useState(String(a.textAlign || "left"));
  const [left, setLeft] = useState(n(a.indLeft));
  const [right, setRight] = useState(n(a.indRight));
  const first0 = typeof a.indFirst === "number" ? (a.indFirst as number) : 0;
  const [special, setSpecial] = useState(first0 > 0 ? "first" : first0 < 0 ? "hanging" : "none");
  const [by, setBy] = useState(first0 ? String(Math.abs(first0)) : "");
  const [before, setBefore] = useState(n(a.spaceBefore));
  const [after, setAfter] = useState(n(a.spaceAfter));
  const [line, setLine] = useState(String(a.lineHeight || ""));
  const [keepNext, setKeepNext] = useState(!!a.keepNext);
  const [keepLines, setKeepLines] = useState(!!a.keepLines);
  const [widow, setWidow] = useState(a.widowControl !== false);
  const [breakBefore, setBreakBefore] = useState(!!a.pageBreakBefore);
  const val = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
  const apply = () =>
    onApply({
      textAlign: align === "left" ? null : align,
      indLeft: val(left),
      indRight: val(right),
      indFirst: special === "none" || val(by) === null ? null : special === "hanging" ? -Math.abs(val(by)!) : Math.abs(val(by)!),
      spaceBefore: val(before),
      spaceAfter: val(after),
      lineHeight: line || null,
      keepNext: keepNext || null,
      keepLines: keepLines || null,
      widowControl: widow ? null : false,
      pageBreakBefore: breakBefore || null,
    });
  return (
    <Modal
      title="Paragraph"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={`${btnCls} text-slate-600 hover:bg-slate-100`}>Cancel</button>
          <button onClick={apply} className={`${btnCls} bg-indigo-600 text-white hover:bg-indigo-700`} data-testid="para-ok">OK</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Alignment">
          <select aria-label="Alignment" className={inputCls} value={align} onChange={(e) => setAlign(e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Centered</option>
            <option value="right">Right</option>
            <option value="justify">Justified</option>
          </select>
        </Field>
        <div />
        <Field label="Indent left (pt)">
          <input aria-label="Indent left" className={inputCls} value={left} onChange={(e) => setLeft(e.target.value)} />
        </Field>
        <Field label="Indent right (pt)">
          <input aria-label="Indent right" className={inputCls} value={right} onChange={(e) => setRight(e.target.value)} />
        </Field>
        <Field label="Special">
          <select aria-label="Special indent" className={inputCls} value={special} onChange={(e) => setSpecial(e.target.value)}>
            <option value="none">(none)</option>
            <option value="first">First line</option>
            <option value="hanging">Hanging</option>
          </select>
        </Field>
        <Field label="By (pt)">
          <input aria-label="Special by" className={inputCls} value={by} disabled={special === "none"} onChange={(e) => setBy(e.target.value)} />
        </Field>
        <Field label="Spacing before (pt)">
          <input aria-label="Spacing before" className={inputCls} value={before} onChange={(e) => setBefore(e.target.value)} />
        </Field>
        <Field label="Spacing after (pt)">
          <input aria-label="Spacing after" className={inputCls} value={after} onChange={(e) => setAfter(e.target.value)} />
        </Field>
        <Field label="Line spacing">
          <select aria-label="Line spacing" className={inputCls} value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">(style)</option>
            <option value="1">Single</option>
            <option value="1.08">1.08</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5 lines</option>
            <option value="2">Double</option>
            <option value="3">Triple</option>
            {line && !["1", "1.08", "1.15", "1.5", "2", "3"].includes(line) && <option value={line}>{line}</option>}
          </select>
        </Field>
        <div className="col-span-2 flex gap-5 pt-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label="Keep with next" checked={keepNext} onChange={(e) => setKeepNext(e.target.checked)} /> Keep with next
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label="Keep lines together" checked={keepLines} onChange={(e) => setKeepLines(e.target.checked)} /> Keep lines together
          </label>
        </div>
        <div className="col-span-2 flex gap-5 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label="Widow/Orphan control" checked={widow} onChange={(e) => setWidow(e.target.checked)} /> Widow/Orphan control
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" aria-label="Page break before" checked={breakBefore} onChange={(e) => setBreakBefore(e.target.checked)} /> Page break before
          </label>
        </div>
      </div>
    </Modal>
  );
}
