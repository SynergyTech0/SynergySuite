// Footnotes and endnotes. A note is an inline reference mark in the text that
// carries the note's own content (a small document) in an attribute, so it
// moves, copies and deletes with its reference. Footnotes are numbered 1, 2,
// 3… and print at the foot of the page that holds the reference; endnotes are
// numbered i, ii, iii… and print at the end of the document.
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { formatPageNumber, type PMNode } from "@/lib/docs/model";

export type NoteKind = "footnote" | "endnote";
export type NoteInfo = { pos: number; kind: NoteKind; num: number; label: string; content: PMNode; index: number };

export const EMPTY_NOTE: PMNode = { type: "doc", content: [{ type: "paragraph" }] };

export function parseNote(v: unknown): PMNode {
  if (v && typeof v === "object") return v as PMNode;
  if (typeof v !== "string" || !v) return EMPTY_NOTE;
  try {
    const d = JSON.parse(v) as PMNode;
    return d && d.type === "doc" ? d : EMPTY_NOTE;
  } catch {
    return EMPTY_NOTE;
  }
}

export const noteLabel = (kind: NoteKind, num: number) => (kind === "endnote" ? formatPageNumber(num, "lowerRoman") : String(num));

/** Every note in document order, numbered per kind (footnotes 1, 2…; endnotes i, ii…). */
export function notesOf(doc: PMNodeT | PMNode): NoteInfo[] {
  const out: NoteInfo[] = [];
  const count = { footnote: 0, endnote: 0 };
  const visit = (kind: NoteKind, content: unknown, pos: number) => {
    const num = ++count[kind];
    out.push({ pos, kind, num, label: noteLabel(kind, num), content: parseNote(content), index: out.length });
  };
  if ("descendants" in doc && typeof doc.descendants === "function") {
    (doc as PMNodeT).descendants((n, pos) => {
      if (n.type.name === "noteRef") visit(n.attrs.kind === "endnote" ? "endnote" : "footnote", n.attrs.content, pos);
      return true;
    });
  } else {
    let pos = 0;
    const walk = (n: PMNode) => {
      if (n.type === "noteRef") visit(n.attrs?.kind === "endnote" ? "endnote" : "footnote", n.attrs?.content, pos);
      pos++;
      n.content?.forEach(walk);
    };
    walk(doc as PMNode);
  }
  return out;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    notes: {
      /** insert a footnote or endnote reference at the cursor (empty note) */
      insertNote: (kind: NoteKind, content?: PMNode) => ReturnType;
      /** replace the content of the note whose reference is at `pos` */
      setNoteContent: (pos: number, content: PMNode) => ReturnType;
    };
  }
}

export const NoteRef = Node.create<{ onOpen: (pos: number) => void }>({
  name: "noteRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {} };
  },
  addAttributes() {
    return {
      kind: { default: "footnote", parseHTML: (el) => (el.getAttribute("data-note") === "endnote" ? "endnote" : "footnote"), renderHTML: (a) => ({ "data-note": a.kind }) },
      content: {
        default: JSON.stringify(EMPTY_NOTE),
        parseHTML: (el) => el.getAttribute("data-content") || JSON.stringify(EMPTY_NOTE),
        renderHTML: (a) => ({ "data-content": typeof a.content === "string" ? a.content : JSON.stringify(a.content) }),
      },
    };
  },
  parseHTML: () => [{ tag: "sup[data-note]" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes, { class: "note-ref", title: "Double-click to edit the note" })],
  addCommands() {
    return {
      insertNote:
        (kind, content) =>
        ({ chain }) =>
          chain().insertContent({ type: "noteRef", attrs: { kind, content: JSON.stringify(content || EMPTY_NOTE) } }).run(),
      setNoteContent:
        (pos, content) =>
        ({ state, tr, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (!n || n.type.name !== "noteRef") return false;
          tr.setNodeMarkup(pos, undefined, { ...n.attrs, content: JSON.stringify(content) });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": () => this.editor.isEditable && this.editor.commands.insertNote("footnote") && (this.options.onOpen(this.editor.state.selection.from - 1), true),
      "Mod-Alt-d": () => this.editor.isEditable && this.editor.commands.insertNote("endnote") && (this.options.onOpen(this.editor.state.selection.from - 1), true),
    };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        props: {
          handleDoubleClickOn: (_view, _pos, node, nodePos) => {
            if (node.type.name !== "noteRef") return false;
            opts.onOpen(nodePos);
            return true;
          },
        },
      }),
    ];
  },
});
