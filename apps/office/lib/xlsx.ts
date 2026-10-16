// Excel <-> Univer bridge. This is the free, de-branded replacement for Univer's
// paid import/export (@univerjs-pro exchange packages, which we must not use):
// ExcelJS (MIT) parses/writes the real .xlsx binary, and we map it to/from
// Univer's workbook snapshot (IWorkbookData) shape ourselves.
//
// What round-trips: values, formulas (+ cached results), rich text, cell styles
// (font, fill, borders, alignment, wrap, rotation, number format), merged cells,
// column widths / row heights / hidden rows+cols, frozen panes, gridlines, zoom,
// tab colors, hidden sheets, defined names (ranges and formulas), hyperlinks,
// notes (Excel comments), data validation, conditional formatting, the autofilter
// with its conditions, Excel tables, images, and page setup / print areas /
// headers and footers (kept in the sheet's `custom` data for the next export),
// charts, sparklines, shapes and text boxes, and what-if scenarios.
//
// Legacy formats (.xls, .ods, .csv) can't be read by ExcelJS; they go through
// SheetJS (`legacyToUniver`), which keeps values, formulas, number formats and merges.
import type * as ExcelJSTypes from "exceljs";
import * as XLSX from "xlsx";
import { autoFilterXml, openPackage, patchOutline, patchPackage, patchSheetProtection, readAutoFilter, readComments, readDefinedNames, readOutline, readSheetProtection, xmlDecode, type DefinedName, type FilterColumn, type OutlineMark } from "./xlsx-ooxml.ts";
import { PROTECTION_RESOURCE, protectionsOf, type Protection } from "./protection-rules.mjs";
import { passwordAttrs } from "./excel-password.ts";
import { patchPicAlts, readPicAlts, type PicAlt } from "./sheet-a11y.ts";
import { DOC_PROPS_RESOURCE, readDocProps, writeDocProps, type DocProps } from "./sensitivity.ts";
import { patchWorkbookProtection, readWorkbookProtection } from "./sheet-doc-props.ts";
import { CUSTOM_VIEWS_RESOURCE, patchSheetCustomViews, patchWorkbookCustomViews, readCustomViews, type CustomView } from "./custom-views.ts";
import { addPivotTables, readPivotTables, type PivotExport } from "./xlsx-pivots.ts";
import { fieldNames, PIVOT_RESOURCE, type PivotDef } from "./pivot.ts";
import { addThreadedComments, fallbackText, readThreadedComments, refCell, type SheetThread } from "./xlsx-threads.ts";
import type { OutlineCustom } from "./sheet-outline.ts";
import { addChartsToXlsx, chartsFromXlsx, SHEET_CHART_RESOURCE, withoutChartFrames } from "./sheet-charts.ts";
import { addControlsToVml, FORM_CONTROL_COMPONENT, readVmlControls, withCtrlProp, type ReadControl } from "./form-controls.ts";
import { addShapesToZip, DRAWING_DOM, drawingPartOf, legacyDrawingPartOf, sheetRelTarget, readShapes, writeLegacyDrawing, SHAPE_COMPONENT, type SheetShapes, type ShapeData } from "./sheet-shapes.ts";
import { patchScenarios, readScenarios, scenariosXml, SCENARIO_RESOURCE, type Scenario } from "./scenarios.ts";
import { asDate, SLICER_COMPONENT, type SlicerData } from "./slicers.ts";
import { addPivotSlicers, addTableSlicersAndTimelines, readPivotSlicers, readTableSlicersAndTimelines, type SlicerExport, type TableSlicerExport, type TimelineExport } from "./xlsx-slicers.ts";
import { DEFAULT_THEME as DEFAULT_WORKBOOK_THEME, patchThemeXml, readThemeXml, THEME_RESOURCE, themeFrom } from "./sheet-themes.ts";
import { addExternalLinks, formulaLinksFromExcel, formulaLinksToExcel, linkNameFor, LINKS_RESOURCE, readExternalLinks, type WorkbookLink } from "./workbook-links.ts";
import { addCalcToZip, CALC_RESOURCE, calcSettings, markDynamicArrays, readCalcPr, type SpillInfo } from "./xlsx-calc.ts";
import { KEPT_RESOURCE, readKept, SCRIPT_RESOURCE, writeKept, type KeptParts, type Script } from "./xlsx-kept.ts";

export { SCRIPT_RESOURCE };

/** True when the workbook carries a VBA project (it downloads as .xlsm). */
export const isMacroEnabled = (book: Pick<UniverWorkbook, "resources">) => {
  try {
    return !!JSON.parse(book.resources?.find((r) => r.name === KEPT_RESOURCE)?.data || "{}").vba?.project;
  } catch {
    return false;
  }
};
import { addQueriesToZip, externalDataName, QUERY_RESOURCE, readQueries, type QueryDef } from "./data-import.ts";
import { DATA_TABLE_RESOURCE, patchDataTables, readDataTables, type DataTableDef } from "./data-table.ts";
import { modelFromNames, SOLVER_RESOURCE, solverNames, type SolverModel } from "./solver.ts";
import { patchSparklines, readSparklines, sparklineExtXml, SPARKLINE_RESOURCE, type SparklineGroup } from "./sparkline.ts";
import { metafilePlaceholder, metafileToSvg } from "./slides/metafile.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Color = { rgb?: string | null; th?: number };
type Border = { s: number; cl: Color };
export type UniverStyle = {
  ff?: string | null;
  fs?: number;
  it?: number;
  bl?: number;
  ul?: { s: number };
  st?: { s: number };
  va?: number | null;
  cl?: Color | null;
  bg?: Color | null;
  bd?: { t?: Border | null; r?: Border | null; b?: Border | null; l?: Border | null } | null;
  ht?: number | null;
  vt?: number | null;
  tb?: number | null;
  tr?: { a: number; v?: number } | null;
  n?: { pattern: string } | null;
};
type TextRun = { st: number; ed: number; ts?: UniverStyle | null };
type CustomRange = { rangeId: string; rangeType: number; startIndex: number; endIndex: number; properties?: { url?: string } };
type RichDoc = {
  id: string;
  documentStyle: Record<string, unknown>;
  body: {
    dataStream: string;
    textRuns?: TextRun[];
    paragraphs?: { startIndex: number }[];
    customRanges?: CustomRange[];
    sectionBreaks?: { startIndex: number }[];
  };
};
export type UniverCell = {
  v?: string | number | boolean | null;
  f?: string | null;
  si?: string | null;
  t?: number | null;
  s?: string | UniverStyle | null;
  p?: RichDoc | null;
};
type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type UniverSheet = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cellData: Record<number, Record<number, UniverCell>>;
  mergeData?: Range[];
  rowData?: Record<number, { h?: number; hd?: number; s?: string | UniverStyle | null; custom?: OutlineCustom & Record<string, unknown> }>;
  columnData?: Record<number, { w?: number; hd?: number; s?: string | UniverStyle | null; custom?: OutlineCustom & Record<string, unknown> }>;
  defaultColumnWidth?: number;
  defaultRowHeight?: number;
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number };
  tabColor?: string;
  hidden?: number;
  showGridlines?: number;
  zoomRatio?: number;
  rightToLeft?: number;
  custom?: { xlsx?: SheetXlsxMeta } & Record<string, unknown>;
};
/** Excel-only sheet settings Univer has no model for, kept so export can write them back. */
export type SheetXlsxMeta = {
  pageSetup?: Record<string, unknown>;
  headerFooter?: Record<string, unknown>;
  /** Excel's "summary rows below / columns right" switches, when turned off. */
  outline?: { summaryBelow?: boolean; summaryRight?: boolean };
  /** A split window (not frozen panes): where the split bars are, in twentieths of a point. */
  split?: { xSplit: number; ySplit: number; topLeftCell?: string };
  /** Excel's "very hidden": hidden, and not offered by Unhide (only code can show it). */
  veryHidden?: boolean;
};
export type UniverWorkbook = {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  sheetOrder: string[];
  styles: Record<string, UniverStyle | null>;
  sheets: Record<string, UniverSheet>;
  resources?: { name: string; data: string }[];
};

// Univer enum values (from @univerjs/core) — inlined so this module stays a
// plain data mapper that also runs in Node (tests) without the engine.
const CELL = { STRING: 1, NUMBER: 2, BOOLEAN: 3, FORCE_STRING: 4 };
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, distributed: 6, centerContinuous: 2, fill: 1 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3, justify: 2, distributed: 2 };
const WRAP = 3;
const BORDER: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
// Resource (plugin state) names inside the Univer snapshot.
export const RESOURCE = {
  cf: "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
  dv: "SHEET_DATA_VALIDATION_PLUGIN",
  note: "SHEET_NOTE_PLUGIN",
  filter: "SHEET_FILTER_PLUGIN",
  names: "SHEET_DEFINED_NAME_PLUGIN",
  table: "SHEET_TABLE_PLUGIN",
  drawing: "SHEET_DRAWING_PLUGIN",
  charts: SHEET_CHART_RESOURCE,
};

const sid = (i: number) => `sheet-${i + 1}`;
const uid = () => Math.random().toString(36).slice(2, 10);

// ---- Units ----------------------------------------------------------------
// Excel widths are in "characters" of the default font (Calibri 11 = 7px),
// heights in points; Univer uses pixels for both.
const colPx = (chars: number) => Math.round(chars * 7 + 5);
const colChars = (px: number) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
const rowPx = (pt: number) => Math.round((pt * 4) / 3);
const rowPt = (px: number) => Math.round(px * 0.75 * 100) / 100;
const EXCEL_DEFAULT_COL = 64; // 8.43 characters
const EXCEL_DEFAULT_ROW = 20; // 15pt

// Excel serial date (1900 system).
const EPOCH = Date.UTC(1899, 11, 30);
const dateToSerial = (d: Date) => (d.getTime() - EPOCH) / 86400000;

// ---- Colors ---------------------------------------------------------------
// Office 2013+ default theme, used when a workbook carries no theme part.
// Order is the cell-XML theme index: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink.
const DEFAULT_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
// Legacy indexed palette (default indexed colors 0..63).
const INDEXED = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF " +
  "000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
  "3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

function parseTheme(xml: string | undefined): string[] {
  if (!xml) return DEFAULT_THEME;
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0];
  if (!scheme) return DEFAULT_THEME;
  const tags = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return tags.map((tag, i) => {
    const block = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(scheme)?.[1] || "";
    const hex = (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(block) || /lastClr="([0-9A-Fa-f]{6})"/.exec(block))?.[1];
    return hex ? hex.toUpperCase() : DEFAULT_THEME[i];
  });
}

/** Excel tint: lighten/darken the HSL luminance. */
export function applyTint(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rgb: number[];
  if (s === 0) rgb = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** ExcelJS color ({argb} | {theme, tint} | {indexed}) -> "#RRGGBB". */
function toHex(c: any, theme: string[]): string | undefined {
  if (!c) return undefined;
  let hex: string | undefined;
  if (typeof c.argb === "string" && c.argb.length >= 6) hex = c.argb.slice(-6).toUpperCase();
  else if (typeof c.theme === "number") hex = theme[c.theme] ?? DEFAULT_THEME[c.theme];
  else if (typeof c.indexed === "number") hex = c.indexed === 64 ? "000000" : INDEXED[c.indexed];
  if (!hex) return undefined;
  if (typeof c.tint === "number" && c.tint) hex = applyTint(hex, c.tint);
  return "#" + hex;
}

/** Univer color string ("#rgb", "#rrggbb", "rgb(r,g,b)", "rgba(...)") -> ExcelJS ARGB. */
export function toArgb(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const c = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return "FF" + m[1].split("").map((x) => x + x).join("").toUpperCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return ((m[2] || "FF") + m[1]).toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) {
    const a = m[4] != null ? Math.round(Number(m[4]) * 255) : 255;
    return [a, m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return undefined;
}
const argb = (color: Color | null | undefined) => (color?.rgb ? toArgb(color.rgb) : undefined);

// ---- Formulas -------------------------------------------------------------
// Newer Excel functions are stored with a `_xlfn.` (and for some `_xlws.`)
// prefix; Excel shows #NAME? if they're written back without it.
const XLFN = [
  "XLOOKUP", "XMATCH", "FILTER", "SORT", "SORTBY", "UNIQUE", "SEQUENCE", "RANDARRAY", "LET", "LAMBDA", "IFS", "SWITCH",
  "MAXIFS", "MINIFS", "CONCAT", "TEXTJOIN", "IFNA", "XOR", "DAYS", "ISOWEEKNUM", "TEXTBEFORE", "TEXTAFTER", "TEXTSPLIT",
  "VSTACK", "HSTACK", "TOCOL", "TOROW", "WRAPROWS", "WRAPCOLS", "TAKE", "DROP", "CHOOSEROWS", "CHOOSECOLS", "EXPAND",
  "STDEV.S", "STDEV.P", "VAR.S", "VAR.P", "MODE.SNGL", "MODE.MULT", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE.INC",
  "QUARTILE.EXC", "RANK.EQ", "RANK.AVG", "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "CEILING.MATH", "FLOOR.MATH",
  "AGGREGATE", "FORECAST.LINEAR", "CONFIDENCE.NORM", "CONFIDENCE.T", "T.TEST", "T.DIST", "T.INV", "BINOM.DIST",
  "COVARIANCE.P", "COVARIANCE.S", "NUMBERVALUE", "ARABIC", "BASE", "DECIMAL", "SHEET", "SHEETS", "FORMULATEXT", "ISFORMULA",
  "IMAGE", "ARRAYTOTEXT", "VALUETOTEXT", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY", "ISOMITTED", "ANCHORARRAY",
];
const XLWS = new Set(["FILTER", "SORT"]);
const XLFN_RE = new RegExp(`(?<![A-Za-z0-9_.])(${XLFN.map((f) => f.replace(/\./g, "\\.")).join("|")})\\(`, "gi");

/** Apply `fn` to the parts of a formula outside "string" literals and 'quoted sheet' names. */
function outsideQuotes(formula: string, fn: (s: string) => string): string {
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}
export const formulaFromExcel = (f: string) => "=" + outsideQuotes(f.replace(/^=/, ""), (s) => s.replace(/_xlfn\.(_xlws\.)?|_xlpm\./gi, ""));

/**
 * The names a formula's LET and LAMBDA calls declare: every LAMBDA argument
 * but the last, and LET's first, third, … arguments. Excel stores them, and
 * every use of them, with an `_xlpm.` prefix.
 */
export function lambdaNames(formula: string): Set<string> {
  const names = new Set<string>();
  const body = formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '""');
  const call = /(?<![A-Za-z0-9_.])(LET|LAMBDA)\(/gi;
  for (let m: RegExpExecArray | null; (m = call.exec(body)); ) {
    // Split this call's arguments at top-level commas.
    const args: string[] = [];
    let depth = 0;
    let start = m.index + m[0].length;
    let i = start;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) {
        args.push(body.slice(start, i));
        start = i + 1;
      }
    }
    args.push(body.slice(start, i));
    const declared = m[1].toUpperCase() === "LAMBDA" ? args.slice(0, -1) : args.filter((_, k) => k % 2 === 0 && k < args.length - 1);
    for (const a of declared) {
      const name = a.trim().replace(/^_xlpm\./i, "");
      if (/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(name)) names.add(name.toLowerCase());
    }
  }
  return names;
}

export const formulaToExcel = (f: string) => {
  const names = lambdaNames(f.replace(/^=/, ""));
  return outsideQuotes(f.replace(/^=/, ""), (s) => {
    let out = s.replace(XLFN_RE, (_m, name: string) => `_xlfn.${XLWS.has(name.toUpperCase()) ? "_xlws." : ""}${name}(`);
    if (names.size)
      out = out.replace(/(?<![A-Za-z0-9_.!$:])([A-Za-z_\\][A-Za-z0-9_.]*)(?![A-Za-z0-9_.!])/g, (m, name: string) => (names.has(name.toLowerCase()) ? `_xlpm.${name}` : m));
    return out;
  });
};

