// Table tools: Word's built-in table styles (CSS and styles.xml), sorting
// rows, converting text to a table and back. Plain data on the editor's JSON.
import type { PMNode } from "./model";

export type TableLook = { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; bandedRows: boolean; bandedColumns: boolean };
export const DEFAULT_LOOK: TableLook = { firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, bandedRows: true, bandedColumns: false };

type Edge = { color: string; size: number } | null; // size in eighths of a point (w:sz)
export type TableStyleDef = {
  id: string;
  name: string;
  borders: { top: Edge; bottom: Edge; left: Edge; right: Edge; insideH: Edge; insideV: Edge };
  header?: { fill?: string; color?: string; bold?: boolean; bottom?: Edge };
  firstCol?: { fill?: string; color?: string; bold?: boolean };
  lastRow?: { fill?: string; bold?: boolean; top?: Edge };
  band?: string; // fill of odd banded rows
  bandCol?: string;
};

const e = (color: string, size = 4): Edge => ({ color, size });
const A1 = "#4472c4";
const A1_LIGHT = "#d9e2f3";
const A1_MID = "#b4c6e7";
const A2 = "#ed7d31";
const A2_LIGHT = "#fbe4d5";
const GREY = "#bfbfbf";
const GREY_LIGHT = "#f2f2f2";
export const TABLE_STYLES: TableStyleDef[] = [
  { id: "TableGrid", name: "Table Grid", borders: { top: e("#000000"), bottom: e("#000000"), left: e("#000000"), right: e("#000000"), insideH: e("#000000"), insideV: e("#000000") } },
  { id: "PlainTable1", name: "Plain Table 1", borders: { top: e(GREY), bottom: e(GREY), left: e(GREY), right: e(GREY), insideH: e(GREY), insideV: e(GREY) }, header: { bold: true }, firstCol: { bold: true }, band: GREY_LIGHT },
  { id: "PlainTable2", name: "Plain Table 2", borders: { top: e("#7f7f7f"), bottom: e("#7f7f7f"), left: null, right: null, insideH: null, insideV: null }, header: { bold: true, bottom: e("#7f7f7f") }, firstCol: { bold: true } },
  { id: "GridTable1Light", name: "Grid Table 1 Light", borders: { top: e(GREY), bottom: e(GREY), left: e(GREY), right: e(GREY), insideH: e(GREY), insideV: e(GREY) }, header: { bold: true, bottom: e("#999999", 12) }, firstCol: { bold: true } },
  { id: "GridTable4-Accent1", name: "Grid Table 4 Accent 1", borders: { top: e("#8eaadb"), bottom: e("#8eaadb"), left: e("#8eaadb"), right: e("#8eaadb"), insideH: e("#8eaadb"), insideV: e("#8eaadb") }, header: { fill: A1, color: "#ffffff", bold: true }, firstCol: { bold: true }, band: A1_LIGHT },
  { id: "GridTable5Dark-Accent1", name: "Grid Table 5 Dark Accent 1", borders: { top: e("#ffffff"), bottom: e("#ffffff"), left: e("#ffffff"), right: e("#ffffff"), insideH: e("#ffffff"), insideV: e("#ffffff") }, header: { fill: A1, color: "#ffffff", bold: true }, firstCol: { fill: A1, color: "#ffffff", bold: true }, band: A1_MID, bandCol: A1_LIGHT },
  { id: "ListTable3-Accent1", name: "List Table 3 Accent 1", borders: { top: e(A1), bottom: e(A1), left: e(A1), right: e(A1), insideH: null, insideV: null }, header: { fill: A1, color: "#ffffff", bold: true }, firstCol: { bold: true }, lastRow: { bold: true, top: e(A1, 12) } },
  { id: "ListTable4-Accent2", name: "List Table 4 Accent 2", borders: { top: e("#f4b083"), bottom: e("#f4b083"), left: e("#f4b083"), right: e("#f4b083"), insideH: e("#f4b083"), insideV: null }, header: { fill: A2, color: "#ffffff", bold: true }, firstCol: { bold: true }, band: A2_LIGHT },
];
export const tableStyle = (id: unknown) => TABLE_STYLES.find((s) => s.id === id);

