// Slicers on pivot tables as Excel's own slicers (Excel 2010 and later): a
// slicer cache tied to the pivot table and its pivot cache, the slicer part
// on the sheet, and a drawing anchor where it sits. Excel then shows working
// slicer buttons. Our own copy of each slicer still travels as hidden names
// (see lib/xlsx.ts), which is what this app reads back.
import { openPackage, xmlDecode, xmlEscape, type XlsxPackage } from "./xlsx-ooxml.ts";
import { appendDrawingAnchors, EMU_PER_PX, type ShapeAnchor } from "./sheet-shapes.ts";
import { compareKeys, keyText } from "./pivot.ts";

export type SlicerExport = {
  /** The sheet the slicer sits on (workbook order). */
  sheetIndex: number;
  caption: string;
  field: string;
  pivotName: string;
  /** Picked values (as keys), or null for all. */
  selected: string[] | null;
  columns?: number;
  anchor: ShapeAnchor;
  size: { width: number; height: number };
};

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const REL_SLICER_CACHE = "http://schemas.microsoft.com/office/2007/relationships/slicerCache";
const REL_SLICER = "http://schemas.microsoft.com/office/2007/relationships/slicer";
const CT_SLICER_CACHE = "application/vnd.ms-excel.slicerCache+xml";
const CT_SLICER = "application/vnd.ms-excel.slicer+xml";
const EXT_WB_SLICER_CACHES = "{BBE1A952-AA13-448e-AADC-164F8A28A991}";
const EXT_WS_SLICER_LIST = "{A8765BA9-456A-4dab-B4F3-ACF838C121DE}";
const EXT_PIVOT_CACHE = "{725AE2AE-9491-48be-B2B4-4EB974FC3084}";

const relsPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};
const EMPTY_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
function addRel(relsXml: string, type: string, target: string): { xml: string; id: string } {
  const xml = relsXml || EMPTY_RELS;
  const used = new Set([...xml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
  let n = used.size + 1;
  while (used.has(`rId${n}`)) n++;
  const id = `rId${n}`;
  return { xml: xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${xmlEscape(target)}"/></Relationships>`), id };
}
const relTargets = (xml: string) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({ type: /Type="([^"]*)"/.exec(m[0])?.[1] || "", target: /Target="([^"]*)"/.exec(m[0])?.[1] || "" }));
const addOverride = (ct: string, part: string, type: string) =>
  ct.includes(`PartName="/${part}"`) ? ct : ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);

/** Adds an <ext> to an element's <extLst> (made before the closing tag when missing). */
export function addExt(xml: string, closing: string, ext: string): string {
  const end = xml.lastIndexOf(`</${closing}>`);
  if (end < 0) return xml;
  const head = xml.slice(0, end);
  const lst = head.lastIndexOf("</extLst>");
  // Only the element's own extLst: the last thing before its closing tag.
  if (lst >= 0 && /^<\/extLst>\s*$/.test(head.slice(lst))) return head.slice(0, lst) + ext + head.slice(lst) + xml.slice(end);
  return `${head}<extLst>${ext}</extLst>${xml.slice(end)}`;
}

const slicerName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=\d)/, "_");

type PivotPart = { name: string; tablePath: string; cachePath: string; sheetIndex: number };

async function pivotParts(pkg: XlsxPackage): Promise<PivotPart[]> {
  const out: PivotPart[] = [];
  for (const sheet of pkg.sheets) {
    for (const r of relTargets(await pkg.read(relsPath(sheet.path)))) {
      if (!r.type.endsWith("/pivotTable")) continue;
      const tablePath = resolve(sheet.path, r.target);
      const xml = await pkg.read(tablePath);
      const name = /<pivotTableDefinition\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
      const cacheRel = relTargets(await pkg.read(relsPath(tablePath))).find((x) => x.type.endsWith("/pivotCacheDefinition"));
      if (name && cacheRel) out.push({ name, tablePath, cachePath: resolve(tablePath, cacheRel.target), sheetIndex: sheet.index });
    }
  }
  return out;
}

