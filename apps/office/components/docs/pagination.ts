// Print layout for the document editor. A ProseMirror plugin measures each
// top-level block, lays the blocks out on pages and columns (lib/docs/paginate)
// and moves them there with node decorations (left offset, width and a top
// margin), so the text stays one editable flow while it looks like Word's
// pages. A block that runs over the foot of a page is split: a gap widget
// pushes the rest of a paragraph (or the remaining rows of a table, below a
// copy of its header rows) to the next page. Footnotes take room at the foot
// of their page; endnotes follow the last block. The page sheets, headers,
// footers and footnote areas are drawn by PrintLayer from the same layout.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { type DocSettings, type PMNode, type Section, defaultSection } from "@/lib/docs/model";
import { type BlockBox, type Layout, type Line, type NoteBox, type Split, type HFKind, type HFType, PAGE_GAP, geometry, flowWidthOf, paginate, sectionsOf, headerFooterFor } from "@/lib/docs/paginate";
import { notesOf, type NoteInfo } from "./notes";

/** A split resolved to a document position: a gap widget goes there. */
export type GapAt = Split & { pos: number; kind: "line" | "row" | "note"; table: number; headerRows: number; cols: number };

export type PaginationState = { enabled: boolean; layout: Layout | null; tick: number; gaps: GapAt[]; printing: boolean };
export const paginationKey = new PluginKey<PaginationState>("wordPagination");

export type PaginationOptions = {
  getSetup: () => { body: Section; settings: DocSettings };
  enabled: boolean;
  /** HTML of a note's content (for measuring and drawing footnotes and endnotes) */
  noteHtml: (doc: PMNode) => string;
  /** open the editor of the note whose reference is at `pos` */
  onOpenNote: (pos: number) => void;
};

/** The current layout, if the print layout is on and has been measured. */
export const layoutOf = (state: EditorState): Layout | null => {
  const s = paginationKey.getState(state);
  return s?.enabled ? s.layout : null;
};

/** Page index of document position `pos` (its top-level block's page, or the page a split moved it to). */
export function pageIndexAt(state: EditorState, pos: number): number | null {
  const st = paginationKey.getState(state);
  const layout = st?.enabled ? st.layout : null;
  if (!layout) return null;
  const p = Math.min(pos, state.doc.content.size);
  const idx = state.doc.resolve(p).index(0);
  let page = layout.place[idx]?.page;
  if (page === undefined) return null;
  for (const g of st!.gaps) if (g.block === idx && g.pos <= p) page = g.page;
  return page;
}

/** Page label of document position `pos`. */
export function pageLabelAt(state: EditorState, pos: number): string | null {
  const layout = layoutOf(state);
  const i = pageIndexAt(state, pos);
  return layout && i !== null ? layout.pages[i]?.label ?? null : null;
}

/** Page labels of every heading in document order (for the TOC written to .docx). */
export function headingPages(state: EditorState): (number | string)[] {
  const out: (number | string)[] = [];
  state.doc.descendants((n, pos) => {
    if (n.type.name === "heading") {
      out.push(pageLabelAt(state, pos) ?? "");
      return false;
    }
    return true;
  });
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** One footnote or endnote as drawn at a page foot or at the end (the same markup is measured). */
export function noteItemHtml(n: NoteInfo, body: string): string {
  return `<div class="pl-note" data-note-pos="${n.pos}" data-note-kind="${n.kind}"><sup class="pl-note-num">${esc(n.label)}</sup><div class="pl-note-body">${body}</div></div>`;
}

type LineInfo = { screen: number[]; rowOfLine?: number[]; headerRows?: number };

const textRects = (el: HTMLElement): DOMRect[] => {
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-pl-gap]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const range = document.createRange();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.nodeValue || !t.nodeValue.trim()) continue;
    range.selectNodeContents(t);
    for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) out.push(r);
  }
  // pictures and other inline objects count as line content too
  el.querySelectorAll("img, svg, math, .note-ref, .word-field").forEach((x) => {
    if ((x as HTMLElement).closest("[data-pl-gap]")) return;
    const r = x.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(r);
  });
  return out;
};