/** Parse a table's look attribute (JSON) with Word's defaults. */
export function lookOf(v: unknown): TableLook {
  if (v && typeof v === "object") return { ...DEFAULT_LOOK, ...(v as Partial<TableLook>) };
  if (typeof v === "string" && v) {
    try {
      return { ...DEFAULT_LOOK, ...JSON.parse(v) };
    } catch {
      /* default */
    }
  }
  return DEFAULT_LOOK;
}

// ---- CSS ----
const edgeCss = (x: Edge) => (x ? `${Math.max(0.75, x.size / 8)}pt solid ${x.color}` : "none");

/** CSS for every built-in table style, scoped under `scope` (tables carry data-table-style and data-look-* flags). */
export function tableStylesCss(scope: string): string {
  const out: string[] = [];
  for (const s of TABLE_STYLES) {
    const t = `${scope} table[data-table-style="${s.id}"]`;
    const b = s.borders;
    out.push(`${t} { border-collapse: collapse; border-top: ${edgeCss(b.top)}; border-bottom: ${edgeCss(b.bottom)}; border-left: ${edgeCss(b.left)}; border-right: ${edgeCss(b.right)}; }`);
    out.push(`${t} td, ${t} th { border: none; border-top: ${edgeCss(b.insideH)}; border-left: ${edgeCss(b.insideV)}; background: none; font-weight: inherit; }`);
    out.push(`${t} tr:first-child > td, ${t} tr:first-child > th { border-top: ${edgeCss(b.top)}; }`);
    out.push(`${t} td:first-child, ${t} th:first-child { border-left: ${edgeCss(b.left)}; }`);
    out.push(`${t} td:last-child, ${t} th:last-child { border-right: ${edgeCss(b.right)}; }`);
    out.push(`${t} tr:last-child > td, ${t} tr:last-child > th { border-bottom: ${edgeCss(b.bottom)}; }`);
    if (s.band) out.push(`${t}[data-look-band-rows] tr:nth-child(${s.header ? "even" : "odd"}) > td { background-color: ${s.band}; }`);
    if (s.bandCol) out.push(`${t}[data-look-band-cols] td:nth-child(odd) { background-color: ${s.bandCol}; }`);
    if (s.firstCol) out.push(`${t}[data-look-first-col] tr > :first-child { ${s.firstCol.bold ? "font-weight: 700;" : ""} ${s.firstCol.fill ? `background-color: ${s.firstCol.fill};` : ""} ${s.firstCol.color ? `color: ${s.firstCol.color};` : ""} }`);
    if (s.lastRow) out.push(`${t}[data-look-last-row] tr:last-child > * { ${s.lastRow.bold ? "font-weight: 700;" : ""} ${s.lastRow.top ? `border-top: ${edgeCss(s.lastRow.top)};` : ""} }`);
    if (s.header) out.push(`${t}[data-look-first-row] tr:first-child > * { ${s.header.bold ? "font-weight: 700;" : ""} ${s.header.fill ? `background-color: ${s.header.fill};` : ""} ${s.header.color ? `color: ${s.header.color};` : ""} ${s.header.bottom ? `border-bottom: ${edgeCss(s.header.bottom)};` : ""} }`);
  }
  return out.join("\n");
}

// ---- WordprocessingML ----
const hx = (c: string) => c.replace("#", "").toUpperCase();
const bdr = (side: string, x: Edge) => (x ? `<w:${side} w:val="single" w:sz="${x.size}" w:space="0" w:color="${hx(x.color)}"/>` : `<w:${side} w:val="nil"/>`);
const rpr = (o: { bold?: boolean; color?: string }) => (o.bold || o.color ? `<w:rPr>${o.bold ? "<w:b/><w:bCs/>" : ""}${o.color ? `<w:color w:val="${hx(o.color)}"/>` : ""}</w:rPr>` : "");
const shd = (fill?: string) => (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hx(fill)}"/>` : "");

