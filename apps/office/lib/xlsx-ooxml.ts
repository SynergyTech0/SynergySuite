// Raw OOXML helpers for the parts of an .xlsx that ExcelJS doesn't model:
// filter conditions inside <autoFilter>, defined names that hold formulas
// (ExcelJS only keeps range names) and comments on empty cells. We read the
// zip with JSZip and, on export, patch the XML ExcelJS wrote.
import * as XLSX from "xlsx";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const xmlDecode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

export const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? xmlDecode(m[1]) : undefined;
};

function rels(xml: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(r[0], "Id");
    const target = attr(r[0], "Target");
    if (id && target) m.set(id, target);
  }
  return m;
}

const resolve = (base: string, target: string) =>
  target.startsWith("/") ? target.slice(1) : new URL(target, `http://x/${base}`).pathname.slice(1);

async function loadZip(bytes: Uint8Array): Promise<any> {
  const mod: any = await import("jszip");
  return (mod.default ?? mod).loadAsync(bytes);
}

export type SheetPart = { name: string; index: number; path: string };
export type XlsxPackage = {
  zip: any;
  read: (path: string) => Promise<string>;
  workbookXml: string;
  sheets: SheetPart[];
};

/** Open an .xlsx and map each sheet (in workbook order) to its XML part. */
export async function openPackage(bytes: Uint8Array): Promise<XlsxPackage> {
  const zip = await loadZip(bytes);
  const read = async (p: string): Promise<string> => (zip.file(p) ? zip.file(p).async("string") : "");
  const workbookXml = await read("xl/workbook.xml");
  const wbRels = rels(await read("xl/_rels/workbook.xml.rels"));
  const sheets: SheetPart[] = [];
  let index = 0;
  for (const s of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(s[0], "name") || "";
    const target = wbRels.get(attr(s[0], "r:id") || "");
    if (target) sheets.push({ name, index, path: resolve("xl/workbook.xml", target) });
    index++;
  }
  return { zip, read, workbookXml, sheets };
}

// ---- Comments on empty cells ------------------------------------------------

/** ExcelJS only attaches comments to cells that exist in sheetData, so notes
 *  on otherwise-empty cells (common in files saved by Excel) would be lost.
 *  Read them straight from the comments parts. */