/** Shift the relative A1 references in a formula by (dr, dc) — used to expand
 *  Univer's shared formulas (cells that carry only an `si`) into real formulas. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  return outsideQuotes(f, (s) =>
    s.replace(/(?<![A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, ca: string, col: string, ra: string, row: string) => {
      const c = XLSX.utils.decode_col(col) + (ca ? 0 : dc);
      const r = Number(row) + (ra ? 0 : dr);
      if (c < 0 || r < 1) return m;
      return `${ca}${XLSX.utils.encode_col(c)}${ra}${r}`;
    }),
  );
}

const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const rangeRef = (g: Range) =>
  g.startRow === g.endRow && g.startColumn === g.endColumn
    ? addr(g.startRow, g.startColumn)
    : `${addr(g.startRow, g.startColumn)}:${addr(g.endRow, g.endColumn)}`;
const absRef = (g: Range) => rangeRef(g).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
function parseRef(ref: string): Range | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(ref.trim());
  if (!m) return null;
  const s = XLSX.utils.decode_cell(`${m[1]}${m[2]}`.toUpperCase());
  const e = m[3] ? XLSX.utils.decode_cell(`${m[3]}${m[4]}`.toUpperCase()) : s;
  return { startRow: Math.min(s.r, e.r), endRow: Math.max(s.r, e.r), startColumn: Math.min(s.c, e.c), endColumn: Math.max(s.c, e.c) };
}
const quoteSheet = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

// ---- Styles: Excel -> Univer ---------------------------------------------
function styleFromExcel(st: Partial<ExcelJSTypes.Style> | undefined, theme: string[]): UniverStyle | null {
  if (!st) return null;
  const u: UniverStyle = {};
  const f = st.font;
  if (f) {
    if (f.name) u.ff = f.name;
    if (f.size) u.fs = f.size;
    if (f.bold) u.bl = 1;
    if (f.italic) u.it = 1;
    if (f.underline && f.underline !== "none") u.ul = { s: 1 };
    if (f.strike) u.st = { s: 1 };
    if (f.vertAlign === "superscript") u.va = 3;
    else if (f.vertAlign === "subscript") u.va = 2;
    const cl = toHex(f.color, theme);
    if (cl && cl !== "#000000") u.cl = { rgb: cl };
  }
  const fill = st.fill as any;
  if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") {
    const bg = toHex(fill.fgColor, theme) || toHex(fill.bgColor, theme);
    if (bg) u.bg = { rgb: bg };
  } else if (fill?.type === "gradient" && fill.stops?.length) {
    const bg = toHex(fill.stops[0].color, theme);
    if (bg) u.bg = { rgb: bg };
  }
  const bd = st.border;
  if (bd) {
    const side = (b: any): Border | undefined =>
      b?.style && BORDER[b.style] ? { s: BORDER[b.style], cl: { rgb: toHex(b.color, theme) || "#000000" } } : undefined;
    const out: NonNullable<UniverStyle["bd"]> = {};
    const t = side(bd.top);
    const r = side(bd.right);
    const b = side(bd.bottom);
    const l = side(bd.left);
    if (t) out.t = t;
    if (r) out.r = r;
    if (b) out.b = b;
    if (l) out.l = l;
    if (Object.keys(out).length) u.bd = out;
  }
  const a = st.alignment;
  if (a) {
    if (a.horizontal && H_ALIGN[a.horizontal]) u.ht = H_ALIGN[a.horizontal];
    if (a.vertical && V_ALIGN[a.vertical]) u.vt = V_ALIGN[a.vertical];
    if (a.wrapText) u.tb = WRAP;
    const rot = a.textRotation as unknown;
    if (rot === "vertical" || rot === 255) u.tr = { a: 0, v: 1 };
    else if (typeof rot === "number" && rot) u.tr = { a: rot > 90 ? 90 - rot : rot };
  }
  if (st.numFmt && st.numFmt !== "General") u.n = { pattern: st.numFmt };
  return Object.keys(u).length ? u : null;
}

// ---- Styles: Univer -> Excel ---------------------------------------------
const BORDER_NAME: Record<number, string> = Object.fromEntries(Object.entries(BORDER).map(([k, v]) => [v, k]));
const H_NAME: Record<number, string> = { 1: "left", 2: "center", 3: "right", 4: "justify", 5: "justify", 6: "distributed" };
const V_NAME: Record<number, string> = { 1: "top", 2: "middle", 3: "bottom" };

function fontToExcel(u: UniverStyle | null | undefined): Partial<ExcelJSTypes.Font> | undefined {
  if (!u) return undefined;
  const font: Partial<ExcelJSTypes.Font> = {};
  if (u.ff) font.name = u.ff;
  if (u.fs) font.size = u.fs;
  if (u.bl) font.bold = true;
  if (u.it) font.italic = true;
  if (u.ul?.s) font.underline = true;
  if (u.st?.s) font.strike = true;
  if (u.va === 3) font.vertAlign = "superscript";
  else if (u.va === 2) font.vertAlign = "subscript";
  const fc = argb(u.cl);
  if (fc) font.color = { argb: fc };
  return Object.keys(font).length ? font : undefined;
}

function styleToExcel(u: UniverStyle | null | undefined): Partial<ExcelJSTypes.Style> | null {
  if (!u) return null;
  const st: Partial<ExcelJSTypes.Style> = {};
  const font = fontToExcel(u);
  if (font) st.font = font;
  const bg = argb(u.bg);
  if (bg) st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  if (u.bd) {
    const side = (b: Border | null | undefined) =>
      b && b.s && BORDER_NAME[b.s] ? { style: BORDER_NAME[b.s] as ExcelJSTypes.BorderStyle, color: { argb: argb(b.cl) || "FF000000" } } : undefined;
    const border: Partial<ExcelJSTypes.Borders> = {};
    const t = side(u.bd.t);
    const r = side(u.bd.r);
    const b = side(u.bd.b);
    const l = side(u.bd.l);
    if (t) border.top = t;
    if (r) border.right = r;
    if (b) border.bottom = b;
    if (l) border.left = l;
    if (Object.keys(border).length) st.border = border;
  }
  const al: Partial<ExcelJSTypes.Alignment> = {};
  if (u.ht && H_NAME[u.ht]) al.horizontal = H_NAME[u.ht] as ExcelJSTypes.Alignment["horizontal"];
  if (u.vt && V_NAME[u.vt]) al.vertical = V_NAME[u.vt] as ExcelJSTypes.Alignment["vertical"];
  if (u.tb === WRAP) al.wrapText = true;
  if (u.tr) {
    if (u.tr.v) al.textRotation = "vertical";
    else if (u.tr.a) al.textRotation = u.tr.a < 0 ? 90 - u.tr.a : u.tr.a;
  }
  if (Object.keys(al).length) st.alignment = al;
  if (u.n?.pattern) st.numFmt = u.n.pattern;
  return Object.keys(st).length ? st : null;
}

/** Dedupe styles into the workbook style table, returning the style id. */
function styleRegistry() {
  const styles: Record<string, UniverStyle> = {};
  const ids = new Map<string, string>();
  return {
    styles,
    id(st: UniverStyle | null): string | undefined {
      if (!st) return undefined;
      const key = JSON.stringify(st);
      let id = ids.get(key);
      if (!id) {
        id = `s${ids.size + 1}`;
        ids.set(key, id);
        styles[id] = st;
      }
      return id;
    },
  };
}
type StyleRegistry = ReturnType<typeof styleRegistry>;

// ---- Rich text ------------------------------------------------------------
// A cell's rich text is a tiny Univer document: "\r" ends a paragraph, "\r\n"
// ends the body. Hyperlinks are custom ranges (rangeType 0) over the text.
function richDoc(text: string, runs: TextRun[] = [], url?: string): RichDoc {
  const flat = text.replace(/\r?\n/g, "\r");
  const len = flat.length;
  return {
    id: "d",
    documentStyle: {},
    body: {
      dataStream: flat + "\r\n",
      textRuns: runs,
      paragraphs: [{ startIndex: len }],
      sectionBreaks: [{ startIndex: len + 1 }],
      customRanges: url ? [{ rangeId: uid(), rangeType: 0, startIndex: 0, endIndex: Math.max(0, len - 1), properties: { url } }] : [],
    },
  };
}
const richText = (p: RichDoc) => p.body.dataStream.replace(/\r?\n$/, "").replace(/\r/g, "\n");

// ---- Import ---------------------------------------------------------------
async function loadExcelJS(): Promise<typeof ExcelJSTypes> {
  const mod: any = await import("exceljs");
  return mod.default ?? mod;
}

/**
 * The file as ExcelJS can read it: chart frames out (read separately), and
 * filter kinds ExcelJS doesn't know (by colour, icon, top 10, dynamic) taken
 * out of its copy; the filters themselves are read from the XML.
 */
export async function forExcelJS(bytes: Uint8Array): Promise<Uint8Array> {
  let out = hasBytes(bytes, "xl/charts/") ? await withoutChartFrames(bytes) : bytes;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(out);
  const UNKNOWN = /<(?:\w+:)?(iconFilter|colorFilter|dynamicFilter|top10)\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?\1>)/g;
  let changed = false;
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/(worksheets\/sheet|tables\/table)[^/]*\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async("string");
    if (!/<(?:\w+:)?(iconFilter|colorFilter|dynamicFilter|top10)\b/.test(xml)) continue;
    zip.file(name, xml.replace(UNKNOWN, ""));
    changed = true;
  }
  if (changed) out = (await zip.generateAsync({ type: "uint8array" })) as Uint8Array;
  return out;
}

// Files saved by the Excel 2007 beta use a pre-release namespace, <sstItem>
// for shared strings and theme colours inside the styles. Brought up to the
// released format, they open like any other.
const BETA_NS = "http://schemas.microsoft.com/office/excel/2006/2";
export async function fromExcel2007Beta(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasBytes(bytes, "xl/workbook.xml")) return bytes;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  if (!wb?.includes(BETA_NS)) return bytes;
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/.*\.xml$/.test(n))) {
    let xml = await zip.file(name)!.async("string");
    if (!xml.includes(BETA_NS)) continue;
    xml = xml.split(BETA_NS).join("http://schemas.openxmlformats.org/spreadsheetml/2006/main");
    if (/sharedStrings/.test(name)) xml = xml.replace(/<(\/?)sstItem\b/g, "<$1si");
    if (/styles\.xml$/.test(name)) xml = xml.replace(/<themeColors>[\s\S]*?<\/themeColors>/, "").replace(/<colors>\s*<\/colors>/, "");
    zip.file(name, xml);
  }
  return (await zip.generateAsync({ type: "uint8array" })) as Uint8Array;
}

