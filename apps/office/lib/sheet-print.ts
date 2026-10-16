// Printing a sheet: page setup, pagination and a page model that both the
// print view (HTML) and the PDF writer draw from.
//
// Page setup is Excel's (as ExcelJS models it, kept in the sheet's
// custom.xlsx data so it round-trips through .xlsx): paper size,
// orientation, margins, scaling or fit-to-pages, print area, rows/columns
// repeated on every page, gridlines, headings, centering, page order and the
// header/footer. Everything here is in points (1/72 inch) on the page.
import { cellDisplayText, type UniverCell, type UniverStyle, type UniverWorkbook } from "./xlsx.ts";
import type { SheetChart, SheetChartResource } from "./sheet-charts.ts";
import { SHAPE_COMPONENT, shapeSvg, shapeTexts, type ShapeData } from "./sheet-shapes.ts";

/**
 * How charts are drawn for printing: the editor sets this to render its chart
 * view as SVG markup. Without it, charts leave a blank space.
 */
export const printRenderers: { chartSvg: ((chart: SheetChart, book: UniverWorkbook, size: { w: number; h: number }) => string | null) | null } = { chartSvg: null };
/** A chart on the grid, in pixels (the size it is saved at in .xlsx). */
export const CHART_PX = { w: 540, h: 300 };

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PageSetup = {
  paperSize?: number;
  orientation?: "portrait" | "landscape";
  margins?: { left: number; right: number; top: number; bottom: number; header: number; footer: number };
  scale?: number;
  fitToPage?: boolean;
  fitToWidth?: number;
  fitToHeight?: number;
  horizontalCentered?: boolean;
  verticalCentered?: boolean;
  showGridLines?: boolean;
  showRowColHeaders?: boolean;
  pageOrder?: "downThenOver" | "overThenDown";
  firstPageNumber?: number;
  printArea?: string;
  printTitlesRow?: string;
  printTitlesColumn?: string;
};
export type HeaderFooter = { oddHeader?: string; oddFooter?: string };

export const DEFAULT_MARGINS = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

/** Excel paper size codes -> [width, height] in points (portrait). */
export const PAPER: Record<number, { name: string; size: [number, number] }> = {
  1: { name: "Letter", size: [612, 792] },
  3: { name: "Tabloid", size: [792, 1224] },
  5: { name: "Legal", size: [612, 1008] },
  8: { name: "A3", size: [841.89, 1190.55] },
  9: { name: "A4", size: [595.28, 841.89] },
  11: { name: "A5", size: [419.53, 595.28] },
};

export type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };

export type TextStyle = {
  font: string;
  size: number; // pt, already scaled
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
};
export type BorderLine = { width: number; color: string; dash?: number[]; double?: boolean };
export type CellBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Width the text may use: the cell, or more when it spills into empty neighbours. */
  textX: number;
  textW: number;
  text: string;
  style: TextStyle;
  fill?: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  wrap: boolean;
  borders: { t?: BorderLine; r?: BorderLine; b?: BorderLine; l?: BorderLine };
  heading?: boolean;
};
export type ImageBox = { x: number; y: number; w: number; h: number; src: string; clip: { x: number; y: number; w: number; h: number } };
export type HeaderText = { left: string; center: string; right: string };

export type PageModel = {
  width: number;
  height: number;
  cells: CellBox[];
  /** Gridlines as segments. */
  grid: { x1: number; y1: number; x2: number; y2: number }[];
  images: ImageBox[];
  /** Text drawn over the pictures (shapes' text). */
  overlay?: CellBox[];
  header: HeaderText;
  footer: HeaderText;
  headerY: number;
  footerY: number;
  margins: { left: number; right: number };
};

export type PrintDoc = { pages: PageModel[]; title: string };

