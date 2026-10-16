// Document fields (Insert > Field): DATE, TIME, FILENAME, AUTHOR, NUMPAGES,
// NUMWORDS... and table formulas (=SUM(ABOVE)). Each is an inline atom with
// Word's field instruction and its last result; dates and counts redraw live,
// formulas keep their result until fields are updated (F9), as in Word.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { fieldArgs, fieldKind, fieldResult, type FieldContext } from "@/lib/docs/doc-fields";
import { indexOf, liveView } from "./refs";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docField: {
      insertDocField: (instr: string) => ReturnType;
      /** update every field's stored result (or the selected ones), like F9 */
      updateDocFields: () => ReturnType;
      setDocFieldInstr: (pos: number, instr: string) => ReturnType;
    };
  }
}

export type FieldEnv = {
  base: () => Omit<FieldContext, "page" | "table" | "words" | "chars" | "now">;
  pageOf: (state: EditorState, pos: number) => string | null;
  pages: (state: EditorState) => number | null;
};

const leaf = (n: PMNodeT) => (n.type.name === "docField" ? String(n.attrs.result || "") : n.type.name === "hardBreak" ? "\n" : "");

/** The grid of cell texts of the table around `pos`, and the field's row and column in it. */
export function tableGridAt(state: EditorState, pos: number): FieldContext["table"] | undefined {
  const $p = state.doc.resolve(pos);
  let td = -1;
  for (let d = $p.depth; d > 0; d--)
    if ($p.node(d).type.name === "table") {
      td = d;
      break;
    }
  if (td < 0) return undefined;
  const table = $p.node(td);
  const cellPos = $p.depth > td + 1 ? $p.before(td + 2) : -1;
  const cells: string[][] = [];
  let row = 0;
  let col = 0;
  const tStart = $p.before(td) + 1;
  // grid placement following colspans (rowspans count once, in their first row)
  table.forEach((r, roff, ri) => {
    const line: string[] = [];
    r.forEach((cell, coff) => {
      const p = tStart + roff + 1 + coff;
      if (p === cellPos) {
        row = ri;
        col = line.length;
      }
      const text = cell.textBetween(0, cell.content.size, " ", leaf).trim();
      const span = Number(cell.attrs.colspan) || 1;
      for (let k = 0; k < span; k++) line.push(k ? "" : text);
    });
    cells.push(line);
  });
  return { cells, row, col };
}

function counts(state: EditorState) {
  const text = state.doc.textBetween(0, state.doc.content.size, " ", leaf);
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, chars: text.replace(/\s/g, "").length };
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** The text of the nearest paragraph in a style: before `pos` (searching up), else after it. */
function styleRefText(state: EditorState, pos: number, style: string): string | null {
  const want = norm(style);
  let before: string | null = null;
  let after: string | null = null;
  state.doc.descendants((n, p) => {
    if (!n.isTextblock) return true;
    const id = n.type.name === "heading" ? `heading${n.attrs.level}` : norm(String(n.attrs.styleId || (n.type.name === "paragraph" ? "Normal" : "")));
    if (id === want && n.textContent.trim()) {
      if (p < pos) before = n.textContent.trim();
      else if (after === null) after = n.textContent.trim();
    }
    return false;
  });
  return before ?? after;
}

/** The number of the footnote or endnote a bookmark marks (the first note at or after it). */
function noteRefText(state: EditorState, name: string): string | null {
  const b = indexOf(state.doc).bookmarks.get(name);
  if (!b) return null;
  const seen = { footnote: 0, endnote: 0 };
  let found: string | null = null;
  state.doc.descendants((n, p) => {
    if (found !== null) return false;
    if (n.type.name === "noteRef") {
      const kind = n.attrs.kind === "endnote" ? "endnote" : "footnote";
      seen[kind]++;
      if (p >= b.pos) found = String(seen[kind]);
    }
    return true;
  });
  return found;
}

/** Values of SET fields before `pos`, and the section `pos` is in. */
function setsAndSection(state: EditorState, pos: number): { sets: Record<string, string>; section: number } {
  const sets: Record<string, string> = {};
  let section = 1;
  state.doc.descendants((n, p) => {
    if (p >= pos) return false;
    if (n.type.name === "sectionBreak") section++;
    if (n.type.name === "docField") {
      const a = fieldArgs(String(n.attrs.instr));
      if (a[0]?.toUpperCase() === "SET" && a[1]) sets[a[1]] = a.slice(2).filter((x) => !x.startsWith("\\")).join(" ");
    }
    return true;
  });
  return { sets, section };
}