/** Parse a real .xlsx file into a Univer workbook snapshot. */
export async function xlsxToUniver(data: ArrayBuffer | Uint8Array, name = "Imported workbook"): Promise<UniverWorkbook> {
  const bytes = await fromExcel2007Beta(data instanceof Uint8Array ? data : new Uint8Array(data));
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await forExcelJS(bytes)) as any);
  const theme = parseTheme((wb as any)._themes?.theme1);
  const reg = styleRegistry();
  const sheets: UniverWorkbook["sheets"] = {};
  const order: string[] = [];
  const idByName = new Map<string, string>();
  const cf: Record<string, unknown[]> = {};
  const dv: Record<string, unknown[]> = {};
  const notes: Record<string, Record<number, Record<number, unknown>>> = {};
  const filters: Record<string, unknown> = {};
  const tables: Record<string, { tables: unknown[]; tableFilteredOutRows: number[] }> = {};
  const drawings: Record<string, { data: Record<string, unknown>; order: string[] }> = {};
  const pkg = await openPackage(bytes);
  const looseNotes = await readComments(pkg);
  const headerless = new Set<string>();
  for (const name of Object.keys(pkg.zip.files).filter((n: string) => /^xl\/tables\/table[^/]*\.xml$/.test(n))) {
    const head = /<table\b[^>]*>/.exec(await pkg.read(name))?.[0] || "";
    if (/\bheaderRowCount="0"/.test(head)) headerless.add(xmlDecode(/\bname="([^"]*)"/.exec(head)?.[1] || ""));
  }
  // Threaded comments come in through readThreadedComments (they belong in the
  // comments list); their legacy copies must not turn into notes as well.
  const threaded = await readThreadedComments(bytes);
  const sheetXml = new Map<number, string>();
  for (const part of pkg.sheets) sheetXml.set(part.index, await pkg.read(part.path));
  // Where each worksheet sits among all the workbook's sheets (chart sheets
  // count there, but the cell reader skips them).
  const kinds = await sheetKinds(pkg);
  const wsPos = kinds.map((k, i) => (k.kind === "worksheet" ? i : -1)).filter((i) => i >= 0);
  const posOf = (i: number) => wsPos[i] ?? i;

  wb.worksheets.forEach((ws, i) => idByName.set(ws.name, sid(i)));
  const protections: Protection[] = [];

  wb.worksheets.forEach((ws, i) => {
    const id = sid(i);
    order.push(id);
    const cellData: UniverSheet["cellData"] = {};
    const sheetNotes: Record<number, Record<number, unknown>> = {};
    let maxR = 0;
    let maxC = 0;
    const touch = (r: number, c: number) => {
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    };

    const unlocked: [number, number][] = [];
    // Array formulas: the formula is in the top left cell and spills over the
    // rest, which hold only the last values. Here the formula spills again,
    // so those values must go (they would block it).
    const arrays: Range[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const r = Number(cell.row) - 1;
        const c = Number(cell.col) - 1;
        if ((cell as any).protection?.locked === false) unlocked.push([r, c]);
        const note = (cell as any).note;
        if (note) {
          (sheetNotes[r] ||= {})[c] = noteModel(r, c, note);
          touch(r, c);
        }
        if ((cell.type as number) === 1) return; // merged-away cell: the anchor carries content
        const raw: any = cell.value;
        if (raw && typeof raw === "object" && raw.shareType === "array" && typeof raw.ref === "string" && raw.ref.includes(":")) {
          const g = parseRef(raw.ref);
          if (g) arrays.push(g);
        }
        const uc = cellFromExcel(cell, theme, reg, idByName);
        if (uc) {
          (cellData[r] ||= {})[c] = uc;
          touch(r, c);
        }
      });
    });
    for (const g of arrays)
      for (let r = g.startRow; r <= g.endRow; r++)
        for (let c = g.startColumn; c <= g.endColumn; c++) {
          if (r === g.startRow && c === g.startColumn) continue;
          const uc = cellData[r]?.[c];
          if (!uc || uc.f) continue;
          delete uc.v;
          delete uc.t;
          delete uc.p;
          if (uc.s === undefined) delete cellData[r][c];
        }
    for (const n of looseNotes.get(ws.name) || []) {
      if (sheetNotes[n.r]?.[n.c]) continue;
      (sheetNotes[n.r] ||= {})[n.c] = noteModel(n.r, n.c, n.text);
      touch(n.r, n.c);
    }
    for (const t of threaded.get(posOf(i)) || []) {
      const { r, c } = refCell(t.ref);
      if (sheetNotes[r]?.[c]) delete sheetNotes[r][c];
      if (sheetNotes[r] && !Object.keys(sheetNotes[r]).length) delete sheetNotes[r];
    }
    if (Object.keys(sheetNotes).length) notes[id] = sheetNotes;

    const mergeData: Range[] = [];
    for (const ref of ((ws as any).model?.merges as string[]) || []) {
      const g = parseRef(ref);
      if (!g) continue;
      mergeData.push(g);
      touch(g.endRow, g.endColumn);
    }

    // Columns / rows: widths, heights, hidden, whole-row/column styles.
    const columnData: NonNullable<UniverSheet["columnData"]> = {};
    for (const col of (ws.columns as ExcelJSTypes.Column[] | null) || []) {
      if (!col) continue;
      const cd: NonNullable<UniverSheet["columnData"]>[number] = {};
      if (col.width) cd.w = colPx(col.width);
      if (col.hidden) cd.hd = 1;
      const s = col.style && Object.keys(col.style).length ? reg.id(styleFromExcel(col.style, theme)) : undefined;
      if (s) cd.s = s;
      if (Object.keys(cd).length) columnData[Number(col.number) - 1] = cd;
    }
    const rowData: NonNullable<UniverSheet["rowData"]> = {};
    ws.eachRow({ includeEmpty: true }, (row) => {
      const rd: NonNullable<UniverSheet["rowData"]>[number] = {};
      if (row.height) rd.h = rowPx(row.height);
      if (row.hidden) rd.hd = 1;
      const rowStyle = (row as unknown as { style?: Partial<ExcelJSTypes.Style> }).style;
      const s = rowStyle && Object.keys(rowStyle).length ? reg.id(styleFromExcel(rowStyle, theme)) : undefined;
      if (s) rd.s = s;
      if (Object.keys(rd).length) rowData[Number(row.number) - 1] = rd;
    });

    const view: any = ws.views?.[0] || {};
    const frozen = view.state === "frozen";
    const xSplit = frozen ? Number(view.xSplit) || 0 : 0;
    const ySplit = frozen ? Number(view.ySplit) || 0 : 0;
    const props: any = ws.properties || {};

    sheets[id] = {
      id,
      name: ws.name,
      rowCount: Math.max(1000, maxR + 50),
      columnCount: Math.max(26, maxC + 10),
      cellData,
      mergeData,
      rowData,
      columnData,
      defaultColumnWidth: props.defaultColWidth ? colPx(props.defaultColWidth) : EXCEL_DEFAULT_COL,
      defaultRowHeight: props.defaultRowHeight ? rowPx(props.defaultRowHeight) : EXCEL_DEFAULT_ROW,
      freeze: xSplit || ySplit ? { xSplit, ySplit, startRow: ySplit, startColumn: xSplit } : { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      tabColor: toHex(props.tabColor, theme) || "",
      hidden: ws.state && ws.state !== "visible" ? 1 : 0,
      showGridlines: view.showGridLines === false ? 0 : 1,
      zoomRatio: view.zoomScale ? Number(view.zoomScale) / 100 : 1,
      rightToLeft: view.rightToLeft ? 1 : 0,
    };

    const rules = cfFromExcel(ws, theme);
    if (rules.length) cf[id] = rules;
    const validations = dvFromExcel(ws);
    if (validations.length) dv[id] = validations;
    // ExcelJS keeps only the filter range; the conditions come from the XML.
    const af: any = ws.autoFilter;
    const xmlFilter = readAutoFilter(sheetXml.get(posOf(i)) || "");
    const ref = xmlFilter ? parseRef(xmlFilter.ref) : typeof af === "string" ? parseRef(af) : af?.from ? parseRef(`${af.from}:${af.to}`) : null;
    if (ref) {
      const filterColumns = xmlFilter?.columns || [];
      // Excel stores the rows a filter hides as hidden rows. Hand them to the
      // filter instead, so clearing it shows them again.
      const filteredOut: number[] = [];
      if (filterColumns.length)
        for (let r = ref.startRow + 1; r <= ref.endRow; r++)
          if (rowData[r]?.hd) {
            filteredOut.push(r);
            delete rowData[r].hd;
            if (!Object.keys(rowData[r]).length) delete rowData[r];
          }
      filters[id] = { ref: { ...ref, rangeType: 0 }, filterColumns, cachedFilteredOut: filteredOut };
    }

    const sheetTables = tablesFromExcel(ws, id, cellData, headerless);
    if (sheetTables.length) tables[id] = { tables: sheetTables, tableFilteredOutRows: [] };
    const images = imagesFromExcel(wb, ws, id, sheets[id]);
    if (images.order.length) drawings[id] = images;
    const xlsxMeta = sheetMetaFromExcel(ws);
    // Row/column grouping: levels and collapsed marks into row/column data.
    const outline = readOutline(sheetXml.get(posOf(i)) || "");
    const mark = (target: { custom?: OutlineCustom & Record<string, unknown> }, m: OutlineMark) => {
      target.custom = { ...(target.custom || {}), ...(m.level ? { ol: Math.min(m.level, 7) } : {}), ...(m.collapsed ? { olc: true } : {}) };
    };
    for (const [r, m] of outline.rows) mark((rowData[r] ||= {}), m);
    for (const [c, m] of outline.cols) mark((columnData[c] ||= {}), m);
    const meta: SheetXlsxMeta = { ...(xlsxMeta || {}) };
    if (!outline.summaryBelow || !outline.summaryRight) meta.outline = { summaryBelow: outline.summaryBelow, summaryRight: outline.summaryRight };
    if (view.state === "split" && (Number(view.xSplit) > 0 || Number(view.ySplit) > 0))
      meta.split = { xSplit: Number(view.xSplit) || 0, ySplit: Number(view.ySplit) || 0, ...(view.topLeftCell ? { topLeftCell: String(view.topLeftCell) } : {}) };
    if (ws.state === "veryHidden") meta.veryHidden = true;
    if (Object.keys(meta).length) sheets[id].custom = { xlsx: meta };

    // A protected sheet: everyone but the owner is kept out, except in its
    // "allow edit ranges" and unlocked cells.
    const prot = readSheetProtection(sheetXml.get(posOf(i)) || "");
    if (prot.attrs) {
      const { sheet: _on, ...xlsx } = prot.attrs;
      void _on;
      // Each "allow edit range" may have its own password; the unlocked
      // cells never do.
      const ranged = prot.ranges.flatMap((pr) =>
        pr.sqref
          .split(/\s+/)
          .map((ref) => parseRef(ref))
          .filter((g): g is Range => !!g)
          .map((g) => ({ g, pw: passwordAttrs(pr.attrs) })),
      );
      const except = [...ranged.map((x) => x.g), ...cellsToRects(unlocked)];
      const exceptPasswords = ranged.some((x) => x.pw) ? except.map((_, n) => ranged[n]?.pw || null) : null;
      // A sheet with a password: anyone who can edit and knows it may change it.
      const editors = passwordAttrs(xlsx) ? ["*"] : [];
      protections.push({ id: `xlsx-${id}`, sheetId: id, range: null, editors, description: "Protected in Excel", ...(except.length ? { except } : {}), ...(exceptPasswords ? { exceptPasswords } : {}), ...(Object.keys(xlsx).length ? { xlsx } : {}) });
    }
  });

  // Chart sheets: a sheet that is only a chart comes in as a sheet of its own
  // (the chart fills it), in its place among the others.
  if (kinds.some((k) => k.kind !== "worksheet")) {
    const worksheets = [...order];
    order.length = 0;
    let w = 0;
    kinds.forEach((k, i) => {
      if (k.kind === "worksheet") {
        if (worksheets[w]) order.push(worksheets[w]);
        w++;
        return;
      }
      if (k.kind !== "chartsheet") {
        // Dialog and macro sheets: kept out, but the positions after them stay right.
        order.push(`sheet-x${i + 1}`);
        return;
      }
      const id = `sheet-c${i + 1}`;
      order.push(id);
      sheets[id] = { id, name: k.name, rowCount: 100, columnCount: 26, cellData: {}, hidden: k.state && k.state !== "visible" ? 1 : 0, ...(k.state === "veryHidden" ? { custom: { xlsx: { veryHidden: true } } } : {}) };
      idByName.set(k.name, id);
    });
  }

  if (order.length === 0) {
    const id = sid(0);
    order.push(id);
    sheets[id] = { id, name: "Sheet1", rowCount: 1000, columnCount: 26, cellData: {} };
  }

  // Defined names, read from workbook.xml: ExcelJS drops names that hold a
  // formula or a constant. Excel's own names (_xlnm.*: print areas, titles,
  // filter ranges) live in the page setup and filter models instead.
  const names: Record<string, unknown> = {};
  const protectionNames: DefinedName[] = [];
  const solverNamesBySheet: Record<string, Record<string, string>> = {};
  const externalNames: { localSheetId: number; name: string; ref: string }[] = [];
  const slicerNames: DefinedName[] = [];
  for (const dn of readDefinedNames(pkg.workbookXml)) {
    if (dn.name.startsWith("_xlnm.") || !dn.formula || /#REF!/.test(dn.formula)) continue;
    if (SLICER_NAME.test(dn.name)) {
      slicerNames.push(dn);
      continue;
    }
    if (PROTECT_NAME.test(dn.name)) {
      protectionNames.push(dn);
      continue;
    }
    // Query tables' ranges (the queries come from the connections part).
    if (/^ExternalData_\d+$/i.test(dn.name) && dn.localSheetId != null) {
      externalNames.push({ localSheetId: dn.localSheetId, name: dn.name, ref: dn.formula });
      continue;
    }
    // Excel's Solver model: hidden sheet-level solver_* names.
    if (/^solver_/i.test(dn.name) && dn.localSheetId != null) {
      const sid = order[dn.localSheetId];
      if (sid) (solverNamesBySheet[sid] ||= {})[dn.name.toLowerCase()] = dn.formula;
      continue;
    }
    const local = dn.localSheetId != null ? order[dn.localSheetId] : undefined;
    if (dn.localSheetId != null && !local) continue;
    const nid = uid();
    names[nid] = {
      id: nid,
      name: dn.name,
      // Univer keeps plain references without "=", formulas and constants with it.
      formulaOrRefString: isPlainRef(dn.formula) ? dn.formula : formulaFromExcel(dn.formula),
      localSheetId: local || "AllDefaultWorkbook",
      ...(dn.hidden ? { hidden: true } : {}),
      ...(dn.comment ? { comment: dn.comment } : {}),
    };
  }

  // Join continued comments (_SynergyProtect3_2 ...) onto their first name.
  const parts = new Map<string, DefinedName & { more: string[] }>();
  for (const dn of protectionNames) {
    const [, base, k] = /^(_SynergyProtect\d+)(?:_(\d+))?$/.exec(dn.name)!;
    const key = `${dn.localSheetId}:${base}`;
    const entry = parts.get(key) || { ...dn, name: base, comment: "", more: [] };
    if (k) entry.more[Number(k)] = dn.comment || "";
    else entry.comment = dn.comment || "";
    parts.set(key, entry);
  }
  for (const dn of parts.values()) protectionFromName({ ...dn, comment: (dn.comment || "") + dn.more.filter((x) => x != null).join("") }, order, protections);

  // Pictures' alt text (ExcelJS doesn't read it), matched by their top-left cell.
  for (const part of pkg.sheets) {
    const id = order[part.index];
    const pics = id ? Object.values((drawings[id]?.data || {}) as Record<string, any>).filter((d) => d.drawingType === 0) : [];
    const drawingPath = pics.length ? await drawingPartOf(pkg.zip, part.path) : null;
    if (!drawingPath) continue;
    const alts = readPicAlts(await pkg.read(drawingPath));
    for (const d of pics) {
      const k = alts.findIndex((a) => a.column === d.sheetTransform?.from?.column && a.row === d.sheetTransform?.from?.row);
      if (k < 0) continue;
      const [a] = alts.splice(k, 1);
      if (a.alt) d.description = a.alt;
      if (a.decorative) d.decorative = true;
    }
  }

  // Shapes and text boxes become floating shape drawings.
  for (const part of pkg.sheets) {
    const id = order[part.index];
    const sheet = id && sheets[id];
    const drawingPath = sheet ? await drawingPartOf(pkg.zip, part.path) : null;
    if (!sheet || !drawingPath) continue;
    const found = readShapes(await pkg.read(drawingPath));
    if (!found.length) continue;
    const into = (drawings[id] ||= { data: {}, order: [] });
    for (const found1 of found) {
      // Shapes from a group carry their place in it as an offset past the anchor cell.
      const fc = advance(found1.from.column, 0, found1.from.columnOffset, (i) => colWidthPx(sheet, i));
      const fr = advance(found1.from.row, 0, found1.from.rowOffset, (i) => rowHeightPx(sheet, i));
      const sh = { ...found1, from: { column: fc.index, columnOffset: fc.offset, row: fr.index, rowOffset: fr.offset } };
      const to = sh.to || (() => {
        const c = advance(sh.from.column, sh.from.columnOffset, sh.size.width || 100, (i) => colWidthPx(sheet, i));
        const r = advance(sh.from.row, sh.from.rowOffset, sh.size.height || 60, (i) => rowHeightPx(sheet, i));
        return { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset };
      })();
      const left = offsetPx(sh.from.column, sh.from.columnOffset, (i) => colWidthPx(sheet, i));
      const top = offsetPx(sh.from.row, sh.from.rowOffset, (i) => rowHeightPx(sheet, i));
      const width = Math.max(1, offsetPx(to.column, to.columnOffset, (i) => colWidthPx(sheet, i)) - left);
      const height = Math.max(1, offsetPx(to.row, to.rowOffset, (i) => rowHeightPx(sheet, i)) - top);
      const drawingId = uid();
      const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
      into.data[drawingId] = {
        drawingId,
        drawingType: DRAWING_DOM,
        componentKey: SHAPE_COMPONENT,
        unitId: "",
        subUnitId: id,
        sheetTransform: { from: sh.from, to, ...flips },
        axisAlignSheetTransform: { from: sh.from, to, ...flips },
        transform: { left, top, width, height, ...flips },
        data: sh.data,
        allowTransform: true,
      };
      into.order.push(drawingId);
    }
  }
  // Form controls (VML shapes, with Excel 2010's ctrlProp parts where present).
  for (const part of pkg.sheets) {
    const id = order[part.index];
    const sheet = id && sheets[id];
    if (!sheet || /chartsheets\//.test(part.path)) continue;
    const vmlPath = await legacyDrawingPartOf(pkg.zip, part.path);
    const controls = vmlPath ? readVmlControls(await pkg.read(vmlPath)) : [];
    if (!controls.length) continue;
    const sx = sheetXml.get(part.index) || "";
    for (const cm of sx.matchAll(/<control\b[^>]*>/g)) {
      const shapeId = Number(/\bshapeId="(\d+)"/.exec(cm[0])?.[1]);
      const rel = /\br:id="([^"]+)"/.exec(cm[0])?.[1];
      const c = controls.find((x) => x.shapeId === shapeId);
      const target = c && rel ? await sheetRelTarget(pkg.zip, part.path, rel) : null;
      if (c && target) c.data = withCtrlProp(c.data, await pkg.read(target));
    }
    const into = (drawings[id] ||= { data: {}, order: [] });
    for (const c of controls) {
      const { from, to } = c.anchor;
      const left = offsetPx(from.column, from.columnOffset, (i) => colWidthPx(sheet, i));
      const top = offsetPx(from.row, from.rowOffset, (i) => rowHeightPx(sheet, i));
      const width = Math.max(1, offsetPx(to.column, to.columnOffset, (i) => colWidthPx(sheet, i)) - left);
      const height = Math.max(1, offsetPx(to.row, to.rowOffset, (i) => rowHeightPx(sheet, i)) - top);
      const drawingId = uid();
      const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
      into.data[drawingId] = { drawingId, drawingType: DRAWING_DOM, componentKey: FORM_CONTROL_COMPONENT, unitId: "", subUnitId: id, sheetTransform: { from, to, ...flips }, axisAlignSheetTransform: { from, to, ...flips }, transform: { left, top, width, height, ...flips }, data: c.data, allowTransform: true };
      into.order.push(drawingId);
    }
  }

  // Slicers and timelines: hidden names whose comments hold them (see the export).
  const slicerParts = new Map<string, { localSheetId?: number; text: string[] }>();
  for (const dn of slicerNames) {
    const [, base, k] = /^(_SynergySlicer\d+)(?:_(\d+))?$/.exec(dn.name)!;
    const key = `${dn.localSheetId}:${base}`;
    const entry = slicerParts.get(key) || { localSheetId: dn.localSheetId, text: [] };
    entry.text[k ? Number(k) - 1 : 0] = dn.comment || "";
    slicerParts.set(key, entry);
  }
  for (const entry of slicerParts.values()) {
    const id = entry.localSheetId != null ? order[entry.localSheetId] : undefined;
    const sheet = id && sheets[id];
    if (!sheet) continue;
    let info: { d?: SlicerData; t?: { left: number; top: number; width: number; height: number } };
    try {
      info = JSON.parse(entry.text.join(""));
    } catch {
      continue;
    }
    if (!info.d?.source || !info.t) continue;
    const { left, top, width, height } = info.t;
    const from = (() => {
      const c = advance(0, 0, Math.max(0, left), (i) => colWidthPx(sheet, i));
      const r = advance(0, 0, Math.max(0, top), (i) => rowHeightPx(sheet, i));
      return { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset };
    })();
    const c2 = advance(from.column, from.columnOffset, Math.max(1, width), (i) => colWidthPx(sheet, i));
    const r2 = advance(from.row, from.rowOffset, Math.max(1, height), (i) => rowHeightPx(sheet, i));
    const to = { column: c2.index, columnOffset: c2.offset, row: r2.index, rowOffset: r2.offset };
    const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
    const drawingId = uid();
    const into = (drawings[id] ||= { data: {}, order: [] });
    into.data[drawingId] = {
      drawingId,
      drawingType: DRAWING_DOM,
      componentKey: SLICER_COMPONENT,
      unitId: "",
      subUnitId: id,
      sheetTransform: { from, to, ...flips },
      axisAlignSheetTransform: { from, to, ...flips },
      transform: { left, top, width, height, ...flips },
      data: info.d,
      allowTransform: true,
    };
    into.order.push(drawingId);
  }
  const resources: { name: string; data: string }[] = [];
  if (Object.keys(cf).length) resources.push({ name: RESOURCE.cf, data: JSON.stringify(cf) });
  if (Object.keys(dv).length) resources.push({ name: RESOURCE.dv, data: JSON.stringify(dv) });
  if (Object.keys(notes).length) resources.push({ name: RESOURCE.note, data: JSON.stringify(notes) });
  if (Object.keys(filters).length) resources.push({ name: RESOURCE.filter, data: JSON.stringify(filters) });
  if (Object.keys(names).length) resources.push({ name: RESOURCE.names, data: JSON.stringify(names) });
  if (Object.keys(tables).length) resources.push({ name: RESOURCE.table, data: JSON.stringify(tables) });
  if (protections.length) resources.push({ name: PROTECTION_RESOURCE, data: JSON.stringify({ protections }) });
  // Excel pivot tables become refreshable pivot definitions.
  const pivots = await readPivotTables(pkg, (k) => (typeof k === "number" ? order[k] : idByName.get(k)));
  if (pivots.length) resources.push({ name: PIVOT_RESOURCE, data: JSON.stringify({ pivots }) });
  // A file made in Excel: its own pivot table slicers become ours.
  if (!slicerParts.size && pivots.length)
    for (const x of await readPivotSlicers(pkg)) {
      const id = order[x.sheetIndex];
      const sheet = id && sheets[id];
      const pivot = pivots.find((p) => p.name === x.pivotName);
      if (!sheet || !pivot) continue;
      const left = offsetPx(x.from.column, x.from.columnOffset, (i) => colWidthPx(sheet, i));
      const top = offsetPx(x.from.row, x.from.rowOffset, (i) => rowHeightPx(sheet, i));
      const width = x.to ? Math.max(40, offsetPx(x.to.column, x.to.columnOffset, (i) => colWidthPx(sheet, i)) - left) : 160;
      const height = x.to ? Math.max(40, offsetPx(x.to.row, x.to.rowOffset, (i) => rowHeightPx(sheet, i)) - top) : 200;
      const c2 = advance(x.from.column, x.from.columnOffset, width, (i) => colWidthPx(sheet, i));
      const r2 = advance(x.from.row, x.from.rowOffset, height, (i) => rowHeightPx(sheet, i));
      const to = { column: c2.index, columnOffset: c2.offset, row: r2.index, rowOffset: r2.offset };
      const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
      const data: SlicerData = { kind: "slicer", caption: x.caption, source: { type: "pivot", pivotId: pivot.id, name: pivot.name }, field: x.field, selected: x.selected, ...(x.columns ? { columns: x.columns } : {}) };
      const drawingId = uid();
      const into = (drawings[id] ||= { data: {}, order: [] });
      into.data[drawingId] = { drawingId, drawingType: DRAWING_DOM, componentKey: SLICER_COMPONENT, unitId: "", subUnitId: id, sheetTransform: { from: x.from, to, ...flips }, axisAlignSheetTransform: { from: x.from, to, ...flips }, transform: { left, top, width, height, ...flips }, data, allowTransform: true };
      into.order.push(drawingId);
    }
  // Excel's own slicers on tables and timelines on pivot tables.
  if (!slicerParts.size) {
    const native = await readTableSlicersAndTimelines(pkg);
    const items = [
      ...native.slicers.map((x) => ({ x, data: { kind: "slicer", caption: x.caption, source: { type: "table", tableId: "", name: x.tableName }, field: x.field, selected: null, ...(x.columns ? { columns: x.columns } : {}) } as SlicerData })),
      ...native.timelines.flatMap((x) => {
        const pivot = pivots.find((p) => p.name === x.pivotName);
        return pivot ? [{ x, data: { kind: "timeline", caption: x.caption, source: { type: "pivot", pivotId: pivot.id, name: pivot.name }, field: x.field, level: x.level, period: null } as SlicerData }] : [];
      }),
    ];
    for (const { x, data } of items) {
      const id = order[x.sheetIndex];
      const sheet = id && sheets[id];
      if (!sheet) continue;
      const left = offsetPx(x.from.column, x.from.columnOffset, (i) => colWidthPx(sheet, i));
      const top = offsetPx(x.from.row, x.from.rowOffset, (i) => rowHeightPx(sheet, i));
      const width = x.to ? Math.max(40, offsetPx(x.to.column, x.to.columnOffset, (i) => colWidthPx(sheet, i)) - left) : data.kind === "timeline" ? 320 : 160;
      const height = x.to ? Math.max(40, offsetPx(x.to.row, x.to.rowOffset, (i) => rowHeightPx(sheet, i)) - top) : data.kind === "timeline" ? 120 : 200;
      const c2 = advance(x.from.column, x.from.columnOffset, width, (i) => colWidthPx(sheet, i));
      const r2 = advance(x.from.row, x.from.rowOffset, height, (i) => rowHeightPx(sheet, i));
      const to = { column: c2.index, columnOffset: c2.offset, row: r2.index, rowOffset: r2.offset };
      const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
      const drawingId = uid();
      const into = (drawings[id] ||= { data: {}, order: [] });
      into.data[drawingId] = { drawingId, drawingType: DRAWING_DOM, componentKey: SLICER_COMPONENT, unitId: "", subUnitId: id, sheetTransform: { from: x.from, to, ...flips }, axisAlignSheetTransform: { from: x.from, to, ...flips }, transform: { left, top, width, height, ...flips }, data, allowTransform: true };
      into.order.push(drawingId);
    }
  }
  // Slicers find their table or pivot table again by name (ids are new here).
  for (const sd of Object.values(drawings))
    for (const d of Object.values(sd.data) as any[]) {
      if (d.componentKey !== SLICER_COMPONENT) continue;
      const src = (d.data as SlicerData).source;
      if (src.type === "pivot") {
        const p = pivots.find((x) => x.name === src.name);
        if (p) src.pivotId = p.id;
      } else {
        const t = Object.values(tables)
          .flatMap((x) => x.tables as any[])
          .find((x) => x?.name === src.name);
        if (t?.id) src.tableId = t.id;
      }
    }
  if (Object.keys(drawings).length) resources.push({ name: RESOURCE.drawing, data: JSON.stringify(drawings) });
  // Sparklines (x14 extension of each worksheet).
  const sparkGroups: SparklineGroup[] = [];
  order.forEach((id, i) => {
    const xml = sheetXml.get(i) || "";
    if (/sparklineGroup/.test(xml)) sparkGroups.push(...readSparklines(xml, id, (n) => idByName.get(n) ?? [...idByName].find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1]));
  });
  if (sparkGroups.length) resources.push({ name: SPARKLINE_RESOURCE, data: JSON.stringify({ groups: sparkGroups }) });
  const dataTables = order.flatMap((id, i) => readDataTables(sheetXml.get(i) || "", id));
  if (dataTables.length) resources.push({ name: DATA_TABLE_RESOURCE, data: JSON.stringify({ tables: dataTables }) });
  // ExcelJS doesn't understand the TABLE formula; its first result cell keeps the cached value.
  for (const d of dataTables) {
    const xml = sheetXml.get(order.indexOf(d.sheetId)) || "";
    const r = d.range.startRow + 1;
    const c = d.range.startColumn + 1;
    const cell = new RegExp(`<c r="${addr(r, c)}"([^>]*)>([\\s\\S]*?)</c>`).exec(xml);
    const cached = cell && /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
    const row = ((sheets[d.sheetId].cellData ||= {})[r] ||= {});
    const { f: _f, si: _si, ...rest } = (row[c] || {}) as UniverCell & { si?: string };
    void _f;
    void _si;
    const number = /\bt="(s|str|inlineStr|e)"/.test(cell?.[1] || "") ? NaN : Number(cached);
    row[c] = Number.isFinite(number) ? { ...rest, v: number, t: 2 } : { ...rest, v: typeof rest.v === "string" || typeof rest.v === "number" ? rest.v : null };
  }
  const solverModels = Object.entries(solverNamesBySheet)
    .map(([sid, names]) => modelFromNames(names, sid))
    .filter((m): m is SolverModel => !!m);
  if (solverModels.length) resources.push({ name: SOLVER_RESOURCE, data: JSON.stringify({ models: solverModels }) });
  const keptIn = await readKept(pkg.zip as any, pkg.sheets.map((p) => ({ path: p.path, sheetId: order[p.index] })).filter((p) => p.sheetId));
  if (keptIn.kept) resources.push({ name: KEPT_RESOURCE, data: JSON.stringify(keptIn.kept) });
  if (keptIn.scripts.length) resources.push({ name: SCRIPT_RESOURCE, data: JSON.stringify({ scripts: keptIn.scripts }) });
  const queries = await readQueries(pkg.read, pkg.sheets.map((p) => ({ path: p.path, sheetId: order[p.index] })).filter((p) => p.sheetId), externalNames);
  if (queries.length) resources.push({ name: QUERY_RESOURCE, data: JSON.stringify({ queries }) });
  const scenarios = order.flatMap((id, i) => readScenarios(sheetXml.get(i) || "", id));
  if (scenarios.length) resources.push({ name: SCENARIO_RESOURCE, data: JSON.stringify({ scenarios }) });
  const customViews = readCustomViews(pkg.workbookXml, order.map((_, i) => sheetXml.get(i) || ""), order);
  if (customViews.length) resources.push({ name: CUSTOM_VIEWS_RESOURCE, data: JSON.stringify({ views: customViews }) });
  const docProps = await readDocProps(pkg.read);
  const workbookProt = readWorkbookProtection(pkg.workbookXml);
  if (docProps || workbookProt) resources.push({ name: DOC_PROPS_RESOURCE, data: JSON.stringify({ custom: [], ...docProps, ...(workbookProt ? { workbook: workbookProt } : {}) }) });

  // The file's theme, unless it is the default one.
  const fileTheme = readThemeXml((wb as any)._themes?.theme1);
  if (fileTheme && (JSON.stringify(fileTheme.colors) !== JSON.stringify(DEFAULT_WORKBOOK_THEME.colors) || JSON.stringify(fileTheme.fonts) !== JSON.stringify(DEFAULT_WORKBOOK_THEME.fonts)))
    resources.push({ name: THEME_RESOURCE, data: JSON.stringify(fileTheme) });
  // Links to other workbooks: Excel's [1]Sheet!A1 becomes [Budget]Sheet!A1,
  // with the other workbook's cached values kept for the formulas to read.
  const external = await readExternalLinks(pkg.zip as any);
  if (external.length) {
    const links: WorkbookLink[] = [];
    const nameByIndex = new Map<number, string>();
    for (const x of external) {
      const title = x.file.replace(/\.[^.]+$/, "");
      const name = linkNameFor(title, links.map((l) => l.name));
      nameByIndex.set(x.index, name);
      links.push({ name, title, file: x.file, updated: Date.now(), cache: x.cache });
    }
    for (const id of order)
      for (const row of Object.values(sheets[id]?.cellData || {}))
        for (const cell of Object.values(row || {})) if (cell?.f && cell.f.includes("[")) cell.f = formulaLinksFromExcel(cell.f, (n) => nameByIndex.get(n));
    resources.push({ name: LINKS_RESOURCE, data: JSON.stringify({ links }) });
  }
  const calc = readCalcPr(pkg.workbookXml);
  if (calc) resources.push({ name: CALC_RESOURCE, data: JSON.stringify(calc) });

  const imported: UniverWorkbook = { id: `wb-${Date.now()}`, name, appVersion: "", locale: "enUS", sheetOrder: order.filter((id) => sheets[id]), styles: reg.styles, sheets, resources };
  if (hasBytes(bytes, "xl/charts/")) {
    const charts = await chartsFromXlsx(bytes, imported);
    if (Object.values(charts.sheets).some((items) => items.length)) resources.push({ name: RESOURCE.charts, data: JSON.stringify(charts) });
  }
  return imported;
}