const sharedValues = (cacheXml: string, field: string): (string | number | null)[] | null => {
  for (const m of cacheXml.matchAll(/<cacheField\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/cacheField>/g)) {
    const name = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    if (name !== field) continue;
    const items = /<sharedItems\b[^>]*>([\s\S]*?)<\/sharedItems>/.exec(m[2])?.[1];
    if (items == null) return null;
    return [...items.matchAll(/<(s|n|m|b|d|e)\b(?:[^>]*\bv="([^"]*)")?[^>]*\/>/g)].map((x) => (x[1] === "m" ? null : x[1] === "n" ? Number(x[2]) : (x[2] ?? "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")));
  }
  return null;
};

/** Writes the slicers into an .xlsx that already holds their pivot tables. */
export async function addPivotSlicers(bytes: Uint8Array, slicers: SlicerExport[]): Promise<Uint8Array> {
  if (!slicers.length) return bytes;
  const pkg = await openPackage(bytes);
  const pivots = await pivotParts(pkg);
  let ct = await pkg.read("[Content_Types].xml");
  let wbRels = await pkg.read("xl/_rels/workbook.xml.rels");
  let workbookXml = pkg.workbookXml;
  const tabIds = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => /\bsheetId="(\d+)"/.exec(m[0])?.[1] || "1");
  const cacheIds = new Map<string, number>(); // pivot cache part -> x14 pivotCacheId
  const usedNames = new Set([...workbookXml.matchAll(/<definedName\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1].toLowerCase()));
  const cacheRels: string[] = [];
  const bySheet = new Map<number, { rid: string }[]>();
  const anchorsBySheet = new Map<number, ((id: number) => string)[]>();
  const shownNames = new Set<string>();
  let n = 0;
  for (const s of slicers) {
    const pivot = pivots.find((p) => p.name === s.pivotName);
    const sheet = pkg.sheets.find((x) => x.index === s.sheetIndex);
    if (!pivot || !sheet) continue;
    let cacheXml = await pkg.read(pivot.cachePath);
    const values = sharedValues(cacheXml, s.field);
    if (!values?.length) continue;
    n++;
    // The pivot cache gets an id slicers refer to.
    let pivotCacheId = cacheIds.get(pivot.cachePath);
    if (pivotCacheId == null) {
      pivotCacheId = cacheIds.size + 1;
      cacheIds.set(pivot.cachePath, pivotCacheId);
      cacheXml = addExt(cacheXml, "pivotCacheDefinition", `<ext uri="${EXT_PIVOT_CACHE}" xmlns:x14="${X14}"><x14:pivotCacheDefinition pivotCacheId="${pivotCacheId}"/></ext>`);
      pkg.zip.file(pivot.cachePath, cacheXml);
    }
    // Names: the cache is "Slicer_<field>" (a workbook name), the slicer its caption.
    let cacheName = `Slicer_${slicerName(s.field)}`;
    for (let k = 1; usedNames.has(cacheName.toLowerCase()); k++) cacheName = `Slicer_${slicerName(s.field)}${k}`;
    usedNames.add(cacheName.toLowerCase());
    let shown = s.caption || s.field;
    for (let k = 1; shownNames.has(shown.toLowerCase()); k++) shown = `${s.caption || s.field} ${k}`;
    shownNames.add(shown.toLowerCase());

    // Items in display order; x is the position in the cache's shared items.
    const picked = s.selected ? new Set(s.selected) : null;
    const order = values.map((v, x) => ({ x, key: keyText(v) })).sort((a, b) => compareKeys(a.key, b.key));
    const items = order.map((o) => `<i x="${o.x}"${!picked || picked.has(o.key) ? ' s="1"' : ""}/>`).join("");
    const cachePart = `xl/slicerCaches/slicerCache${n}.xml`;
    pkg.zip.file(
      cachePart,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}" name="${xmlEscape(cacheName)}" sourceName="${xmlEscape(s.field)}"><pivotTables><pivotTable tabId="${tabIds[pivot.sheetIndex] || 1}" name="${xmlEscape(pivot.name)}"/></pivotTables><data><tabular pivotCacheId="${pivotCacheId}"><items count="${order.length}">${items}</items></tabular></data></slicerCacheDefinition>`,
    );
    ct = addOverride(ct, cachePart, CT_SLICER_CACHE);
    const wr = addRel(wbRels, REL_SLICER_CACHE, `slicerCaches/slicerCache${n}.xml`);
    wbRels = wr.xml;
    cacheRels.push(wr.id);
    workbookXml = addDefinedName(workbookXml, cacheName);

    const slicerPart = `xl/slicers/slicer${n}.xml`;
    const cols = s.columns && s.columns > 1 ? ` columnCount="${s.columns}"` : "";
    pkg.zip.file(slicerPart, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}"><slicer name="${xmlEscape(shown)}" cache="${xmlEscape(cacheName)}" caption="${xmlEscape(s.caption || s.field)}"${cols} rowHeight="241300"/></slicers>`);
    ct = addOverride(ct, slicerPart, CT_SLICER);
    const sr = addRel(await pkg.read(relsPath(sheet.path)), REL_SLICER, `../slicers/slicer${n}.xml`);
    pkg.zip.file(relsPath(sheet.path), sr.xml);
    (bySheet.get(sheet.index) || bySheet.set(sheet.index, []).get(sheet.index)!).push({ rid: sr.id });
    (anchorsBySheet.get(sheet.index) || anchorsBySheet.set(sheet.index, []).get(sheet.index)!).push((id) => slicerAnchorXml(shown, s.anchor, s.size, id));
  }
  if (!n) return bytes;
  for (const [index, list] of bySheet) {
    const sheet = pkg.sheets.find((x) => x.index === index)!;
    let xml = await pkg.read(sheet.path);
    if (!/xmlns:r=/.test(xml.slice(0, xml.indexOf(">", xml.indexOf("<worksheet"))))) xml = xml.replace(/<worksheet\b/, `<worksheet xmlns:r="${RELNS}"`);
    xml = addExt(xml, "worksheet", `<ext uri="${EXT_WS_SLICER_LIST}" xmlns:x14="${X14}"><x14:slicerList>${list.map((x) => `<x14:slicer r:id="${x.rid}"/>`).join("")}</x14:slicerList></ext>`);
    pkg.zip.file(sheet.path, xml);
  }
  if (!/xmlns:r=/.test(workbookXml.slice(0, workbookXml.indexOf(">", workbookXml.indexOf("<workbook"))))) workbookXml = workbookXml.replace(/<workbook\b/, `<workbook xmlns:r="${RELNS}"`);
  workbookXml = addExt(workbookXml, "workbook", `<ext uri="${EXT_WB_SLICER_CACHES}" xmlns:x14="${X14}"><x14:slicerCaches>${cacheRels.map((id) => `<x14:slicerCache r:id="${id}"/>`).join("")}</x14:slicerCaches></ext>`);
  pkg.zip.file("xl/workbook.xml", workbookXml);
  pkg.zip.file("xl/_rels/workbook.xml.rels", wbRels);
  pkg.zip.file("[Content_Types].xml", ct);
  for (const [index, builds] of anchorsBySheet) {
    const sheet = pkg.sheets.find((x) => x.index === index)!;
    await appendDrawingAnchors(pkg.zip, sheet.path, (first) => builds.map((b, k) => b(first + k)).join(""));
  }
  return (await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })) as Uint8Array;
}

