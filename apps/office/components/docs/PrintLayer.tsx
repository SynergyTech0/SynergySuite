"use client";

// The page sheets, headers, footers and column lines of the print layout,
// drawn behind and around the editor from the pagination plugin's layout.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { watermarkStyle, pageBorderBox, lineNumberLabels } from "@/lib/docs/page-design";
import { generateHTML, type Editor, type Extensions } from "@tiptap/core";
import { type DocSettings, type PMNode, type Section } from "@/lib/docs/model";
import { type Layout, type HFKind, type HFType, sectionsOf, headerFooterFor } from "@/lib/docs/paginate";
import { layoutOf, noteItemHtml } from "./pagination";
import { notesOf, type NoteInfo } from "./notes";

export { headerFooterFor, type HFKind, type HFType } from "@/lib/docs/paginate";

const isEmpty = (d: PMNode | undefined) => !d || !JSON.stringify(d).includes('"text"') && !JSON.stringify(d).includes('"pageField"') && !JSON.stringify(d).includes('"image"');

export default function PrintLayer({
  editor,
  body,
  settings,
  extensions,
  onEditHF,
  onOpenNote,
  children,
}: {
  editor: Editor;
  body: Section;
  settings: DocSettings;
  extensions: Extensions;
  onEditHF: (section: number, kind: HFKind, type: HFType) => void;
  onOpenNote?: (pos: number) => void;
  children: ReactNode;
}) {
  const [layout, setLayout] = useState<Layout | null>(() => layoutOf(editor.state));
  const [sections, setSections] = useState<Section[]>(() => sectionsOf(editor.state.doc, body).sections);
  const [notes, setNotes] = useState<NoteInfo[]>(() => notesOf(editor.state.doc));
  useEffect(() => {
    const on = () => {
      setLayout(layoutOf(editor.state));
      setSections(sectionsOf(editor.state.doc, body).sections);
      setNotes(notesOf(editor.state.doc));
    };
    on();
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor, body]);

  // line numbers: the editor's text lines, measured after each layout
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [lineNums, setLineNums] = useState<{ top: number; left: number; label: number }[]>([]);
  const numbering = sections.some((s) => s.lineNumbers);
  useEffect(() => {
    if (!numbering || !layout) {
      setLineNums([]);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      const root = editor.view.dom as HTMLElement;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const scale = wrap.offsetWidth ? wr.width / wrap.offsetWidth || 1 : 1;
      const lines: { y: number; page: number; section: number; h: number }[] = [];
      const seen = new Set<number>();
      root.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > ul li > p, :scope > ol li > p, :scope > blockquote p").forEach((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.nodeValue?.trim() || (t.parentElement && t.parentElement.closest("[data-pl-gap]"))) continue;
          range.selectNodeContents(t);
          for (const r of Array.from(range.getClientRects())) {
            if (r.height <= 0) continue;
            const y = (r.top - wr.top) / scale;
            const key = Math.round(y / 2);
            if (seen.has(key) || seen.has(key - 1) || seen.has(key + 1)) continue;
            seen.add(key);
            const pg = layout.pages.find((p) => y >= p.top && y < p.top + p.height);
            if (pg) lines.push({ y, page: pg.index, section: pg.section, h: r.height / scale });
          }
        }
      });
      lines.sort((a, b) => a.y - b.y);
      const labels = lineNumberLabels(lines, (si) => sections[si]?.lineNumbers);
      const out: { top: number; left: number; label: number }[] = [];
      lines.forEach((l, i) => {
        const n = labels[i];
        const pg = layout.pages[l.page];
        const dist = ((sections[l.section]?.lineNumbers?.distance || 18) * 4) / 3;
        if (n !== null && pg) out.push({ top: l.y, left: pg.left + pg.marginLeft - dist, label: n });
      });
      setLineNums(out);
    });
    return () => cancelAnimationFrame(raf);
  }, [numbering, layout, sections, editor]);

  const htmlCache = useMemo(() => new Map<string, string>(), [extensions]);
  const render = (d: PMNode | undefined, label: string, total: number): string => {
    if (!d) return "";
    const key = JSON.stringify(d);
    let html = htmlCache.get(key);
    if (html === undefined) {
      try {
        html = generateHTML(d as never, extensions);
      } catch {
        html = "";
      }
      htmlCache.set(key, html);
    }
    return html.replace(/<span([^>]*)data-field="(page|pages|sectionPages)"([^>]*)>#<\/span>/g, (_m, a, kind, b) => `<span${a}data-field="${kind}"${b}>${kind === "pages" ? total : label}</span>`);
  };

  if (!layout) return <div className="pl-wrap">{children}</div>;
  const total = layout.pages.length;
  const wm = settings.watermark && (settings.watermark.kind === "picture" ? settings.watermark.image : settings.watermark.text) ? settings.watermark : null;
  return (
    <div className="pl-wrap" ref={wrapRef} style={{ width: layout.flowWidth }}>
      <div className="pl-pages" aria-hidden>
        {layout.pages.map((p) => {
          const sec = sections[p.section];
          const pb = sec?.pageBorders;
          const showBorder = pb && (pb.display === "firstPage" ? p.firstOfSection : pb.display === "notFirstPage" ? !p.firstOfSection : true);
          const box = showBorder ? pageBorderBox(pb!, { top: p.marginTop, right: p.marginRight, bottom: p.marginBottom, left: p.marginLeft }) : null;
          const cw = p.width - p.marginLeft - p.marginRight;
          return (
            <div key={p.index} className="pl-page" data-page={p.index + 1} style={{ top: p.top, left: p.left, width: p.width, height: p.height, ...(settings.pageColor ? { background: settings.pageColor } : {}) }}>
              {box && <div className="pl-page-border" data-testid="page-border" style={{ position: "absolute", top: box.top, left: box.left, right: box.right, bottom: box.bottom, ...box.css }} />}
              {wm && (
                <div className="pl-watermark" data-testid="watermark" style={{ position: "absolute", top: p.marginTop, left: p.marginLeft, width: cw, height: p.height - p.marginTop - p.marginBottom }}>
                  {wm.kind === "picture" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wm.image} alt="" style={watermarkStyle(wm, cw)} />
                  ) : (
                    <span style={watermarkStyle(wm, cw)}>{wm.text}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {lineNums.length > 0 && (
        <div className="pl-line-numbers" aria-hidden data-testid="line-numbers">
          {lineNums.map((l, i) => (
            <span key={i} style={{ top: l.top, left: l.left }}>{l.label}</span>
          ))}
        </div>
      )}
      {children}
      <div className="pl-hf-layer">
        {layout.pages.map((p) => {
          const head = headerFooterFor(sections, p.section, "headers", p.hf);
          const foot = headerFooterFor(sections, p.section, "footers", p.hf);
          const left = p.left + p.marginLeft;
          const width = p.width - p.marginLeft - p.marginRight;
          return (
            <div key={p.index}>
              <div
                className={`pl-hf pl-header${isEmpty(head.doc) ? " pl-hf-empty" : ""}`}
                data-testid="page-header"
                title="Double-click to edit the header"
                style={{ top: p.top + p.headerDist, left, width, minHeight: Math.max(12, p.marginTop - p.headerDist - 4) }}
                onDoubleClick={() => onEditHF(p.section, "headers", p.hf)}
              >
                <div className="hf-content" dangerouslySetInnerHTML={{ __html: render(head.doc, p.label, total) }} />
              </div>
              <div
                className={`pl-hf pl-footer${isEmpty(foot.doc) ? " pl-hf-empty" : ""}`}
                data-testid="page-footer"
                title="Double-click to edit the footer"
                style={{ top: p.top + p.height - p.footerDist, left, width, minHeight: 12, transform: "translateY(-100%)" }}
                onDoubleClick={() => onEditHF(p.section, "footers", p.hf)}
              >
                <div className="hf-content" dangerouslySetInnerHTML={{ __html: render(foot.doc, p.label, total) }} />
              </div>
              {p.notes.length > 0 && (
                <div
                  className="pl-footnotes hf-content"
                  data-testid="page-footnotes"
                  style={{ top: p.top + p.height - p.marginBottom - p.notesHeight, left, width }}
                  onDoubleClick={(e) => {
                    const it = (e.target as HTMLElement).closest("[data-note-pos]");
                    if (it && onOpenNote) onOpenNote(Number(it.getAttribute("data-note-pos")));
                  }}
                  dangerouslySetInnerHTML={{
                    __html: '<div class="pl-note-sep"></div>' + p.notes.map((id) => (notes[id] ? noteItemHtml(notes[id], render(notes[id].content, p.label, total)) : "")).join(""),
                  }}
                />
              )}
              {p.regions
                .filter((r) => r.separator && r.cols > 1 && r.bottom > r.top)
                .flatMap((r, ri) =>
                  Array.from({ length: r.cols - 1 }, (_, c) => (
                    <div key={`${ri}-${c}`} className="pl-col-line" style={{ top: r.top, height: r.bottom - r.top, left: r.left + (c + 1) * (r.colWidth + r.gap) - r.gap / 2 }} />
                  )),
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