export const Pagination = Extension.create<PaginationOptions>({
  name: "wordPagination",
  addOptions() {
    return { getSetup: () => ({ body: defaultSection(), settings: {} }), enabled: true, noteHtml: () => "", onOpenNote: () => {} };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    let frame = 0;
    const noteHeights = new Map<string, number>();
    let lastTick = -1;
    const hfHeights = new Map<string, number>();
    /** a hidden header box to measure header and footer content at a section's width */
    const hfBox = (view: EditorView): HTMLElement | null => {
      const host = view.dom.parentElement;
      if (!host) return null;
      let box = host.querySelector(":scope > .pl-hf-measure > .hf-content") as HTMLElement | null;
      if (!box) {
        const outer = document.createElement("div");
        outer.className = "pl-hf pl-hf-measure";
        outer.setAttribute("aria-hidden", "true");
        box = document.createElement("div");
        box.className = "hf-content";
        outer.appendChild(box);
        host.appendChild(outer);
      }
      return box;
    };
    const measureBox = (view: EditorView): HTMLElement | null => {
      const host = view.dom.parentElement;
      if (!host) return null;
      let box = host.querySelector(":scope > .pl-notes-measure") as HTMLElement | null;
      if (!box) {
        box = document.createElement("div");
        box.className = "hf-content pl-notes-measure";
        box.setAttribute("aria-hidden", "true");
        host.appendChild(box);
      }
      return box;
    };

    const measure = (view: EditorView) => {
      frame = 0;
      if (view.isDestroyed) return;
      const st = paginationKey.getState(view.state);
      if (!st?.enabled) return;
      if (st.tick !== lastTick) {
        noteHeights.clear();
        lastTick = st.tick;
      }
      const { body, settings } = opts.getSetup();
      const doc = view.state.doc;
      const { sections, blockSection } = sectionsOf(doc, body);
      const flow = flowWidthOf(sections);
      const root = view.dom as HTMLElement;
      const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
      const notes = notesOf(doc);
      const feet = notes.filter((n) => n.kind === "footnote");
      const ends = notes.filter((n) => n.kind === "endnote");
      // footnote heights, measured at the width of their section's text
      const box = measureBox(view);
      const heightOf = (n: NoteInfo, width: number): number => {
        const html = noteItemHtml(n, opts.noteHtml(n.content));
        const key = `${width}|${html}`;
        let h = noteHeights.get(key);
        if (h === undefined && box) {
          box.style.width = `${width}px`;
          box.innerHTML = html;
          h = (box.firstElementChild as HTMLElement).getBoundingClientRect().height / scale;
          noteHeights.set(key, h);
          box.innerHTML = "";
        }
        return h ?? 0;
      };
      const notesByBlock = new Map<number, NoteInfo[]>();
      for (const n of feet) {
        const bi = doc.resolve(Math.min(n.pos, doc.content.size)).index(0);
        notesByBlock.set(bi, [...(notesByBlock.get(bi) || []), n]);
      }

      const blocks: BlockBox[] = [];
      const infos: (LineInfo | null)[] = [];
      const natural = (rect: DOMRect, gaps: { top: number; h: number }[]) => (screenY: number) => {
        const y = (screenY - rect.top) / scale;
        return y - gaps.filter((g) => g.top < y - 0.5).reduce((s, g) => s + g.h, 0);
      };
      const addBlock = (dom: HTMLElement | null, node: PMNodeT | null, index: number) => {
        const rect = dom?.getBoundingClientRect ? dom.getBoundingClientRect() : null;
        if (!dom || !rect) {
          blocks.push({ h: 0, kind: "block" });
          infos.push(null);
          return;
        }
        const gaps = Array.from(dom.querySelectorAll("[data-pl-gap]")).map((g) => {
          const r = g.getBoundingClientRect();
          return { top: (r.top - rect.top) / scale, h: r.height / scale };
        });
        const nat = natural(rect, gaps);
        const h = rect.height / scale - gaps.reduce((s, g) => s + g.h, 0);
        const name = node?.type.name;
        const wrap = node?.attrs?.wrap as string | undefined;
        const kind: BlockBox["kind"] = name === "pageBreak" ? "pageBreak" : name === "sectionBreak" ? "sectionBreak" : wrap && wrap !== "inline" && wrap !== "topBottom" ? "float" : "block";
        const b: BlockBox = { h, kind, keepNext: name === "heading" || !!node?.attrs?.keepNext, keepLines: !!node?.attrs?.keepLines, widows: node?.attrs?.widowControl === false ? false : undefined, breakBefore: !!node?.attrs?.pageBreakBefore };
        // footnotes referenced in this block
        const own = node ? notesByBlock.get(index) : undefined;
        if (own?.length) {
          const g = geometry(sections[blockSection[index]] || body, flow);
          b.notes = own.map((n): NoteBox => {
            const el = view.nodeDOM(n.pos) as HTMLElement | null;
            const y = el?.getBoundingClientRect ? nat(el.getBoundingClientRect().top) : 0;
            return { id: n.index, h: heightOf(n, g.cw), y };
          });
        }
        const info: LineInfo = { screen: [] };
        infos.push(info);
        if (kind !== "block" || name === "tableOfContents" || name === "image" || name === "horizontalRule" || name === "shape" || name === "bibliography") {
          blocks.push(b);
          return;
        }
        if (name === "table") {
          b.lines = () => {
            const table = dom.querySelector("table");
            if (!table) return undefined;
            const rows = Array.from(table.rows).filter((r) => !r.hasAttribute("data-pl-gap"));
            const headerRows = rows.findIndex((r) => !Array.from(r.cells).every((c) => c.tagName === "TH"));
            const hr = headerRows > 0 && headerRows < rows.length - 1 ? headerRows : 0;
            const boxes = rows.map((r) => {
              const rr = r.getBoundingClientRect();
              return { top: nat(rr.top), bottom: nat(rr.bottom) };
            });
            // header rows stay with the first data row; a split only falls before a data row
            const lines: Line[] = [];
            const rowOfLine: number[] = [];
            boxes.forEach((bx, k) => {
              if (k <= hr && k > 0) lines[0].bottom = bx.bottom;
              else {
                lines.push({ top: k === 0 ? 0 : bx.top, bottom: bx.bottom });
                rowOfLine.push(k);
              }
            });
            if (lines.length) lines[lines.length - 1].bottom = Math.max(lines[lines.length - 1].bottom, h);
            b.header = hr ? boxes[hr - 1].bottom - boxes[0].top : 0;
            info.rowOfLine = rowOfLine;
            info.headerRows = hr;
            return lines;
          };
        } else {
          b.lines = () => {
            const rects = textRects(dom).sort((a, c) => a.top - c.top);
            const raw: { top: number; bottom: number }[] = [];
            for (const r of rects) {
              const last = raw[raw.length - 1];
              if (last && r.top < last.bottom - 2) {
                last.top = Math.min(last.top, r.top);
                last.bottom = Math.max(last.bottom, r.bottom);
              } else raw.push({ top: r.top, bottom: r.bottom });
            }
            if (raw.length < 2) return undefined;
            // natural (gap-free) line boxes; a line boundary is midway between two lines' text
            const nr = raw.map((r) => ({ top: nat(r.top), bottom: nat(r.bottom) }));
            const lines: Line[] = nr.map((r, k) => ({
              top: k === 0 ? 0 : (nr[k - 1].bottom + r.top) / 2,
              bottom: k === nr.length - 1 ? h : (r.bottom + nr[k + 1].top) / 2,
            }));
            info.screen = raw.map((r, k) => (k === 0 ? r.top : (raw[k - 1].bottom + r.top) / 2));
            return lines;
          };
        }
        blocks.push(b);
      };
      doc.forEach((node, offset, i) => addBlock(view.nodeDOM(offset) as HTMLElement | null, node, i));
      const endDom = ends.length ? (root.querySelector(":scope > [data-pl-endnotes]") as HTMLElement | null) : null;
      if (endDom) {
        const bi = blocks.length;
        addBlock(endDom, null, bi);
        const b = blocks[bi];
        const rect = endDom.getBoundingClientRect();
        const gaps = Array.from(endDom.querySelectorAll("[data-pl-gap]")).map((g) => {
          const r = g.getBoundingClientRect();
          return { top: (r.top - rect.top) / scale, h: r.height / scale };
        });
        const nat = natural(rect, gaps);
        b.lines = () => {
          const items = Array.from(endDom.querySelectorAll(":scope > .pl-note")) as HTMLElement[];
          return items.map((it, k) => {
            const r = it.getBoundingClientRect();
            return { top: k === 0 ? 0 : nat(r.top), bottom: k === items.length - 1 ? b.h : nat(r.bottom) };
          });
        };
      }
      const hbox = hfBox(view);
      const hfHeight = (si: number, kind: HFKind, type: HFType): number => {
        const d = headerFooterFor(sections, si, kind, type).doc;
        if (!d || !hbox) return 0;
        const text = JSON.stringify(d);
        if (!/"text"|"image"|"pageField"|"docField"|"shape"/.test(text)) return 0;
        const width = geometry(sections[si], flow).cw;
        const key = `${width}|${text}`;
        let h = hfHeights.get(key);
        if (h === undefined) {
          (hbox.parentElement as HTMLElement).style.width = `${width}px`;
          hbox.innerHTML = opts.noteHtml(d);
          h = hbox.getBoundingClientRect().height / scale;
          hbox.innerHTML = "";
          if (hfHeights.size > 200) hfHeights.clear();
          hfHeights.set(key, h);
        }
        return h;
      };
      const layout = paginate(blocks, endDom ? [...blockSection, sections.length - 1] : blockSection, sections, settings, { pageGap: st.printing ? 0 : PAGE_GAP, hfHeight });

      // where each split's gap goes in the document
      const gaps: GapAt[] = [];
      const offsets: number[] = [];
      doc.forEach((_n, off) => offsets.push(off));
      for (const sp of layout.splits) {
        const node = sp.block < doc.childCount ? doc.child(sp.block) : null;
        if (!node) {
          gaps.push({ ...sp, pos: doc.content.size, kind: "note", table: -1, headerRows: 0, cols: 0 });
          continue;
        }
        const start = offsets[sp.block];
        const info = infos[sp.block];
        if (node.type.name === "table") {
          const row = info?.rowOfLine?.[sp.line] ?? sp.line;
          let pos = start + 1;
          for (let k = 0; k < row && k < node.childCount; k++) pos += node.child(k).nodeSize;
          let cols = 0;
          node.firstChild?.forEach((c) => (cols += Number(c.attrs.colspan) || 1));
          gaps.push({ ...sp, pos, kind: "row", table: start, headerRows: info?.headerRows || 0, cols: Math.max(1, cols) });
          continue;
        }
        const y = info?.screen[sp.line];
        if (y === undefined) continue;
        let lo = start + 1;
        let hi = start + node.nodeSize - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          let top = Infinity;
          try {
            top = view.coordsAtPos(mid, 1).top;
          } catch {
            top = Infinity;
          }
          if (top >= y - 0.5) hi = mid;
          else lo = mid + 1;
        }
        let pos = lo;
        const $p = doc.resolve(pos);
        if (!$p.parent.inlineContent) {
          let found = -1;
          doc.nodesBetween(pos, start + node.nodeSize, (n, p) => {
            if (found >= 0) return false;
            if (n.isTextblock && p >= pos - 1) {
              found = p + 1;
              return false;
            }
            return true;
          });
          if (found < 0) continue;
          pos = found;
        }
        gaps.push({ ...sp, pos, kind: "line", table: -1, headerRows: 0, cols: 0 });
      }
      const same = JSON.stringify(layout) === JSON.stringify(st.layout) && JSON.stringify(gaps) === JSON.stringify(st.gaps);
      if (!same) view.dispatch(view.state.tr.setMeta(paginationKey, { layout, gaps }).setMeta("addToHistory", false));
    };
    const schedule = (view: EditorView) => {
      if (frame) return;
      frame = requestAnimationFrame(() => measure(view));
    };

    const endnotesWidget = (state: EditorState, st: PaginationState | undefined, ends: NoteInfo[], all: NoteInfo[], style: string) => {
      const web = !st?.enabled;
      const shown = web ? all : ends;
      if (!shown.length) return null;
      const splits = (st?.gaps || []).filter((g) => g.kind === "note");
      const htmls = shown.map((n) => noteItemHtml(n, opts.noteHtml(n.content)));
      const key = `endnotes:${style}:${splits.map((g) => `${g.line}/${Math.round(g.gap)}`).join(",")}:${htmls.join("").length}:${hashStr(htmls.join(""))}`;
      return Decoration.widget(
        state.doc.content.size,
        () => {
          const el = document.createElement("div");
          el.className = `pl-endnotes${st?.enabled ? " pl-block" : ""}`;
          el.setAttribute("data-pl-endnotes", "");
          el.contentEditable = "false";
          if (style) el.setAttribute("style", style);
          const sep = document.createElement("div");
          sep.className = "pl-note-sep";
          el.appendChild(sep);
          htmls.forEach((h, k) => {
            const sp = splits.find((g) => g.line === k);
            if (sp) {
              const gap = document.createElement("div");
              gap.setAttribute("data-pl-gap", "");
              gap.style.height = `${Math.max(0, sp.gap)}px`;
              el.appendChild(gap);
            }
            const t = document.createElement("template");
            t.innerHTML = h;
            el.appendChild(t.content);
          });
          el.addEventListener("dblclick", (e) => {
            const it = (e.target as HTMLElement).closest("[data-note-pos]");
            if (it) opts.onOpenNote(Number(it.getAttribute("data-note-pos")));
          });
          return el;
        },
        { side: 1, key, ignoreSelection: true, stopEvent: () => true },
      );
    };

    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => ({ enabled: opts.enabled, layout: null, tick: 0, gaps: [], printing: false }),
          apply(tr, v) {
            const m = tr.getMeta(paginationKey) as Partial<PaginationState> | undefined;
            let next = m ? { ...v, ...m } : v;
            if (tr.docChanged && !m?.gaps && next.gaps.length) {
              const size = tr.doc.content.size;
              next = { ...next, gaps: next.gaps.map((g) => ({ ...g, pos: g.kind === "note" ? size : Math.min(size, tr.mapping.map(g.pos, -1)), table: g.table >= 0 ? tr.mapping.map(g.table) : -1 })) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const st = paginationKey.getState(state);
            const { body } = opts.getSetup();
            const { sections, blockSection } = sectionsOf(state.doc, body);
            const decos: Decoration[] = [];
            const all = notesOf(state.doc);
            const ends = all.filter((n) => n.kind === "endnote");
            if (!st?.enabled) {
              state.doc.forEach((node, offset, i) => {
                if (node.type.name === "sectionBreak") decos.push(Decoration.node(offset, offset + node.nodeSize, { "data-next": sections[blockSection[i] + 1]?.type || "nextPage" }));
              });
              const w = endnotesWidget(state, st, ends, all, "");
              if (w) decos.push(w);
              return DecorationSet.create(state.doc, decos);
            }
            const flow = flowWidthOf(sections);
            const layout = st.layout;
            // mirror margins: the part of a split block on the next page moves to where that page's text starts
            const shifted = new Map<number, GapAt[]>();
            for (const gp of st.gaps) if (gp.shift !== undefined && gp.kind !== "note") shifted.set(gp.block, [...(shifted.get(gp.block) || []), gp].sort((a, b) => a.pos - b.pos));
            for (const [bi, list] of [...shifted]) if (!list.some((g) => Math.abs(g.shift || 0) > 0.5)) shifted.delete(bi);
            const splitWiden = new Map<number, { min: number; max: number }>();
            if (shifted.size) {
              let bi = 0;
              state.doc.forEach((node, start) => {
                const list = shifted.get(bi++);
                if (!list) return;
                const shiftAt = (p: number) => {
                  let d = 0;
                  for (const g of list) if (g.pos <= p) d = g.shift || 0;
                  return d;
                };
                if (node.isTextblock) {
                  // the paragraph is wider by the shifts and floats keep each page's lines where that page's text is
                  const ds = [0, ...list.map((g) => g.shift || 0)];
                  const min = Math.min(...ds);
                  const max = Math.max(...ds);
                  splitWiden.set(start, { min, max });
                  const portions = [{ at: start + 1, d: 0, h: (list[0].to ?? 0) - (list[0].from ?? 0), side: -0.9 }, ...list.map((g, k) => ({ at: g.pos, d: g.shift || 0, h: (list[k + 1] ? (list[k + 1].to ?? 0) - (list[k + 1].from ?? 0) : (g.h ?? 0) - (g.to ?? 0)), side: -0.5 }))];
                  portions.forEach((pt, k) => {
                    const l = pt.d - min;
                    const r = max - pt.d;
                    decos.push(
                      Decoration.widget(
                        pt.at,
                        () => {
                          const frag = document.createElement("span");
                          frag.setAttribute("data-pl-shift", "");
                          frag.contentEditable = "false";
                          for (const [side, w] of [["left", l], ["right", r]] as const) {
                            if (w <= 0.5) continue;
                            const f = document.createElement("span");
                            f.style.cssText = `float: ${side}; width: ${w}px; height: ${Math.max(0, pt.h)}px; clear: ${side}`;
                            frag.appendChild(f);
                          }
                          return frag;
                        },
                        { side: pt.side, key: `shift:${k}:${Math.round(l)}:${Math.round(r)}:${Math.round(pt.h)}`, ignoreSelection: true, marks: [] },
                      ),
                    );
                  });
                  return;
                }
                // inside a list, table or control: rows and paragraphs after a split move with their page
                node.descendants((n, rel) => {
                  const p = start + 1 + rel;
                  if (n.type.name === "tableRow" || n.isTextblock) {
                    const d = shiftAt(p);
                    if (Math.abs(d) > 0.5) decos.push(Decoration.node(p, p + n.nodeSize, { style: `transform: translateX(${d}px)` }));
                    return false;
                  }
                  return true;
                });
              });
            }
            state.doc.forEach((node, offset, i) => {
              const place = layout?.place[i];
              const g = geometry(sections[blockSection[i]], flow);
              const widen = splitWiden.get(offset);
              const left = (place ? place.left : g.left) + (widen ? widen.min : 0);
              const width = (place ? place.width : g.n > 1 ? g.colWidth : g.cw) + (widen ? widen.max - widen.min : 0);
              const mt = place ? place.marginTop : 0;
              const wrap = node.attrs?.wrap as string | undefined;
              let style = `margin-left: ${left}px; width: ${width}px; margin-top: ${mt}px`;
              let cls = "pl-block";
              if (wrap === "square" || wrap === "tight") {
                const right = node.attrs.align === "right";
                style = right ? `float: right; margin-right: ${Math.max(0, flow - left - width)}px; margin-top: ${mt}px` : `float: left; margin-left: ${left}px; margin-top: ${mt}px`;
                cls = "pl-block pl-float";
              } else if (wrap === "behind" || wrap === "front") {
                const x = Number(node.attrs.offsetX) || 0;
                const y = Number(node.attrs.offsetY) || 0;
                style = `position: absolute; left: ${left + x}px; top: ${(place ? place.y : 0) + y}px; margin: 0`;
                cls = "pl-block pl-abs";
              }
              const attrs: Record<string, string> = { style, class: cls };
              if (node.type.name === "sectionBreak") attrs["data-next"] = sections[blockSection[i] + 1]?.type || "nextPage";
              decos.push(Decoration.node(offset, offset + node.nodeSize, attrs));
            });
            for (const gp of st.gaps) {
              if (gp.kind === "line") {
                decos.push(
                  Decoration.widget(
                    gp.pos,
                    () => {
                      const el = document.createElement("span");
                      el.className = "pl-gap";
                      el.setAttribute("data-pl-gap", "");
                      el.style.height = `${Math.max(0, gp.gap)}px`;
                      return el;
                    },
                    { side: -1, key: `gap:${Math.round(gp.gap * 10)}`, ignoreSelection: true },
                  ),
                );
              } else if (gp.kind === "row") {
                decos.push(
                  Decoration.widget(
                    gp.pos,
                    () => {
                      const tr = document.createElement("tr");
                      tr.className = "pl-gap-row";
                      tr.setAttribute("data-pl-gap", "");
                      const td = document.createElement("td");
                      td.colSpan = gp.cols;
                      td.style.height = `${Math.max(0, gp.gap)}px`;
                      tr.appendChild(td);
                      return tr;
                    },
                    { side: -2, key: `rowgap:${gp.cols}:${Math.round(gp.gap * 10)}`, ignoreSelection: true, stopEvent: () => true },
                  ),
                );
                for (let k = 0; k < gp.headerRows; k++) {
                  decos.push(
                    Decoration.widget(
                      gp.pos,
                      (view) => {
                        const wrapper = view.nodeDOM(gp.table) as HTMLElement | null;
                        const row = wrapper?.querySelector("table")?.rows[k];
                        const clone = (row ? row.cloneNode(true) : document.createElement("tr")) as HTMLElement;
                        clone.setAttribute("data-pl-gap", "");
                        clone.classList.add("pl-repeat-header");
                        if (gp.shift && Math.abs(gp.shift) > 0.5) clone.style.transform = `translateX(${gp.shift}px)`;
                        clone.contentEditable = "false";
                        clone.querySelectorAll("[contenteditable]").forEach((x) => x.removeAttribute("contenteditable"));
                        return clone;
                      },
                      { side: -1 + k * 0.01, key: `rowhead:${gp.table}:${k}:${state.doc.nodeAt(gp.table)?.child(k)?.textContent.length ?? 0}`, ignoreSelection: true, stopEvent: () => true },
                    ),
                  );
                }
              }
            }
            const endPlace = layout?.place[state.doc.childCount];
            const g = geometry(sections[sections.length - 1], flow);
            const w = endnotesWidget(state, st, ends, all, endPlace ? `margin-left: ${endPlace.left}px; width: ${endPlace.width}px; margin-top: ${endPlace.marginTop}px` : `margin-left: ${g.left}px; width: ${g.cw}px`);
            if (w) decos.push(w);
            return DecorationSet.create(state.doc, decos);
          },
          attributes(state): Record<string, string> {
            const st = paginationKey.getState(state);
            if (!st?.enabled) return { class: "web-root" };
            const { body } = opts.getSetup();
            const { sections } = sectionsOf(state.doc, body);
            const flow = st.layout?.flowWidth ?? flowWidthOf(sections);
            return { class: "pl-root", style: `width: ${flow}px; padding-bottom: ${st.layout?.padBottom ?? 0}px` };
          },
        },
        view(view) {
          const onLoad = (e: Event) => {
            if ((e.target as HTMLElement)?.tagName === "IMG") schedule(view);
          };
          view.dom.addEventListener("load", onLoad, true);
          if (typeof document !== "undefined" && document.fonts?.ready) document.fonts.ready.then(() => schedule(view)).catch(() => {});
          schedule(view);
          return {
            update(v, prev) {
              const a = paginationKey.getState(v.state);
              const b = paginationKey.getState(prev);
              if (v.state.doc !== prev.doc || a?.enabled !== b?.enabled || a?.tick !== b?.tick || a?.printing !== b?.printing || a?.gaps !== b?.gaps) schedule(v);
            },
            destroy() {
              view.dom.removeEventListener("load", onLoad, true);
              view.dom.parentElement?.querySelector(":scope > .pl-notes-measure")?.remove();
              if (frame) cancelAnimationFrame(frame);
            },
          };
        },
      }),
    ];
  },
});

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Lay the pages out now (no animation frame), e.g. just before printing. */
export function measureNow(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(paginationKey, { tick: Date.now() }).setMeta("addToHistory", false));
}