const PX_TO_PT = 0.75;
const DEFAULT_COL_PX = 64;
const DEFAULT_ROW_PX = 20;
const HEADING_W = 28; // pt, row number column when headings print
const HEADING_H = 14;
const BORDER_WIDTH: Record<number, number> = { 1: 0.5, 2: 0.25, 3: 0.5, 4: 0.5, 5: 0.5, 6: 0.5, 7: 0.5, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1.5 };
const BORDER_DASH: Record<number, number[]> = { 3: [0.5, 1], 4: [2, 1], 5: [3, 1, 1, 1], 6: [3, 1, 1, 1, 1, 1], 9: [3, 1.5], 10: [4, 1.5, 1.5, 1.5], 11: [4, 1, 1, 1, 1, 1], 12: [4, 1, 1, 1] };

// ---- References --------------------------------------------------------------

const colIndex = (letters: string) => letters.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colName = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** "A1:D20" or "$A$1:$D$20" (sheet prefix allowed) -> range. */
export function parseArea(ref: string): Range | null {
  const m = /^(?:.*!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(ref.trim());
  if (!m) return null;
  const a = { r: Number(m[2]) - 1, c: colIndex(m[1]) };
  const b = m[3] ? { r: Number(m[4]) - 1, c: colIndex(m[3]) } : a;
  return { startRow: Math.min(a.r, b.r), endRow: Math.max(a.r, b.r), startColumn: Math.min(a.c, b.c), endColumn: Math.max(a.c, b.c) };
}
export const areaText = (g: Range) => `${colName(g.startColumn)}${g.startRow + 1}:${colName(g.endColumn)}${g.endRow + 1}`;

/** "1:2" / "$1:$2" -> rows; "A:B" -> columns. */
export function parseSpan(ref: string | undefined, kind: "rows" | "cols"): [number, number] | null {
  if (!ref) return null;
  const re = kind === "rows" ? /^(?:.*!)?\$?(\d+):\$?(\d+)$/ : /^(?:.*!)?\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/i;
  const m = re.exec(ref.trim());
  if (!m) return null;
  const a = kind === "rows" ? Number(m[1]) - 1 : colIndex(m[1]);
  const b = kind === "rows" ? Number(m[2]) - 1 : colIndex(m[2]);
  return [Math.min(a, b), Math.max(a, b)];
}

// ---- Header / footer -----------------------------------------------------------

/** Excel header/footer codes: &L &C &R sections, &P page, &N pages, &D date,
 *  &T time, &A sheet, &F file. Font codes (&"Arial,Bold", &12, &B...) are dropped. */
export function headerFooterText(code: string | undefined, vars: { page: number; pages: number; sheet: string; file: string; now: Date }): HeaderText {
  const out: HeaderText = { left: "", center: "", right: "" };
  if (!code) return out;
  let section: keyof HeaderText = "center";
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch !== "&") {
      out[section] += ch;
      continue;
    }
    const next = code[++i];
    if (next === undefined) break;
    const k = next.toUpperCase();
    if (k === "L") section = "left";
    else if (k === "C") section = "center";
    else if (k === "R") section = "right";
    else if (k === "P") out[section] += String(vars.page);
    else if (k === "N") out[section] += String(vars.pages);
    else if (k === "D") out[section] += vars.now.toLocaleDateString();
    else if (k === "T") out[section] += vars.now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    else if (k === "A") out[section] += vars.sheet;
    else if (k === "F") out[section] += vars.file;
    else if (k === "Z") out[section] += "";
    else if (next === "&") out[section] += "&";
    else if (next === '"') {
      const end = code.indexOf('"', i + 1);
      i = end < 0 ? code.length : end;
    } else if (/\d/.test(next)) while (/\d/.test(code[i + 1] || "")) i++;
    // &B &I &U &S &E &X &Y &K..: formatting only
    else if (k === "K") i += 6;
  }
  return out;
}

// ---- Layout --------------------------------------------------------------------

type Sheet = UniverWorkbook["sheets"][string];

export function pageSetupOf(sheet: Sheet): PageSetup {
  return { ...((sheet.custom?.xlsx?.pageSetup as PageSetup) || {}) };
}