export async function readComments(pkg: XlsxPackage): Promise<Map<string, { r: number; c: number; text: string }[]>> {
  const out = new Map<string, { r: number; c: number; text: string }[]>();
  for (const sheet of pkg.sheets) {
    const relPath = sheet.path.replace(/([^/]+)$/, "_rels/$1.rels");
    for (const [, t] of rels(await pkg.read(relPath))) {
      if (!/comments\d*\.xml$/.test(t)) continue;
      const list: { r: number; c: number; text: string }[] = [];
      for (const c of (await pkg.read(resolve(sheet.path, t))).matchAll(/<comment\b[^>]*\bref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
        const text = [...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join("");
        const { r, c: col } = XLSX.utils.decode_cell(c[1]);
        list.push({ r, c: col, text });
      }
      out.set(sheet.name, list);
    }
  }
  return out;
}

// ---- Defined names ----------------------------------------------------------

export type DefinedName = { name: string; formula: string; localSheetId?: number; hidden?: boolean; comment?: string };

export function readDefinedNames(workbookXml: string): DefinedName[] {
  const out: DefinedName[] = [];
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const tag = `<x ${m[1]}>`;
    const name = attr(tag, "name");
    if (!name) continue;
    const local = attr(tag, "localSheetId");
    out.push({
      name,
      formula: xmlDecode(m[2]).trim(),
      ...(local != null ? { localSheetId: Number(local) } : {}),
      ...(attr(tag, "hidden") === "1" || attr(tag, "hidden") === "true" ? { hidden: true } : {}),
      ...(attr(tag, "comment") ? { comment: attr(tag, "comment") } : {}),
    });
  }
  return out;
}

const definedNameXml = (d: DefinedName) =>
  `<definedName name="${xmlEscape(d.name)}"${d.localSheetId != null ? ` localSheetId="${d.localSheetId}"` : ""}${
    d.hidden ? ' hidden="1"' : ""
  }${d.comment ? ` comment="${xmlEscape(d.comment)}"` : ""}>${xmlEscape(d.formula)}</definedName>`;

/** Add names to workbook.xml next to the ones ExcelJS wrote (print areas, titles). */
function addDefinedNames(workbookXml: string, names: DefinedName[]): string {
  if (!names.length) return workbookXml;
  const existing = new Set(readDefinedNames(workbookXml).map((d) => `${d.localSheetId ?? ""}|${d.name.toLowerCase()}`));
  const xml = names
    .filter((d) => !existing.has(`${d.localSheetId ?? ""}|${d.name.toLowerCase()}`))
    .map(definedNameXml)
    .join("");
  if (!xml) return workbookXml;
  if (/<definedNames\s*\/>/.test(workbookXml)) return workbookXml.replace(/<definedNames\s*\/>/, `<definedNames>${xml}</definedNames>`);
  if (workbookXml.includes("</definedNames>")) return workbookXml.replace("</definedNames>", `${xml}</definedNames>`);
  // CT_Workbook order: … sheets, functionGroups, externalReferences, definedNames, calcPr …
  const after = /<\/externalReferences>|<\/functionGroups>|<\/sheets>/.exec(workbookXml);
  if (!after) return workbookXml;
  const at = after.index + after[0].length;
  return `${workbookXml.slice(0, at)}<definedNames>${xml}</definedNames>${workbookXml.slice(at)}`;
}

// ---- AutoFilter conditions --------------------------------------------------

/** Filter column in Univer's shape (colId is the absolute column index). */
export type FilterColumn = {
  colId: number;
  filters?: { blank?: true; filters?: string[] };
  customFilters?: { and?: 1; customFilters: { operator?: string; val: string | number }[] };
};

const filterVal = (v: string | undefined): string | number => {
  if (v == null) return "";
  return v !== "" && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v) ? Number(v) : v;
};

/** Parse the sheet's <autoFilter> conditions (values and custom filters). */
export function readAutoFilter(sheetXml: string): { ref: string; columns: FilterColumn[] } | null {
  const m = /<autoFilter\b([^>]*?)(?:\/>|>([\s\S]*?)<\/autoFilter>)/.exec(sheetXml);
  if (!m) return null;
  const ref = attr(`<x ${m[1]}>`, "ref");
  if (!ref) return null;
  const startCol = XLSX.utils.decode_range(ref).s.c;
  const columns: FilterColumn[] = [];
  for (const fc of (m[2] || "").matchAll(/<filterColumn\b([^>]*?)(?:\/>|>([\s\S]*?)<\/filterColumn>)/g)) {
    const colId = startCol + Number(attr(`<x ${fc[1]}>`, "colId") || 0);
    const body = fc[2] || "";
    const col: FilterColumn = { colId };
    const vf = /<filters\b([^>]*?)(?:\/>|>([\s\S]*?)<\/filters>)/.exec(body);
    if (vf) {
      const values = [...(vf[2] || "").matchAll(/<filter\b[^>]*\bval="([^"]*)"/g)].map((x) => xmlDecode(x[1]));
      const blank = attr(`<x ${vf[1]}>`, "blank");
      col.filters = { ...(blank === "1" || blank === "true" ? { blank: true as const } : {}), ...(values.length ? { filters: values } : {}) };
    }
    const cf = /<customFilters\b([^>]*?)>([\s\S]*?)<\/customFilters>/.exec(body);
    if (cf) {
      const list = [...cf[2].matchAll(/<customFilter\b[^>]*>/g)].map((x) => {
        const op = attr(x[0], "operator");
        return { ...(op && op !== "equal" ? { operator: op } : {}), val: filterVal(attr(x[0], "val")) };
      });
      const and = attr(`<x ${cf[1]}>`, "and");
      if (list.length) col.customFilters = { ...(and === "1" || and === "true" ? { and: 1 as const } : {}), customFilters: list.slice(0, 2) };
    }
    if (col.filters || col.customFilters) columns.push(col);
  }
  return { ref, columns };
}