/** Each sheet of the workbook, in order: a worksheet, a chart sheet, or another kind (dialog, macro). */
async function sheetKinds(pkg: { workbookXml: string; read: (p: string) => Promise<string> }): Promise<{ name: string; kind: "worksheet" | "chartsheet" | "other"; state?: string }[]> {
  const rels = new Map([...(await pkg.read("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/\bId="([^"]*)"/.exec(m[0])?.[1] || "", /\bType="([^"]*)"/.exec(m[0])?.[1] || ""]));
  return [...pkg.workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const type = rels.get(/\br:id="([^"]*)"/.exec(m[0])?.[1] || "") || "";
    const kind = /\/worksheet$/.test(type) ? "worksheet" : /\/chartsheet$/.test(type) ? "chartsheet" : "other";
    return { name: xmlDecode(/\bname="([^"]*)"/.exec(m[0])?.[1] || ""), kind, state: /\bstate="([^"]*)"/.exec(m[0])?.[1] };
  });
}

// Protections Excel has no model for (a range only some people may change, and
// who those people are) travel as hidden, sheet-scoped names: the name's
// reference is the range and its comment holds the details as JSON.
const PROTECT_NAME = /^_SynergyProtect\d+(?:_\d+)?$/;
// Slicers and timelines (Excel's own slicers need its slicer caches) travel as
// hidden sheet-level names whose comments hold the slicer as JSON.
const SLICER_NAME = /^_SynergySlicer\d+(?:_\d+)?$/;
type ProtectNameInfo = { w?: 1; d?: string; e?: string[]; id?: string };

function protectionFromName(dn: DefinedName, order: string[], out: Protection[]) {
  const sheetId = dn.localSheetId != null ? order[dn.localSheetId] : undefined;
  if (!sheetId) return;
  let info: ProtectNameInfo = {};
  try {
    info = JSON.parse(dn.comment || "{}");
  } catch {
    /* no details: owner only */
  }
  const editors = Array.isArray(info.e) ? info.e.filter((x) => typeof x === "string") : [];
  if (info.w) {
    // Details for the sheet's own protection (read from <sheetProtection>).
    const sheetProt = out.find((p) => p.sheetId === sheetId && !p.range);
    if (sheetProt) {
      sheetProt.editors = editors;
      if (info.d) sheetProt.description = info.d;
      else delete sheetProt.description;
      if (info.id) sheetProt.id = info.id;
    }
    return;
  }
  const range = parseRef(dn.formula.replace(/^.*!/, ""));
  if (!range) return;
  out.push({ id: info.id || `xlsx-${dn.name}`, sheetId, range, editors, ...(info.d ? { description: info.d } : {}) });
}

/** Cells grouped into rectangles: runs along each row, then equal runs stacked. */
function cellsToRects(cells: [number, number][]): Range[] {
  const byRow = new Map<number, number[]>();
  for (const [r, c] of cells) (byRow.get(r) || byRow.set(r, []).get(r)!).push(c);
  const open = new Map<string, Range>();
  const done: Range[] = [];
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const cols = byRow.get(r)!.sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const c of cols) {
      const last = runs[runs.length - 1];
      if (last && c === last[1] + 1) last[1] = c;
      else if (!last || c > last[1]) runs.push([c, c]);
    }
    const seen = new Set<string>();
    for (const [a, b] of runs) {
      const key = `${a}:${b}`;
      seen.add(key);
      const prev = open.get(key);
      if (prev && prev.endRow === r - 1) prev.endRow = r;
      else {
        if (prev) done.push(prev);
        open.set(key, { startRow: r, endRow: r, startColumn: a, endColumn: b });
      }
    }
    for (const [key, g] of [...open]) if (!seen.has(key) && g.endRow < r) {
      done.push(g);
      open.delete(key);
    }
  }
  return [...done, ...open.values()].sort((x, y) => x.startRow - y.startRow || x.startColumn - y.startColumn);
}

const isPlainRef = (f: string) =>
  f.split(",").every((part) => /^(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/.test(part.trim()));

function hasBytes(bytes: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

const noteModel = (row: number, col: number, note: any) => ({
  id: uid(),
  row,
  col,
  width: 160,
  height: 72,
  note: typeof note === "string" ? note : (note?.texts || []).map((t: any) => t.text).join(""),
  // The runs' fonts (bold author line, colours), kept for the .xlsx while the text is unchanged.
  ...(typeof note !== "string" && (note?.texts || []).some((t: any) => t.font && Object.keys(t.font).length) ? { texts: note.texts.map((t: any) => ({ text: t.text, ...(t.font ? { font: t.font } : {}) })) } : {}),
});

// -- Excel tables --
// Univer ships six table looks (table-default-0..5); Excel names its built-in
// styles TableStyle{Light,Medium,Dark}N, cycling through the theme accents.
// The exact Excel style is kept in the table's meta and written back unless
// the user picked another look in the editor.
const UNIVER_TABLE_FOR_ACCENT = [0, 0, 5, 3, 4, 1, 2]; // neutral, accent1..6
const EXCEL_TABLE_FOR_UNIVER = ["TableStyleMedium2", "TableStyleMedium6", "TableStyleMedium7", "TableStyleMedium4", "TableStyleMedium5", "TableStyleMedium3"];
export function univerTableStyle(excel: string | undefined): string {
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/.exec(excel || "");
  const accent = m ? (Number(m[2]) - 1) % 7 : 1;
  return `table-default-${UNIVER_TABLE_FOR_ACCENT[accent]}`;
}

type TableXlsxMeta = {
  style?: Record<string, unknown>;
  univerStyle?: string;
  totalsRow?: boolean;
  columns?: { name: string; totalsRowFunction?: string; totalsRowLabel?: string; totalsRowFormula?: string }[];
};

function tablesFromExcel(ws: ExcelJSTypes.Worksheet, sheetId: string, cellData: UniverSheet["cellData"], headerless: Set<string>): unknown[] {
  const out: unknown[] = [];
  for (const t of ((ws as any).getTables?.() || []) as any[]) {
    const model = t?.table || t;
    const g = parseRef(model?.tableRef || model?.ref || "");
    // Univer tables always have a header row. (ExcelJS reads a missing
    // headerRowCount, which means 1, as no header row: ask the XML.)
    if (!g || headerless.has(String(model.name || model.displayName))) continue;
    const range = { ...g, endRow: model.totalsRow ? g.endRow - 1 : g.endRow };
    if (range.endRow <= range.startRow) continue;
    const univerStyle = univerTableStyle(model.style?.theme);
    const columns = ((model.columns || []) as any[]).map((col, j) => {
      const cell = cellData[range.startRow]?.[range.startColumn + j];
      return {
        id: uid(),
        displayName: String(col.name ?? cell?.v ?? `Column${j + 1}`),
        dataType: "string",
        formula: "",
        meta: {},
        style: {},
      };
    });
    const meta: TableXlsxMeta = {
      style: model.style,
      univerStyle,
      totalsRow: !!model.totalsRow,
      columns: ((model.columns || []) as any[]).map((col) => ({
        name: String(col.name ?? ""),
        ...(col.totalsRowFunction && col.totalsRowFunction !== "none" ? { totalsRowFunction: col.totalsRowFunction } : {}),
        ...(col.totalsRowLabel ? { totalsRowLabel: col.totalsRowLabel } : {}),
        ...(col.totalsRowFormula ? { totalsRowFormula: col.totalsRowFormula } : {}),
      })),
    };
    out.push({
      id: uid(),
      name: String(model.displayName || model.name || `Table${out.length + 1}`),
      range: { ...range, rangeType: 0, sheetId },
      options: { showHeader: true, showFooter: false, tableStyleId: univerStyle },
      filters: { tableColumnFilterList: [] },
      columns,
      meta: { xlsx: meta },
    });
  }
  return out;
}

// -- Images --
const EMU_PER_PX = 9525;

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const colWidthPx = (s: UniverSheet, c: number) => s.columnData?.[c]?.w ?? s.defaultColumnWidth ?? EXCEL_DEFAULT_COL;
const rowHeightPx = (s: UniverSheet, r: number) => s.rowData?.[r]?.h ?? s.defaultRowHeight ?? EXCEL_DEFAULT_ROW;

/** Walk `px` pixels from (index, offset) across cells of the given sizes. */
/** Pixels from the sheet's top-left edge to a cell index plus an offset. */
function offsetPx(index: number, offset: number, size: (i: number) => number): number {
  let px = offset;
  for (let i = 0; i < index; i++) px += size(i);
  return px;
}

function advance(index: number, offset: number, px: number, size: (i: number) => number): { index: number; offset: number } {
  let i = index;
  let left = offset + px;
  for (let guard = 0; guard < 100000 && left > size(i); guard++) {
    left -= size(i);
    i++;
  }
  return { index: i, offset: Math.round(left) };
}

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" };

function imagesFromExcel(wb: ExcelJSTypes.Workbook, ws: ExcelJSTypes.Worksheet, sheetId: string, sheet: UniverSheet) {
  const data: Record<string, unknown> = {};
  const order: string[] = [];
  for (const img of ((ws as any).getImages?.() || []) as any[]) {
    const media: any = (wb as any).getImage?.(Number(img.imageId));
    const ext = String(media?.extension || "").toLowerCase();
    let bytes: Uint8Array | null = null;
    if (media?.buffer) bytes = new Uint8Array(media.buffer);
    else if (typeof media?.base64 === "string") bytes = fromBase64(media.base64.replace(/^data:[^,]*,/, ""));
    if (!bytes) continue;
    // EMF and WMF (Windows metafiles browsers can't show) are drawn as SVG; the original goes back into the .xlsx.
    const metafile = ext === "emf" || ext === "wmf" ? { ext, data: toBase64(bytes) } : null;
    if (!MIME[ext] && !metafile) continue;
    const tl = img.range?.tl;
    if (!tl) continue;
    const from = { column: Number(tl.nativeCol) || 0, columnOffset: Math.round((Number(tl.nativeColOff) || 0) / EMU_PER_PX), row: Number(tl.nativeRow) || 0, rowOffset: Math.round((Number(tl.nativeRowOff) || 0) / EMU_PER_PX) };
    let to: typeof from;
    const br = img.range?.br;
    if (br && br.nativeCol != null) {
      to = { column: Number(br.nativeCol) || 0, columnOffset: Math.round((Number(br.nativeColOff) || 0) / EMU_PER_PX), row: Number(br.nativeRow) || 0, rowOffset: Math.round((Number(br.nativeRowOff) || 0) / EMU_PER_PX) };
    } else {
      const w = Number(img.range?.ext?.width) || 100;
      const h = Number(img.range?.ext?.height) || 100;
      const c = advance(from.column, from.columnOffset, w, (i) => colWidthPx(sheet, i));
      const r = advance(from.row, from.rowOffset, h, (i) => rowHeightPx(sheet, i));
      to = { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset };
    }
    const id = uid();
    const flips = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
    data[id] = {
      drawingId: id,
      drawingType: 0, // DrawingTypeEnum.DRAWING_IMAGE
      imageSourceType: "BASE64",
      source: metafile ? `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(metafileToSvg(bytes) || metafilePlaceholder(ext)))}` : `data:${MIME[ext]};base64,${toBase64(bytes)}`,
      ...(metafile ? { metafile } : {}),
      unitId: "",
      subUnitId: sheetId,
      sheetTransform: { from, to, ...flips },
      axisAlignSheetTransform: { from, to, ...flips },
      transform: { left: 0, top: 0, width: 0, height: 0, ...flips },
    };
    order.push(id);
  }
  return { data, order };
}

// -- Page setup, print areas, headers and footers --
// ExcelJS's defaults for a new sheet.
const PAGE_SETUP_DEFAULTS = {
  margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  orientation: "portrait",
  horizontalDpi: 4294967295,
  verticalDpi: 4294967295,
  fitToPage: false,
  pageOrder: "downThenOver",
  blackAndWhite: false,
  draft: false,
  cellComments: "None",
  errors: "displayed",
  scale: 100,
  fitToWidth: 1,
  fitToHeight: 1,
  showRowColHeaders: false,
  showGridLines: false,
  horizontalCentered: false,
  verticalCentered: false,
  firstPageNumber: 1,
  useFirstPageNumber: false,
  usePrinterDefaults: false,
  copies: 1,
};
function sheetMetaFromExcel(ws: ExcelJSTypes.Worksheet): SheetXlsxMeta | null {
  const meta: SheetXlsxMeta = {};
  const ps: any = { ...(ws.pageSetup || {}) };
  // ExcelJS fills in defaults for everything; keep only what differs from a
  // fresh sheet so the stored data stays small.
  const fresh: any = PAGE_SETUP_DEFAULTS;
  for (const k of Object.keys(ps)) if (JSON.stringify(ps[k]) === JSON.stringify(fresh[k]) || ps[k] == null) delete ps[k];
  if (Object.keys(ps).length) meta.pageSetup = ps;
  const hf: any = Object.fromEntries(Object.entries(ws.headerFooter || {}).filter(([, v]) => v != null && v !== false && v !== ""));
  if (Object.keys(hf).length) meta.headerFooter = hf;
  return Object.keys(meta).length ? meta : null;
}

function excelValue(v: any): { v: string | number | null; t: number } {
  if (v instanceof Date) return { v: dateToSerial(v), t: CELL.NUMBER };
  if (typeof v === "number") return { v, t: CELL.NUMBER };
  if (typeof v === "boolean") return { v: v ? 1 : 0, t: CELL.BOOLEAN };
  if (v && typeof v === "object" && "error" in v) return { v: String(v.error), t: CELL.STRING };
  if (v && typeof v === "object" && Array.isArray(v.richText)) return { v: v.richText.map((r: any) => r.text).join(""), t: CELL.STRING };
  return { v: v == null ? null : String(v), t: CELL.STRING };
}

/** Excel "#'My Sheet'!A1" / "#Sheet2!B3" -> Univer "#gid=<sheetId>&range=A1". */
function internalLink(target: string, idByName: Map<string, string>): string | null {
  const m = /^#?(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(target);
  if (!m) return null;
  const id = idByName.get((m[1] ?? m[2]).replace(/''/g, "'"));
  return id ? `#gid=${id}&range=${m[3].replace(/\$/g, "")}` : null;
}

function cellFromExcel(cell: ExcelJSTypes.Cell, theme: string[], reg: StyleRegistry, idByName: Map<string, string>): UniverCell | null {
  const uc: UniverCell = {};
  const s = reg.id(styleFromExcel(cell.style, theme));
  if (s) uc.s = s;
  const raw: any = cell.value;
  if (raw && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw)) {
    // ExcelJS translates shared-formula children into their own formula.
    const f = cell.formula || raw.formula;
    if (f) uc.f = formulaFromExcel(f);
    if (raw.result !== undefined) Object.assign(uc, excelValue(raw.result));
  } else if (raw && typeof raw === "object" && "hyperlink" in raw) {
    const text = typeof raw.text === "string" ? raw.text : String(excelValue(raw.text).v ?? "");
    const target = String(raw.hyperlink || "");
    const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(target);
    const url = isExternal ? target : internalLink(target, idByName) ?? target;
    uc.p = richDoc(text, [], url);
    uc.v = text;
    uc.t = CELL.STRING;
  } else if (raw && typeof raw === "object" && Array.isArray(raw.richText)) {
    let pos = 0;
    let text = "";
    const runs: TextRun[] = [];
    for (const run of raw.richText as ExcelJSTypes.RichText[]) {
      const t = (run.text || "").replace(/\r?\n/g, "\r");
      const ts = run.font ? styleFromExcel({ font: run.font } as Partial<ExcelJSTypes.Style>, theme) : null;
      if (ts && t.length) runs.push({ st: pos, ed: pos + t.length, ts });
      pos += t.length;
      text += run.text || "";
    }
    uc.p = richDoc(text, runs);
    uc.v = text;
    uc.t = CELL.STRING;
  } else if (raw != null) {
    Object.assign(uc, excelValue(raw));
    if (uc.t === CELL.STRING && cell.numFmt === "@") uc.t = CELL.FORCE_STRING;
  }
  if (uc.v === undefined && uc.f === undefined && uc.s === undefined && uc.p === undefined) return null;
  return uc;
}

// -- Conditional formatting: Excel -> Univer --
function dxfStyle(style: any, theme: string[]): UniverStyle {
  const u: UniverStyle = {};
  const f = style?.font;
  if (f) {
    if (f.bold) u.bl = 1;
    if (f.italic) u.it = 1;
    if (f.underline && f.underline !== "none") u.ul = { s: 1 };
    if (f.strike) u.st = { s: 1 };
    const cl = toHex(f.color, theme);
    if (cl) u.cl = { rgb: cl };
  }
  const fill = style?.fill;
  if (fill?.type === "pattern") {
    // Differential (CF) fills put the solid color in bgColor.
    const bg = toHex(fill.bgColor, theme) || toHex(fill.fgColor, theme);
    if (bg) u.bg = { rgb: bg };
  }
  return u;
}

const cfvoFromExcel = (c: any) => {
  const type = c?.type === "autoMin" ? "min" : c?.type === "autoMax" ? "max" : c?.type || "num";
  if (type === "min" || type === "max" || c?.value === undefined || c?.value === null) return { type };
  return { type, value: type === "formula" ? formulaFromExcel(String(c.value)) : Number(c.value) };
};

function cfFromExcel(ws: ExcelJSTypes.Worksheet, theme: string[]): unknown[] {
  const out: { priority: number; rule: unknown }[] = [];
  const num = (x: any) => (x === undefined || x === null || x === "" || isNaN(Number(x)) ? null : Number(x));
  for (const block of ((ws as any).conditionalFormattings as ExcelJSTypes.ConditionalFormattingOptions[]) || []) {
    const ranges = String(block.ref || "")
      .split(/\s+/)
      .map(parseRef)
      .filter((g): g is Range => !!g);
    if (!ranges.length) continue;
    const tl = addr(ranges[0].startRow, ranges[0].startColumn);
    for (const rule of block.rules as any[]) {
      const style = dxfStyle(rule.style, theme);
      let conf: any = null;
      switch (rule.type) {
        case "cellIs": {
          const op = rule.operator as string;
          const a = rule.formulae?.[0];
          const b = rule.formulae?.[1];
          if (num(a) !== null && (b === undefined || num(b) !== null)) {
            conf = { type: "highlightCell", subType: "number", operator: op, value: b !== undefined ? [num(a), num(b)] : num(a), style };
          } else if ((op === "equal" || op === "notEqual") && typeof a === "string" && /^".*"$/.test(a)) {
            conf = { type: "highlightCell", subType: "text", operator: op, value: a.slice(1, -1).replace(/""/g, '"'), style };
          } else {
            // References or formulas as operands: express as a formula rule.
            const cmp: Record<string, string> = { equal: "=", notEqual: "<>", greaterThan: ">", greaterThanOrEqual: ">=", lessThan: "<", lessThanOrEqual: "<=" };
            const expr =
              op === "between" ? `AND(${tl}>=${a},${tl}<=${b})` : op === "notBetween" ? `OR(${tl}<${a},${tl}>${b})` : cmp[op] ? `${tl}${cmp[op]}${a}` : null;
            if (expr) conf = { type: "highlightCell", subType: "formula", value: formulaFromExcel(expr), style };
          }
          break;
        }
        case "expression":
          if (rule.formulae?.[0]) conf = { type: "highlightCell", subType: "formula", value: formulaFromExcel(String(rule.formulae[0])), style };
          break;
        case "containsText":
        case "notContainsText":
        case "beginsWith":
        case "endsWith": {
          const op = rule.type === "containsText" ? rule.operator || "containsText" : rule.type;
          if (["containsBlanks", "notContainsBlanks", "containsErrors", "notContainsErrors"].includes(op)) {
            conf = { type: "highlightCell", subType: "text", operator: op, value: "", style };
            break;
          }
          const text = rule.text ?? /"((?:[^"]|"")*)"/.exec(String(rule.formulae?.[0] ?? ""))?.[1]?.replace(/""/g, '"') ?? "";
          conf = { type: "highlightCell", subType: "text", operator: op, value: text, style };
          break;
        }
        case "containsBlanks":
        case "notContainsBlanks":
        case "containsErrors":
        case "notContainsErrors":
          conf = { type: "highlightCell", subType: "text", operator: rule.type, value: "", style };
          break;
        case "timePeriod":
          if (rule.timePeriod) conf = { type: "highlightCell", subType: "timePeriod", operator: rule.timePeriod, style };
          break;
        case "top10":
          conf = { type: "highlightCell", subType: "rank", isBottom: !!rule.bottom, isPercent: !!rule.percent, value: Number(rule.rank) || 10, style };
          break;
        case "aboveAverage":
          conf = { type: "highlightCell", subType: "average", operator: rule.aboveAverage === false ? "lessThan" : "greaterThan", style };
          break;
        case "duplicateValues":
        case "uniqueValues":
          conf = { type: "highlightCell", subType: rule.type, style };
          break;
        case "colorScale":
          conf = {
            type: "colorScale",
            config: (rule.cfvo || []).map((c: any, index: number) => ({ index, color: toHex(rule.color?.[index], theme) || "#FFFFFF", value: cfvoFromExcel(c) })),
          };
          break;
        case "dataBar":
          conf = {
            type: "dataBar",
            isShowValue: rule.showValue !== false,
            config: {
              min: cfvoFromExcel(rule.cfvo?.[0] || { type: "min" }),
              max: cfvoFromExcel(rule.cfvo?.[1] || { type: "max" }),
              isGradient: rule.gradient !== false,
              positiveColor: toHex(rule.color, theme) || "#638EC6",
              nativeColor: "#FF0000",
            },
          };
          break;
        case "iconSet": {
          // Excel: thresholds ascending, icons low -> high. Univer: config[0]
          // is the highest bucket and iconId indexes its icon list (best first).
          const cfvo = (rule.cfvo || []) as any[];
          const n = cfvo.length;
          if (!n) break;
          const iconType = rule.iconSet || "3TrafficLights1";
          conf = {
            type: "iconSet",
            isShowValue: rule.showValue !== false,
            config: cfvo.map((_c, i) => {
              const last = i === n - 1;
              const src = last ? cfvo[Math.min(1, n - 1)] : cfvo[n - 1 - i];
              return {
                operator: last ? "lessThan" : src?.gte === false ? "greaterThan" : "greaterThanOrEqual",
                value: cfvoFromExcel(src),
                iconType,
                iconId: String(rule.reverse ? n - 1 - i : i),
              };
            }),
          };
          break;
        }
      }
      if (conf) out.push({ priority: Number(rule.priority) || 1000 + out.length, rule: { cfId: uid(), ranges, stopIfTrue: !!rule.stopIfTrue, rule: conf } });
    }
  }
  // Univer evaluates its rule list top-down, like Excel's priority order.
  return out.sort((a, b) => a.priority - b.priority).map((x) => x.rule);
}