/** Cells that print when no print area is set: anything with a value, a fill or a border. */
export function usedRange(book: UniverWorkbook, sheet: Sheet): Range | null {
  let g: Range | null = null;
  const grow = (r: number, c: number) => {
    if (!g) g = { startRow: r, endRow: r, startColumn: c, endColumn: c };
    else {
      g.startRow = Math.min(g.startRow, r);
      g.endRow = Math.max(g.endRow, r);
      g.startColumn = Math.min(g.startColumn, c);
      g.endColumn = Math.max(g.endColumn, c);
    }
  };
  for (const [rk, row] of Object.entries(sheet.cellData || {}))
    for (const [ck, cell] of Object.entries(row || {})) {
      if (!cell) continue;
      const st = styleOf(book, cell.s);
      if ((cell.v != null && cell.v !== "") || cell.p || st?.bg?.rgb || st?.bd) grow(Number(rk), Number(ck));
    }
  // Pictures, shapes and charts print too: their bottom-right cell counts.
  if (sheet.id) for (const d of drawingsOf(book, sheet.id)) {
    const end = drawingEnd(sheet, d);
    grow(d.row, d.col);
    grow(end.row, end.col);
  }
  for (const m of sheet.mergeData || []) if (g) {
    const gg = g as Range;
    if (m.startRow <= gg.endRow && m.startColumn <= gg.endColumn && m.endRow >= gg.startRow && m.endColumn >= gg.startColumn) grow(m.endRow, m.endColumn);
  }
  return g;
}

const styleOf = (book: UniverWorkbook, s: string | UniverStyle | null | undefined): UniverStyle | null =>
  s == null ? null : typeof s === "string" ? book.styles?.[s] ?? null : s;

const rgb = (c: { rgb?: string | null } | null | undefined, fallback: string) => {
  const v = c?.rgb;
  if (!v) return fallback;
  return v.startsWith("#") ? v : v.startsWith("rgb") ? v : `#${v.replace(/^ff/i, "").slice(-6)}`;
};

export type PrintOptions = {
  /** Print this range instead of the sheet's print area. */
  area?: Range;
  /** Ignore the print area and print what's used. */
  ignorePrintArea?: boolean;
  file?: string;
  now?: Date;
  /** Pages printed before this sheet (continuing a workbook) and the job's total. */
  pageOffset?: number;
  totalPages?: number;
};

type Layout = {
  setup: PageSetup;
  paper: [number, number];
  margins: typeof DEFAULT_MARGINS;
  scale: number;
  areas: { area: Range; colBands: [number, number][]; rowBands: [number, number][] }[];
  titleRows: [number, number] | null;
  titleCols: [number, number] | null;
};

const colPx = (sheet: Sheet, c: number) => (sheet.columnData?.[c]?.hd ? 0 : sheet.columnData?.[c]?.w ?? sheet.defaultColumnWidth ?? DEFAULT_COL_PX);
const rowPx = (sheet: Sheet, r: number) => (sheet.rowData?.[r]?.hd ? 0 : sheet.rowData?.[r]?.h ?? sheet.defaultRowHeight ?? DEFAULT_ROW_PX);
const sum = (from: number, to: number, f: (i: number) => number) => {
  let t = 0;
  for (let i = from; i <= to; i++) t += f(i);
  return t;
};

/** Splits [from, to] into bands that fit `avail` points at `scale`. */
function bands(from: number, to: number, sizePt: (i: number) => number, avail: number, scale: number): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  let used = 0;
  for (let i = from; i <= to; i++) {
    const s = sizePt(i) * scale;
    if (used + s > avail + 0.01 && i > start) {
      out.push([start, i - 1]);
      start = i;
      used = 0;
    }
    used += s;
  }
  if (start <= to) out.push([start, to]);
  return out;
}

