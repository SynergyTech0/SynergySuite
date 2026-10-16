// Bullets and numbering: the list library (number formats, multilevel legal
// numbering, bullet characters), restart at 1, continue numbering from the
// previous list, and set numbering value.
import type { Editor } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";

export const NUMBER_FORMATS: { id: string; label: string; numFmt: string; lvlText?: string }[] = [
  { id: "decimal", label: "1. 2. 3.", numFmt: "decimal" },
  { id: "decimalParen", label: "1) 2) 3)", numFmt: "decimal", lvlText: "%1)" },
  { id: "upperLetter", label: "A. B. C.", numFmt: "upperLetter" },
  { id: "lowerLetter", label: "a. b. c.", numFmt: "lowerLetter" },
  { id: "lowerLetterParen", label: "a) b) c)", numFmt: "lowerLetter", lvlText: "%1)" },
  { id: "upperRoman", label: "I. II. III.", numFmt: "upperRoman" },
  { id: "lowerRoman", label: "i. ii. iii.", numFmt: "lowerRoman" },
  { id: "legal", label: "1.1, 1.1.1 (legal)", numFmt: "decimal", lvlText: "%1.%2." },
];
export const BULLETS: { id: string; label: string }[] = [
  { id: "disc", label: "● Filled circle" },
  { id: "circle", label: "○ Hollow circle" },
  { id: "square", label: "■ Square" },
  { id: "➢", label: "➢ Arrow" },
  { id: "✓", label: "✓ Check mark" },
  { id: "–", label: "– Dash" },
  { id: "◆", label: "◆ Diamond" },
];

/** The innermost list around the selection: its node and position. */
export function listAt(editor: Editor, type?: "orderedList" | "bulletList"): { node: PMNodeT; pos: number } | null {
  const $p = editor.state.selection.$from;
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if ((type ? n.type.name === type : n.type.name === "orderedList" || n.type.name === "bulletList")) return { node: n, pos: $p.before(d) };
  }
  return null;
}

function setAttrs(editor: Editor, pos: number, attrs: Record<string, unknown>) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const n = tr.doc.nodeAt(pos);
      if (!n) return false;
      tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs });
      return true;
    })
    .run();
}

export function applyNumberFormat(editor: Editor, id: string) {
  const f = NUMBER_FORMATS.find((x) => x.id === id);
  if (!f) return;
  let l = listAt(editor, "orderedList");
  if (!l) {
    editor.chain().focus().toggleOrderedList().run();
    l = listAt(editor, "orderedList");
  }
  if (l) setAttrs(editor, l.pos, { numFmt: f.numFmt === "decimal" && !f.lvlText ? null : f.numFmt, lvlText: f.lvlText || null });
}

export function applyBullet(editor: Editor, bullet: string) {
  let l = listAt(editor, "bulletList");
  if (!l) {
    editor.chain().focus().toggleBulletList().run();
    l = listAt(editor, "bulletList");
  }
  if (l) setAttrs(editor, l.pos, { bullet: bullet === "disc" ? null : bullet });
}

/** How many numbers the ordered list before `pos` (at the same depth) used, and where it started. */
function previousList(editor: Editor, pos: number): { start: number; count: number } | null {
  const $p = editor.state.doc.resolve(pos);
  const parent = $p.parent;
  const index = $p.index();
  for (let i = index - 1; i >= 0; i--) {
    const n = parent.child(i);
    if (n.type.name === "orderedList") return { start: Number(n.attrs.start ?? 1), count: n.childCount };
  }
  return null;
}

export function restartNumbering(editor: Editor) {
  const l = listAt(editor, "orderedList");
  if (l) setAttrs(editor, l.pos, { start: 1 });
}

export function continueNumbering(editor: Editor): boolean {
  const l = listAt(editor, "orderedList");
  if (!l) return false;
  const prev = previousList(editor, l.pos);
  if (!prev) return false;
  setAttrs(editor, l.pos, { start: prev.start + prev.count });
  return true;
}

export function setNumberingValue(editor: Editor, n: number) {
  const l = listAt(editor, "orderedList");
  if (l && n >= 0) setAttrs(editor, l.pos, { start: Math.round(n) });
}