export function autoFilterXml(ref: string, columns: FilterColumn[]): string {
  const startCol = XLSX.utils.decode_range(ref).s.c;
  const body = columns
    .map((col) => {
      let inner = "";
      if (col.filters) {
        const vals = (col.filters.filters || []).map((v) => `<filter val="${xmlEscape(String(v))}"/>`).join("");
        inner = `<filters${col.filters.blank ? ' blank="1"' : ""}>${vals}</filters>`;
      } else if (col.customFilters?.customFilters?.length) {
        const list = col.customFilters.customFilters
          .map((c) => `<customFilter${c.operator && c.operator !== "equal" ? ` operator="${c.operator}"` : ""} val="${xmlEscape(String(c.val))}"/>`)
          .join("");
        inner = `<customFilters${col.customFilters.and ? ' and="1"' : ""}>${list}</customFilters>`;
      }
      return inner ? `<filterColumn colId="${col.colId - startCol}">${inner}</filterColumn>` : "";
    })
    .join("");
  return body ? `<autoFilter ref="${ref}">${body}</autoFilter>` : `<autoFilter ref="${ref}"/>`;
}

// ---- Export patching ----------------------------------------------------------

export type PackagePatch = {
  definedNames?: DefinedName[];
  /** Full <autoFilter> element per sheet index, replacing what ExcelJS wrote. */
  autoFilters?: Map<number, string>;
  /** Further edits to a sheet part, by sheet index (outline, protection). */
  sheetTransforms?: Map<number, ((xml: string) => string)[]>;
};

export async function patchPackage(bytes: Uint8Array, patch: PackagePatch): Promise<Uint8Array> {
  if (!patch.definedNames?.length && !patch.autoFilters?.size && !patch.sheetTransforms?.size) return bytes;
  const pkg = await openPackage(bytes);
  if (patch.definedNames?.length) pkg.zip.file("xl/workbook.xml", addDefinedNames(pkg.workbookXml, patch.definedNames));
  for (const [index, xml] of patch.autoFilters || []) {
    const part = pkg.sheets.find((s) => s.index === index);
    if (!part) continue;
    const sheetXml = await pkg.read(part.path);
    const re = /<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/;
    if (re.test(sheetXml)) pkg.zip.file(part.path, sheetXml.replace(re, xml));
  }
  for (const [index, steps] of patch.sheetTransforms || []) {
    const part = pkg.sheets.find((s) => s.index === index);
    if (!part || !steps.length) continue;
    let sheetXml = await pkg.read(part.path);
    for (const step of steps) sheetXml = step(sheetXml);
    pkg.zip.file(part.path, sheetXml);
  }
  const out = await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return out as Uint8Array;
}

// ---- Row/column outline (grouping) -------------------------------------------
// ExcelJS reads and writes outline levels but gets the "collapsed" mark wrong
// (it derives it from the deepest level), so both sides go through the XML.

export type OutlineMark = { level: number; collapsed?: boolean; hidden?: boolean };
export type SheetOutlineXml = { rows: Map<number, OutlineMark>; cols: Map<number, OutlineMark>; summaryBelow: boolean; summaryRight: boolean };

const flag = (tag: string, name: string) => /^(1|true)$/i.test(attr(tag, name) || "");