export function layoutSheet(book: UniverWorkbook, sheetId: string, opts: PrintOptions = {}): Layout | null {
  const sheet = book.sheets[sheetId];
  if (!sheet) return null;
  const setup = pageSetupOf(sheet);
  const paperBase = (PAPER[setup.paperSize || 1] || PAPER[1]).size;
  const paper: [number, number] = setup.orientation === "landscape" ? [paperBase[1], paperBase[0]] : [paperBase[0], paperBase[1]];
  const margins = { ...DEFAULT_MARGINS, ...(setup.margins || {}) };
  const headings = !!setup.showRowColHeaders;
  const availW = paper[0] - (margins.left + margins.right) * 72 - (headings ? HEADING_W : 0);
  const availH = paper[1] - (margins.top + margins.bottom) * 72 - (headings ? HEADING_H : 0);

  let areas: Range[] = [];
  if (opts.area) areas = [opts.area];
  else if (setup.printArea && !opts.ignorePrintArea) areas = setup.printArea.split(/[,;]|&&/).map(parseArea).filter((g): g is Range => !!g);
  if (!areas.length) {
    const used = usedRange(book, sheet);
    if (!used) return { setup, paper, margins, scale: 1, areas: [], titleRows: null, titleCols: null };
    areas = [used];
  }
  const titleRows = parseSpan(setup.printTitlesRow, "rows");
  const titleCols = parseSpan(setup.printTitlesColumn, "cols");
  const colPt = (c: number) => colPx(sheet, c) * PX_TO_PT;
  const rowPt = (r: number) => rowPx(sheet, r) * PX_TO_PT;
  const titleW = titleCols ? sum(titleCols[0], titleCols[1], colPt) : 0;
  const titleH = titleRows ? sum(titleRows[0], titleRows[1], rowPt) : 0;

  let scale = Math.max(0.1, Math.min(4, (setup.scale || 100) / 100));
  if (setup.fitToPage) {
    // Excel's "fit to N pages wide by M tall" (0 = as many as needed).
    const fw = setup.fitToWidth ?? 1;
    const fh = setup.fitToHeight ?? 1;
    let fit = 1;
    for (const a of areas) {
      const w = sum(a.startColumn, a.endColumn, colPt);
      const h = sum(a.startRow, a.endRow, rowPt);
      if (fw > 0 && w > 0) fit = Math.min(fit, (availW * fw) / w);
      if (fh > 0 && h > 0) fit = Math.min(fit, (availH * fh) / h);
    }
    scale = Math.max(0.1, Math.min(1, fit));
    // Rounding to whole percent, as Excel shows it, must not spill a column.
    scale = Math.floor(scale * 100 + 1e-6) / 100;
  }

  return {
    setup,
    paper,
    margins,
    scale,
    titleRows,
    titleCols,
    areas: areas.map((area) => ({
      area,
      colBands: bands(area.startColumn, area.endColumn, colPt, availW - titleW * scale, scale),
      rowBands: bands(area.startRow, area.endRow, rowPt, availH - titleH * scale, scale),
    })),
  };
}

