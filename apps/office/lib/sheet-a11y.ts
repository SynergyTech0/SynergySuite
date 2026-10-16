// Review > Check Accessibility, after Excel's checker: missing alternative
// text on pictures, shapes and charts (errors); merged cells, hard-to-read
// text colours and tables without a header row (warnings); default sheet
// names and blank table headers (tips). Plus the alt text of pictures in
// .xlsx (descr on the picture's cNvPr), which ExcelJS doesn't read or write.

import { DRAWING_DOM, SHAPE_COMPONENT } from "./sheet-shapes.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Severity = "error" | "warning" | "tip";
export type A11yTarget = { kind: "image" | "shape" | "chart"; sheetId: string; id: string };
export type A11yIssue = { severity: Severity; rule: string; sheetId: string; sheetName: string; ref?: string; message: string; target?: A11yTarget };

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const rangeRef = (g: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => `${col(g.startColumn)}${g.startRow + 1}:${col(g.endColumn)}${g.endRow + 1}`;

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number | null {
  const x = luminance(a);
  const y = luminance(b);
  if (x == null || y == null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const rgbOf = (c: any) => (typeof c?.rgb === "string" ? (c.rgb.length === 8 && !c.rgb.startsWith("#") ? `#${c.rgb.slice(2)}` : c.rgb.startsWith("#") ? c.rgb : `#${c.rgb}`) : null);

type Book = { sheetOrder: string[]; sheets: Record<string, any>; styles?: Record<string, any>; resources?: { name: string; data: string }[] };

/** The issues in a workbook, errors first. */
export function checkAccessibility(book: Book): A11yIssue[] {
  const out: A11yIssue[] = [];
  const res = (name: string) => {
    try {
      return JSON.parse(book.resources?.find((r) => r.name === name)?.data || "null");
    } catch {
      return null;
    }
  };
  const drawings = res("SHEET_DRAWING_PLUGIN") || {};
  const charts = res("SHEET_SYNERGY_CHARTS_PLUGIN") || {};
  const tables = res("SHEET_TABLE_PLUGIN");
  for (const sheetId of book.sheetOrder) {
    const s = book.sheets[sheetId];
    if (!s) continue;
    const sheetName = s.name || sheetId;
    const issue = (severity: Severity, rule: string, message: string, extra: Partial<A11yIssue> = {}) => out.push({ severity, rule, sheetId, sheetName, message, ...extra });

    // Alternative text.
    const sd = drawings[sheetId];
    for (const id of (sd?.order || Object.keys(sd?.data || {})) as string[]) {
      const d = sd?.data?.[id];
      if (!d) continue;
      if (d.drawingType === 0 && !d.description?.trim() && !d.decorative) issue("error", "Missing alternative text", "Picture without alt text", { target: { kind: "image", sheetId, id } });
      if (d.drawingType === DRAWING_DOM && d.componentKey === SHAPE_COMPONENT && d.data && !d.data.alt?.trim() && !d.data.decorative && d.data.kind !== "line")
        issue("error", "Missing alternative text", `${d.data.name || (d.data.kind === "textbox" ? "Text box" : "Shape")} without alt text`, { target: { kind: "shape", sheetId, id } });
    }
    for (const c of (charts.sheets?.[sheetId] || []) as any[])
      if (!c.alt?.trim() && !c.decorative) issue("error", "Missing alternative text", `Chart${c.title ? ` "${c.title}"` : ""} without alt text`, { target: { kind: "chart", sheetId, id: c.id } });

    // Merged cells.
    for (const g of (s.mergeData || []) as any[]) issue("warning", "Merged cells", "Merged cells make tables hard to navigate with a screen reader", { ref: rangeRef(g) });

    // Hard-to-read text: below 4.5:1 (WCAG AA), one issue per sheet's worst cells.
    const low: string[] = [];
    for (const [r, row] of Object.entries((s.cellData || {}) as Record<string, any>))
      for (const [c, cell] of Object.entries((row || {}) as Record<string, any>)) {
        if (cell?.v == null || cell.v === "") continue;
        const st = typeof cell.s === "string" ? book.styles?.[cell.s] : cell.s;
        if (!st?.cl && !st?.bg) continue;
        const ratio = contrastRatio(rgbOf(st.cl) || "#000000", rgbOf(st.bg) || "#ffffff");
        if (ratio != null && ratio < 4.5) low.push(`${col(Number(c))}${Number(r) + 1}`);
      }
    if (low.length) issue("warning", "Hard-to-read text contrast", `Text colour too close to its background in ${low.slice(0, 6).join(", ")}${low.length > 6 ? ` and ${low.length - 6} more` : ""}`, { ref: low[0] });

    // Default sheet names, on sheets with something on them.
    const used = Object.values((s.cellData || {}) as Record<string, any>).some((row) => Object.values(row || {}).some((x: any) => x?.v != null && x.v !== ""));
    if (/^Sheet\d+$/i.test(sheetName) && (used || sd?.order?.length)) issue("tip", "Default sheet name", `Give "${sheetName}" a name that says what's on it`);
  }

  // Tables: a header row, with every header filled in.
  for (const [sheetId, entry] of Object.entries((tables || {}) as Record<string, { tables?: any[] }>)) {
    if (!book.sheets[sheetId]) continue;
    const sheetName = book.sheets[sheetId].name || sheetId;
    for (const t of entry?.tables || []) {
      if (t?.options?.showHeader === false) out.push({ severity: "warning", rule: "No header row", sheetId, sheetName, message: `Table ${t.name} has no header row` });
      const blanks = ((t?.columns || []) as any[]).filter((c) => !String(c?.displayName ?? "").trim()).length;
      if (blanks) out.push({ severity: "tip", rule: "Blank table headers", sheetId, sheetName, message: `Table ${t.name} has ${blanks} blank header${blanks > 1 ? "s" : ""}` });
    }
  }
  const rank = { error: 0, warning: 1, tip: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---- Picture alt text in .xlsx --------------------------------------------------

export type PicAlt = { column: number; row: number; alt?: string; decorative?: boolean };
const DECORATIVE = /<adec:decorative\b[^>]*val="1"/;
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function picAnchors(drawingXml: string) {
  const out: { column: number; row: number; xml: string; index: number }[] = [];
  for (const m of drawingXml.matchAll(/<(?:\w+:)?(oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
    const pic = /<(?:\w+:)?pic\b[\s\S]*?<\/(?:\w+:)?pic>/.exec(m[2]);
    if (!pic) continue;
    const from = /<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/.exec(m[2])?.[1] || "";
    const n = (t: string) => Number(new RegExp(`<(?:\\w+:)?${t}>(\\d+)<`).exec(from)?.[1] || 0);
    out.push({ column: n("col"), row: n("row"), xml: pic[0], index: (m.index || 0) + m[0].indexOf(pic[0]) });
  }
  return out;
}

/** The alt text of the pictures in a drawing part, by their top-left cell. */
export function readPicAlts(drawingXml: string): PicAlt[] {
  return picAnchors(drawingXml).map((p) => {
    const tag = /<(?:\w+:)?cNvPr\b[^>]*>/.exec(p.xml)?.[0] || "";
    const descr = /\bdescr="([^"]*)"/.exec(tag)?.[1];
    return { column: p.column, row: p.row, ...(descr ? { alt: unesc(descr) } : {}), ...(DECORATIVE.test(p.xml) ? { decorative: true } : {}) };
  });
}

/** Sets descr (and the decorative mark) on the pictures at those cells, in order. */
export function patchPicAlts(drawingXml: string, alts: PicAlt[]): string {
  const left = [...alts];
  let xml = drawingXml;
  // From the end, so earlier positions stay put.
  for (const p of picAnchors(drawingXml).reverse()) {
    const k = left.findIndex((a) => a.column === p.column && a.row === p.row);
    if (k < 0) continue;
    const a = left.splice(k, 1)[0];
    const pic = p.xml.replace(/<((?:\w+:)?cNvPr)\b([^>]*?)(\/?)>/, (_m, name: string, attrs: string, selfClose: string) => {
      const base = attrs.replace(/\s+descr="[^"]*"/, "") + (a.alt ? ` descr="${esc(a.alt)}"` : "");
      if (!a.decorative) return `<${name}${base}${selfClose}>`;
      const ext = `<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>`;
      return selfClose ? `<${name}${base}>${ext}</${name}>` : `<${name}${base}>${ext}`;
    });
    xml = xml.slice(0, p.index) + pic + xml.slice(p.index + p.xml.length);
  }
  return xml;
}
