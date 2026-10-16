// Table styles as PowerPoint has them: the table names a style (a:tableStyleId)
// and turns its parts on (header row, total row, first/last column, banded
// rows/columns); the cells' look comes from the style, a cell's own fill,
// colour, weight or border winning over it. Built-in styles are drawn from the
// theme's accent; a deck's own styles keep their resolved look.
import type { CellBorder, TableCell, TableEl, TableLook, TableLookPart, TableStyle } from "./model";
import { normalizeTable } from "./table";

export const TABLE_PARTS = ["whole", "band1H", "band2H", "band1V", "band2V", "lastCol", "firstCol", "lastRow", "firstRow"] as const;
export type TablePart = (typeof TABLE_PARTS)[number];
/** The OOXML element of each part (a:tblStyle children). */
export const PART_TAG: Record<TablePart, string> = { whole: "wholeTbl", band1H: "band1H", band2H: "band2H", band1V: "band1V", band2V: "band2V", lastCol: "lastCol", firstCol: "firstCol", lastRow: "lastRow", firstRow: "firstRow" };

/** PowerPoint's built-in style ids (as listed by Microsoft and LibreOffice). */
export const BUILTIN_STYLES: { id: string; name: string; kind: "grid" | "light1" | "medium2" | "none"; accent: boolean }[] = [
  { id: "{2D5ABB26-0587-4C30-8999-92F81FD0307C}", name: "No Style, No Grid", kind: "none", accent: false },
  { id: "{5940675A-B579-460E-94D1-54222C63F5DA}", name: "No Style, Table Grid", kind: "grid", accent: false },
  { id: "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}", name: "Light Style 1 - Accent 1", kind: "light1", accent: true },
  { id: "{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", name: "Medium Style 2", kind: "medium2", accent: false },
  { id: "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", name: "Medium Style 2 - Accent 1", kind: "medium2", accent: true },
];
/** PowerPoint's default for a new table. */
export const DEFAULT_TABLE_STYLE = BUILTIN_STYLES[4].id;