/** A workbook-level name that is #N/A, as Excel keeps for each slicer cache. */
function addDefinedName(workbookXml: string, name: string): string {
  const dn = `<definedName name="${xmlEscape(name)}">#N/A</definedName>`;
  if (/<definedNames>/.test(workbookXml)) return workbookXml.replace("<definedNames>", `<definedNames>${dn}`);
  if (/<definedNames\/>/.test(workbookXml)) return workbookXml.replace("<definedNames/>", `<definedNames>${dn}</definedNames>`);
  const after = /<(calcPr|oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/.exec(workbookXml);
  return after ? workbookXml.slice(0, after.index) + `<definedNames>${dn}</definedNames>` + workbookXml.slice(after.index) : workbookXml;
}

const marker = (tag: string, p: { column: number; columnOffset: number; row: number; rowOffset: number }) =>
  `<xdr:${tag}><xdr:col>${p.column}</xdr:col><xdr:colOff>${Math.round(p.columnOffset * EMU_PER_PX)}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${Math.round(p.rowOffset * EMU_PER_PX)}</xdr:rowOff></xdr:${tag}>`;

export function slicerAnchorXml(name: string, anchor: ShapeAnchor, size: { width: number; height: number }, id: number): string {
  const cx = Math.round(size.width * EMU_PER_PX);
  const cy = Math.round(size.height * EMU_PER_PX);
  const frame = `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer"><sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="${xmlEscape(name)}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  const fallback = `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This shape represents a slicer. Slicers are supported in Excel 2010 or later.</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
  return `<xdr:twoCellAnchor editAs="oneCell">${marker("from", anchor.from)}${marker("to", anchor.to)}<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${frame}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>`;
}

export type ReadSlicer = { name: string; caption: string; field: string; pivotName: string; selected: string[] | null; columns?: number; from: ShapeAnchor["from"]; to: ShapeAnchor["to"] | null };

/** Excel's pivot table slicers in a package (for files made in Excel). */
export async function readPivotSlicers(pkgOrBytes: XlsxPackage | Uint8Array): Promise<(ReadSlicer & { sheetIndex: number })[]> {
  const pkg = pkgOrBytes instanceof Uint8Array ? await openPackage(pkgOrBytes) : pkgOrBytes;
  const wbRels = relTargets(await pkg.read("xl/_rels/workbook.xml.rels"));
  const pivots = await pivotParts(pkg);
  const caches = new Map<string, { field: string; pivotName: string; selected: string[] | null }>();
  for (const r of wbRels.filter((x) => x.type === REL_SLICER_CACHE)) {
    const xml = await pkg.read(resolve("xl/workbook.xml", r.target));
    const head = /<slicerCacheDefinition\b[^>]*>/.exec(xml)?.[0] || "";
    const name = /\bname="([^"]*)"/.exec(head)?.[1];
    const field = /\bsourceName="([^"]*)"/.exec(head)?.[1];
    const pivotName = /<pivotTable\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
    const tab = /<tabular\b[^>]*>([\s\S]*?)<\/tabular>/.exec(xml)?.[1] || "";
    const pivot = pivots.find((p) => p.name === pivotName);
    if (!name || !field || !pivotName || !pivot) continue;
    const values = sharedValues(await pkg.read(pivot.cachePath), field) || [];
    const items = [...tab.matchAll(/<i\b[^>]*>/g)].map((m) => ({ x: Number(/\bx="(\d+)"/.exec(m[0])?.[1]), s: /\bs="1"/.test(m[0]) }));
    const keys = items.filter((i) => i.s && i.x < values.length).map((i) => keyText(values[i.x]));
    caches.set(name, { field, pivotName, selected: items.length && keys.length < items.length ? keys : null });
  }
  if (!caches.size) return [];
  const out: (ReadSlicer & { sheetIndex: number })[] = [];
  for (const sheet of pkg.sheets) {
    const rels = relTargets(await pkg.read(relsPath(sheet.path)));
    const anchors = new Map<string, { from: ShapeAnchor["from"]; to: ShapeAnchor["to"] | null }>();
    const drawingRel = rels.find((r) => r.type.endsWith("/drawing"));
    if (drawingRel) {
      const dxml = await pkg.read(resolve(sheet.path, drawingRel.target));
      for (const m of dxml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
        const name = /<(?:\w+:)?slicer\b[^>]*\bname="([^"]*)"/.exec(m[2])?.[1];
        if (!name) continue;
        const pt = (tag: string) => {
          const x = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(m[2])?.[1];
          if (!x) return null;
          const v = (t: string) => Number(new RegExp(`<(?:\\w+:)?${t}>(-?\\d+)<`).exec(x)?.[1] || 0);
          return { column: v("col"), columnOffset: Math.round(v("colOff") / EMU_PER_PX), row: v("row"), rowOffset: Math.round(v("rowOff") / EMU_PER_PX) };
        };
        const from = pt("from");
        if (from) anchors.set(name, { from, to: pt("to") });
      }
    }
    for (const r of rels.filter((x) => x.type === REL_SLICER)) {
      const xml = await pkg.read(resolve(sheet.path, r.target));
      for (const m of xml.matchAll(/<slicer\b[^>]*\/?>/g)) {
        const at = (a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(m[0])?.[1];
        const name = at("name");
        const c = caches.get(at("cache") || "");
        const place = name ? anchors.get(name) : undefined;
        if (!name || !c || !place) continue;
        const cols = Number(at("columnCount"));
        out.push({ sheetIndex: sheet.index, name, caption: at("caption") || c.field, field: c.field, pivotName: c.pivotName, selected: c.selected, ...(cols > 1 ? { columns: cols } : {}), from: place.from, to: place.to });
      }
    }
  }
  return out;
}