/** Outline levels and collapsed marks of a sheet part, with 0-based indices. */
export function readOutline(sheetXml: string): SheetOutlineXml {
  const rows = new Map<number, OutlineMark>();
  for (const m of sheetXml.matchAll(/<row\b[^>]*>/g)) {
    const r = Number(attr(m[0], "r"));
    const level = Number(attr(m[0], "outlineLevel")) || 0;
    const collapsed = flag(m[0], "collapsed");
    if (r > 0 && (level || collapsed)) rows.set(r - 1, { level, ...(collapsed ? { collapsed } : {}), ...(flag(m[0], "hidden") ? { hidden: true } : {}) });
  }
  const cols = new Map<number, OutlineMark>();
  for (const m of sheetXml.matchAll(/<col\b[^>]*>/g)) {
    const level = Number(attr(m[0], "outlineLevel")) || 0;
    const collapsed = flag(m[0], "collapsed");
    if (!level && !collapsed) continue;
    const min = Number(attr(m[0], "min"));
    const max = Math.min(Number(attr(m[0], "max")) || min, min + 16384);
    for (let c = min; c <= max; c++) cols.set(c - 1, { level, ...(collapsed ? { collapsed } : {}), ...(flag(m[0], "hidden") ? { hidden: true } : {}) });
  }
  const pr = /<outlinePr\b[^>]*>/.exec(sheetXml)?.[0] || "";
  return { rows, cols, summaryBelow: attr(pr, "summaryBelow") !== "0", summaryRight: attr(pr, "summaryRight") !== "0" };
}

const setAttr = (tag: string, name: string, value: string | null) => {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  const without = tag.replace(re, "");
  if (value == null) return without;
  return without.replace(/^<(\w+)/, `<$1 ${name}="${value}"`);
};

/** Puts the outline marks on the rows and columns ExcelJS wrote: the levels,
 *  the collapsed marks (and only those), and the sheet's maximum levels.
 *  Rows and columns that carry a mark must already exist in the part. */
export function patchOutline(sheetXml: string, o: SheetOutlineXml): string {
  let xml = sheetXml.replace(/<row\b[^>]*>/g, (tag) => {
    const r = Number(attr(tag, "r")) - 1;
    const mark = o.rows.get(r);
    let t = setAttr(tag, "collapsed", mark?.collapsed ? "1" : null);
    t = setAttr(t, "outlineLevel", mark?.level ? String(mark.level) : null);
    return t;
  });

  // Columns: split <col min max> runs so each column carries its own marks,
  // then join neighbours that ended up identical again.
  xml = xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_all, inner: string) => {
    const each: { c: number; tag: string }[] = [];
    for (const m of inner.matchAll(/<col\b[^>]*\/>/g)) {
      const min = Number(attr(m[0], "min"));
      const max = Number(attr(m[0], "max")) || min;
      if (max - min > 2048) {
        each.push({ c: min, tag: m[0] }); // a whole-sheet run: leave it alone
        continue;
      }
      for (let c = min; c <= max; c++) {
        const mark = o.cols.get(c - 1);
        let t = setAttr(setAttr(m[0], "min", String(c)), "max", String(c));
        t = setAttr(t, "collapsed", mark?.collapsed ? "1" : null);
        t = setAttr(t, "outlineLevel", mark?.level ? String(mark.level) : null);
        each.push({ c, tag: t });
      }
    }
    const out: string[] = [];
    let run: { min: number; max: number; body: string } | null = null;
    const bodyOf = (tag: string) => setAttr(setAttr(tag, "min", null), "max", null);
    const flush = () => run && out.push(setAttr(setAttr(run.body, "max", String(run.max)), "min", String(run.min)));
    for (const { c, tag } of each.sort((a, b) => a.c - b.c)) {
      const max = Number(attr(tag, "max")) || c;
      const body = bodyOf(tag);
      if (run && run.max + 1 === c && run.body === body && max === c) {
        run.max = c;
        continue;
      }
      flush();
      run = { min: c, max, body };
    }
    flush();
    return `<cols>${out.join("")}</cols>`;
  });

  const rowMax = Math.max(0, ...[...o.rows.values()].map((m) => m.level));
  const colMax = Math.max(0, ...[...o.cols.values()].map((m) => m.level));
  xml = xml.replace(/<sheetFormatPr\b[^>]*?\/?>/, (tag) => {
    const selfClosing = tag.endsWith("/>");
    let t = tag.replace(/\/?>$/, "");
    t = setAttr(`${t}>`, "outlineLevelRow", rowMax ? String(rowMax) : null).replace(/>$/, "");
    t = setAttr(`${t}>`, "outlineLevelCol", colMax ? String(colMax) : null).replace(/>$/, "");
    return t + (selfClosing ? "/>" : ">");
  });

  if (!o.summaryBelow || !o.summaryRight) {
    const pr = `<outlinePr${o.summaryBelow ? "" : ' summaryBelow="0"'}${o.summaryRight ? "" : ' summaryRight="0"'}/>`;
    if (/<outlinePr\b[^>]*\/>/.test(xml)) xml = xml.replace(/<outlinePr\b[^>]*\/>/, pr);
    else if (/<sheetPr\b[^>]*\/>/.test(xml)) xml = xml.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${pr}</sheetPr>`);
    else if (/<sheetPr\b[^>]*>/.test(xml))
      // outlinePr follows tabColor and comes before pageSetUpPr.
      xml = /<tabColor\b[^>]*\/>/.test(xml) ? xml.replace(/(<tabColor\b[^>]*\/>)/, `$1${pr}`) : xml.replace(/(<sheetPr\b[^>]*>)/, `$1${pr}`);
    else xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${pr}</sheetPr>`);
  }
  return xml;
}