const HEX = /^[0-9A-F]{6}$/i;
/** `hex` mixed with white: f = 1 is the colour, 0 is white. */
export function tint(hex: string, f: number): string {
  const n = parseInt(hex, 16);
  const ch = (s: number) => Math.round(255 - (255 - ((n >> s) & 255)) * f);
  return [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** The look of a built-in style in a theme (text = dk1, bg = lt1). */
export function builtinLook(id: string, accent: string, text: string, bg = "FFFFFF"): TableLook | undefined {
  const s = BUILTIN_STYLES.find((b) => b.id === id);
  if (!s) return undefined;
  const A = s.accent ? accent : text;
  if (s.kind === "none") return {};
  if (s.kind === "grid") return { whole: { line: text }, firstRow: { bold: true }, lastRow: { bold: true }, firstCol: { bold: true }, lastCol: { bold: true } };
  if (s.kind === "light1") return { whole: { color: text }, band1H: { fill: tint(A, 0.2) }, band1V: { fill: tint(A, 0.2) }, firstRow: { bold: true, line: A }, lastRow: { bold: true, line: A }, firstCol: { bold: true }, lastCol: { bold: true } };
  return {
    whole: { fill: tint(A, 0.2), color: text, line: bg },
    band1H: { fill: tint(A, 0.4) },
    band1V: { fill: tint(A, 0.4) },
    firstRow: { fill: A, color: bg, bold: true },
    lastRow: { fill: A, color: bg, bold: true },
    firstCol: { fill: A, color: bg, bold: true },
    lastCol: { fill: A, color: bg, bold: true },
  };
}

/** A table style value worth keeping (from a document or an import). */
export function validTableStyle(v: unknown): v is TableStyle {
  if (!v || typeof v !== "object") return false;
  const t = v as TableStyle;
  return typeof t.id === "string" && /^\{[0-9A-F-]{36}\}$/i.test(t.id);
}

/** The style's look in this theme: its own (a deck's style) or the built-in one's. */
export function lookOf(ts: TableStyle, accent: string, text: string, bg?: string): TableLook {
  return ts.look ?? builtinLook(ts.id, accent, text, bg) ?? {};
}

/** The parts that apply to cell (r, c) of an nr x nc grid, in the order they layer (later wins). */
export function partsAt(ts: TableStyle, r: number, c: number, nr: number, nc: number): TablePart[] {
  const out: TablePart[] = ["whole"];
  const rr = ts.first ? r - 1 : r, cc = ts.firstCol ? c - 1 : c;
  const headRow = (ts.first && r === 0) || (ts.last && r === nr - 1);
  const headCol = (ts.firstCol && c === 0) || (ts.lastCol && c === nc - 1);
  if (ts.bandRow && !headRow && rr >= 0) out.push(rr % 2 === 0 ? "band1H" : "band2H");
  if (ts.bandCol && !headCol && cc >= 0) out.push(cc % 2 === 0 ? "band1V" : "band2V");
  if (ts.lastCol && c === nc - 1) out.push("lastCol");
  if (ts.firstCol && c === 0) out.push("firstCol");
  if (ts.last && r === nr - 1) out.push("lastRow");
  if (ts.first && r === 0) out.push("firstRow");
  return out;
}

/** What the style gives cell (r, c). */
export function styleAt(ts: TableStyle, look: TableLook, r: number, c: number, nr: number, nc: number): TableLookPart {
  const out: TableLookPart = {};
  for (const p of partsAt(ts, r, c, nr, nc)) Object.assign(out, look[p] || {});
  return out;
}

/**
 * The table's cells with its style applied, for drawing: a cell's own fill,
 * colour, bold and borders win; the style fills in the rest. Without a style
 * the rows are returned as they are.
 */
export function styledRows(el: TableEl, accent: string, text: string, bg?: string): TableCell[][] {
  const rows = normalizeTable(el.rows);
  const ts = el.tstyle;
  if (!validTableStyle(ts)) return rows;
  const look = lookOf(ts, accent, text, bg);
  const nr = rows.length, nc = rows[0]?.length || 1;
  return rows.map((row, r) =>
    row.map((cell, c) => {
      if (cell.merged) return cell;
      const s = styleAt(ts, look, r, c, nr, nc);
      const out: TableCell = { ...cell };
      if (!out.fill && s.fill && HEX.test(s.fill)) out.fill = s.fill;
      if (!out.color && s.color && HEX.test(s.color)) out.color = s.color;
      if (out.bold === undefined && s.bold) out.bold = true;
      const line: CellBorder = s.line && HEX.test(s.line) ? { c: s.line, w: 1 } : { c: "000000", w: 0 };
      out.bd = { t: cell.bd?.t ?? line, r: cell.bd?.r ?? line, b: cell.bd?.b ?? line, l: cell.bd?.l ?? line };
      return out;
    }),
  );
}

const clr = (hex: string) => `<a:srgbClr val="${hex}"/>`;
/** One a:tblStyle for ppt/tableStyles.xml, from a look (colours written as resolved). */
export function tblStyleXml(id: string, name: string, look: TableLook): string {
  const part = (p: TablePart) => {
    const v = look[p];
    if (!v && p !== "whole") return "";
    const tx = v?.color || v?.bold ? `<a:tcTxStyle${v.bold ? ` b="on"` : ""}><a:fontRef idx="minor"/>${v.color ? clr(v.color) : ""}</a:tcTxStyle>` : "";
    const ln = v?.line ? `<a:ln w="12700" cmpd="sng"><a:solidFill>${clr(v.line)}</a:solidFill></a:ln>` : "";
    const sides = ln ? `<a:tcBdr>${["left", "right", "top", "bottom", "insideH", "insideV"].map((s) => `<a:${s}>${ln}</a:${s}>`).join("")}</a:tcBdr>` : "<a:tcBdr/>";
    const fill = v?.fill ? `<a:fill><a:solidFill>${clr(v.fill)}</a:solidFill></a:fill>` : "";
    return `<a:${PART_TAG[p]}>${tx}<a:tcStyle>${sides}${fill}</a:tcStyle></a:${PART_TAG[p]}>`;
  };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<a:tblStyle styleId="${id}" styleName="${esc(name)}">${TABLE_PARTS.map(part).join("")}</a:tblStyle>`;
}

/** The tblPr flags and style reference for a table. */
export function tblPrXml(ts: TableStyle): string {
  const f = (k: string, on: boolean | undefined) => (on ? ` ${k}="1"` : "");
  return `<a:tblPr${f("firstRow", ts.first)}${f("lastRow", ts.last)}${f("firstCol", ts.firstCol)}${f("lastCol", ts.lastCol)}${f("bandRow", ts.bandRow)}${f("bandCol", ts.bandCol)}><a:tableStyleId>${ts.id}</a:tableStyleId></a:tblPr>`;
}
