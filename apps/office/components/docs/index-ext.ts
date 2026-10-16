// Index entries (Word's XE fields, hidden unless formatting marks are shown)
// and the index itself, built live from the entries with page numbers from the
// print layout.
import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { buildIndex, xeInstr, type IndexEntryAttrs, type IndexItem, type IndexOptions } from "@/lib/docs/word-index";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordIndex: {
      markIndexEntry: (a: IndexEntryAttrs, opts?: { all?: string }) => ReturnType;
      insertIndex: (o: IndexOptions) => ReturnType;
      setIndexOptions: (pos: number, o: Partial<IndexOptions>) => ReturnType;
    };
  }
}

/** The index entries of a document with their positions, in order. */
export function indexEntriesOf(doc: PMNodeT): (IndexEntryAttrs & { pos: number })[] {
  const out: (IndexEntryAttrs & { pos: number })[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "indexEntry") out.push({ entry: String(n.attrs.entry || ""), bold: !!n.attrs.bold, italic: !!n.attrs.italic, see: n.attrs.see || null, pos });
  });
  return out;
}

export const IndexEntry = Node.create({
  name: "indexEntry",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      entry: { default: "", parseHTML: (el) => el.getAttribute("data-xe") || "", renderHTML: (a) => ({ "data-xe": a.entry }) },
      bold: { default: false, parseHTML: (el) => el.hasAttribute("data-xe-b"), renderHTML: (a) => (a.bold ? { "data-xe-b": "" } : {}) },
      italic: { default: false, parseHTML: (el) => el.hasAttribute("data-xe-i"), renderHTML: (a) => (a.italic ? { "data-xe-i": "" } : {}) },
      see: { default: null, parseHTML: (el) => el.getAttribute("data-xe-see"), renderHTML: (a) => (a.see ? { "data-xe-see": a.see } : {}) },
    };
  },
  parseHTML: () => [{ tag: "span[data-xe]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-xe", contenteditable: "false" }), `{ ${xeInstr(node.attrs as IndexEntryAttrs)} }`],
  addCommands() {
    return {
      markIndexEntry:
        (a, opts) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.indexEntry;
          const at: number[] = [];
          if (opts?.all) {
            // after every occurrence of the text (whole words, any case)
            const re = new RegExp(`(?<![\\p{L}\\p{N}_])${opts.all.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu");
            state.doc.descendants((n, pos) => {
              if (!n.isText) return true;
              for (const m of n.text!.matchAll(re)) at.push(pos + m.index! + m[0].length);
              return false;
            });
          } else at.push(state.selection.to);
          if (!at.length) return false;
          if (dispatch) {
            for (const p of at.sort((x, y) => y - x)) tr.insert(p, type.create({ entry: a.entry, bold: !!a.bold, italic: !!a.italic, see: a.see || null }));
            dispatch(tr);
          }
          return true;
        },
      insertIndex:
        (o) =>
        ({ commands }) =>
          commands.insertContent({ type: "wordIndex", attrs: { columns: o.columns, rightAlign: o.rightAlign, headings: o.headings } }),
      setIndexOptions:
        (pos, o) =>
        ({ state, tr, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (n?.type.name !== "wordIndex") return false;
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...o }));
          return true;
        },
    };
  },
});

export const WordIndex = Node.create<{ pageOf: (pos: number) => string | null; onOpen: (pos: number) => void }>({
  name: "wordIndex",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { pageOf: () => null, onOpen: () => {} };
  },
  addAttributes() {
    return {
      columns: { default: 2, parseHTML: (el) => Number(el.getAttribute("data-columns")) || 2, renderHTML: (a) => ({ "data-columns": a.columns }) },
      rightAlign: { default: false, parseHTML: (el) => el.hasAttribute("data-right"), renderHTML: (a) => (a.rightAlign ? { "data-right": "" } : {}) },
      headings: { default: true, parseHTML: (el) => el.getAttribute("data-headings") !== "0", renderHTML: (a) => ({ "data-headings": a.headings ? "1" : "0" }) },
    };
  },
  parseHTML: () => [{ tag: "div[data-word-index]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-word-index": "", class: "word-index" })],
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "word-index";
      dom.setAttribute("data-word-index", "");
      dom.contentEditable = "false";
      let cur = node;
      let last = "";
      const render = () => {
        const entries = indexEntriesOf(editor.state.doc).map((e) => ({ ...e, page: this.options.pageOf(e.pos) ?? "1" }));
        const groups = buildIndex(entries);
        const key = JSON.stringify([cur.attrs, groups]);
        if (key === last) return;
        last = key;
        dom.replaceChildren();
        dom.style.columnCount = String(cur.attrs.columns || 1);
        dom.classList.toggle("word-index-right", !!cur.attrs.rightAlign);
        if (!groups.length) {
          const e = document.createElement("div");
          e.className = "word-toc-empty";
          e.textContent = "No index entries found. Mark entries with References › Mark entry.";
          dom.append(e);
          return;
        }
        const line = (it: IndexItem, level: number) => {
          const row = document.createElement("div");
          row.className = `word-index-entry word-index-l${level}`;
          const text = document.createElement("span");
          text.textContent = it.text;
          row.append(text);
          if (it.see || it.pages.length) {
            if (cur.attrs.rightAlign && !it.see) {
              const dots = document.createElement("span");
              dots.className = "word-toc-dots";
              row.append(dots);
            } else row.append(document.createTextNode(", "));
            const pages = document.createElement("span");
            pages.className = "word-index-pages";
            if (it.see) {
              const i = document.createElement("i");
              i.textContent = "See";
              pages.append(i, ` ${it.see}`);
            } else
              it.pages.forEach((p, k) => {
                if (k) pages.append(", ");
                const el = document.createElement(p.bold ? "b" : p.italic ? "i" : "span");
                el.textContent = p.label;
                pages.append(el);
              });
            row.append(pages);
          }
          dom.append(row);
          for (const s of it.subs) line(s, level + 1);
        };
        for (const g of groups) {
          if (cur.attrs.headings) {
            const h = document.createElement("div");
            h.className = "word-index-heading";
            h.textContent = g.letter === "*" ? "Symbols" : g.letter === "#" ? "Numbers" : g.letter;
            dom.append(h);
          }
          for (const it of g.items) line(it, 1);
        }
      };
      render();
      editor.on("transaction", render);
      dom.addEventListener("dblclick", () => {
        const pos = (getPos as () => number | undefined)();
        if (typeof pos === "number" && editor.isEditable) this.options.onOpen(pos);
      });
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
      };
    };
  },
});