/** Lays out one sheet into pages. */
export function printSheet(book: UniverWorkbook, sheetId: string, opts: PrintOptions = {}): PageModel[] {
  if (isChartSheet(book, sheetId)) return chartSheetPage(book, sheetId, opts);
  const sheet = book.sheets[sheetId];
  const lay = layoutSheet(book, sheetId, opts);
  if (!sheet || !lay) return [];
  const { setup, paper, margins, scale } = lay;
  const headings = !!setup.showRowColHeaders;
  const colPt = (c: number) => colPx(sheet, c) * PX_TO_PT * scale;
  const rowPt = (r: number) => rowPx(sheet, r) * PX_TO_PT * scale;

  // Merges: anchor -> extent, covered cells skipped.
  const mergeAt = new Map<string, Range>();
  const covered = new Set<string>();
  for (const m of sheet.mergeData || []) {
    mergeAt.set(`${m.startRow},${m.startColumn}`, m);
    for (let r = m.startRow; r <= m.endRow; r++) for (let c = m.startColumn; c <= m.endColumn; c++) if (r !== m.startRow || c !== m.startColumn) covered.add(`${r},${c}`);
  }
  const cellAt = (r: number, c: number): UniverCell | undefined => sheet.cellData?.[r]?.[c];
  const styleAt = (r: number, c: number): UniverStyle => ({
    ...(styleOf(book, sheet.columnData?.[c]?.s) || {}),
    ...(styleOf(book, sheet.rowData?.[r]?.s) || {}),
    ...(styleOf(book, cellAt(r, c)?.s) || {}),
  });
  const textAt = (r: number, c: number) => {
    const cell = cellAt(r, c);
    return cell ? cellDisplayText(book, cell, styleAt(r, c)) : "";
  };

  const sequence: { rows: number[]; cols: number[] }[] = [];
  for (const { colBands, rowBands } of lay.areas) {
    const order: [number, number][] = [];
    if (setup.pageOrder === "overThenDown") rowBands.forEach((_r, ri) => colBands.forEach((_c, ci) => order.push([ri, ci])));
    else colBands.forEach((_c, ci) => rowBands.forEach((_r, ri) => order.push([ri, ci])));
    for (const [ri, ci] of order) {
      const [r0, r1] = rowBands[ri];
      const [c0, c1] = colBands[ci];
      const rows: number[] = [];
      const cols: number[] = [];
      // Repeated titles go first on pages that don't already show them.
      if (lay.titleRows && r0 > lay.titleRows[1]) for (let r = lay.titleRows[0]; r <= lay.titleRows[1]; r++) rows.push(r);
      for (let r = r0; r <= r1; r++) rows.push(r);
      if (lay.titleCols && c0 > lay.titleCols[1]) for (let c = lay.titleCols[0]; c <= lay.titleCols[1]; c++) cols.push(c);
      for (let c = c0; c <= c1; c++) cols.push(c);
      sequence.push({ rows, cols });
    }
  }

  const now = opts.now || new Date();
  const first = (setup.firstPageNumber && setup.firstPageNumber > 0 ? setup.firstPageNumber : 1) + (opts.pageOffset || 0);
  const total = opts.totalPages ?? sequence.length + (opts.pageOffset || 0);
  const hf = (sheet.custom?.xlsx?.headerFooter || {}) as HeaderFooter;
  const drawings = drawingsOf(book, sheetId);

  return sequence.map(({ rows, cols }, pageIndex) => {
    const xs = new Map<number, number>();
    const ys = new Map<number, number>();
    const contentW = cols.reduce((t, c) => t + colPt(c), 0);
    const contentH = rows.reduce((t, r) => t + rowPt(r), 0);
    const left0 = margins.left * 72 + (headings ? HEADING_W : 0) + (setup.horizontalCentered ? Math.max(0, (paper[0] - (margins.left + margins.right) * 72 - (headings ? HEADING_W : 0) - contentW) / 2) : 0);
    const top0 = margins.top * 72 + (headings ? HEADING_H : 0) + (setup.verticalCentered ? Math.max(0, (paper[1] - (margins.top + margins.bottom) * 72 - (headings ? HEADING_H : 0) - contentH) / 2) : 0);
    let x = left0;
    for (const c of cols) {
      xs.set(c, x);
      x += colPt(c);
    }
    let y = top0;
    for (const r of rows) {
      ys.set(r, y);
      y += rowPt(r);
    }
    const right = x;
    const bottom = y;
    const colPos = cols.map((c) => [c, xs.get(c)!, colPt(c)] as const);

    const cells: CellBox[] = [];
    const occupied = new Set<string>();
    for (const r of rows) {
      const h = rowPt(r);
      if (!h) continue;
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (!colPt(c) || covered.has(`${r},${c}`)) continue;
        const merge = mergeAt.get(`${r},${c}`);
        let w = colPt(c);
        let hh = h;
        if (merge) {
          w = cols.slice(ci).filter((cc) => cc <= merge.endColumn).reduce((t, cc) => t + colPt(cc), 0);
          hh = rows.slice(rows.indexOf(r)).filter((rr) => rr <= merge.endRow).reduce((t, rr) => t + rowPt(rr), 0);
        }
        const st = styleAt(r, c);
        const cell = cellAt(r, c);
        const text = textAt(r, c);
        const fill = st.bg?.rgb ? rgb(st.bg, "") : undefined;
        const bd = st.bd || {};
        const line = (b: any): BorderLine | undefined =>
          b && b.s ? { width: (BORDER_WIDTH[b.s] ?? 0.5) * Math.max(scale, 0.5), color: rgb(b.cl, "#000000"), ...(BORDER_DASH[b.s] ? { dash: BORDER_DASH[b.s] } : {}), ...(b.s === 7 ? { double: true } : {}) } : undefined;
        const borders = { t: line(bd.t), r: line(bd.r), b: line(bd.b), l: line(bd.l) };
        if (!text && !fill && !borders.t && !borders.r && !borders.b && !borders.l) continue;
        const isNumber = typeof cell?.v === "number" && cell?.t !== 3;
        const align = st.ht === 2 ? "center" : st.ht === 3 ? "right" : st.ht === 1 ? "left" : isNumber ? "right" : cell?.t === 3 ? "center" : "left";
        const valign = st.vt === 1 ? "top" : st.vt === 2 ? "middle" : "bottom";
        const wrap = st.tb === 3;
        // Unwrapped text spills over empty neighbours, as on screen.
        let textX = xs.get(c)!;
        let textW = w;
        if (text && !wrap && !merge) {
          const empty = (cc: number) => !textAt(r, cc) && !mergeAt.has(`${r},${cc}`) && !covered.has(`${r},${cc}`);
          if (align === "left" || align === "center")
            for (let k = ci + 1; k < colPos.length && empty(colPos[k][0]); k++) textW += colPos[k][2];
          if (align === "right" || align === "center")
            for (let k = ci - 1; k >= 0 && empty(colPos[k][0]) && !occupied.has(`${r},${colPos[k][0]}`); k--) {
              textX -= colPos[k][2];
              textW += colPos[k][2];
            }
          if (align === "center") {
            // keep it centred on its own cell
            const mid = xs.get(c)! + w / 2;
            const half = Math.min(mid - textX, textX + textW - mid);
            textX = mid - half;
            textW = half * 2;
          }
        }
        occupied.add(`${r},${c}`);
        cells.push({
          x: xs.get(c)!,
          y: ys.get(r)!,
          w,
          h: hh,
          textX,
          textW,
          text,
          style: {
            font: st.ff || "Arial",
            size: (st.fs || 11) * scale,
            bold: !!st.bl,
            italic: !!st.it,
            underline: !!st.ul?.s,
            strike: !!st.st?.s,
            color: rgb(st.cl, "#000000"),
          },
          ...(fill ? { fill } : {}),
          align,
          valign,
          wrap,
          borders,
        });
      }
    }

    const grid: PageModel["grid"] = [];
    if (setup.showGridLines) {
      for (const [, x0] of colPos) grid.push({ x1: x0, y1: top0, x2: x0, y2: bottom });
      grid.push({ x1: right, y1: top0, x2: right, y2: bottom });
      for (const r of rows) if (rowPt(r)) grid.push({ x1: left0, y1: ys.get(r)!, x2: right, y2: ys.get(r)! });
      grid.push({ x1: left0, y1: bottom, x2: right, y2: bottom });
    }

    if (headings) {
      const hs: TextStyle = { font: "Arial", size: 8, bold: false, italic: false, underline: false, strike: false, color: "#475569" };
      const edge: BorderLine = { width: 0.5, color: "#94a3b8" };
      for (const [c, x0, w] of colPos)
        if (w) cells.push({ x: x0, y: top0 - HEADING_H, w, h: HEADING_H, textX: x0, textW: w, text: colName(c), style: hs, fill: "#f1f5f9", align: "center", valign: "middle", wrap: false, borders: { t: edge, r: edge, b: edge, l: edge }, heading: true });
      for (const r of rows)
        if (rowPt(r)) cells.push({ x: left0 - HEADING_W, y: ys.get(r)!, w: HEADING_W, h: rowPt(r), textX: left0 - HEADING_W, textW: HEADING_W, text: String(r + 1), style: hs, fill: "#f1f5f9", align: "center", valign: "middle", wrap: false, borders: { t: edge, r: edge, b: edge, l: edge }, heading: true });
    }

    // Pictures anchored to cells on this page.
    const images: ImageBox[] = [];
    const overlay: CellBox[] = [];
    const colSet = new Set(cols);
    const rowSet = new Set(rows);
    for (const d of drawings) {
      if (!colSet.has(d.col) || !rowSet.has(d.row)) continue;
      const ix = xs.get(d.col)! + d.dx * PX_TO_PT * scale;
      const iy = ys.get(d.row)! + d.dy * PX_TO_PT * scale;
      const iw = d.w * PX_TO_PT * scale;
      const ih = d.h * PX_TO_PT * scale;
      if (d.src) images.push({ x: ix, y: iy, w: iw, h: ih, src: d.src, clip: { x: left0, y: top0, w: right - left0, h: bottom - top0 } });
      // A shape's text prints as text (searchable in the PDF), over its outline.
      for (const t of d.texts || []) {
        const s = t.data;
        const pad = 4 * PX_TO_PT * scale;
        const box = { x: ix + t.x * iw, y: iy + t.y * ih, w: t.w * iw, h: t.h * ih };
        overlay.push({
          ...box,
          textX: box.x + pad,
          textW: Math.max(1, box.w - pad * 2),
          text: s.text,
          style: { font: "Calibri", size: s.fontSize * scale, bold: !!s.bold, italic: !!s.italic, underline: false, strike: false, color: s.color || "#000000" },
          align: s.align === "l" ? "left" : s.align === "r" ? "right" : "center",
          valign: s.vAlign === "t" ? "top" : s.vAlign === "b" ? "bottom" : "middle",
          wrap: true,
          borders: {},
        });
      }
    }

    const vars = { page: first + pageIndex, pages: total, sheet: sheet.name, file: opts.file || book.name || "", now };
    return {
      width: paper[0],
      height: paper[1],
      cells,
      grid,
      images,
      ...(overlay.length ? { overlay } : {}),
      header: headerFooterText(hf.oddHeader, vars),
      footer: headerFooterText(hf.oddFooter, vars),
      headerY: margins.header * 72,
      footerY: paper[1] - margins.footer * 72,
      margins: { left: margins.left * 72, right: paper[0] - margins.right * 72 },
    };
  });
}