// -- Data validation: Excel -> Univer --
function dvFromExcel(ws: ExcelJSTypes.Worksheet): unknown[] {
  const model: Record<string, any> = (ws as any).dataValidations?.model || {};
  // ExcelJS expands every sqref into per-cell entries that share one rule
  // object; group by that object and squeeze the cells back into ranges.
  const cells = new Map<any, { r: number; c: number }[]>();
  const ranged = new Map<any, Range[]>();
  for (const [key, rule] of Object.entries(model)) {
    if (!rule) continue;
    if (key.includes(":")) {
      const g = parseRef(key);
      if (g) (ranged.get(rule) || ranged.set(rule, []).get(rule)!).push(g);
      continue;
    }
    const { r, c } = XLSX.utils.decode_cell(key);
    (cells.get(rule) || cells.set(rule, []).get(rule)!).push({ r, c });
  }
  const out: unknown[] = [];
  for (const rule of new Set([...cells.keys(), ...ranged.keys()])) {
    const ranges = [...(ranged.get(rule) || []), ...squeeze(cells.get(rule) || [])];
    const conv = dvRuleFromExcel(rule);
    if (conv && ranges.length) out.push({ uid: uid(), ranges: ranges.map((g) => ({ ...g, rangeType: 0 })), ...conv });
  }
  return out;
}

/** Collapse a set of cells into rectangles (column runs, merged side by side). */
function squeeze(cells: { r: number; c: number }[]): Range[] {
  const byCol = new Map<number, number[]>();
  for (const { r, c } of cells) (byCol.get(c) || byCol.set(c, []).get(c)!).push(r);
  const runs: Range[] = [];
  for (const [c, rows] of [...byCol].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a - b);
    let start = rows[0];
    let prev = rows[0];
    for (const r of [...rows.slice(1), Infinity]) {
      if (r === prev + 1) {
        prev = r;
        continue;
      }
      const left = runs.find((g) => g.endColumn === c - 1 && g.startRow === start && g.endRow === prev);
      if (left) left.endColumn = c;
      else runs.push({ startRow: start, endRow: prev, startColumn: c, endColumn: c });
      start = prev = r;
    }
  }
  return runs;
}

