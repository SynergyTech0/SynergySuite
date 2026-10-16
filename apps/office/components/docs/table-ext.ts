// The document's table node: Word's table styles and style options (header
// row, banded rows, first column...), table alignment, and the Table menu's
// commands: sort, convert text to a table and back, cell borders and
// vertical alignment.
import Table, { TableView } from "@tiptap/extension-table";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import { TextSelection } from "@tiptap/pm/state";
import { lookOf, sortTable, tableStylesCss, tableToText, textToTable, type SortKey, type Separator, type TableLook } from "@/lib/docs/tables";
import type { PMNode } from "@/lib/docs/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wordTable: {
      /** apply a built-in table style (null for none); clears cell borders and shading */
      setTableStyle: (id: string | null) => ReturnType;
      setTableLook: (look: Partial<TableLook>) => ReturnType;
      setTableAlign: (align: "left" | "center" | "right") => ReturnType;
      sortTableRows: (keys: SortKey[], hasHeader: boolean) => ReturnType;
      convertTextToTable: (sep: Separator) => ReturnType;
      convertTableToText: (sep: Separator) => ReturnType;
      /** borders of the selected cells: "all", "outside", "none", "top", "bottom", "left", "right", "insideH", "insideV" */
      setCellBorders: (which: string, css?: string) => ReturnType;
      setCellVAlign: (v: "top" | "middle" | "bottom") => ReturnType;
    };
  }
}

function applyAttrs(dom: HTMLElement, node: PMNodeT) {
  const s = node.attrs.tableStyle as string | null;
  if (s) dom.setAttribute("data-table-style", s);
  else dom.removeAttribute("data-table-style");
  const l = lookOf(node.attrs.look);
  const flags: [keyof TableLook, string][] = [
    ["firstRow", "data-look-first-row"],
    ["lastRow", "data-look-last-row"],
    ["firstColumn", "data-look-first-col"],
    ["bandedRows", "data-look-band-rows"],
    ["bandedColumns", "data-look-band-cols"],
  ];
  for (const [k, a] of flags) {
    if (s && l[k]) dom.setAttribute(a, "");
    else dom.removeAttribute(a);
  }
  const al = node.attrs.align as string | null;
  dom.style.marginLeft = al === "center" || al === "right" ? "auto" : "";
  dom.style.marginRight = al === "center" ? "auto" : "";
}

export class StyledTableView extends TableView {
  constructor(node: PMNodeT, cellMinWidth: number) {
    super(node, cellMinWidth);
    applyAttrs(this.table, node);
  }
  update(node: PMNodeT) {
    if (!super.update(node)) return false;
    applyAttrs(this.table, node);
    return true;
  }
}

/** The table and its position around the selection. */
export function tableAround(state: { selection: { $from: { depth: number; node: (d: number) => PMNodeT; before: (d: number) => number } } }): { node: PMNodeT; pos: number } | null {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === "table") return { node: $f.node(d), pos: $f.before(d) };
  return null;
}

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const el = document.createElement("style");
  el.setAttribute("data-table-styles", "");
  el.textContent = tableStylesCss(".word-doc .ProseMirror");
  document.head.appendChild(el);
}

const BORDER = "1px solid #000000";