// ---- Table slicers and timelines (Excel 2013 and later) -------------------------

const X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const EXT_TABLE_SLICER_CACHE = "{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}";
const EXT_WB_TABLE_SLICER_CACHES = "{46BE6895-7355-4a93-B00E-2C351335B9C9}";
const EXT_WS_TABLE_SLICER_LIST = "{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}";
const EXT_WB_TIMELINE_CACHES = "{D0CA8CA8-9F24-4464-BF8E-62219DCF47F9}";
const EXT_WS_TIMELINES = "{7E03D99C-DC04-49d9-9315-930204A7B6E9}";
const REL_TIMELINE_CACHE = "http://schemas.microsoft.com/office/2011/relationships/timelineCache";
const REL_TIMELINE = "http://schemas.microsoft.com/office/2011/relationships/timeline";
const CT_TIMELINE_CACHE = "application/vnd.ms-excel.timelineCache+xml";
const CT_TIMELINE = "application/vnd.ms-excel.timeline+xml";
const LEVELS = ["years", "quarters", "months", "days"] as const;

export type TableSlicerExport = Omit<SlicerExport, "pivotName" | "selected"> & { tableName: string };
export type TimelineExport = Omit<SlicerExport, "selected" | "columns"> & { level: (typeof LEVELS)[number]; bounds: { start: string; end: string } | null };

