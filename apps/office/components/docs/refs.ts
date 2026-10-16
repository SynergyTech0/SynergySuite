// Bookmarks, caption numbers (SEQ fields) and cross-references (REF/PAGEREF)
// as inline nodes. Numbers and reference text are worked out from the whole
// document (lib/docs/fields.ts) and redrawn after every change, so they stay
// current like Word's fields after "Update field" — without needing F9.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { fieldIndex, refText, seqText, type FieldIndex, type RefShow, type BookmarkInfo } from "@/lib/docs/fields";

const cache = new WeakMap<PMNodeT, FieldIndex>();
/** The field index of a document, computed once per document version. */
export function indexOf(doc: PMNodeT): FieldIndex {
  let ix = cache.get(doc);
  if (!ix) {
    ix = fieldIndex(doc as never);
    cache.set(doc, ix);
  }
  return ix;
}

/** Jump to a bookmark: put the cursor there and scroll it into view. */
export function goToBookmark(editor: Editor, name: string): boolean {
  const b = indexOf(editor.state.doc).bookmarks.get(name);
  if (!b) return false;
  const pos = Math.min(b.pos + 1, editor.state.doc.content.size);
  editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  try {
    (editor.view.domAtPos(pos).node as HTMLElement)?.parentElement?.scrollIntoView({ block: "center" });
  } catch {
    /* not rendered */
  }
  return true;
}

/** Bookmarks people can see in the Bookmark dialog (not Word's hidden _Ref/_Toc ones). */
export function bookmarkNames(state: EditorState, hidden = false): string[] {
  return [...indexOf(state.doc).bookmarks.keys()].filter((n) => hidden || !n.startsWith("_"));
}

/** Position of an existing bookmark at the start of the textblock that holds `pos`, if any. */
export function bookmarkAtBlockStart(state: EditorState, pos: number): string | null {
  const $p = state.doc.resolve(pos);
  const block = $p.parent.isTextblock ? $p.parent : null;
  if (!block) return null;
  let found: string | null = null;
  block.forEach((n) => {
    if (!found && n.type.name === "bookmark") found = String(n.attrs.name);
  });
  return found;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    refs: {
      /** add a bookmark at the cursor */
      addBookmark: (name: string) => ReturnType;
      /** remove a bookmark by name */
      deleteBookmark: (name: string) => ReturnType;
    };
  }
}

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      name: { default: "", parseHTML: (el) => el.getAttribute("data-bookmark") || "", renderHTML: (a) => ({ "data-bookmark": a.name }) },
      span: { default: "para", parseHTML: (el) => el.getAttribute("data-span") || "para", renderHTML: (a) => ({ "data-span": a.span }) },
    };
  },
  parseHTML: () => [{ tag: "span[data-bookmark]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-bookmark", contenteditable: "false" })],
  addCommands() {
    return {
      addBookmark:
        (name) =>
        ({ state, tr, dispatch }) => {
          if (!name || indexOf(state.doc).bookmarks.has(name)) return false;
          // Word moves a same-named bookmark; ours are unique, so adding one that exists fails
          const at = state.selection.from;
          tr.insert(at, state.schema.nodes.bookmark.create({ name, span: "para" }));
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
          if (dispatch) dispatch(tr);
          return true;
        },
      deleteBookmark:
        (name) =>
        ({ state, tr, dispatch }) => {
          let at = -1;
          state.doc.descendants((n, pos) => {
            if (at < 0 && n.type.name === "bookmark" && n.attrs.name === name) at = pos;
            return at < 0;
          });
          if (at < 0) return false;
          tr.delete(at, at + 1);
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});

/** A live-updating inline field: the node view redraws its text on every transaction. */
export function liveView(editor: Editor, node: PMNodeT, getPos: () => number | undefined, cls: string, text: (n: PMNodeT, pos: number) => string, onClick?: (n: PMNodeT, e: MouseEvent) => void) {
  const dom = document.createElement("span");
  dom.className = cls;
  dom.contentEditable = "false";
  let cur = node;
  for (const [k, v] of Object.entries(cur.attrs)) dom.setAttribute(`data-${k}`, String(v));
  const render = () => {
    const pos = getPos();
    if (pos === undefined) return;
    const t = text(cur, pos);
    if (dom.textContent !== t) dom.textContent = t;
  };
  render();
  editor.on("transaction", render);
  if (onClick) dom.addEventListener("click", (e) => onClick(cur, e));
  return {
    dom,
    update: (n: PMNodeT) => {
      if (n.type !== cur.type) return false;
      cur = n;
      for (const [k, v] of Object.entries(cur.attrs)) dom.setAttribute(`data-${k}`, String(v));
      render();
      return true;
    },
    destroy: () => editor.off("transaction", render),
    ignoreMutation: () => true,
  };
}

/** A caption number: SEQ Figure, SEQ Table… counted in document order. */
export const SeqField = Node.create({
  name: "seqField",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      name: { default: "Figure", parseHTML: (el) => el.getAttribute("data-seq") || "Figure", renderHTML: (a) => ({ "data-seq": a.name }) },
      format: { default: null, parseHTML: (el) => el.getAttribute("data-format"), renderHTML: (a) => (a.format ? { "data-format": a.format } : {}) },
    };
  },
  parseHTML: () => [{ tag: "span[data-seq]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-field word-seq" }), "#"],
  addNodeView() {
    return ({ editor, node, getPos }) =>
      liveView(editor, node, getPos as () => number | undefined, "word-field word-seq", (n, pos) => seqText(indexOf(editor.state.doc).seq.get(pos) || 1, n.attrs.format || undefined));
  },
});

/** A cross-reference to a bookmark (a caption, heading or named bookmark). Ctrl+click follows it. */
export const CrossRef = Node.create<{ pageOf: (state: EditorState, pos: number) => string | null }>({
  name: "crossRef",
  group: "inline",
  inline: true,
  atom: true,
  addOptions() {
    return { pageOf: () => null };
  },
  addAttributes() {
    return {
      target: { default: "", parseHTML: (el) => el.getAttribute("data-ref") || "", renderHTML: (a) => ({ "data-ref": a.target }) },
      show: { default: "text", parseHTML: (el) => el.getAttribute("data-show") || "text", renderHTML: (a) => ({ "data-show": a.show }) },
      link: { default: true, parseHTML: (el) => el.getAttribute("data-link") !== "false", renderHTML: (a) => ({ "data-link": String(a.link !== false) }) },
      // Word's switches beyond the plain forms (REF \n \p, PAGEREF \p, \* Upper…), kept and applied
      switches: { default: null, parseHTML: (el) => el.getAttribute("data-switches"), renderHTML: (a) => (a.switches ? { "data-switches": a.switches } : {}) },
    };
  },
  parseHTML: () => [{ tag: "span[data-ref]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-field word-xref" })],
  addNodeView() {
    const opts = this.options;
    return ({ editor, node, getPos }) => {
      const v = liveView(
        editor,
        node,
        getPos as () => number | undefined,
        "word-field word-xref",
        (n, pos) =>
          refText(indexOf(editor.state.doc), String(n.attrs.target), n.attrs.show as RefShow, {
            refPos: pos,
            page: (b: BookmarkInfo) => opts.pageOf(editor.state, b.pos),
            switches: n.attrs.switches,
            refPage: opts.pageOf(editor.state, pos),
          }),
        (n, e) => {
          if (!(e.ctrlKey || e.metaKey) && editor.isEditable) return;
          e.preventDefault();
          goToBookmark(editor, String(n.attrs.target));
        },
      );
      v.dom.title = "Ctrl+click to follow the reference";
      return v;
    };
  },
});