const Base = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-table-style"),
        renderHTML: (a: Record<string, unknown>) => (a.tableStyle ? { "data-table-style": a.tableStyle } : {}),
      },
      look: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-look"),
        renderHTML: (a: Record<string, unknown>) => (a.look ? { "data-look": typeof a.look === "string" ? a.look : JSON.stringify(a.look) } : {}),
      },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-align"),
        renderHTML: (a: Record<string, unknown>) => (a.align ? { "data-align": a.align } : {}),
      },
    };
  },
  onCreate() {
    injectCss();
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setTableStyle:
        (id) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          if (dispatch) {
            tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, tableStyle: id, look: t.node.attrs.look });
            t.node.descendants((c, off) => {
              if (c.type.name === "tableCell" || c.type.name === "tableHeader") {
                if (c.attrs.borders || c.attrs.background) tr.setNodeMarkup(t.pos + 1 + off, undefined, { ...c.attrs, borders: null, background: null });
                return false;
              }
              return true;
            });
          }
          return true;
        },
      setTableLook:
        (look) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          if (dispatch) tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, look: JSON.stringify({ ...lookOf(t.node.attrs.look), ...look }) });
          return true;
        },
      setTableAlign:
        (align) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          if (dispatch) tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, align: align === "left" ? null : align });
          return true;
        },
      sortTableRows:
        (keys, hasHeader) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          const sorted = sortTable(t.node.toJSON() as PMNode, keys, hasHeader);
          if (dispatch) tr.replaceWith(t.pos, t.pos + t.node.nodeSize, state.schema.nodeFromJSON(sorted));
          return true;
        },
      convertTableToText:
        (sep) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          const paras = tableToText(t.node.toJSON() as PMNode, sep).map((p) => state.schema.nodeFromJSON(p));
          if (dispatch) {
            tr.replaceWith(t.pos, t.pos + t.node.nodeSize, paras);
            tr.setSelection(TextSelection.near(tr.doc.resolve(t.pos + 1)));
          }
          return true;
        },
      convertTextToTable:
        (sep) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          const $a = state.doc.resolve(from);
          const $b = state.doc.resolve(to);
          if ($a.depth < 1 || tableAround(state)) return false;
          const start = $a.before(1);
          const end = $b.after(1);
          const paras: PMNode[] = [];
          let ok = true;
          state.doc.nodesBetween(start, end, (n, pos) => {
            if (pos < start || pos >= end) return false;
            if (n.type.name !== "paragraph") ok = false;
            else paras.push(n.toJSON() as PMNode);
            return false;
          });
          if (!ok || !paras.length) return false;
          if (dispatch) {
            tr.replaceWith(start, end, state.schema.nodeFromJSON(textToTable(paras, sep)));
            tr.setSelection(TextSelection.near(tr.doc.resolve(start + 3)));
          }
          return true;
        },
      setCellBorders:
        (which, css = BORDER) =>
        ({ state, tr, dispatch }) => {
          const t = tableAround(state);
          if (!t) return false;
          // the selected cells as grid rectangles
          const cells: { pos: number; node: PMNodeT; r: number; c: number; r2: number; c2: number }[] = [];
          const sel = state.selection;
          const inSel = (pos: number) => (sel instanceof CellSelection ? (() => { let hit = false; sel.forEachCell((_n, p) => p === pos && (hit = true)); return hit; })() : pos <= sel.from && sel.from <= pos + (state.doc.nodeAt(pos)?.nodeSize || 0));
          let ri = 0;
          let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
          t.node.forEach((row, roff) => {
            let ci = 0;
            row.forEach((cell, coff) => {
              const pos = t.pos + 1 + roff + 1 + coff;
              const span = Number(cell.attrs.colspan) || 1;
              const rs = Number(cell.attrs.rowspan) || 1;
              if (inSel(pos)) {
                cells.push({ pos, node: cell, r: ri, c: ci, r2: ri + rs - 1, c2: ci + span - 1 });
                minR = Math.min(minR, ri); minC = Math.min(minC, ci); maxR = Math.max(maxR, ri + rs - 1); maxC = Math.max(maxC, ci + span - 1);
              }
              ci += span;
            });
            ri++;
          });
          if (!cells.length) return false;
          if (dispatch)
            for (const x of cells) {
              let b: Record<string, string> = {};
              try {
                b = x.node.attrs.borders ? JSON.parse(String(x.node.attrs.borders)) : {};
              } catch {
                b = {};
              }
              const outer = { top: x.r === minR, bottom: x.r2 === maxR, left: x.c === minC, right: x.c2 === maxC };
              for (const side of ["top", "bottom", "left", "right"] as const) {
                const isOuter = outer[side];
                const inner = side === "top" || side === "bottom" ? "insideH" : "insideV";
                if (which === "all") b[side] = css;
                else if (which === "none") b[side] = "none";
                else if (which === "outside" && isOuter) b[side] = css;
                else if (which === side && isOuter) b[side] = css;
                else if (which === inner && !isOuter) b[side] = css;
              }
              tr.setNodeMarkup(x.pos, undefined, { ...x.node.attrs, borders: JSON.stringify(b) });
            }
          return true;
        },
      setCellVAlign:
        (v) =>
        ({ commands }) =>
          commands.setCellAttribute("valign", v === "top" ? null : v),
    };
  },
});

/** The table node with Word's styles (configure with { resizable } as usual). */
export const WordTable = Base.configure({ View: StyledTableView as unknown as typeof TableView });
