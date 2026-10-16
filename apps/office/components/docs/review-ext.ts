// Review helpers in the editor: the read-aloud highlight (the paragraph being
// read and the word being spoken) and positions for paths from the
// accessibility checker.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNodeT } from "@tiptap/pm/model";

export type ReadAloudMark = { from: number; to: number; word?: { from: number; to: number } } | null;
export const readAloudKey = new PluginKey<ReadAloudMark>("readAloud");

export const ReviewTools = Extension.create<{ onThesaurus: () => void; onReadAloud: () => void }>({
  name: "reviewTools",
  addOptions() {
    return { onThesaurus: () => {}, onReadAloud: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      "Shift-F7": () => (this.options.onThesaurus(), true),
      "Mod-Alt-Space": () => (this.options.onReadAloud(), true),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<ReadAloudMark>({
        key: readAloudKey,
        state: {
          init: () => null,
          apply: (tr, v) => {
            const m = tr.getMeta(readAloudKey);
            if (m !== undefined) return m as ReadAloudMark;
            if (!v || !tr.docChanged) return v;
            const from = tr.mapping.map(v.from);
            const to = tr.mapping.map(v.to);
            return { from, to, word: v.word ? { from: tr.mapping.map(v.word.from), to: tr.mapping.map(v.word.to) } : undefined };
          },
        },
        props: {
          decorations(state) {
            const m = readAloudKey.getState(state);
            if (!m) return null;
            const d = [Decoration.inline(m.from, m.to, { class: "read-aloud-block" })];
            if (m.word && m.word.to > m.word.from) d.push(Decoration.inline(m.word.from, m.word.to, { class: "read-aloud-word" }));
            return DecorationSet.create(state.doc, d);
          },
        },
      }),
    ];
  },
});

/** Document position of the node at a path of child indexes (top-level index first). */
export function posOfPath(doc: PMNodeT, path: number[]): number {
  let pos = 0;
  let node = doc;
  for (const i of path) {
    if (i >= node.childCount) break;
    let off = 0;
    for (let k = 0; k < i; k++) off += node.child(k).nodeSize;
    pos += off + (node === doc ? 0 : 1);
    node = node.child(i);
  }
  return pos;
}

/** The text blocks from `from` on, each with its text and a map from text offsets to positions (for read aloud). */
export function readingBlocks(state: EditorState, from: number): { from: number; to: number; text: string; posAt: (i: number) => number }[] {
  const out: { from: number; to: number; text: string; posAt: (i: number) => number }[] = [];
  state.doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    if (pos + n.nodeSize < from) return false;
    const starts: { i: number; pos: number }[] = [];
    let text = "";
    n.forEach((c, off) => {
      if (c.isText) {
        starts.push({ i: text.length, pos: pos + 1 + off });
        text += c.text;
      } else if (c.type.name === "hardBreak") text += "\n";
    });
    if (text.trim())
      out.push({
        from: pos + 1,
        to: pos + n.nodeSize - 1,
        text,
        posAt: (i: number) => {
          let s = starts[0];
          for (const x of starts) if (x.i <= i) s = x;
          return s ? s.pos + (i - s.i) : pos + 1;
        },
      });
    return false;
  });
  return out;
}
