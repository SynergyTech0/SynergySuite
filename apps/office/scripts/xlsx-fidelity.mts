// Round-trip check for real-world .xlsx files: each file is opened the way
// the Sheets editor opens it (xlsxToUniver), saved the way it saves
// (univerToXlsx), and the two files are compared: cell values, formulas,
// styles, merges, column widths, comments, links, validation, conditional
// formatting, and the parts (charts, pivot tables, drawings, tables, names,
// sparklines, slicers, threaded comments).
//
//   node --import tsx scripts/xlsx-fidelity.mts <folder or files...> [--json out.json]
//
// Prints one line per file and the details of what changed.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { forExcelJS, univerToXlsx, xlsxToUniver } from "../lib/xlsx.ts";

type Counts = Record<string, number>;
export type FileResult = {
  file: string;
  ok: boolean;
  error?: string;
  sheets: number;
  cells: number;
  /** What differs, by kind: [count, examples]. */
  losses: Record<string, { n: number; of: number; examples: string[] }>;
  parts: { before: Counts; after: Counts };
};

const norm = (f: string) => f.replace(/^=/, "").replace(/_xlfn\.|_xlws\.|_xlpm\./g, "").replace(/\s+/g, "").replace(/\$/g, "").toUpperCase();
function valueOf(cell: ExcelJS.Cell): unknown {
  const v = cell.value as any;
  if (v == null) return null;
  if (v instanceof Date) return Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 864e5 * 1e6) / 1e6;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r: any) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) return valueOf({ value: v.result ?? null } as any);
    if ("text" in v && "hyperlink" in v) return v.text;
    if ("error" in v) return v.error;
    return JSON.stringify(v);
  }
  return v;
}
// Shared formulas come back translated to the cell (ExcelJS's cell.formula).
const formulaOf = (cell: ExcelJS.Cell) => {
  const v = cell.value as any;
  return v && typeof v === "object" && ("formula" in v || "sharedFormula" in v) ? ((cell as any).formula ?? null) : null;
};
const same = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if ((a == null || a === "") && (b == null || b === "")) return true;
  return String(a) === String(b);
};
// Theme colours resolved against the file's own theme (index order as Excel
// uses it: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink), with tint.
type Theme = string[];
function themeOf(themeXml: string): Theme {
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(themeXml)?.[1] || "";
  const col = (n: string) => {
    const x = new RegExp(`<a:${n}>([\\s\\S]*?)</a:${n}>`).exec(scheme)?.[1] || "";
    return (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(x)?.[1] || /lastClr="([0-9A-Fa-f]{6})"/.exec(x)?.[1] || "000000").toUpperCase();
  };
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(col);
}
function tint(hex: string, t: number): string {
  if (!t) return hex;
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
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (x: number) => {
    x = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  if (!s) return Math.round(l * 255).toString(16).padStart(2, "0").repeat(3).toUpperCase();
  return (f(h + 1 / 3) + f(h) + f(h - 1 / 3)).toUpperCase();
}
const near = (a: string, b: string) => [0, 2, 4].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
let THEME: Theme = [];
const argb = (c: any): string | null => (c?.argb ? String(c.argb).slice(-6).toUpperCase() : c?.theme != null && THEME[c.theme] ? tint(THEME[c.theme], c.tint || 0) : null);
const styleKey = (cell: ExcelJS.Cell, theme: Theme) => {
  THEME = theme;
  const s: any = cell.style || {};
  const color = argb(s.font?.color);
  return {
    bold: !!s.font?.bold,
    italic: !!s.font?.italic,
    // Black text is the default either way.
    color: color === "000000" ? null : color,
    fill: s.fill?.type === "pattern" && s.fill.pattern !== "none" ? argb(s.fill.fgColor) : null,
    numFmt: s.numFmt && s.numFmt !== "General" ? s.numFmt : null,
    align: s.alignment?.horizontal && s.alignment.horizontal !== "general" ? s.alignment.horizontal : null,
    border: ["top", "left", "bottom", "right"].filter((k) => s.border?.[k]?.style).join(","),
  };
};

const colNum = (c: string) => [...c].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
function cellsIn(sqref: string): number {
  return sqref.trim().split(/\s+/).reduce((a, r) => {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(r);
    if (!m) return a;
    const rows = m[3] ? Math.abs(Number(m[4]) - Number(m[2])) + 1 : 1;
    const cols = m[3] ? Math.abs(colNum(m[3]) - colNum(m[1])) + 1 : 1;
    return a + Math.min(rows * cols, 1e7);
  }, 0);
}

async function partCounts(bytes: Uint8Array): Promise<Counts> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const all = async (re: RegExp) => Promise.all(names.filter((n) => re.test(n)).map((n) => zip.file(n)!.async("string")));
  const count = (xs: string[], re: RegExp) => xs.reduce((a, x) => a + (x.match(re)?.length || 0), 0);
  const drawings = await all(/^xl\/drawings\/drawing\d+\.xml$/);
  const sheets = await all(/^xl\/worksheets\/sheet\d+\.xml$/);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) || "";
  return {
    charts: names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).length,
    pivotTables: names.filter((n) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(n)).length,
    tables: names.filter((n) => /^xl\/tables\/table\d+\.xml$/.test(n)).length,
    images: names.filter((n) => /^xl\/media\//.test(n)).length,
    shapes: count(drawings, /<(?:\w+:)?sp\b(?![^>]*\/>)/g) - count(drawings, /<mc:Fallback>\s*<(?:\w+:)?sp\b/g),
    groups: count(drawings, /<(?:\w+:)?grpSp>/g),
    slicers: names.filter((n) => /^xl\/slicers\/slicer\d+\.xml$/.test(n)).length,
    threadedComments: names.filter((n) => /^xl\/threadedComments\//.test(n)).length,
    sparklines: count(sheets, /<x14:sparkline>/g),
    // Rules by priority (an x14 data bar extends its main rule, it isn't another).
    conditionalFormats: sheets.reduce((a, x) => a + new Set([...x.matchAll(/<(?:x14:)?cfRule\b[^>]*\bpriority="(\d+)"/g)].map((m) => m[1])).size, 0),
    // Cells covered (identical rules may be merged into one).
    dataValidationCells: sheets.reduce((a, x) => a + [...x.matchAll(/<(?:x14:)?dataValidation\b[^>]*\bsqref="([^"]*)"/g), ...x.matchAll(/<x14:dataValidation\b[\s\S]*?<xm:sqref>([^<]*)<\/xm:sqref>/g)].reduce((b, m) => b + cellsIn(m[1]), 0), 0),
    // Names that refer to something (not built-in ones, not #REF!).
    definedNames: [...wb.matchAll(/<definedName\b([^>]*)>([^<]*)</g)].filter((m) => !/name="(_Synergy|_xlnm\.)|hidden="1"/.test(m[1]) && !/^(\S+!)?#REF!$/.test(m[2].trim())).length,
    externalLinks: names.filter((n) => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(n)).length,
    frozenPanes: count(sheets, /<pane\b[^>]*state="frozen/g),
    autoFilters: count(sheets, /<autoFilter\b/g),
    hiddenSheets: (wb.match(/<sheet\b[^>]*state="(hidden|veryHidden)"/g) || []).length,
  };
}

export async function roundTrip(file: string, bytes: Uint8Array): Promise<FileResult> {
  const result: FileResult = { file, ok: false, sheets: 0, cells: 0, losses: {}, parts: { before: {}, after: {} } };
  const loss = (kind: string, of: number, example?: string) => {
    const l = (result.losses[kind] ||= { n: 0, of: 0, examples: [] });
    if (example) {
      l.n++;
      if (l.examples.length < 3) l.examples.push(example);
    }
    l.of = Math.max(l.of, of);
  };
  let out: Uint8Array;
  try {
    const book = await xlsxToUniver(bytes, path.basename(file, ".xlsx"));
    out = await univerToXlsx(book);
  } catch (e) {
    result.error = `round trip failed: ${(e as Error).message}`;
    return result;
  }
  result.parts.before = await partCounts(bytes);
  result.parts.after = await partCounts(out);
  const a = new ExcelJS.Workbook();
  const b = new ExcelJS.Workbook();
  try {
    await a.xlsx.load(Buffer.from(await forExcelJS(bytes)) as any);
  } catch (e) {
    result.ok = true;
    result.error = `ExcelJS can't read the original (${(e as Error).message}); parts only`;
    return result;
  }
  await b.xlsx.load(Buffer.from(out) as any);
  const inTheme = themeOf((await (await JSZip.loadAsync(bytes)).file("xl/theme/theme1.xml")?.async("string")) || "");
  const outTheme = themeOf((await (await JSZip.loadAsync(out)).file("xl/theme/theme1.xml")?.async("string")) || "");
  result.sheets = a.worksheets.length;
  if (b.worksheets.length !== a.worksheets.length) loss("sheets", a.worksheets.length, `${a.worksheets.length} -> ${b.worksheets.length}`);
  for (const wa of a.worksheets) {
    const wb = b.getWorksheet(wa.name);
    if (!wb) {
      loss("sheets", a.worksheets.length, `missing sheet ${wa.name}`);
      continue;
    }
    const counts = { values: 0, formulas: 0, styled: 0, comments: 0, links: 0 };
    wa.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (ca) => {
        const cb = wb.getCell(ca.address);
        const at = `${wa.name}!${ca.address}`;
        const fa = formulaOf(ca);
        if (ca.isMerged && ca.master !== ca) return;
        const va = valueOf(ca);
        if (va != null && va !== "") {
          result.cells++;
          counts.values++;
          // A formula's cached value may be missing in the original (never calculated): skip those.
          if (!(fa && (ca.value as any)?.result === undefined) && !same(va, valueOf(cb))) loss("values", 0, `${at}: ${JSON.stringify(va)} -> ${JSON.stringify(valueOf(cb))}`);
        }
        if (fa) {
          counts.formulas++;
          const fb = formulaOf(cb);
          if (!fb || norm(fa) !== norm(fb)) loss("formulas", 0, `${at}: =${fa} -> ${fb ? `=${fb}` : "(value)"}`);
        }
        const sa = styleKey(ca, inTheme);
        if (sa.bold || sa.italic || sa.color || sa.fill || sa.numFmt || sa.align || sa.border) {
          counts.styled++;
          const sb = styleKey(cb, outTheme);
          for (const k of Object.keys(sa) as (keyof typeof sa)[])
            if (sa[k] && String(sa[k]) !== String(sb[k]) && !(typeof sa[k] === "string" && typeof sb[k] === "string" && /^[0-9A-F]{6}$/.test(sa[k] as string) && /^[0-9A-F]{6}$/.test(sb[k] as string) && near(sa[k] as string, sb[k] as string))) loss(`style: ${k}`, 0, `${at}: ${sa[k]} -> ${sb[k] ?? "none"}`);
        }
        if (ca.note) {
          counts.comments++;
          if (!cb.note) loss("comments", 0, at);
        }
        if ((ca.value as any)?.hyperlink) {
          counts.links++;
          if (!(cb.value as any)?.hyperlink) loss("hyperlinks", 0, at);
        }
      }),
    );
    for (const [k, v] of Object.entries(counts)) if (v) loss(k === "styled" ? "style: any" : k, v);
    const ma = new Set((wa.model as any).merges || []);
    const mb = new Set((wb.model as any).merges || []);
    for (const m of ma) if (!mb.has(m)) loss("merges", ma.size, `${wa.name}!${m}`);
    (wa.columns || []).forEach((col, i) => {
      const w1 = col?.width;
      const w2 = wb.getColumn(i + 1).width;
      if (w1 && Math.abs(w1 - (w2 || 8.43)) > 0.6) loss("column widths", 0, `${wa.name} col ${i + 1}: ${w1} -> ${w2 ?? "default"}`);
    });
    if (wa.state !== wb.state) loss("sheet visibility", 1, `${wa.name}: ${wa.state} -> ${wb.state}`);
  }
  for (const [k, before] of Object.entries(result.parts.before)) {
    const after = result.parts.after[k] ?? 0;
    if (after < before) loss(`parts: ${k}`, before, `${before} -> ${after}`);
  }
  for (const k of Object.keys(result.losses)) if (!result.losses[k].n) delete result.losses[k];
  result.ok = true;
  return result;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const files = args.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".xlsx")).sort().map((f) => path.join(p, f)) : [p]));
  const results: FileResult[] = [];
  for (const f of files) {
    const r = await roundTrip(f, new Uint8Array(readFileSync(f)));
    results.push(r);
    const kinds = Object.entries(r.losses).map(([k, l]) => `${k} ${l.n}${l.of ? `/${l.of}` : ""}`);
    console.log(`${r.ok ? (kinds.length ? "CHANGED" : "SAME   ") : "FAILED "} ${path.basename(f)} (${r.sheets} sheets, ${r.cells} cells)${kinds.length ? `: ${kinds.join("; ")}` : ""}${r.error ? ` [${r.error}]` : ""}`);
    for (const [k, l] of Object.entries(r.losses)) for (const ex of l.examples) console.log(`    ${k}: ${ex}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
}