type Drawing = { row: number; col: number; dx: number; dy: number; w: number; h: number; src: string; texts?: { x: number; y: number; w: number; h: number; data: ShapeData }[] };

/** The cell a drawing's bottom-right corner falls in. */
function drawingEnd(sheet: Sheet, d: Drawing) {
  let col = d.col;
  let x = d.dx + d.w;
  while (x > colPx(sheet, col) && col < 16383) x -= colPx(sheet, col++);
  let row = d.row;
  let y = d.dy + d.h;
  while (y > rowPx(sheet, row) && row < 1048575) y -= rowPx(sheet, row++);
  return { row, col };
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function chartsOf(book: UniverWorkbook): SheetChartResource {
  try {
    const data = (book.resources || []).find((r) => r.name === "SHEET_SYNERGY_CHARTS_PLUGIN")?.data;
    const parsed = data ? (JSON.parse(data) as SheetChartResource) : null;
    return parsed?.sheets ? parsed : { sheets: {} };
  } catch {
    return { sheets: {} };
  }
}

/** Pictures, shapes and charts of a sheet: anchor cell, offset and size in pixels. */
function drawingsOf(book: UniverWorkbook, sheetId: string): Drawing[] {
  const out: Drawing[] = [];
  const res = (book.resources || []).find((r) => r.name === "SHEET_DRAWING_PLUGIN");
  let data: any = null;
  try {
    data = res ? JSON.parse(res.data || "{}")?.[sheetId] : null;
  } catch {
    data = null;
  }
  for (const id of data?.order || []) {
    const d = data.data?.[id];
    const from = d?.sheetTransform?.from;
    if (!from) continue;
    const w = d.transform?.width || 100;
    const h = d.transform?.height || 100;
    const at = { row: from.row, col: from.column, dx: from.columnOffset || 0, dy: from.rowOffset || 0, w, h };
    if (typeof d?.source === "string" && d.source.startsWith("data:image/")) out.push({ ...at, src: d.source });
    else if (d?.componentKey === SHAPE_COMPONENT && d.data) {
      const shape = d.data as ShapeData;
      out.push({ ...at, src: svgUrl(shapeSvg(shape, w, h)), texts: shapeTexts(shape) });
    }
  }
  for (const chart of chartsOf(book).sheets[sheetId] || []) {
    const svg = printRenderers.chartSvg?.(chart, book, CHART_PX);
    out.push({ row: chart.anchor.row, col: chart.anchor.column, dx: 0, dy: 0, w: CHART_PX.w, h: CHART_PX.h, src: svg ? svgUrl(svg) : "" });
  }
  return out;
}

/** A chart sheet prints as one page: the chart, as large as the page allows. */
function chartSheetPage(book: UniverWorkbook, sheetId: string, opts: PrintOptions): PageModel[] {
  const sheet = book.sheets[sheetId];
  const chart = chartsOf(book).sheets[sheetId]?.[0];
  if (!sheet || !chart) return [];
  const setup = pageSetupOf(sheet);
  const paperBase = (PAPER[setup.paperSize || 1] || PAPER[1]).size;
  // Excel prints chart sheets landscape unless told otherwise.
  const paper: [number, number] = setup.orientation === "portrait" ? [paperBase[0], paperBase[1]] : [paperBase[1], paperBase[0]];
  const margins = { ...DEFAULT_MARGINS, ...(setup.margins || {}) };
  const availW = paper[0] - (margins.left + margins.right) * 72;
  const availH = paper[1] - (margins.top + margins.bottom) * 72;
  const k = Math.min(availW / CHART_PX.w, availH / CHART_PX.h);
  const w = CHART_PX.w * k;
  const h = CHART_PX.h * k;
  const x = margins.left * 72 + (availW - w) / 2;
  const y = margins.top * 72 + (availH - h) / 2;
  const svg = printRenderers.chartSvg?.(chart, book, { w: Math.round(w / PX_TO_PT), h: Math.round(h / PX_TO_PT) });
  const hf = (sheet.custom?.xlsx?.headerFooter || {}) as HeaderFooter;
  const page = (setup.firstPageNumber && setup.firstPageNumber > 0 ? setup.firstPageNumber : 1) + (opts.pageOffset || 0);
  const vars = { page, pages: opts.totalPages ?? page, sheet: sheet.name, file: opts.file || book.name || "", now: opts.now || new Date() };
  return [
    {
      width: paper[0],
      height: paper[1],
      cells: [],
      grid: [],
      images: svg ? [{ x, y, w, h, src: svgUrl(svg), clip: { x, y, w, h } }] : [],
      header: headerFooterText(hf.oddHeader, vars),
      footer: headerFooterText(hf.oddFooter, vars),
      headerY: margins.header * 72,
      footerY: paper[1] - margins.footer * 72,
      margins: { left: margins.left * 72, right: paper[0] - margins.right * 72 },
    },
  ];
}
const isChartSheet = (book: UniverWorkbook, sheetId: string) => !!chartsOf(book).chartSheets?.includes(sheetId);

export function printWorkbook(book: UniverWorkbook, opts: Omit<PrintOptions, "area" | "pageOffset" | "totalPages"> = {}): PageModel[] {
  const ids = book.sheetOrder.filter((id) => book.sheets[id] && !book.sheets[id].hidden);
  // The page total (&N) needs every sheet's page count first.
  const counts = ids.map((id) => layoutPageCount(book, id, opts));
  const totalPages = counts.reduce((a, b) => a + b, 0);
  const pages: PageModel[] = [];
  let pageOffset = 0;
  ids.forEach((id, i) => {
    pages.push(...printSheet(book, id, { ...opts, pageOffset, totalPages }));
    pageOffset += counts[i];
  });
  return pages;
}

/** Number of pages a sheet prints on, without building them. */
export function layoutPageCount(book: UniverWorkbook, sheetId: string, opts: PrintOptions = {}): number {
  if (isChartSheet(book, sheetId)) return chartsOf(book).sheets[sheetId]?.length ? 1 : 0;
  const lay = layoutSheet(book, sheetId, opts);
  return lay ? lay.areas.reduce((t, a) => t + a.colBands.length * a.rowBands.length, 0) : 0;
}