/** A w:style of type table for styles.xml. */
export function tableStyleXml(s: TableStyleDef): string {
  const b = s.borders;
  const parts: string[] = [];
  if (s.header)
    parts.push(
      `<w:tblStylePr w:type="firstRow">${rpr(s.header)}<w:tblPr/><w:tcPr>${s.header.bottom ? `<w:tcBorders>${bdr("bottom", s.header.bottom)}</w:tcBorders>` : ""}${shd(s.header.fill)}</w:tcPr></w:tblStylePr>`,
    );
  if (s.lastRow) parts.push(`<w:tblStylePr w:type="lastRow">${rpr(s.lastRow)}<w:tblPr/><w:tcPr>${s.lastRow.top ? `<w:tcBorders>${bdr("top", s.lastRow.top)}</w:tcBorders>` : ""}${shd(s.lastRow.fill)}</w:tcPr></w:tblStylePr>`);
  if (s.firstCol) parts.push(`<w:tblStylePr w:type="firstCol">${rpr(s.firstCol)}<w:tblPr/><w:tcPr>${shd(s.firstCol.fill)}</w:tcPr></w:tblStylePr>`);
  if (s.band) parts.push(`<w:tblStylePr w:type="band1Horz"><w:tblPr/><w:tcPr>${shd(s.band)}</w:tcPr></w:tblStylePr>`);
  if (s.bandCol) parts.push(`<w:tblStylePr w:type="band1Vert"><w:tblPr/><w:tcPr>${shd(s.bandCol)}</w:tcPr></w:tblStylePr>`);
  return (
    `<w:style w:type="table" w:styleId="${s.id}"><w:name w:val="${s.name}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>` +
    `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
    `<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/><w:tblBorders>${bdr("top", b.top)}${bdr("left", b.left)}${bdr("bottom", b.bottom)}${bdr("right", b.right)}${bdr("insideH", b.insideH)}${bdr("insideV", b.insideV)}</w:tblBorders></w:tblPr>` +
    parts.join("") +
    "</w:style>"
  );
}

export const TABLE_NORMAL_XML =
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';

/** w:tblLook for a look. */
export function tblLookXml(l: TableLook): string {
  const v = (l.firstRow ? 0x20 : 0) | (l.lastRow ? 0x40 : 0) | (l.firstColumn ? 0x80 : 0) | (l.lastColumn ? 0x100 : 0) | (l.bandedRows ? 0 : 0x200) | (l.bandedColumns ? 0 : 0x400);
  const b = (x: boolean) => (x ? "1" : "0");
  return `<w:tblLook w:val="${v.toString(16).toUpperCase().padStart(4, "0")}" w:firstRow="${b(l.firstRow)}" w:lastRow="${b(l.lastRow)}" w:firstColumn="${b(l.firstColumn)}" w:lastColumn="${b(l.lastColumn)}" w:noHBand="${b(!l.bandedRows)}" w:noVBand="${b(!l.bandedColumns)}"/>`;
}

/** A look from w:tblLook's attributes (or its hex w:val). */
export function readTblLook(attrs: Record<string, string> | undefined): TableLook {
  if (!attrs) return DEFAULT_LOOK;
  const val = parseInt(attrs.val || "", 16);
  const flag = (name: string, bit: number, invert = false) => {
    if (attrs[name] !== undefined) return invert ? !(attrs[name] === "1" || attrs[name] === "true") : attrs[name] === "1" || attrs[name] === "true";
    if (!Number.isNaN(val)) return invert ? !(val & bit) : !!(val & bit);
    return (DEFAULT_LOOK as Record<string, boolean>)[name] ?? false;
  };
  return {
    firstRow: flag("firstRow", 0x20),
    lastRow: flag("lastRow", 0x40),
    firstColumn: flag("firstColumn", 0x80),
    lastColumn: flag("lastColumn", 0x100),
    bandedRows: attrs.noHBand !== undefined ? !(attrs.noHBand === "1") : Number.isNaN(val) ? true : !(val & 0x200),
    bandedColumns: attrs.noVBand !== undefined ? !(attrs.noVBand === "1") : Number.isNaN(val) ? false : !(val & 0x400),
  };
}

// ---- sort ----

export type SortKey = { col: number; type: "text" | "number" | "date"; desc?: boolean };
const cellText = (c: PMNode | undefined): string => {
  const walk = (n: PMNode): string => (n.type === "text" ? n.text || "" : n.type === "docField" ? String(n.attrs?.result || "") : (n.content || []).map(walk).join(n.type === "paragraph" ? "" : " "));
  return c ? walk(c).trim() : "";
};

function compare(a: string, b: string, type: SortKey["type"]): number {
  if (type === "number") {
    const n = (s: string) => {
      const v = parseFloat(s.replace(/[^\d.eE+-]/g, ""));
      return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
    };
    return n(a) - n(b);
  }
  if (type === "date") {
    const d = (s: string) => {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };
    return d(a) - d(b);
  }
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** The table with its rows sorted by the keys (a header row stays first). Rows with merged cells across rows are not reordered. */
export function sortTable(table: PMNode, keys: SortKey[], hasHeader: boolean): PMNode {
  const rows = [...(table.content || [])];
  if (rows.some((r) => (r.content || []).some((c) => Number(c.attrs?.rowspan) > 1))) return table;
  const head = hasHeader ? rows.splice(0, 1) : [];
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      for (const k of keys) {
        const d = compare(cellText(x.r.content?.[k.col]), cellText(y.r.content?.[k.col]), k.type);
        if (d) return k.desc ? -d : d;
      }
      return x.i - y.i;
    })
    .map((x) => x.r);
  return { ...table, content: [...head, ...sorted] };
}

// ---- text to table and back ----

export type Separator = "tab" | "comma" | "paragraph" | string;
const splitBy = (t: string, sep: Separator) => (sep === "tab" ? t.split("\t") : sep === "comma" ? t.split(/,\s*/) : sep === "paragraph" ? [t] : t.split(sep));

/** Paragraphs (inline content) to a table: one row each, cells split at the separator. */
export function textToTable(paras: PMNode[], sep: Separator): PMNode {
  const rows = paras.map((p) => {
    const text = (p.content || []).map((n) => (n.type === "text" ? n.text || "" : "")).join("");
    return splitBy(text, sep);
  });
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return {
    type: "table",
    content: rows.map((r) => ({
      type: "tableRow",
      content: Array.from({ length: cols }, (_, i) => ({
        type: "tableCell",
        attrs: { colspan: 1, rowspan: 1 },
        content: [{ type: "paragraph", ...(r[i] ? { content: [{ type: "text", text: r[i] }] } : {}) }],
      })),
    })),
  };
}

/** A table back to paragraphs, cells joined by the separator. */
export function tableToText(table: PMNode, sep: Separator): PMNode[] {
  const joiner = sep === "tab" ? "\t" : sep === "comma" ? ", " : sep === "paragraph" ? "\n" : sep;
  const out: PMNode[] = [];
  for (const r of table.content || []) {
    const cells = (r.content || []).map(cellText);
    while (cells.length > 1 && !cells[cells.length - 1]) cells.pop(); // padding cells of short rows
    if (sep === "paragraph") for (const c of cells) out.push({ type: "paragraph", ...(c ? { content: [{ type: "text", text: c }] } : {}) });
    else {
      const t = cells.join(joiner);
      out.push({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
    }
  }
  return out;
}

/** Guess the separator of some lines of text: tabs, else commas, else none. */
export function guessSeparator(lines: string[]): Separator {
  if (lines.some((l) => l.includes("\t"))) return "tab";
  if (lines.length && lines.every((l) => l.includes(","))) return "comma";
  return "paragraph";
}

export { cellText };