type TablePart = { name: string; id: string; columns: string[] };
async function tableParts(pkg: XlsxPackage): Promise<TablePart[]> {
  const out: TablePart[] = [];
  for (const path of Object.keys(pkg.zip.files).filter((p: string) => /^xl\/tables\/[^/]+\.xml$/.test(p))) {
    const xml = await pkg.read(path);
    const head = /<table\b[^>]*>/.exec(xml)?.[0] || "";
    const name = /\b(?:displayName|name)="([^"]*)"/.exec(head)?.[1];
    const id = /\bid="(\d+)"/.exec(head)?.[1];
    if (!name || !id) continue;
    const columns = [...xml.matchAll(/<tableColumn\b[^>]*\bname="([^"]*)"/g)].map((m) => xmlDecode(m[1]));
    out.push({ name: xmlDecode(name), id, columns });
  }
  return out;
}

/**
 * Writes slicers on Excel tables and timelines on pivot tables as Excel's own
 * (into an .xlsx that already holds the tables, pivot tables and any pivot
 * slicers). Excel shows a table slicer's picks through the table's filter; a
 * timeline comes in showing all periods.
 */
export async function addTableSlicersAndTimelines(bytes: Uint8Array, slicers: TableSlicerExport[], timelines: TimelineExport[]): Promise<Uint8Array> {
  if (!slicers.length && !timelines.length) return bytes;
  const pkg = await openPackage(bytes);
  const tables = await tableParts(pkg);
  const pivots = await pivotParts(pkg);
  let ct = await pkg.read("[Content_Types].xml");
  let wbRels = await pkg.read("xl/_rels/workbook.xml.rels");
  let workbookXml = pkg.workbookXml;
  const tabIds = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => /\bsheetId="(\d+)"/.exec(m[0])?.[1] || "1");
  const usedNames = new Set([...workbookXml.matchAll(/<definedName\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1].toLowerCase()));
  const uniqueName = (base: string) => {
    let name = base;
    for (let k = 1; usedNames.has(name.toLowerCase()); k++) name = `${base}${k}`;
    usedNames.add(name.toLowerCase());
    return name;
  };
  const nextPart = (prefix: string) => {
    let k = 1;
    while (pkg.zip.file(`${prefix}${k}.xml`)) k++;
    return `${prefix}${k}.xml`;
  };
  const shown = new Set<string>();
  const shownName = (base: string) => {
    let s = base;
    for (let k = 1; shown.has(s.toLowerCase()); k++) s = `${base} ${k}`;
    shown.add(s.toLowerCase());
    return s;
  };
  const wbSlicerCaches: string[] = [];
  const wbTimelineCaches: string[] = [];
  const sheetSlicers = new Map<number, string[]>();
  const sheetTimelines = new Map<number, string[]>();
  const anchors = new Map<number, ((id: number) => string)[]>();
  const push = <T>(m: Map<number, T[]>, k: number, v: T) => (m.get(k) || m.set(k, []).get(k)!).push(v);

  for (const s of slicers) {
    const table = tables.find((t) => t.name.toLowerCase() === s.tableName.toLowerCase());
    const sheet = pkg.sheets.find((x) => x.index === s.sheetIndex);
    const column = table ? table.columns.findIndex((c) => c === s.field) + 1 : 0;
    if (!table || !sheet || column < 1) continue;
    const cacheName = uniqueName(`Slicer_${slicerName(s.field)}`);
    const name = shownName(s.caption || s.field);
    const cachePart = nextPart("xl/slicerCaches/slicerCache");
    pkg.zip.file(
      cachePart,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}" name="${xmlEscape(cacheName)}" sourceName="${xmlEscape(s.field)}"><extLst><x:ext uri="${EXT_TABLE_SLICER_CACHE}" xmlns:x15="${X15}"><x15:tableSlicerCache tableId="${table.id}" column="${column}"/></x:ext></extLst></slicerCacheDefinition>`,
    );
    ct = addOverride(ct, cachePart, CT_SLICER_CACHE);
    const wr = addRel(wbRels, REL_SLICER_CACHE, cachePart.replace(/^xl\//, ""));
    wbRels = wr.xml;
    wbSlicerCaches.push(wr.id);
    workbookXml = addDefinedName(workbookXml, cacheName);
    const slicerPart = nextPart("xl/slicers/slicer");
    const cols = s.columns && s.columns > 1 ? ` columnCount="${s.columns}"` : "";
    pkg.zip.file(slicerPart, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}"><slicer name="${xmlEscape(name)}" cache="${xmlEscape(cacheName)}" caption="${xmlEscape(s.caption || s.field)}"${cols} rowHeight="241300"/></slicers>`);
    ct = addOverride(ct, slicerPart, CT_SLICER);
    const sr = addRel(await pkg.read(relsPath(sheet.path)), REL_SLICER, `../slicers/${slicerPart.split("/").at(-1)}`);
    pkg.zip.file(relsPath(sheet.path), sr.xml);
    push(sheetSlicers, sheet.index, sr.id);
    push(anchors, sheet.index, (id: number) => slicerAnchorXml(name, s.anchor, s.size, id));
  }

  const cacheIds = new Map<string, number>();
  for (const t of timelines) {
    const pivot = pivots.find((p) => p.name === t.pivotName);
    const sheet = pkg.sheets.find((x) => x.index === t.sheetIndex);
    if (!pivot || !sheet) continue;
    // The pivot cache needs an id (it may have one already, for slicers).
    let cacheXml = await pkg.read(pivot.cachePath);
    let pivotCacheId = Number(/<x14:pivotCacheDefinition\b[^>]*\bpivotCacheId="(\d+)"/.exec(cacheXml)?.[1]) || cacheIds.get(pivot.cachePath);
    if (!pivotCacheId) {
      const taken = await Promise.all(pivots.map(async (p) => Number(/pivotCacheId="(\d+)"/.exec(await pkg.read(p.cachePath))?.[1]) || 0));
      pivotCacheId = Math.max(0, ...taken, ...cacheIds.values()) + 1;
      cacheIds.set(pivot.cachePath, pivotCacheId);
      cacheXml = addExt(cacheXml, "pivotCacheDefinition", `<ext uri="${EXT_PIVOT_CACHE}" xmlns:x14="${X14}"><x14:pivotCacheDefinition pivotCacheId="${pivotCacheId}"/></ext>`);
      pkg.zip.file(pivot.cachePath, cacheXml);
    }
    const cacheName = uniqueName(`NativeTimeline_${slicerName(t.field)}`);
    const name = shownName(t.caption || t.field);
    const cachePart = nextPart("xl/timelineCaches/timelineCache");
    const bounds = t.bounds ? `<bounds startDate="${t.bounds.start}" endDate="${t.bounds.end}"/>` : "";
    pkg.zip.file(
      cachePart,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<timelineCacheDefinition xmlns="${X15}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}" name="${xmlEscape(cacheName)}" sourceName="${xmlEscape(t.field)}"><pivotTables><pivotTable tabId="${tabIds[pivot.sheetIndex] || 1}" name="${xmlEscape(pivot.name)}"/></pivotTables><state minimalRefreshVersion="6" lastRefreshVersion="6" pivotCacheId="${pivotCacheId}" filterType="unknown">${bounds}</state></timelineCacheDefinition>`,
    );
    ct = addOverride(ct, cachePart, CT_TIMELINE_CACHE);
    const wr = addRel(wbRels, REL_TIMELINE_CACHE, cachePart.replace(/^xl\//, ""));
    wbRels = wr.xml;
    wbTimelineCaches.push(wr.id);
    workbookXml = addDefinedName(workbookXml, cacheName);
    const level = Math.max(0, LEVELS.indexOf(t.level));
    const part = nextPart("xl/timelines/timeline");
    pkg.zip.file(part, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<timelines xmlns="${X15}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="${MAIN}"><timeline name="${xmlEscape(name)}" cache="${xmlEscape(cacheName)}" caption="${xmlEscape(t.caption || t.field)}" level="${level}" selectionLevel="${level}"${t.bounds ? ` scrollPosition="${t.bounds.start}"` : ""}/></timelines>`);
    ct = addOverride(ct, part, CT_TIMELINE);
    const sr = addRel(await pkg.read(relsPath(sheet.path)), REL_TIMELINE, `../timelines/${part.split("/").at(-1)}`);
    pkg.zip.file(relsPath(sheet.path), sr.xml);
    push(sheetTimelines, sheet.index, sr.id);
    push(anchors, sheet.index, (id: number) => timelineAnchorXml(name, t.anchor, t.size, id));
  }
  if (!wbSlicerCaches.length && !wbTimelineCaches.length) return bytes;

  for (const sheet of pkg.sheets) {
    const sl = sheetSlicers.get(sheet.index);
    const tl = sheetTimelines.get(sheet.index);
    if (!sl && !tl) continue;
    let xml = await pkg.read(sheet.path);
    if (!/xmlns:r=/.test(xml.slice(0, xml.indexOf(">", xml.indexOf("<worksheet"))))) xml = xml.replace(/<worksheet\b/, `<worksheet xmlns:r="${RELNS}"`);
    if (sl) xml = addExt(xml, "worksheet", `<ext uri="${EXT_WS_TABLE_SLICER_LIST}" xmlns:x15="${X15}"><x14:slicerList xmlns:x14="${X14}">${sl.map((id) => `<x14:slicer r:id="${id}"/>`).join("")}</x14:slicerList></ext>`);
    if (tl) xml = addExt(xml, "worksheet", `<ext uri="${EXT_WS_TIMELINES}" xmlns:x15="${X15}"><x15:timelineRefs>${tl.map((id) => `<x15:timelineRef r:id="${id}"/>`).join("")}</x15:timelineRefs></ext>`);
    pkg.zip.file(sheet.path, xml);
  }
  if (!/xmlns:r=/.test(workbookXml.slice(0, workbookXml.indexOf(">", workbookXml.indexOf("<workbook"))))) workbookXml = workbookXml.replace(/<workbook\b/, `<workbook xmlns:r="${RELNS}"`);
  if (wbSlicerCaches.length) workbookXml = addExt(workbookXml, "workbook", `<ext uri="${EXT_WB_TABLE_SLICER_CACHES}" xmlns:x15="${X15}"><x15:slicerCaches xmlns:x14="${X14}">${wbSlicerCaches.map((id) => `<x14:slicerCache r:id="${id}"/>`).join("")}</x15:slicerCaches></ext>`);
  if (wbTimelineCaches.length) workbookXml = addExt(workbookXml, "workbook", `<ext uri="${EXT_WB_TIMELINE_CACHES}" xmlns:x15="${X15}"><x15:timelineCacheRefs>${wbTimelineCaches.map((id) => `<x15:timelineCacheRef r:id="${id}"/>`).join("")}</x15:timelineCacheRefs></ext>`);
  pkg.zip.file("xl/workbook.xml", workbookXml);
  pkg.zip.file("xl/_rels/workbook.xml.rels", wbRels);
  pkg.zip.file("[Content_Types].xml", ct);
  for (const [index, builds] of anchors) {
    const sheet = pkg.sheets.find((x) => x.index === index)!;
    await appendDrawingAnchors(pkg.zip, sheet.path, (first) => builds.map((b, k) => b(first + k)).join(""));
  }
  return (await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })) as Uint8Array;
}