function dvRuleFromExcel(rule: any): Record<string, unknown> | null {
  const str = (x: any) => (x === undefined || x === null ? undefined : String(x));
  const base: Record<string, unknown> = {
    allowBlank: rule.allowBlank !== false,
    showErrorMessage: rule.showErrorMessage !== false,
    error: rule.error,
    errorTitle: rule.errorTitle,
    errorStyle: rule.errorStyle === "warning" ? 2 : rule.errorStyle === "information" ? 0 : 1,
    showInputMessage: !!rule.showInputMessage,
    prompt: rule.prompt,
    promptTitle: rule.promptTitle,
  };
  const f1 = str(rule.formulae?.[0]);
  const f2 = str(rule.formulae?.[1]);
  switch (rule.type) {
    case "list": {
      if (!f1) return null;
      const literal = /^"([\s\S]*)"$/.exec(f1);
      const formula1 = literal
        ? JSON.stringify(literal[1].split(",").map((x) => x.trim()).filter(Boolean))
        : formulaFromExcel(f1);
      return { ...base, type: "list", formula1, showDropDown: true };
    }
    case "whole":
    case "decimal":
    case "textLength":
    case "date":
    case "time":
      return { ...base, type: rule.type, operator: rule.operator || "between", formula1: f1, formula2: f2 };
    case "custom":
      return f1 ? { ...base, type: "custom", formula1: formulaFromExcel(f1) } : null;
    default:
      return null;
  }
}

// ---- Export ---------------------------------------------------------------

/** Write a Univer workbook snapshot back out as a real .xlsx binary. */
export type XlsxExportOptions = {
  /** Comment threads (from the database) to write as Excel threaded comments. */
  threads?: SheetThread[];
  /** Split windows open now, by sheet id (in twentieths of a point, as Excel keeps them). */
  split?: Record<string, { xSplit: number; ySplit: number; topLeftCell?: string }>;
  /** Dynamic-array formulas' spills, from the live formula engine. */
  spills?: SpillInfo;
};

