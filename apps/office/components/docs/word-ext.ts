// Tiptap pieces that give the document editor Word's model: paragraph and
// character styles, precise paragraph spacing and indents, list formats,
// sized images, table cell shading/borders, page and section breaks, a
// table of contents and page-number fields (for headers and footers).
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { placementAttrs, dragToMove } from "./shapes";
import { CSS_LIST, cssLineHeight, type ParaProps } from "@/lib/docs/model";
import { indexOf } from "./refs";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordStyles: {
      /** apply a paragraph style ("Normal", "Heading1"…"Heading6", "Title" or a custom id) */
      setParagraphStyle: (id: string) => ReturnType;
      /** set (or with null clear) a character style on the selection */
      setCharStyle: (id: string | null) => ReturnType;
      /** set direct paragraph formatting on the selected paragraphs */
      setParaFormat: (attrs: Record<string, unknown>) => ReturnType;
    };
    wordBreaks: {
      insertPageBreak: () => ReturnType;
    };
  }
}

const PARA_TYPES = ["paragraph", "heading"];
const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Paragraph attributes: style, spacing, line spacing and indents (points). */
export const WordParagraph = Extension.create({
  name: "wordParagraph",
  addGlobalAttributes() {
    const css = (name: string, attr: string, render: (v: unknown) => string | null) => ({
      default: null,
      parseHTML: (el: HTMLElement) => num(el.getAttribute(attr)),
      renderHTML: (a: Record<string, unknown>) => {
        const v = a[name];
        if (v === null || v === undefined) return {};
        const s = render(v);
        return s ? { [attr]: String(v), style: s } : { [attr]: String(v) };
      },
    });
    return [
      {
        types: PARA_TYPES,
        attributes: {
          styleId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-style"),
            renderHTML: (a) => (a.styleId ? { "data-style": a.styleId } : {}),
          },
          spaceBefore: css("spaceBefore", "data-sb", (v) => `padding-top: ${v}pt`),
          spaceAfter: css("spaceAfter", "data-sa", (v) => `padding-bottom: ${v}pt`),
          indLeft: css("indLeft", "data-il", (v) => `padding-left: ${v}pt`),
          indRight: css("indRight", "data-ir", (v) => `padding-right: ${v}pt`),
          indFirst: css("indFirst", "data-if", (v) => `text-indent: ${v}pt`),
          lineHeight: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-lh"),
            renderHTML: (a) => (a.lineHeight ? { "data-lh": a.lineHeight, style: `line-height: ${cssLineHeight(String(a.lineHeight))}` } : {}),
          },
          keepNext: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (el.hasAttribute("data-keep-next") ? true : null),
            renderHTML: (a) => (a.keepNext ? { "data-keep-next": "" } : {}),
          },
          keepLines: {
            default: null,
            parseHTML: (el) => (el.hasAttribute("data-keep-lines") ? true : null),
            renderHTML: (a) => (a.keepLines ? { "data-keep-lines": "" } : {}),
          },
        },
      },
      {
        types: ["orderedList"],
        attributes: {
          numFmt: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-numfmt"),
            renderHTML: (a) => (a.numFmt && CSS_LIST[String(a.numFmt)] ? { "data-numfmt": a.numFmt, style: `list-style-type: ${CSS_LIST[String(a.numFmt)]}` } : {}),
          },
          lvlText: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-lvl-text"),
            renderHTML: (a) => (a.lvlText ? { "data-lvl-text": a.lvlText, ...((String(a.lvlText).match(/%\d/g) || []).length > 1 ? { "data-legal": "" } : {}) } : {}),
          },
        },
      },
      {
        types: ["bulletList"],
        attributes: {
          bullet: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-bullet"),
            renderHTML: (a) => {
              const b = a.bullet ? String(a.bullet) : "";
              if (!b) return {};
              const type = ["disc", "circle", "square"].includes(b) ? b : `"${b.replace(/["\\]/g, "")}  "`;
              return { "data-bullet": b, style: `list-style-type: ${type}` };
            },
          },
        },
      },
      {
        types: ["textStyle"],
        attributes: {
          charStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-cstyle"),
            renderHTML: (a) => (a.charStyle ? { "data-cstyle": a.charStyle } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphStyle:
        (id) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          const h = /^Heading([1-6])$/.exec(id);
          const heading = state.schema.nodes.heading;
          const paragraph = state.schema.nodes.paragraph;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARA_TYPES.includes(node.type.name)) return true;
            const type = h ? heading : paragraph;
            const attrs: Record<string, unknown> = {};
            for (const k of Object.keys(type.spec.attrs || {})) if (k in node.attrs) attrs[k] = node.attrs[k];
            if (h) attrs.level = Number(h[1]);
            attrs.styleId = h || id === "Normal" ? null : id;
            tr.setNodeMarkup(pos, type, attrs);
            changed = true;
            return false;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      setCharStyle:
        (id) =>
        ({ chain }) =>
          id ? chain().setMark("textStyle", { charStyle: id }).run() : chain().setMark("textStyle", { charStyle: null }).removeEmptyTextStyle().run(),
      setParaFormat:
        (attrs) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARA_TYPES.includes(node.type.name)) return true;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
            changed = true;
            return false;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});