export function timelineAnchorXml(name: string, anchor: ShapeAnchor, size: { width: number; height: number }, id: number): string {
  const cx = Math.round(size.width * EMU_PER_PX);
  const cy = Math.round(size.height * EMU_PER_PX);
  const frame = `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xmlEscape(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2012/timeslicer"><tsle:timeslicer xmlns:tsle="http://schemas.microsoft.com/office/drawing/2012/timeslicer" name="${xmlEscape(name)}"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
  const fallback = `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>Timeline: works in Excel 2013 or later. Do not move or resize.</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
  return `<xdr:twoCellAnchor editAs="oneCell">${marker("from", anchor.from)}${marker("to", anchor.to)}<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:tsle="http://schemas.microsoft.com/office/drawing/2012/timeslicer" Requires="tsle">${frame}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>`;
}

export type ReadTableSlicer = Omit<ReadSlicer, "pivotName" | "selected"> & { tableName: string; sheetIndex: number };
export type ReadTimeline = Omit<ReadSlicer, "selected" | "columns"> & { level: (typeof LEVELS)[number]; sheetIndex: number };

/** Excel's own table slicers and timelines in a package (for files made in Excel). */
export async function readTableSlicersAndTimelines(pkgOrBytes: XlsxPackage | Uint8Array): Promise<{ slicers: ReadTableSlicer[]; timelines: ReadTimeline[] }> {
  const pkg = pkgOrBytes instanceof Uint8Array ? await openPackage(pkgOrBytes) : pkgOrBytes;
  const wbRels = relTargets(await pkg.read("xl/_rels/workbook.xml.rels"));
  const tables = await tableParts(pkg);
  const caches = new Map<string, { field: string; tableName?: string; pivotName?: string }>();
  for (const r of wbRels.filter((x) => x.type === REL_SLICER_CACHE || x.type === REL_TIMELINE_CACHE)) {
    const xml = await pkg.read(resolve("xl/workbook.xml", r.target));
    const head = /<(?:\w+:)?(?:slicerCacheDefinition|timelineCacheDefinition)\b[^>]*>/.exec(xml)?.[0] || "";
    const name = /\bname="([^"]*)"/.exec(head)?.[1];
    const field = /\bsourceName="([^"]*)"/.exec(head)?.[1];
    if (!name || !field) continue;
    const ts = /<(?:\w+:)?tableSlicerCache\b[^>]*>/.exec(xml)?.[0];
    if (ts) {
      const t = tables.find((x) => x.id === /\btableId="(\d+)"/.exec(ts)?.[1]);
      if (t) caches.set(name, { field: xmlDecode(field), tableName: t.name });
      continue;
    }
    if (r.type === REL_TIMELINE_CACHE) {
      const pivotName = /<(?:\w+:)?pivotTable\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
      if (pivotName) caches.set(name, { field: xmlDecode(field), pivotName: xmlDecode(pivotName) });
    }
  }
  const out = { slicers: [] as ReadTableSlicer[], timelines: [] as ReadTimeline[] };
  if (!caches.size) return out;
  for (const sheet of pkg.sheets) {
    const rels = relTargets(await pkg.read(relsPath(sheet.path)));
    const places = new Map<string, { from: ShapeAnchor["from"]; to: ShapeAnchor["to"] | null }>();
    const drawingRel = rels.find((r) => r.type.endsWith("/drawing"));
    if (drawingRel) {
      const dxml = await pkg.read(resolve(sheet.path, drawingRel.target));
      for (const m of dxml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
        const name = /<(?:\w+:)?(?:slicer|timeslicer)\b[^>]*\bname="([^"]*)"/.exec(m[2])?.[1];
        if (!name) continue;
        const pt = (tag: string) => {
          const x = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(m[2])?.[1];
          if (!x) return null;
          const v = (t: string) => Number(new RegExp(`<(?:\\w+:)?${t}>(-?\\d+)<`).exec(x)?.[1] || 0);
          return { column: v("col"), columnOffset: Math.round(v("colOff") / EMU_PER_PX), row: v("row"), rowOffset: Math.round(v("rowOff") / EMU_PER_PX) };
        };
        const from = pt("from");
        if (from) places.set(name, { from, to: pt("to") });
      }
    }
    for (const r of rels.filter((x) => x.type === REL_SLICER || x.type === REL_TIMELINE)) {
      const xml = await pkg.read(resolve(sheet.path, r.target));
      for (const m of xml.matchAll(/<(?:\w+:)?(slicer|timeline)\b[^>]*\/?>/g)) {
        const at = (a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(m[0])?.[1];
        const name = at("name");
        const c = caches.get(at("cache") || "");
        const place = name ? places.get(name) : undefined;
        if (!name || !c || !place) continue;
        const caption = xmlDecode(at("caption") || c.field);
        if (m[1] === "slicer" && c.tableName) {
          const cols = Number(at("columnCount"));
          out.slicers.push({ sheetIndex: sheet.index, name: xmlDecode(name), caption, field: c.field, tableName: c.tableName, ...(cols > 1 ? { columns: cols } : {}), from: place.from, to: place.to });
        } else if (m[1] === "timeline" && c.pivotName) {
          out.timelines.push({ sheetIndex: sheet.index, name: xmlDecode(name), caption, field: c.field, pivotName: c.pivotName, level: LEVELS[Number(at("level"))] || "months", from: place.from, to: place.to });
        }
      }
    }
  }
  return out;
}