// ---- Sheet protection ----
// <sheetProtection> switches protection on (its attributes carry Excel's
// password hash and which actions stay allowed); <protectedRanges> lists the
// "allow edit ranges" users may still change on a protected sheet.
export type ProtectedRangeXml = { name: string; sqref: string; attrs: Record<string, string> };
export type SheetProtectionXml = { attrs: Record<string, string> | null; ranges: ProtectedRangeXml[] };

const attrsOf = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = xmlDecode(m[2]);
  return out;
};

export function readSheetProtection(sheetXml: string): SheetProtectionXml {
  const tag = /<sheetProtection\b[^>]*\/?>/.exec(sheetXml)?.[0];
  let attrs: Record<string, string> | null = null;
  if (tag) {
    const a = attrsOf(tag);
    // sheet="0" (or no sheet attribute) leaves the sheet unprotected.
    if (/^(1|true)$/i.test(a.sheet || "")) attrs = a;
  }
  const ranges: ProtectedRangeXml[] = [];
  for (const m of sheetXml.matchAll(/<protectedRange\b[^>]*?(?:\/>|>[\s\S]*?<\/protectedRange>)/g)) {
    const open = /<protectedRange\b[^>]*>/.exec(m[0])?.[0] || m[0];
    const a = attrsOf(open);
    if (!a.sqref) continue;
    const { name = "", sqref, ...rest } = a;
    ranges.push({ name, sqref, attrs: rest });
  }
  return { attrs, ranges };
}

const tagWith = (name: string, attrs: Record<string, string>) =>
  `<${name}${Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`)
    .join("")}/>`;

/** Rewrites the sheet's protection elements; null attrs removes protection. */
export function patchSheetProtection(sheetXml: string, p: SheetProtectionXml): string {
  let xml = sheetXml.replace(/<sheetProtection\b[^>]*\/>/g, "").replace(/<sheetProtection\b[^>]*>[\s\S]*?<\/sheetProtection>/g, "");
  xml = xml.replace(/<protectedRanges>[\s\S]*?<\/protectedRanges>/g, "");
  let insert = "";
  if (p.attrs) insert += tagWith("sheetProtection", { ...p.attrs, sheet: "1" });
  if (p.ranges.length) insert += `<protectedRanges>${p.ranges.map((r) => tagWith("protectedRange", { ...r.attrs, sqref: r.sqref, name: r.name })).join("")}</protectedRanges>`;
  if (!insert) return xml;
  // Schema order: sheetData, sheetCalcPr, sheetProtection, protectedRanges, ...
  const after = /<sheetCalcPr\b[^>]*\/>/.exec(xml) || /<\/sheetData>/.exec(xml) || /<sheetData\s*\/>/.exec(xml);
  if (!after) return xml;
  const at = after.index + after[0].length;
  return xml.slice(0, at) + insert + xml.slice(at);
}