/** The text a field shows at `pos` (`stored` for fields we don't evaluate). */
export function docFieldText(state: EditorState, env: FieldEnv, instr: string, pos: number, stored = ""): string {
  const kind = fieldKind(instr);
  const nested = instr.includes("{");
  const all = nested || kind === "IF" || kind === "COMPARE" || kind === "DOCPROPERTY" || kind === "INFO";
  const c = all || kind === "NUMWORDS" || kind === "NUMCHARS" ? counts(state) : { words: 0, chars: 0 };
  const ss = all || kind === "SECTION" || kind === "SET" ? setsAndSection(state, pos) : { sets: {}, section: 1 };
  return fieldResult(
    instr,
    {
      ...env.base(),
      now: new Date(),
      page: all || kind === "PAGE" ? env.pageOf(state, pos) : null,
      pages: all || kind === "NUMPAGES" || kind === "SECTIONPAGES" ? env.pages(state) : null,
      words: c.words,
      chars: c.chars,
      table: all || kind === "=" ? tableGridAt(state, pos) : undefined,
      bookmark: (name) => indexOf(state.doc).bookmarks.get(name)?.text ?? null,
      styleRef: (style) => styleRefText(state, pos, style),
      noteRef: (name) => noteRefText(state, name),
      sets: ss.sets,
      section: ss.section,
    },
    stored,
  );
}

export const DocField = Node.create<{ env: FieldEnv; onEdit: (pos: number) => void }>({
  name: "docField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { env: { base: () => ({}), pageOf: () => null, pages: () => null }, onEdit: () => {} };
  },
  addAttributes() {
    return {
      instr: { default: "DATE", parseHTML: (el) => el.getAttribute("data-doc-field") || "DATE", renderHTML: (a) => ({ "data-doc-field": a.instr }) },
      result: { default: "", parseHTML: (el) => el.textContent || "", renderHTML: () => ({}) },
    };
  },
  parseHTML: () => [{ tag: "span[data-doc-field]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "word-field" }), String(node.attrs.result || "")],
  renderText: ({ node }) => String(node.attrs.result || ""),
  addNodeView() {
    return ({ node, editor, getPos }) =>
      liveView(
        editor as Editor,
        node,
        getPos as () => number | undefined,
        "word-field word-docfield",
        // formulas show their stored result (updated by F9); the rest are live
        (n, pos) => (fieldKind(String(n.attrs.instr)) === "=" && n.attrs.result ? String(n.attrs.result) : docFieldText(editor.state, this.options.env, String(n.attrs.instr), pos, String(n.attrs.result || ""))),
        (_n, e) => {
          if (e.detail >= 2) {
            const pos = (getPos as () => number | undefined)();
            if (pos !== undefined) this.options.onEdit(pos);
          }
        },
      );
  },
  addCommands() {
    return {
      insertDocField:
        (instr) =>
        ({ state, tr, dispatch }) => {
          const pos = state.selection.from;
          const result = docFieldText(state, this.options.env, instr, pos);
          if (dispatch) tr.replaceSelectionWith(state.schema.nodes.docField.create({ instr, result }), true);
          return true;
        },
      setDocFieldInstr:
        (pos, instr) =>
        ({ state, tr, dispatch }) => {
          const n = state.doc.nodeAt(pos);
          if (!n || n.type.name !== "docField") return false;
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...n.attrs, instr, result: docFieldText(state, this.options.env, instr, pos, String(n.attrs.result || "")) });
          return true;
        },
      updateDocFields:
        () =>
        ({ state, tr, dispatch }) => {
          // two passes so formulas that read other formulas settle
          let changed = false;
          for (let pass = 0; pass < 2; pass++) {
            const st = { ...state, doc: tr.doc } as EditorState;
            tr.doc.descendants((n, pos) => {
              if (n.type.name !== "docField") return true;
              const r = docFieldText(st, this.options.env, String(n.attrs.instr), pos, String(n.attrs.result || ""));
              if (r !== n.attrs.result) {
                tr.setNodeMarkup(pos, undefined, { ...n.attrs, result: r });
                changed = true;
              }
              return false;
            });
          }
          if (dispatch && changed) dispatch(tr);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return { F9: () => this.editor.commands.updateDocFields() };
  },
});

/** Every field's live result in document order (for export). */
export function docFieldResults(state: EditorState, env: FieldEnv): string[] {
  const out: string[] = [];
  state.doc.descendants((n, pos) => {
    if (n.type.name === "docField") out.push(fieldKind(String(n.attrs.instr)) === "=" && n.attrs.result ? String(n.attrs.result) : docFieldText(state, env, String(n.attrs.instr), pos, String(n.attrs.result || "")));
    return true;
  });
  return out;
}