/** Direct paragraph props of a paragraph node, as the styles model names them. */
export function paraPropsOf(node: PMNodeT): ParaProps {
  const a = node.attrs;
  const p: ParaProps = {};
  if (a.textAlign && a.textAlign !== "left") p.align = a.textAlign;
  if (typeof a.spaceBefore === "number") p.spaceBefore = a.spaceBefore;
  if (typeof a.spaceAfter === "number") p.spaceAfter = a.spaceAfter;
  if (a.lineHeight) p.lineHeight = a.lineHeight;
  if (typeof a.indLeft === "number") p.indentLeft = a.indLeft;
  if (typeof a.indRight === "number") p.indentRight = a.indRight;
  if (typeof a.indFirst === "number") p.indentFirst = a.indFirst;
  return p;
}

export const WordImage = Image.extend<{ inline: boolean; allowBase64: boolean; HTMLAttributes: Record<string, unknown>; onOpen: (pos: number) => void }>({
  addOptions() {
    return { ...(this.parent?.() as { inline: boolean; allowBase64: boolean; HTMLAttributes: Record<string, unknown> }), onOpen: () => {} };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: (el) => num(el.getAttribute("width")), renderHTML: (a) => (a.width ? { width: a.width } : {}) },
      height: { default: null, parseHTML: (el) => num(el.getAttribute("height")), renderHTML: (a) => (a.height ? { height: a.height } : {}) },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-align"),
        renderHTML: (a) => (a.align ? { "data-align": a.align } : {}),
      },
      // the original EMF or WMF of a metafile picture (shown as SVG, saved back as itself)
      orig: { default: null, parseHTML: (el) => el.getAttribute("data-orig"), renderHTML: () => ({}) },
      ...placementAttrs,
    };
  },
  addNodeView() {
    const opts = this.options;
    return ({ node, getPos, editor }) => {
      const wrap = document.createElement("div");
      wrap.className = "word-image";
      const img = document.createElement("img");
      const handle = document.createElement("span");
      handle.className = "word-image-handle";
      handle.contentEditable = "false";
      wrap.append(img, handle);
      let cur = node;
      const paint = (n: PMNodeT) => {
        img.src = n.attrs.src;
        img.alt = n.attrs.alt || "";
        if (n.attrs.title) img.title = n.attrs.title;
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : "";
        img.style.height = n.attrs.width && n.attrs.height ? `${n.attrs.height}px` : "";
        wrap.style.textAlign = n.attrs.align || "";
        wrap.setAttribute("data-wrap", String(n.attrs.wrap || "inline"));
      };
      paint(node);
      img.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const p = typeof getPos === "function" ? getPos() : undefined;
        if (typeof p === "number" && editor.isEditable) opts.onOpen(p);
      });
      img.draggable = false;
      dragToMove(img, {
        editable: () => editor.isEditable,
        get: () => cur,
        pos: () => (typeof getPos === "function" ? getPos() : undefined),
        box: img,
        select: (p) => editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, p))),
        dispatch: (p, attrs) => editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, attrs)),
      });
      handle.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const w0 = img.offsetWidth || Number(cur.attrs.width) || 100;
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : (cur.attrs.height || 1) / (cur.attrs.width || 1);
        const r0 = (cur.attrs.height && cur.attrs.width ? cur.attrs.height / cur.attrs.width : ratio) || ratio;
        let w = w0;
        const move = (ev: PointerEvent) => {
          w = Math.max(16, Math.round(w0 + ev.clientX - startX));
          img.style.width = `${w}px`;
          img.style.height = `${Math.round(w * r0)}px`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (typeof pos === "number") editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: w, height: Math.round(w * r0) }));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      return {
        dom: wrap,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          paint(n);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-bg"),
    renderHTML: (a: Record<string, unknown>) => (a.background ? { "data-bg": a.background, style: `background-color: ${a.background}` } : {}),
  },
  borders: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-borders"),
    renderHTML: (a: Record<string, unknown>) => {
      if (!a.borders) return {};
      let b: Record<string, string> = {};
      try {
        b = JSON.parse(String(a.borders));
      } catch {
        return {};
      }
      const css = ["top", "right", "bottom", "left"]
        .filter((s) => typeof b[s] === "string" && /^[\w\s#.(),-]+$/.test(b[s]))
        .map((s) => `border-${s}: ${b[s]}`)
        .join("; ");
      return { "data-borders": a.borders, style: css };
    },
  },
  valign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-valign"),
    renderHTML: (a: Record<string, unknown>) => (a.valign ? { "data-valign": a.valign, style: `vertical-align: ${a.valign}` } : {}),
  },
};
export const WordTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});
export const WordTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs };
  },
});

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: () => ["div", { "data-page-break": "", class: "word-break", contenteditable: "false" }, ["span", {}, "Page break"]],
  addCommands() {
    return {
      // Like Word's Ctrl+Enter: the text after the cursor starts the next page.
      insertPageBreak:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          const br = state.schema.nodes.pageBreak.create();
          const para = state.schema.nodes.paragraph;
          if ($from.depth === 0) tr.insert($from.pos, [br, para.create()]);
          else if ($from.depth > 1 || !$from.parent.isTextblock) tr.insert($from.after(1), [br, para.create()]);
          else if ($from.parentOffset === 0 && $from.parent.content.size > 0) tr.insert($from.before(1), br);
          else if ($from.parentOffset === $from.parent.content.size) {
            const at = $from.after(1);
            tr.insert(at, [br, para.create()]);
            tr.setSelection(TextSelection.create(tr.doc, at + br.nodeSize + 1));
          } else {
            tr.split($from.pos);
            tr.insert($from.pos + 1, br);
          }
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertPageBreak() };
  },
});