export async function univerToXlsx(book: UniverWorkbook, options: XlsxExportOptions = {}): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const styleOf = (s: string | UniverStyle | null | undefined): UniverStyle | null =>
    s == null ? null : typeof s === "string" ? book.styles?.[s] ?? null : s;
  const res = (name: string): any => {
    const r = book.resources?.find((x) => x.name === name);
    if (!r?.data) return {};
    try {
      return JSON.parse(r.data) || {};
    } catch {
      return {};
    }
  };
  const cfAll = res(RESOURCE.cf);
  const dvAll = res(RESOURCE.dv);
  const notesAll = res(RESOURCE.note);
  const filterAll = res(RESOURCE.filter);
  const namesAll = res(RESOURCE.names);
  const tablesAll = res(RESOURCE.table);
  const drawingsAll = res(RESOURCE.drawing);
  const protectionsAll = protectionsOf(book);
  const autoFilters = new Map<number, string>();
  const sheetTransforms = new Map<number, ((xml: string) => string)[]>();
  let dynamicArrays = false;
  // Links to other workbooks, numbered as Excel numbers them in formulas.
  const workbookLinks = ((res(LINKS_RESOURCE).links || []) as WorkbookLink[]).filter((l) => l?.name && l.cache?.sheets);
  const linkIndex = new Map(workbookLinks.map((l, i) => [l.name.toLowerCase(), i + 1]));
  const excelFormula = (f: string) => (linkIndex.size && f.includes("[") ? formulaLinksToExcel(formulaToExcel(f), (n) => linkIndex.get(n.toLowerCase())) : formulaToExcel(f));
  const threadsBySheet = new Map<number, SheetThread[]>();
  const usedTableNames = new Set<string>();
  const nameById = new Map<string, string>();
  for (const id of book.sheetOrder) if (book.sheets[id]) nameById.set(id, book.sheets[id].name.slice(0, 31));

  for (const sheetId of book.sheetOrder) {
    const s = book.sheets[sheetId];
    if (!s) continue;
    const sheetIndex = wb.worksheets.length;
    const xSplit = s.freeze?.xSplit || 0;
    const ySplit = s.freeze?.ySplit || 0;
    const ws = wb.addWorksheet(s.name.slice(0, 31), {
      state: s.hidden ? (s.custom?.xlsx?.veryHidden ? "veryHidden" : "hidden") : "visible",
      properties: {
        defaultColWidth: colChars(s.defaultColumnWidth || 88),
        defaultRowHeight: rowPt(s.defaultRowHeight || 24),
        ...(s.tabColor && toArgb(s.tabColor) ? { tabColor: { argb: toArgb(s.tabColor) } } : {}),
      } as Partial<ExcelJSTypes.WorksheetProperties>,
      views: [
        {
          ...(xSplit || ySplit
            ? { state: "frozen", xSplit, ySplit, topLeftCell: addr(ySplit, xSplit) }
            : options.split?.[sheetId] || s.custom?.xlsx?.split
              ? { state: "split", ...(options.split?.[sheetId] || s.custom!.xlsx!.split) }
              : { state: "normal" }),
          showGridLines: s.showGridlines !== 0,
          zoomScale: Math.round((s.zoomRatio || 1) * 100),
          rightToLeft: !!s.rightToLeft,
        } as Partial<ExcelJSTypes.WorksheetView>,
      ],
    });

    const outlineRows = new Map<number, OutlineMark>();
    const outlineCols = new Map<number, OutlineMark>();
    for (const [k, cd] of Object.entries(s.columnData || {})) {
      const col = ws.getColumn(Number(k) + 1);
      if (cd?.w) col.width = colChars(cd.w);
      if (cd?.hd) col.hidden = true;
      const st = styleToExcel(styleOf(cd?.s));
      if (st) col.style = st as ExcelJSTypes.Style;
      if (cd?.custom?.ol || cd?.custom?.olc) {
        outlineCols.set(Number(k), { level: Number(cd.custom.ol) || 0, collapsed: !!cd.custom.olc });
        if (cd.custom.ol) col.outlineLevel = Number(cd.custom.ol);
        // The column needs its own <col> element to carry the marks.
        if (!col.width) col.width = colChars(s.defaultColumnWidth || EXCEL_DEFAULT_COL);
      }
    }
    for (const [k, rd] of Object.entries(s.rowData || {})) {
      const row = ws.getRow(Number(k) + 1);
      if (rd?.h && rd.h !== s.defaultRowHeight) row.height = rowPt(rd.h);
      if (rd?.hd) {
        row.hidden = true;
        // ExcelJS drops rows that have neither cells nor a height.
        if (!row.height) row.height = rowPt(rd.h || s.defaultRowHeight || 24);
      }
      const st = styleToExcel(styleOf(rd?.s));
      if (st) (row as unknown as { style: Partial<ExcelJSTypes.Style> }).style = st;
      if (rd?.custom?.ol || rd?.custom?.olc) {
        outlineRows.set(Number(k), { level: Number(rd.custom.ol) || 0, collapsed: !!rd.custom.olc });
        if (rd.custom.ol) row.outlineLevel = Number(rd.custom.ol);
        if (!row.height) row.height = rowPt(rd.h || s.defaultRowHeight || 24);
      }
    }
    // Sheet protection: Excel enforces the whole-sheet kind itself.
    const sheetProt = protectionsAll.find((p) => p.sheetId === sheetId && !p.range);
    if (sheetProt) {
      const attrs = { ...(sheetProt.xlsx || {}), sheet: "1" };
      const ranges = (sheetProt.except || []).map((g, n) => ({ name: `Range${n + 1}`, sqref: rangeRef(g), attrs: sheetProt.exceptPasswords?.[n] || {} }));
      sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), (xml) => patchSheetProtection(xml, { attrs, ranges })]);
    }

    // Data tables: the TABLE formula on each table's results.
    const sheetDataTables = ((res(DATA_TABLE_RESOURCE).tables || []) as DataTableDef[]).filter((d) => d.sheetId === sheetId);
    if (sheetDataTables.length) sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), (x) => patchDataTables(x, sheetDataTables)]);
    // Scenarios (What-If Analysis), after any sheet protection.
    const sheetScenarios = ((res(SCENARIO_RESOURCE).scenarios || []) as Scenario[]).filter((x) => x.sheetId === sheetId);
    if (sheetScenarios.length) {
      const xml = scenariosXml(sheetScenarios);
      sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), (x) => patchScenarios(x, xml)]);
    }
    const sparkGroups = ((res(SPARKLINE_RESOURCE).groups || []) as SparklineGroup[]).filter((g) => g.sheetId === sheetId && g.items?.length);
    if (sparkGroups.length) {
      const ext = sparklineExtXml(sparkGroups, (id) => nameById.get(id));
      if (ext) sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), (xml) => patchSparklines(xml, ext)]);
    }

    const outlineFlags = s.custom?.xlsx?.outline;
    if (outlineRows.size || outlineCols.size || outlineFlags) {
      const o = { rows: outlineRows, cols: outlineCols, summaryBelow: outlineFlags?.summaryBelow !== false, summaryRight: outlineFlags?.summaryRight !== false };
      sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), (xml) => patchOutline(xml, o)]);
    }

    // Shared formulas: Univer keeps `f` on the first cell of a group and only
    // `si` on the rest; expand them by shifting the anchor's references.
    const shared = new Map<string, { f: string; r: number; c: number }>();
    for (const [rk, row] of Object.entries(s.cellData || {}))
      for (const [ck, uc] of Object.entries(row || {})) if (uc?.si && uc.f) shared.set(uc.si, { f: uc.f, r: Number(rk), c: Number(ck) });

    for (const [rk, row] of Object.entries(s.cellData || {})) {
      for (const [ck, uc] of Object.entries(row || {})) {
        if (!uc) continue;
        const r = Number(rk);
        const c = Number(ck);
        const cell = ws.getCell(r + 1, c + 1);
        let f = uc.f || undefined;
        const anchor = !f && uc.si ? shared.get(uc.si) : undefined;
        if (anchor) f = shiftFormula(anchor.f, r - anchor.r, c - anchor.c);
        const value = cellValueToExcel(uc, nameById);
        if (f) cell.value = { formula: excelFormula(f), result: value as ExcelJSTypes.CellFormulaValue["result"] };
        else if (value !== undefined) cell.value = value;
        const st = styleToExcel(styleOf(uc.s));
        if (st) cell.style = st as ExcelJSTypes.Style;
      }
    }

    // Dynamic arrays: an array formula over the spill, which holds its values.
    const sheetSpills = options.spills?.[sheetId];
    if (sheetSpills?.spills.length) {
      let any = false;
      for (const g of sheetSpills.spills) {
        const f = s.cellData?.[g.row]?.[g.column]?.f;
        if (!f || (g.endRow === g.row && g.endColumn === g.column)) continue;
        any = true;
        const cell = ws.getCell(g.row + 1, g.column + 1);
        const first = sheetSpills.values[g.row]?.[g.column];
        cell.value = { formula: excelFormula(f), result: (first ?? (cell.value as any)?.result) as any, shareType: "array", ref: rangeRef({ startRow: g.row, startColumn: g.column, endRow: g.endRow, endColumn: g.endColumn }) } as any;
        for (let r = g.row; r <= g.endRow; r++)
          for (let c = g.column; c <= g.endColumn; c++) {
            if (r === g.row && c === g.column) continue;
            const v = sheetSpills.values[r]?.[c];
            const own = s.cellData?.[r]?.[c];
            if (v === undefined || v === null || (own && (own.f || own.v != null))) continue;
            ws.getCell(r + 1, c + 1).value = v as ExcelJSTypes.CellValue;
          }
      }
      if (any) {
        dynamicArrays = true;
        sheetTransforms.set(sheetIndex, [...(sheetTransforms.get(sheetIndex) || []), markDynamicArrays]);
      }
    }

    const seen = new Set<string>(); // Univer can hold the same merge twice
    for (const m of s.mergeData || []) {
      const ref = rangeRef(m);
      if (seen.has(ref) || !ref.includes(":")) continue;
      seen.add(ref);
      try {
        ws.mergeCells(ref);
      } catch {
        /* overlapping merge: keep the first */
      }
    }

    // A cell holds either a note or a thread in Excel: a note on a commented
    // cell becomes the thread's first message.
    const sheetThreads = (options.threads || []).filter((t) => t.sheetId === sheetId && t.messages.length && /^[A-Z]{1,3}\d+$/.test(t.ref));
    const threadAt = new Map(sheetThreads.map((t) => [t.ref, t]));
    for (const [rk, cols] of Object.entries((notesAll[sheetId] || {}) as Record<string, Record<string, any>>)) {
      for (const [ck, n] of Object.entries(cols || {})) {
        if (!n?.note) continue;
        const t = threadAt.get(addr(Number(rk), Number(ck)));
        if (t) {
          threadAt.set(t.ref, { ...t, messages: [{ author_name: "Note", author_email: "", body: String(n.note), created_ms: (t.messages[0]?.created_ms ?? Date.now()) - 1 }, ...t.messages] });
          continue;
        }
        const cell = ws.getCell(Number(rk) + 1, Number(ck) + 1);
        const runs = Array.isArray(n.texts) && n.texts.map((t: any) => t.text).join("") === String(n.note) ? n.texts : null;
        cell.note = runs ? ({ texts: runs } as any) : String(n.note);
        // ExcelJS skips cells with neither value nor style, and drops their
        // notes; the (default) locked protection makes the cell be written.
        if (cell.value == null && !Object.keys(cell.style || {}).length) cell.protection = { locked: true };
      }
    }

    if (threadAt.size) {
      threadsBySheet.set(sheetIndex, [...threadAt.values()]);
      for (const t of threadAt.values()) {
        const { r, c } = refCell(t.ref);
        const cell = ws.getCell(r + 1, c + 1);
        cell.note = fallbackText(t);
        if (cell.value == null && !Object.keys(cell.style || {}).length) cell.protection = { locked: true };
      }
    }

    const filter = filterAll[sheetId];
    if (filter?.ref) {
      const ref = rangeRef(filter.ref);
      ws.autoFilter = ref;
      const columns = ((filter.filterColumns || []) as FilterColumn[]).filter((c) => c.filters || c.customFilters);
      if (columns.length) {
        autoFilters.set(sheetIndex, autoFilterXml(ref, columns));
        // Excel shows a filter's result through hidden rows.
        for (const r of (filter.cachedFilteredOut || []) as number[]) {
          const row = ws.getRow(r + 1);
          row.hidden = true;
          if (!row.height) row.height = rowPt(s.rowData?.[r]?.h || s.defaultRowHeight || 24);
        }
      }
    }

    for (const t of (tablesAll[sheetId]?.tables || []) as any[]) tableToExcel(ws, t, usedTableNames);
    await imagesToExcel(wb, ws, drawingsAll[sheetId], s);
    const meta = s.custom?.xlsx;
    if (meta?.pageSetup) Object.assign(ws.pageSetup, meta.pageSetup);
    if (meta?.headerFooter) Object.assign(ws.headerFooter, meta.headerFooter);

    for (const rule of (dvAll[sheetId] || []) as any[]) {
      const x = dvRuleToExcel(rule);
      if (!x) continue;
      for (const g of rule.ranges || []) (ws as any).dataValidations.add(rangeRef(g), x);
    }

    ((cfAll[sheetId] || []) as any[]).forEach((rule, i) => {
      const ref = ((rule.ranges || []) as Range[]).map(rangeRef).join(" ");
      const x = ref ? cfRuleToExcel(rule, i + 1) : null;
      if (x) ws.addConditionalFormatting({ ref, rules: [x] });
    });
  }

  // Defined names go straight into workbook.xml: ExcelJS can only write names
  // that point at ranges, not ones holding a formula or a constant.
  const sheetIndexById = new Map(book.sheetOrder.filter((id) => book.sheets[id]).map((id, i) => [id, i]));
  const definedNames: DefinedName[] = [];
  for (const dn of Object.values(namesAll) as any[]) {
    if (!dn?.name || !dn.formulaOrRefString) continue;
    const local = dn.localSheetId && dn.localSheetId !== "AllDefaultWorkbook" ? sheetIndexById.get(dn.localSheetId) : undefined;
    if (dn.localSheetId && dn.localSheetId !== "AllDefaultWorkbook" && local == null) continue;
    const formula = formulaToExcel(String(dn.formulaOrRefString)).replace(/^=/, "");
    definedNames.push({ name: dn.name, formula, ...(local != null ? { localSheetId: local } : {}), ...(dn.hidden ? { hidden: true } : {}), ...(dn.comment ? { comment: dn.comment } : {}) });
  }

  // Solver models as Excel's hidden solver_* names on their sheet.
  for (const m of ((res(SOLVER_RESOURCE).models || []) as SolverModel[])) {
    const local = sheetIndexById.get(m.sheetId);
    const sheetName = book.sheets[m.sheetId]?.name;
    if (local == null || !sheetName) continue;
    for (const [name, formula] of Object.entries(solverNames(m, sheetName.slice(0, 31)))) definedNames.push({ name, formula, localSheetId: local, hidden: true });
  }

  // Each query's data range, named after its query table.
  const queriesAll = ((res(QUERY_RESOURCE).queries || []) as QueryDef[]).filter((q) => q.foreign || sheetIndexById.has(q.sheetId));
  queriesAll.forEach((q, i) => {
    const local = sheetIndexById.get(q.sheetId);
    const sheetName = book.sheets[q.sheetId]?.name?.slice(0, 31);
    if (q.foreign || local == null || !sheetName) return;
    const size = q.size || { rows: 1, columns: 1 };
    const abs = (r: number, c: number) => addr(r, c).replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
    const range = `${abs(q.anchor.row, q.anchor.column)}:${abs(q.anchor.row + Math.max(1, size.rows) - 1, q.anchor.column + Math.max(1, size.columns) - 1)}`;
    const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
    definedNames.push({ name: externalDataName(i + 1), formula: `${quoted}!${range}`, localSheetId: local, hidden: true });
  });

  // Slicers and timelines as hidden names on their sheet.
  let slicerN = 0;
  for (const [sheetId, sd] of Object.entries((drawingsAll || {}) as Record<string, any>)) {
    const local = sheetIndexById.get(sheetId);
    const sheetName = book.sheets[sheetId]?.name?.slice(0, 31);
    if (local == null || !sheetName || !sd?.data) continue;
    for (const did of (sd.order || Object.keys(sd.data)) as string[]) {
      const d = sd.data[did];
      if (d?.drawingType !== DRAWING_DOM || d.componentKey !== SLICER_COMPONENT || !d.data || !d.transform) continue;
      const t = d.transform;
      const json = JSON.stringify({ d: d.data, t: { left: t.left || 0, top: t.top || 0, width: t.width || 160, height: t.height || 200 } });
      const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
      slicerN++;
      for (let k = 0; k * 240 < json.length; k++)
        definedNames.push({ name: `_SynergySlicer${slicerN}${k ? `_${k + 1}` : ""}`, formula: `${quoted}!$A$1`, localSheetId: local, hidden: true, comment: json.slice(k * 240, (k + 1) * 240) });
    }
  }

  // Who may edit each protected area, and range protections, as hidden names.
  let protectName = 0;
  for (const p of protectionsAll) {
    const local = sheetIndexById.get(p.sheetId);
    const sheetName = book.sheets[p.sheetId]?.name;
    if (local == null || !sheetName) continue;
    const info: ProtectNameInfo = { id: p.id, ...(p.range ? {} : { w: 1 as const }), ...(p.description ? { d: p.description } : {}), ...(p.editors?.length ? { e: p.editors } : {}) };
    if (!p.range && !info.d && !info.e) continue; // Excel's own protection says it all
    const g = p.range || { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    // Excel keeps name comments to 255 characters, so long details continue in
    // further names (_SynergyProtect3_2, _3_3, ...).
    const json = JSON.stringify(info);
    const n = ++protectName;
    const formula = `${quoteSheet(sheetName.slice(0, 31))}!${absRef(g)}`;
    for (let k = 0; k * 240 < json.length; k++)
      definedNames.push({ name: `_SynergyProtect${n}${k ? `_${k + 1}` : ""}`, formula, localSheetId: local, hidden: true, comment: json.slice(k * 240, (k + 1) * 240) });
  }

  if (wb.worksheets.length === 0) wb.addWorksheet("Sheet1");
  const buf = await wb.xlsx.writeBuffer();
  let out = await patchPackage(new Uint8Array(buf as ArrayBuffer), { definedNames, autoFilters, sheetTransforms });
  if (threadsBySheet.size) out = await addThreadedComments(out, threadsBySheet);
  // Slicers on pivot tables also go in as Excel's own slicers.
  const pivotDefs = (res(PIVOT_RESOURCE).pivots || []) as PivotDef[];
  const slicerExports: SlicerExport[] = [];
  const tableSlicerExports: TableSlicerExport[] = [];
  const timelineExports: (TimelineExport & { pivotId: string })[] = [];
  for (const [index, sheetId] of book.sheetOrder.filter((id) => book.sheets[id]).entries()) {
    const sd = (drawingsAll as Record<string, any>)?.[sheetId];
    const sheet = book.sheets[sheetId];
    if (!sd?.data) continue;
    for (const did of (sd.order || Object.keys(sd.data)) as string[]) {
      const d = sd.data[did];
      const data = d?.data as SlicerData | undefined;
      if (d?.drawingType !== DRAWING_DOM || d.componentKey !== SLICER_COMPONENT || !data || !d.transform || !data.source) continue;
      const t = d.transform;
      const c = advance(0, 0, Math.max(0, t.left || 0), (i) => colWidthPx(sheet, i));
      const r = advance(0, 0, Math.max(0, t.top || 0), (i) => rowHeightPx(sheet, i));
      const c2 = advance(c.index, c.offset, Math.max(1, t.width || 160), (i) => colWidthPx(sheet, i));
      const r2 = advance(r.index, r.offset, Math.max(1, t.height || 200), (i) => rowHeightPx(sheet, i));
      const place = {
        sheetIndex: index,
        caption: data.caption || data.field,
        field: data.field,
        anchor: { from: { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset }, to: { column: c2.index, columnOffset: c2.offset, row: r2.index, rowOffset: r2.offset } },
        size: { width: t.width || 160, height: t.height || 200 },
      };
      const src = data.source;
      if (data.kind === "slicer" && src.type === "table") {
        tableSlicerExports.push({ ...place, tableName: src.name, columns: data.columns });
        continue;
      }
      if (src.type !== "pivot") continue;
      const pivot = pivotDefs.find((p) => p.id === src.pivotId);
      if (!pivot) continue;
      if (data.kind === "timeline") timelineExports.push({ ...place, pivotName: pivot.name, pivotId: pivot.id, level: data.level || "months", bounds: null });
      else slicerExports.push({ ...place, pivotName: pivot.name, selected: data.selected ?? null, columns: data.columns });
    }
  }
  // Pivot tables as real Excel pivot tables over their source ranges.
  const pivotExports: PivotExport[] = [];
  for (const def of pivotDefs) {
    const src = book.sheets[def.source?.sheetId];
    const targetSheetIndex = sheetIndexById.get(def.target?.sheetId);
    if (!src || targetSheetIndex == null) continue;
    const g = def.source.range;
    const table: unknown[][] = [];
    for (let r = g.startRow; r <= g.endRow; r++) {
      const row: unknown[] = [];
      for (let c = g.startColumn; c <= g.endColumn; c++) row.push(src.cellData?.[r]?.[c]?.v ?? null);
      table.push(row);
    }
    while (table.length > 1 && table[table.length - 1].every((v) => v == null || v === "")) table.pop();
    const slicerFields = slicerExports.filter((x) => x.pivotName === def.name).map((x) => x.field);
    const dateFields = timelineExports.filter((x) => x.pivotId === def.id).map((x) => x.field);
    // A timeline's bounds: the first and last date in its field.
    for (const tl of timelineExports.filter((x) => x.pivotId === def.id)) {
      const j = fieldNames(table[0] || []).indexOf(tl.field);
      const dates = table
        .slice(1)
        .map((row) => asDate(row[j]))
        .filter((x): x is Date => !!x)
        .map((x) => x.toISOString().slice(0, 10));
      dates.sort();
      if (dates.length) tl.bounds = { start: `${dates[0]}T00:00:00`, end: `${dates.at(-1)}T00:00:00` };
    }
    pivotExports.push({ def, table, sourceSheetName: src.name.slice(0, 31), targetSheetIndex, ...(slicerFields.length ? { slicerFields } : {}), ...(dateFields.length ? { dateFields } : {}) });
  }
  if (pivotExports.length) out = await addPivotTables(out, pivotExports);
  if (pivotExports.length && slicerExports.length) out = await addPivotSlicers(out, slicerExports);
  const timelinesOut = timelineExports.filter((x) => pivotExports.some((p) => p.def.id === x.pivotId)).map(({ pivotId: _, ...x }) => x);
  if (tableSlicerExports.length || timelinesOut.length) out = await addTableSlicersAndTimelines(out, tableSlicerExports, timelinesOut);
  // Shapes and text boxes, as Excel shapes in each sheet's drawing part.
  const shapeSheets: SheetShapes[] = [];
  const parts = (await openPackage(out)).sheets;
  for (const [index, sheetId] of book.sheetOrder.filter((id) => book.sheets[id]).entries()) {
    const sd = drawingsAll[sheetId];
    const sheet = book.sheets[sheetId];
    const part = parts.find((p) => p.index === index);
    if (!sd?.data || !part) continue;
    const shapes: SheetShapes["shapes"] = [];
    for (const did of (sd.order || Object.keys(sd.data)) as string[]) {
      const d = sd.data[did];
      if (d?.drawingType !== DRAWING_DOM || d.componentKey !== SHAPE_COMPONENT || !d.data || !d.transform) continue;
      const t = d.transform;
      const c = advance(0, 0, Math.max(0, t.left || 0), (i) => colWidthPx(sheet, i));
      const r = advance(0, 0, Math.max(0, t.top || 0), (i) => rowHeightPx(sheet, i));
      const c2 = advance(c.index, c.offset, Math.max(1, t.width || 1), (i) => colWidthPx(sheet, i));
      const r2 = advance(r.index, r.offset, Math.max(1, t.height || 1), (i) => rowHeightPx(sheet, i));
      shapes.push({
        data: d.data as ShapeData,
        anchor: { from: { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset }, to: { column: c2.index, columnOffset: c2.offset, row: r2.index, rowOffset: r2.offset } },
        size: { width: t.width || 1, height: t.height || 1 },
      });
    }
    if (shapes.length) shapeSheets.push({ sheetPath: part.path, shapes });
  }
  const calc = book.resources?.some((r) => r.name === CALC_RESOURCE) ? calcSettings(res(CALC_RESOURCE)) : null;
  const themeData = book.resources?.find((r) => r.name === THEME_RESOURCE)?.data;
  // The workbook's theme, or the default one (ExcelJS writes an older Office theme).
  const workbookTheme = themeData ? themeFrom(res(THEME_RESOURCE)) : DEFAULT_WORKBOOK_THEME;
  {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(out);
    const themePart = workbookTheme ? await zip.file("xl/theme/theme1.xml")?.async("string") : null;
    // Metafiles under the content types Excel uses for them.
    const types = await zip.file("[Content_Types].xml")?.async("string");
    if (types && /ContentType="image\/(emf|wmf)"/.test(types)) zip.file("[Content_Types].xml", types.replace(/ContentType="image\/(emf|wmf)"/g, 'ContentType="image/x-$1"'));
    if (themePart) zip.file("xl/theme/theme1.xml", patchThemeXml(themePart, workbookTheme));
    await addCalcToZip(zip as any, { dynamicArrays, calc });
    await addExternalLinks(zip as any, workbookLinks);
    if (shapeSheets.length) await addShapesToZip(zip as any, shapeSheets);
    if (queriesAll.length)
      await addQueriesToZip(
        zip as any,
        queriesAll.map((query) => ({ query, sheetPath: parts.find((p) => p.index === sheetIndexById.get(query.sheetId))?.path })),
      );
    out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  out = await addChartsToXlsx(out, book);
  // VBA project, code names, other programs' custom XML, and our scripts.
  const kept = (res(KEPT_RESOURCE) as KeptParts) || null;
  const scripts = ((res(SCRIPT_RESOURCE).scripts || []) as Script[]).filter((x) => x?.code != null);
  if (kept?.vba || kept?.codeNames || kept?.customXml?.length || kept?.pivots || scripts.length) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(out);
    const sheetParts = (await openPackage(out)).sheets.map((p) => ({ path: p.path, sheetId: book.sheetOrder.filter((id) => book.sheets[id])[p.index] })).filter((p) => p.sheetId);
    await writeKept(zip as any, kept && Object.keys(kept).length ? kept : null, scripts, sheetParts);
    out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  // Custom views: one customWorkbookView each, with a customSheetView per sheet.
  // The document's custom properties and sensitivity label.
  const customViews = ((res(CUSTOM_VIEWS_RESOURCE).views || []) as CustomView[]).filter((v) => v?.id && v.sheets);
  const docProps = res(DOC_PROPS_RESOURCE) as DocProps;
  // Pictures' alt text, which ExcelJS doesn't write.
  const picAlts = new Map<number, PicAlt[]>();
  for (const [index, sheetId] of book.sheetOrder.filter((id) => book.sheets[id]).entries()) {
    const sd = (drawingsAll as Record<string, any>)?.[sheetId];
    const list = Object.values((sd?.data || {}) as Record<string, any>)
      .filter((d) => d?.drawingType === 0 && (d.description || d.decorative) && (d.sheetTransform || d.axisAlignSheetTransform)?.from)
      .map((d) => {
        const from = (d.sheetTransform || d.axisAlignSheetTransform).from;
        return { column: from.column || 0, row: from.row || 0, ...(d.description ? { alt: String(d.description) } : {}), ...(d.decorative ? { decorative: true } : {}) };
      });
    if (list.length) picAlts.set(index, list);
  }
  // Form controls, as VML shapes in the sheet's legacy drawing.
  const controlsBySheet = new Map<number, ReadControl[]>();
  for (const [index, sheetId] of book.sheetOrder.filter((id) => book.sheets[id]).entries()) {
    const sd = (drawingsAll as Record<string, any>)?.[sheetId];
    const sheet = book.sheets[sheetId];
    const list: ReadControl[] = [];
    for (const did of (sd?.order || Object.keys(sd?.data || {})) as string[]) {
      const d = sd?.data?.[did];
      const st = d?.sheetTransform || d?.axisAlignSheetTransform;
      if (d?.drawingType !== DRAWING_DOM || d.componentKey !== FORM_CONTROL_COMPONENT || !d.data || !st?.from) continue;
      const from = { column: st.from.column || 0, columnOffset: Math.round(st.from.columnOffset || 0), row: st.from.row || 0, rowOffset: Math.round(st.from.rowOffset || 0) };
      let to = st.to;
      if (!to) {
        const c = advance(from.column, from.columnOffset, d.transform?.width || 100, (i) => colWidthPx(sheet, i));
        const r = advance(from.row, from.rowOffset, d.transform?.height || 22, (i) => rowHeightPx(sheet, i));
        to = { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset };
      }
      list.push({ data: d.data, anchor: { from, to: { column: to.column || 0, columnOffset: Math.round(to.columnOffset || 0), row: to.row || 0, rowOffset: Math.round(to.rowOffset || 0) } } });
    }
    if (list.length) controlsBySheet.set(index, list);
  }
  if (customViews.length || docProps?.custom?.length || docProps?.label || docProps?.workbook || picAlts.size || controlsBySheet.size) {
    const pkg = await openPackage(out);
    if (docProps?.workbook) pkg.zip.file("xl/workbook.xml", patchWorkbookProtection(pkg.workbookXml, docProps.workbook));
    if (customViews.length) {
      const ids = book.sheetOrder.filter((id) => book.sheets[id]);
      pkg.zip.file("xl/workbook.xml", patchWorkbookCustomViews(await pkg.read("xl/workbook.xml"), customViews, ids));
      for (const part of pkg.sheets) {
        const sid = ids[part.index];
        if (sid && !/chartsheets\//.test(part.path)) pkg.zip.file(part.path, patchSheetCustomViews(await pkg.read(part.path), customViews, sid));
      }
    }
    if (docProps?.custom?.length || docProps?.label) await writeDocProps(pkg.zip as any, docProps);
    for (const part of pkg.sheets) {
      const controls = controlsBySheet.get(part.index);
      if (controls && !/chartsheets\//.test(part.path)) await writeLegacyDrawing(pkg.zip as any, part.path, (vml, block) => addControlsToVml(vml, controls, block));
    }
    if (picAlts.size)
      for (const part of pkg.sheets) {
        const alts = picAlts.get(part.index);
        const drawingPath = alts ? await drawingPartOf(pkg.zip, part.path) : null;
        if (drawingPath) pkg.zip.file(drawingPath, patchPicAlts(await pkg.read(drawingPath), alts!));
      }
    out = (await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })) as Uint8Array;
  }
  return out;
}

function tableToExcel(ws: ExcelJSTypes.Worksheet, t: any, used: Set<string>) {
  const g: Range | undefined = t?.range;
  if (!g || g.endRow <= g.startRow) return;
  const meta: TableXlsxMeta = t.meta?.xlsx || {};
  const width = g.endColumn - g.startColumn + 1;
  const sameShape = meta.columns?.length === width;
  const totalsRow = !!meta.totalsRow && sameShape;
  const last = g.endRow + (totalsRow ? 1 : 0);
  // ExcelJS writes the table's values into the cells; keep what we already
  // wrote (formulas, styles) and put it back afterwards.
  const saved: { cell: ExcelJSTypes.Cell; value: ExcelJSTypes.CellValue; style: Partial<ExcelJSTypes.Style> }[] = [];
  for (let r = g.startRow; r <= last; r++)
    for (let c = g.startColumn; c <= g.endColumn; c++) {
      const cell = ws.getCell(r + 1, c + 1);
      saved.push({ cell, value: cell.value, style: { ...(cell.style || {}) } });
    }
  const names = new Set<string>();
  const columns = Array.from({ length: width }, (_, j) => {
    const header = ws.getCell(g.startRow + 1, g.startColumn + j + 1).text?.trim();
    let name = header || t.columns?.[j]?.displayName || `Column${j + 1}`;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${header || "Column"}${n}`;
    names.add(name.toLowerCase());
    const m = sameShape ? meta.columns?.[j] : undefined;
    return {
      name,
      filterButton: true,
      ...(totalsRow && m?.totalsRowFunction ? { totalsRowFunction: m.totalsRowFunction } : {}),
      ...(totalsRow && m?.totalsRowLabel ? { totalsRowLabel: m.totalsRowLabel } : {}),
      ...(totalsRow && m?.totalsRowFormula ? { totalsRowFormula: m.totalsRowFormula } : {}),
    };
  });
  const rows: ExcelJSTypes.CellValue[][] = [];
  for (let r = g.startRow + 1; r <= g.endRow; r++) rows.push(columns.map((_, j) => ws.getCell(r + 1, g.startColumn + j + 1).value));
  let name = String(t.name || "Table").replace(/[^A-Za-z0-9_.\\]/g, "_");
  if (!/^[A-Za-z_\\]/.test(name)) name = `_${name}`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${t.name}_${n}`;
  used.add(name.toLowerCase());
  const keepExcelLook = meta.style && meta.univerStyle && meta.univerStyle === t.options?.tableStyleId;
  const styleIndex = Number(/table-default-(\d+)/.exec(t.options?.tableStyleId || "")?.[1] ?? 0);
  const style = keepExcelLook
    ? meta.style
    : { theme: EXCEL_TABLE_FOR_UNIVER[styleIndex] || "TableStyleMedium2", showRowStripes: true, showFirstColumn: false, showLastColumn: false, showColumnStripes: false };
  try {
    ws.addTable({ name, displayName: name, ref: addr(g.startRow, g.startColumn), headerRow: true, totalsRow, style, columns, rows } as any);
  } catch {
    /* table rejected by ExcelJS: the cells stay as plain data */
  }
  for (const x of saved) {
    x.cell.value = x.value;
    x.cell.style = x.style as ExcelJSTypes.Style;
  }
}

async function imagesToExcel(wb: ExcelJSTypes.Workbook, ws: ExcelJSTypes.Worksheet, sheetDrawings: any, sheet: UniverSheet) {
  for (const id of (sheetDrawings?.order || Object.keys(sheetDrawings?.data || {})) as string[]) {
    const d = sheetDrawings?.data?.[id];
    if (!d || d.drawingType !== 0 || typeof d.source !== "string") continue;
    let mime = "";
    let bytes: Uint8Array | null = null;
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(d.source);
    if (d.metafile?.data && (d.metafile.ext === "emf" || d.metafile.ext === "wmf")) {
      mime = `image/${d.metafile.ext}`;
      bytes = fromBase64(d.metafile.data);
    } else if (m) {
      mime = m[1];
      bytes = m[2] ? fromBase64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
    } else if (/^https?:|^\//.test(d.source) && typeof fetch === "function") {
      try {
        const r = await fetch(d.source);
        mime = r.headers.get("content-type") || "";
        bytes = new Uint8Array(await r.arrayBuffer());
      } catch {
        bytes = null;
      }
    }
    const extension = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpeg" : mime.includes("gif") ? "gif" : mime === "image/emf" ? "emf" : mime === "image/wmf" ? "wmf" : "";
    if (!bytes || !extension) continue; // Excel takes png/jpeg/gif here, and metafiles back as they came
    const st = d.sheetTransform || d.axisAlignSheetTransform;
    if (!st?.from) continue;
    const imageId = wb.addImage({ base64: toBase64(bytes), extension: extension as "png" });
    const anchor = (p: any) => ({ nativeCol: p.column || 0, nativeColOff: Math.round((p.columnOffset || 0) * EMU_PER_PX), nativeRow: p.row || 0, nativeRowOff: Math.round((p.rowOffset || 0) * EMU_PER_PX) });
    let to = st.to;
    if (!to) {
      const c = advance(st.from.column, st.from.columnOffset || 0, d.transform?.width || 100, (i) => colWidthPx(sheet, i));
      const r = advance(st.from.row, st.from.rowOffset || 0, d.transform?.height || 100, (i) => rowHeightPx(sheet, i));
      to = { column: c.index, columnOffset: c.offset, row: r.index, rowOffset: r.offset };
    }
    ws.addImage(imageId, { tl: anchor(st.from), br: anchor(to), editAs: "oneCell" } as any);
  }
}

function cellValueToExcel(uc: UniverCell, nameById: Map<string, string>): ExcelJSTypes.CellValue | undefined {
  if (uc.p?.body?.dataStream) {
    const text = richText(uc.p);
    const link = uc.p.body.customRanges?.find((x) => x.rangeType === 0 && x.properties?.url);
    if (link?.properties?.url) {
      let url = link.properties.url;
      const internal = /^#gid=([^&]+)&range=(.+)$/.exec(url);
      if (internal) url = `#${quoteSheet(nameById.get(internal[1]) || internal[1])}!${internal[2]}`;
      return { text, hyperlink: url };
    }
    const runs = (uc.p.body.textRuns || []).filter((x) => x.ed > x.st);
    if (!runs.length) return text;
    const flat = uc.p.body.dataStream.replace(/\r?\n$/, "");
    const parts: ExcelJSTypes.RichText[] = [];
    let pos = 0;
    for (const run of [...runs].sort((a, b) => a.st - b.st)) {
      if (run.st > pos) parts.push({ text: flat.slice(pos, run.st).replace(/\r/g, "\n") });
      const font = fontToExcel(run.ts);
      parts.push({ text: flat.slice(Math.max(pos, run.st), run.ed).replace(/\r/g, "\n"), ...(font ? { font } : {}) });
      pos = Math.max(pos, run.ed);
    }
    if (pos < flat.length) parts.push({ text: flat.slice(pos).replace(/\r/g, "\n") });
    return { richText: parts.filter((p) => p.text) };
  }
  const v = uc.v;
  if (v === undefined || v === null) return undefined;
  if (uc.t === CELL.BOOLEAN) return v === true || v === 1 || String(v).toUpperCase() === "TRUE" || v === "1";
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return uc.t === CELL.STRING || uc.t === CELL.FORCE_STRING ? String(v) : v;
  if (uc.f && /^#(N\/A|REF!|NAME\?|DIV\/0!|NULL!|VALUE!|NUM!|SPILL!|CALC!)$/.test(v)) return { error: v } as ExcelJSTypes.CellErrorValue;
  return String(v);
}

function dvRuleToExcel(rule: any): ExcelJSTypes.DataValidation | null {
  const common = {
    allowBlank: rule.allowBlank !== false,
    showErrorMessage: rule.showErrorMessage !== false,
    ...(rule.error ? { error: rule.error } : {}),
    ...(rule.errorTitle ? { errorTitle: rule.errorTitle } : {}),
    errorStyle: rule.errorStyle === 2 ? "warning" : rule.errorStyle === 0 ? "information" : "stop",
    showInputMessage: !!rule.showInputMessage,
    ...(rule.prompt ? { prompt: rule.prompt } : {}),
    ...(rule.promptTitle ? { promptTitle: rule.promptTitle } : {}),
  };
  const strip = (x: any) => (x === undefined || x === null ? undefined : formulaToExcel(String(x)));
  switch (rule.type) {
    case "list":
    case "listMultiple": {
      const f1 = String(rule.formula1 ?? "");
      if (f1.startsWith("=")) return { ...common, type: "list", formulae: [strip(f1)] };
      let items: string[];
      try {
        const parsed = JSON.parse(f1);
        items = Array.isArray(parsed) ? parsed.map(String) : f1.split(",");
      } catch {
        items = f1.split(",");
      }
      return { ...common, type: "list", formulae: [`"${items.filter(Boolean).join(",")}"`] };
    }
    case "checkbox":
      return { ...common, type: "list", formulae: ['"TRUE,FALSE"'] };
    case "whole":
    case "decimal":
    case "textLength":
    case "date":
    case "time": {
      const op = rule.operator || "between";
      const formulae = [strip(rule.formula1)];
      if (op === "between" || op === "notBetween") formulae.push(strip(rule.formula2));
      return { ...common, type: rule.type, operator: op, formulae: formulae.filter((x) => x !== undefined) } as ExcelJSTypes.DataValidation;
    }
    case "custom":
      return rule.formula1 ? { ...common, type: "custom", formulae: [strip(rule.formula1)] } : null;
    default:
      return null;
  }
}

function cfStyleToExcel(u: UniverStyle | undefined): Partial<ExcelJSTypes.Style> {
  const st: Partial<ExcelJSTypes.Style> = {};
  const font: Partial<ExcelJSTypes.Font> = {};
  if (u?.bl) font.bold = true;
  if (u?.it) font.italic = true;
  if (u?.ul?.s) font.underline = true;
  if (u?.st?.s) font.strike = true;
  const fc = argb(u?.cl);
  if (fc) font.color = { argb: fc };
  if (Object.keys(font).length) st.font = font;
  const bg = argb(u?.bg);
  if (bg) st.fill = { type: "pattern", pattern: "solid", bgColor: { argb: bg }, fgColor: { argb: bg } };
  return st;
}

const cfvoToExcel = (v: any) => {
  const out: { type: string; value?: number | string } = { type: v?.type || "num" };
  if (v?.value !== undefined && v?.value !== "" && out.type !== "min" && out.type !== "max")
    out.value = out.type === "formula" ? formulaToExcel(String(v.value)) : Number(v.value);
  return out;
};

function cfRuleToExcel(rule: any, priority: number): ExcelJSTypes.ConditionalFormattingRule | null {
  const conf = rule.rule || {};
  const ranges = (rule.ranges || []) as Range[];
  if (!ranges.length) return null;
  const tl = addr(ranges[0].startRow, ranges[0].startColumn);
  const style = cfStyleToExcel(conf.style);
  const extra = rule.stopIfTrue ? { stopIfTrue: true } : {};
  const expr = (formula: string): any => ({ type: "expression", priority, formulae: [formula], style, ...extra });
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  if (conf.type === "highlightCell") {
    switch (conf.subType) {
      case "number": {
        const formulae = Array.isArray(conf.value) ? conf.value.map(String) : [String(conf.value ?? 0)];
        return { type: "cellIs", operator: conf.operator, priority, formulae, style, ...extra } as any;
      }
      case "text": {
        const v = q(conf.value);
        // Text rules go out as formula rules, which every Excel version
        // evaluates the same way (ExcelJS mislabels the native text rules).
        const formulas: Record<string, string> = {
          containsText: `NOT(ISERROR(SEARCH(${v},${tl})))`,
          notContainsText: `ISERROR(SEARCH(${v},${tl}))`,
          beginsWith: `LEFT(${tl},LEN(${v}))=${v}`,
          endsWith: `RIGHT(${tl},LEN(${v}))=${v}`,
          equal: `${tl}=${v}`,
          notEqual: `${tl}<>${v}`,
          containsBlanks: `LEN(TRIM(${tl}))=0`,
          notContainsBlanks: `LEN(TRIM(${tl}))>0`,
          containsErrors: `ISERROR(${tl})`,
          notContainsErrors: `NOT(ISERROR(${tl}))`,
        };
        return formulas[conf.operator] ? expr(formulas[conf.operator]) : null;
      }
      case "formula":
        return conf.value ? expr(formulaToExcel(String(conf.value))) : null;
      case "timePeriod":
        return { type: "timePeriod", timePeriod: conf.operator, priority, style, ...extra } as any;
      case "rank":
        return { type: "top10", rank: Number(conf.value) || 10, percent: !!conf.isPercent, bottom: !!conf.isBottom, priority, style, ...extra } as any;
      case "average":
        return { type: "aboveAverage", aboveAverage: !String(conf.operator).startsWith("less"), priority, style, ...extra } as any;
      case "duplicateValues":
      case "uniqueValues":
        return expr(`COUNTIF(${ranges.map(absRef).join(",")},${tl})${conf.subType === "duplicateValues" ? ">1" : "=1"}`);
    }
    return null;
  }
  if (conf.type === "colorScale") {
    const items = [...(conf.config || [])].sort((a: any, b: any) => a.index - b.index);
    return {
      type: "colorScale",
      priority,
      cfvo: items.map((x: any) => cfvoToExcel(x.value)),
      color: items.map((x: any) => ({ argb: toArgb(x.color) || "FFFFFFFF" })),
    } as any;
  }
  if (conf.type === "dataBar") {
    return {
      type: "dataBar",
      priority,
      gradient: conf.config?.isGradient !== false,
      showValue: conf.isShowValue !== false,
      cfvo: [cfvoToExcel(conf.config?.min), cfvoToExcel(conf.config?.max)],
      color: { argb: toArgb(conf.config?.positiveColor) || "FF638EC6" },
    } as any;
  }
  if (conf.type === "iconSet") {
    const items = (conf.config || []) as any[];
    const n = items.length;
    if (!n) return null;
    // Back to Excel's ascending thresholds; the lowest bucket starts at 0%.
    const cfvo = [{ type: "percent", value: 0 }, ...items.slice(0, n - 1).reverse().map((x) => cfvoToExcel(x.value))];
    return {
      type: "iconSet",
      priority,
      iconSet: items[0].iconType,
      showValue: conf.isShowValue !== false,
      reverse: n > 1 && items[0].iconId === String(n - 1),
      cfvo,
    } as any;
  }
  return null;
}

// ---- Legacy formats (SheetJS) --------------------------------------------

/** Read .xls / .ods / .csv (anything SheetJS parses): values, formulas, number formats, merges. */
export function legacyToUniver(data: ArrayBuffer | Uint8Array, name = "Imported workbook"): UniverWorkbook {
  // `type: "array"` wants a byte array. Normalize either an ArrayBuffer (from a
  // browser File) or a Uint8Array (which may be a view into a larger buffer).
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true });
  const sheets: UniverWorkbook["sheets"] = {};
  const order: string[] = [];
  const reg = styleRegistry();

  wb.SheetNames.forEach((sheetName, i) => {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    const cellData: UniverSheet["cellData"] = {};
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const uc: UniverCell = {};
        if (cell.f != null) uc.f = formulaFromExcel(String(cell.f));
        if (cell.v != null) Object.assign(uc, excelValue(cell.t === "e" ? { error: cell.w } : cell.v));
        if (typeof cell.z === "string" && cell.z !== "General") uc.s = reg.id({ n: { pattern: cell.z } });
        if (uc.v === undefined && uc.f === undefined) continue;
        (cellData[r] ||= {})[c] = uc;
      }
    }
    const id = sid(i);
    order.push(id);
    sheets[id] = {
      id,
      name: sheetName,
      rowCount: Math.max(1000, range.e.r + 50),
      columnCount: Math.max(26, range.e.c + 10),
      cellData,
      mergeData: (ws["!merges"] || []).map((m) => ({ startRow: m.s.r, endRow: m.e.r, startColumn: m.s.c, endColumn: m.e.c })),
    };
  });

  if (order.length === 0) {
    const id = sid(0);
    order.push(id);
    sheets[id] = { id, name: "Sheet1", rowCount: 1000, columnCount: 26, cellData: {} };
  }

  return { id: `wb-${Date.now()}`, name, appVersion: "", locale: "enUS", sheetOrder: order, styles: reg.styles, sheets };
}

