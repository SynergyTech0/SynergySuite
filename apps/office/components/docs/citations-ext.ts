// In-text citations and the bibliography block. Both redraw from the
// document's sources and citation style (document settings) on every change,
// so switching APA to IEEE or editing a source updates them at once.
import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { bibliography, citationOrder, citationText, CITATION_STYLES, type CitationStyle, type Source } from "@/lib/docs/citations";
import { liveView } from "./refs";

export type CiteSetup = () => { sources: Source[]; style: CitationStyle };

const citedCache = new WeakMap<PMNodeT, string[]>();
/** Source tags in the order they are first cited. */
export function citedTags(doc: PMNodeT): string[] {
  let t = citedCache.get(doc);
  if (!t) {
    const out: string[] = [];
    doc.descendants((n) => {
      if (n.type.name === "citation") for (const x of String(n.attrs.tags || "").split(",")) if (x && !out.includes(x)) out.push(x);
      return true;
    });
    citedCache.set(doc, (t = out));
  }
  return t;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citations: {
      insertCitation: (tags: string[], pages?: string) => ReturnType;
    };
  }
}

export const Citation = Node.create<{ setup: CiteSetup; onOpen: (pos: number) => void }>({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  addOptions() {
    return { setup: () => ({ sources: [], style: "APA" as CitationStyle }), onOpen: () => {} };
  },
  addAttributes() {
    return {
      tags: { default: "", parseHTML: (el) => el.getAttribute("data-cite") || "", renderHTML: (a) => ({ "data-cite": a.tags }) },
      pages: { default: null, parseHTML: (el) => el.getAttribute("data-pages"), renderHTML: (a) => (a.pages ? { "data-pages": a.pages } : {}) },
    };
  },
  parseHTML: () => [{ tag: "span[data-cite]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-field word-cite" })],
  addCommands() {
    return {
      insertCitation:
        (tags, pages) =>
        ({ chain }) =>
          chain().insertContent({ type: "citation", attrs: { tags: tags.join(","), pages: pages || null } }).run(),
    };
  },
  addNodeView() {
    const opts = this.options;
    return ({ editor, node, getPos }) => {
      const v = liveView(editor, node, getPos as () => number | undefined, "word-field word-cite", (n) => {
        const { sources, style } = opts.setup();
        const tags = String(n.attrs.tags || "").split(",").filter(Boolean);
        return citationText(sources, tags, style, n.attrs.pages || undefined, style === "IEEE" ? citationOrder(sources, citedTags(editor.state.doc)) : undefined);
      });
      v.dom.title = "Double-click to edit the citation";
      v.dom.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const p = (getPos as () => number | undefined)();
        if (p !== undefined && editor.isEditable) opts.onOpen(p);
      });
      return v;
    };
  },
});

/** The bibliography: a heading and one entry per source, in the citation style. */
export const Bibliography = Node.create<{ setup: CiteSetup }>({
  name: "bibliography",
  group: "block",
  atom: true,
  selectable: true,
  addOptions() {
    return { setup: () => ({ sources: [], style: "APA" as CitationStyle }) };
  },
  addAttributes() {
    return { title: { default: null, parseHTML: (el) => el.getAttribute("data-title"), renderHTML: (a) => (a.title ? { "data-title": a.title } : {}) } };
  },
  parseHTML: () => [{ tag: "div[data-bibliography]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-bibliography": "", class: "word-bib" })],
  addNodeView() {
    const opts = this.options;
    return ({ editor, node }) => {
      const dom = document.createElement("div");
      dom.className = "word-bib";
      dom.setAttribute("data-bibliography", "");
      dom.contentEditable = "false";
      let cur = node;
      let last = "";
      const render = () => {
        const { sources, style } = opts.setup();
        const entries = bibliography(sources, style, citedTags(editor.state.doc));
        const title = (cur.attrs.title as string | null) ?? CITATION_STYLES.find((c) => c.id === style)?.title ?? "Bibliography";
        const key = JSON.stringify([title, style, entries]);
        if (key === last) return;
        last = key;
        dom.replaceChildren();
        const h = document.createElement("h1");
        h.className = "word-bib-title";
        h.textContent = title;
        dom.append(h);
        if (!entries.length) {
          const e = document.createElement("p");
          e.className = "word-bib-empty";
          e.textContent = "There are no sources in the current document.";
          dom.append(e);
        }
        for (const e of entries) {
          const p = document.createElement("p");
          p.className = `word-bib-entry${style === "IEEE" ? " word-bib-num" : ""}`;
          p.setAttribute("data-style", "Bibliography");
          for (const s of e.segs) {
            const parts = s.text.split("\t");
            parts.forEach((t, k) => {
              if (k) p.append(Object.assign(document.createElement("span"), { className: "word-bib-tab" }));
              if (!t) return;
              if (s.italic) p.append(Object.assign(document.createElement("i"), { textContent: t }));
              else p.append(document.createTextNode(t));
            });
          }
          dom.append(p);
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
      };
    };
  },
});