/** Ends a section; carries that section's page setup, headers and footers as JSON. Its label
 * ("Section break (Next page)") comes from CSS on the data-next attribute the print layout sets. */
export const SectionBreak = Node.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      section: {
        default: "{}",
        parseHTML: (el) => el.getAttribute("data-section") || "{}",
        renderHTML: (a) => ({ "data-section": a.section }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-section-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-section-break": "", class: "word-break word-section-break", contenteditable: "false" }), ["span", {}]],
});

export const PageField = Node.create({
  name: "pageField",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { kind: { default: "page", parseHTML: (el) => el.getAttribute("data-field") || "page", renderHTML: (a) => ({ "data-field": a.kind }) } };
  },
  parseHTML: () => [{ tag: "span[data-field]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-field" }), node.attrs.kind === "pages" ? "#" : "#"],
});

/** Table of contents: lists the document's headings live, with page numbers from the print layout. */
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { pageOf: (_pos: number): string | null => null };
  },
  addAttributes() {
    return {
      levels: { default: 3, parseHTML: (el) => Number(el.getAttribute("data-levels")) || 3, renderHTML: (a) => ({ "data-levels": a.levels }) },
      title: { default: "Contents", parseHTML: (el) => el.getAttribute("data-title"), renderHTML: (a) => (a.title ? { "data-title": a.title } : {}) },
      /** a caption label ("Figure"): a table of figures instead of headings */
      caption: { default: null, parseHTML: (el) => el.getAttribute("data-caption"), renderHTML: (a) => (a.caption ? { "data-caption": a.caption } : {}) },
    };
  },
  parseHTML: () => [{ tag: "div[data-toc]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-toc": "", class: "word-toc" })],
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement("div");
      dom.className = "word-toc";
      dom.setAttribute("data-toc", "");
      if (node.attrs.caption) dom.setAttribute("data-caption", String(node.attrs.caption));
      dom.contentEditable = "false";
      let cur = node;
      let last = "";
      const render = () => {
        const cap = cur.attrs.caption as string | null;
        const entries = cap
          ? indexOf(editor.state.doc)
              .captions.filter((c) => c.label === cap)
              .map((c) => ({ level: 1, text: c.text, pos: c.pos, page: this.options.pageOf(c.pos) }))
          : tocEntries(editor, Number(cur.attrs.levels) || 3, this.options.pageOf);
        const key = JSON.stringify([cur.attrs.title, entries]);
        if (key === last) return;
        last = key;
        dom.replaceChildren();
        if (cur.attrs.title) {
          const t = document.createElement("div");
          t.className = "word-toc-title";
          t.textContent = String(cur.attrs.title);
          dom.append(t);
        }
        if (!entries.length) {
          const e = document.createElement("div");
          e.className = "word-toc-empty";
          e.textContent = cap ? `No table of figures entries found. Insert ${cap.toLowerCase()} captions to build one.` : "No table of contents entries found. Add headings to build one.";
          dom.append(e);
        }
        for (const e of entries) {
          const row = document.createElement("a");
          row.className = `word-toc-entry word-toc-l${e.level}`;
          row.href = "#";
          const text = document.createElement("span");
          text.textContent = e.text || "Heading";
          const dots = document.createElement("span");
          dots.className = "word-toc-dots";
          const page = document.createElement("span");
          page.textContent = e.page ?? "";
          row.append(text, dots, page);
          row.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            editor.chain().focus().setTextSelection(e.pos + 1).scrollIntoView().run();
            const el = editor.view.nodeDOM(e.pos) as HTMLElement | null;
            el?.scrollIntoView({ block: "center" });
          });
          dom.append(row);
        }
      };
      render();
      editor.on("transaction", render);
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          last = "";
          render();
          return true;
        },
        destroy: () => editor.off("transaction", render),
        ignoreMutation: () => true,
        stopEvent: (e) => e.type === "mousedown",
      };
    };
  },
});

export function tocEntries(editor: Editor, levels: number, pageOf: (pos: number) => string | null) {
  const out: { level: number; text: string; pos: number; page: string | null }[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "heading") {
      if (n.attrs.level <= levels) out.push({ level: n.attrs.level, text: n.textContent, pos, page: pageOf(pos) });
      return false;
    }
    return n.type.name !== "tableOfContents";
  });
  return out;
}