// ---- CSV --------------------------------------------------------------------

/** One sheet as CSV text, with values shown the way the sheet formats them. */
/** What a cell shows: its value through its number format. */
export function cellDisplayText(book: Pick<UniverWorkbook, "styles">, uc: UniverCell | undefined, style?: UniverStyle | null): string {
  if (!uc) return "";
  if (uc.p?.body?.dataStream) return richText(uc.p);
  const v = uc.v;
  if (v == null) return "";
  if (uc.t === CELL.BOOLEAN) return v === 1 || (v as unknown) === true || String(v).toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    const pattern = (style ?? (uc.s == null ? null : typeof uc.s === "string" ? book.styles?.[uc.s] ?? null : uc.s))?.n?.pattern;
    if (pattern && pattern !== "General") {
      try {
        // Bundlers see SheetJS's ESM build (SSF is a named export); Node
        // loads the CommonJS one, where SSF hangs off the module object.
        const mod = XLSX as Record<string, any>;
        const ssf = mod.SSF ?? Object.values(mod).find((x) => x?.SSF)?.SSF;
        return ssf.format(pattern, v);
      } catch {
        /* unknown format: fall through to the general format */
      }
    }
    // General format: at most 11 significant digits, like the grid shows.
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(11)));
  }
  return String(v);
}

export function univerSheetToCsv(book: UniverWorkbook, sheetId = book.sheetOrder[0]): string {
  const s = book.sheets[sheetId];
  if (!s) return "";
  let maxR = -1;
  let maxC = -1;
  for (const [rk, row] of Object.entries(s.cellData || {}))
    for (const [ck, uc] of Object.entries(row || {}))
      if (uc && (uc.v != null || uc.p)) {
        maxR = Math.max(maxR, Number(rk));
        maxC = Math.max(maxC, Number(ck));
      }
  const text = (uc: UniverCell | undefined) => cellDisplayText(book, uc);
  const quote = (f: string) => (/[",\r\n]/.test(f) || /^\s|\s$/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const fields: string[] = [];
    for (let c = 0; c <= maxC; c++) fields.push(quote(text(s.cellData?.[r]?.[c])));
    lines.push(fields.join(","));
  }
  return lines.join("\r\n") + (lines.length ? "\r\n" : "");
}
