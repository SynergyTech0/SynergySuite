// Pivot tables in .xlsx as real Excel pivot tables: a pivot cache (definition
// plus records) for the source range and a pivot table definition on the
// output sheet. The cache asks Excel to refresh on open, so Excel lays the
// table out itself; the computed cells we wrote stay in the sheet for programs
// that don't refresh. Reading does the reverse: an Excel pivot table becomes
// our pivot definition, ready to refresh.
import { openPackage, xmlDecode, xmlEscape, type XlsxPackage } from "./xlsx-ooxml.ts";
import { fieldNames, keyText, type PivotAgg, type PivotDef, type PivotRange } from "./pivot.ts";
import * as XLSX from "xlsx";
import { asDate } from "./slicers.ts";

export type PivotExport = {
  def: PivotDef;
  /** The source block, header row first. */
  table: unknown[][];
  sourceSheetName: string;
  targetSheetIndex: number;
  /** Fields a slicer filters: their items are listed in the cache (Excel's slicers point at them). */
  slicerFields?: string[];
  /** Fields a timeline filters: their cache field holds dates (Excel's timelines need one). */
  dateFields?: string[];
};

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = {
  cache: `${RELNS}/pivotCacheDefinition`,
  records: `${RELNS}/pivotCacheRecords`,
  table: `${RELNS}/pivotTable`,
};
const CT = {
  cache: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml",
  records: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml",
  table: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml",
};
const SUBTOTAL: Record<PivotAgg, string> = { sum: "sum", count: "count", average: "average", min: "min", max: "max" };

const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const ref = (g: PivotRange) => `${addr(g.startRow, g.startColumn)}:${addr(g.endRow, g.endColumn)}`;
const relsPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const resolvePath = (base: string, target: string) => {
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
const addOverride = (ct: string, part: string, type: string) =>
  ct.includes(`PartName="/${part}"`) ? ct : ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);

type Cell = { kind: "s"; v: string } | { kind: "n"; v: number } | { kind: "d"; v: string } | { kind: "m" };
const dateCell = (v: unknown): Cell => {
  const d = asDate(v);
  return d ? { kind: "d", v: d.toISOString().slice(0, 19) } : cellOf(v);
};
const cellOf = (v: unknown): Cell => {
  if (v == null || v === "") return { kind: "m" };
  if (typeof v === "number" && Number.isFinite(v)) return { kind: "n", v };
  if (typeof v === "boolean") return { kind: "s", v: v ? "TRUE" : "FALSE" };
  return { kind: "s", v: String(v) };
};
const itemXml = (c: Cell) => (c.kind === "m" ? "<m/>" : c.kind === "n" ? `<n v="${c.v}"/>` : c.kind === "d" ? `<d v="${c.v}"/>` : `<s v="${xmlEscape(c.v)}"/>`);
const cellKey = (c: Cell) => (c.kind === "m" ? "m" : `${c.kind}:${c.v}`);

function sharedItemsAttrs(cells: Cell[]): string {
  const dates = cells.filter((c): c is { kind: "d"; v: string } => c.kind === "d").map((c) => c.v).sort();
  if (dates.length) {
    const blank = cells.some((c) => c.kind === "m");
    const other = cells.some((c) => c.kind === "s" || c.kind === "n");
    return [other ? 'containsMixedTypes="1"' : 'containsSemiMixedTypes="0" containsNonDate="0"', 'containsDate="1"', other ? "" : 'containsString="0"', blank ? 'containsBlank="1"' : "", `minDate="${dates[0]}"`, `maxDate="${dates.at(-1)}"`].filter(Boolean).join(" ");
  }
  const hasStr = cells.some((c) => c.kind === "s");
  const hasBlank = cells.some((c) => c.kind === "m");
  const nums = cells.filter((c): c is { kind: "n"; v: number } => c.kind === "n").map((c) => c.v);
  const a: string[] = [];
  if (!hasStr && !hasBlank) a.push('containsSemiMixedTypes="0"');
  if (!hasStr) a.push('containsString="0"');
  if (nums.length) {
    if (hasStr) a.push('containsMixedTypes="1"');
    a.push('containsNumber="1"');
    if (nums.every(Number.isInteger)) a.push('containsInteger="1"');
    a.push(`minValue="${Math.min(...nums)}"`, `maxValue="${Math.max(...nums)}"`);
  }
  if (hasBlank) a.push('containsBlank="1"');
  return a.join(" ");
}

/** Insert <pivotCaches> where CT_Workbook wants it (after calcPr and friends). */
function addPivotCaches(workbookXml: string, entries: { cacheId: number; rid: string }[]): string {
  let xml = workbookXml;
  if (!/xmlns:r="/.test(xml)) xml = xml.replace(/<workbook\b/, `<workbook xmlns:r="${RELNS}"`);
  const inner = entries.map((e) => `<pivotCache cacheId="${e.cacheId}" r:id="${e.rid}"/>`).join("");
  if (/<pivotCaches>/.test(xml)) return xml.replace("</pivotCaches>", `${inner}</pivotCaches>`);
  const before = /<(smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/.exec(xml);
  if (!before) return xml;
  return xml.slice(0, before.index) + `<pivotCaches>${inner}</pivotCaches>` + xml.slice(before.index);
}

export async function addPivotTables(bytes: Uint8Array, pivots: PivotExport[]): Promise<Uint8Array> {
  const usable = pivots.filter((p) => p.table.length >= 1 && (p.def.rows.length || p.def.columns.length || p.def.values.length));
  if (!usable.length) return bytes;
  const pkg = await openPackage(bytes);
  let ct = await pkg.read("[Content_Types].xml");
  let wbRels = await pkg.read("xl/_rels/workbook.xml.rels");
  const caches: { cacheId: number; rid: string }[] = [];
  const firstCacheId = 1 + Math.max(0, ...[...pkg.workbookXml.matchAll(/cacheId="(\d+)"/g)].map((m) => Number(m[1])));

  for (const [n0, p] of usable.entries()) {
    const n = n0 + 1;
    const { def } = p;
    const names = fieldNames(p.table[0] || []);
    const rows = p.table.slice(1);
    const width = names.length;
    const dated = new Set(p.dateFields || []);
    const columns: Cell[][] = names.map((name, j) => rows.map((r) => (dated.has(name) ? dateCell(r[j]) : cellOf(r[j]))));
    const index = (field: string) => names.indexOf(field);
    const axisFields = new Set([...def.rows, ...def.columns, ...def.filters.map((f) => f.field)].map(index).filter((i) => i >= 0));
    const listed = new Set([...axisFields, ...(p.slicerFields || []).map(index).filter((i) => i >= 0)]);
    const values = def.values.filter((v) => index(v.field) >= 0);

    // Shared items: listed for fields on an axis (the table refers to them by
    // position), summarized for the rest.
    const shared = columns.map((cells, j) => {
      if (!listed.has(j)) return null;
      const seen = new Map<string, number>();
      const items: Cell[] = [];
      for (const c of cells)
        if (!seen.has(cellKey(c))) {
          seen.set(cellKey(c), items.length);
          items.push(c);
        }
      return { items, at: seen };
    });
    const cacheFields = names
      .map((name, j) => {
        const s = shared[j];
        const attrs = sharedItemsAttrs(columns[j]);
        const body = s ? `<sharedItems${attrs ? ` ${attrs}` : ""} count="${s.items.length}">${s.items.map(itemXml).join("")}</sharedItems>` : `<sharedItems${attrs ? ` ${attrs}` : ""}/>`;
        return `<cacheField name="${xmlEscape(name)}" numFmtId="${columns[j].some((c) => c.kind === "d") ? 14 : 0}">${body}</cacheField>`;
      })
      .join("");
    const cachePath = `xl/pivotCache/pivotCacheDefinition${n}.xml`;
    const recordsPath = `xl/pivotCache/pivotCacheRecords${n}.xml`;
    const src = def.source.range;
    const sourceRef = ref({ startRow: src.startRow, endRow: src.startRow + p.table.length - 1, startColumn: src.startColumn, endColumn: src.startColumn + width - 1 });
    pkg.zip.file(
      cachePath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="${MAIN}" xmlns:r="${RELNS}" r:id="rId1" refreshOnLoad="1" refreshedBy="SynergyDocs" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${rows.length}"><cacheSource type="worksheet"><worksheetSource ref="${sourceRef}" sheet="${xmlEscape(p.sourceSheetName)}"/></cacheSource><cacheFields count="${width}">${cacheFields}</cacheFields></pivotCacheDefinition>`,
    );
    pkg.zip.file(relsPath(cachePath), addRel("", REL.records, `pivotCacheRecords${n}.xml`).xml);
    const records = rows
      .map((r, i) => `<r>${names.map((_, j) => (shared[j] ? `<x v="${shared[j]!.at.get(cellKey(columns[j][i]))}"/>` : itemXml(columns[j][i]))).join("")}</r>`)
      .join("");
    pkg.zip.file(recordsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${MAIN}" xmlns:r="${RELNS}" count="${rows.length}">${records}</pivotCacheRecords>`);
    ct = addOverride(addOverride(ct, cachePath, CT.cache), recordsPath, CT.records);
    const cacheRel = addRel(wbRels, REL.cache, `pivotCache/pivotCacheDefinition${n}.xml`);
    wbRels = cacheRel.xml;
    const cacheId = firstCacheId + n0;
    caches.push({ cacheId, rid: cacheRel.id });

    // The table. Excel puts report filters above the table, so leave room.
    // A filter on a row or column field is its hidden items; others are report filters.
    const pageFilters = def.filters.filter((f) => !def.rows.includes(f.field) && !def.columns.includes(f.field));
    const pageRows = pageFilters.length ? pageFilters.length + 1 : 0;
    const top = Math.max(def.target.row, pageRows);
    const size = def.lastSize || { rows: 2, columns: 2 };
    const location = ref({ startRow: top, endRow: top + Math.max(1, size.rows) - 1, startColumn: def.target.column, endColumn: def.target.column + Math.max(1, size.columns) - 1 });
    const subtotals = def.subtotals !== false;
    const pivotFields = names
      .map((_, j) => {
        const axis = def.rows.includes(names[j]) ? "axisRow" : def.columns.includes(names[j]) ? "axisCol" : def.filters.some((f) => f.field === names[j]) ? "axisPage" : null;
        const isData = values.some((v) => index(v.field) === j);
        const attrs = [axis ? `axis="${axis}"` : "", isData ? 'dataField="1"' : "", 'showAll="0"', subtotals || !axis ? "" : 'defaultSubtotal="0"'].filter(Boolean).join(" ");
        if (!axis && !shared[j]) return `<pivotField ${attrs}/>`;
        const hidden = new Set(def.filters.find((f) => f.field === names[j])?.exclude || []);
        const items = shared[j]!.items.map((c, x) => `<item x="${x}"${hidden.has(keyText(c.kind === "m" ? null : c.v)) ? ' h="1"' : ""}/>`);
        if (subtotals) items.push('<item t="default"/>');
        return `<pivotField ${attrs}><items count="${items.length}">${items.join("")}</items></pivotField>`;
      })
      .join("");
    const fieldList = (list: number[]) => list.map((x) => `<field x="${x}"/>`).join("");
    const rowIdx = def.rows.map(index).filter((i) => i >= 0);
    const colIdx = def.columns.map(index).filter((i) => i >= 0);
    // Several value fields line up as a "Values" pseudo-field (-2) in the columns.
    if (values.length > 1) colIdx.push(-2);
    const pageIdx = pageFilters.map((f) => index(f.field)).filter((i) => i >= 0);
    const grand = def.grandTotals !== false;
    const tablePath = `xl/pivotTables/pivotTable${n}.xml`;
    const table = [
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="${MAIN}" name="${xmlEscape(def.name)}" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0"${grand ? "" : ' rowGrandTotals="0" colGrandTotals="0"'}>`,
      `<location ref="${location}" firstHeaderRow="1" firstDataRow="${colIdx.length ? 2 : 1}" firstDataCol="1"${pageIdx.length ? ` rowPageCount="${pageIdx.length}" colPageCount="1"` : ""}/>`,
      `<pivotFields count="${width}">${pivotFields}</pivotFields>`,
      rowIdx.length ? `<rowFields count="${rowIdx.length}">${fieldList(rowIdx)}</rowFields>` : "",
      colIdx.length ? `<colFields count="${colIdx.length}">${fieldList(colIdx)}</colFields>` : "",
      pageIdx.length ? `<pageFields count="${pageIdx.length}">${pageIdx.map((x) => `<pageField fld="${x}" hier="-1"/>`).join("")}</pageFields>` : "",
      values.length
        ? `<dataFields count="${values.length}">${values.map((v) => `<dataField name="${xmlEscape(`${{ sum: "Sum", count: "Count", average: "Average", min: "Min", max: "Max" }[v.agg]} of ${v.field}`)}" fld="${index(v.field)}" subtotal="${SUBTOTAL[v.agg]}" baseField="0" baseItem="0"/>`).join("")}</dataFields>`
        : "",
      `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/>`,
      `</pivotTableDefinition>`,
    ].join("");
    pkg.zip.file(tablePath, table);
    pkg.zip.file(relsPath(tablePath), addRel("", REL.cache, `../pivotCache/pivotCacheDefinition${n}.xml`).xml);
    ct = addOverride(ct, tablePath, CT.table);
    const sheet = pkg.sheets.find((s) => s.index === p.targetSheetIndex);
    if (sheet) {
      const sr = relsPath(sheet.path);
      pkg.zip.file(sr, addRel(await pkg.read(sr), REL.table, `../pivotTables/pivotTable${n}.xml`).xml);
    }
  }
  pkg.zip.file("xl/workbook.xml", addPivotCaches(pkg.workbookXml, caches));
  pkg.zip.file("xl/_rels/workbook.xml.rels", wbRels);
  pkg.zip.file("[Content_Types].xml", ct);
  return (await pkg.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })) as Uint8Array;
}

// ---- Reading ----------------------------------------------------------------

const attrIn = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? xmlDecode(m[1]) : undefined;
};
const AGG_FROM: Record<string, PivotAgg> = { sum: "sum", count: "count", countNums: "count", average: "average", min: "min", max: "max" };
function parseArea(text: string): PivotRange | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(text.trim());
  if (!m) return null;
  const s = XLSX.utils.decode_cell(`${m[1]}${m[2]}`.toUpperCase());
  const e = m[3] ? XLSX.utils.decode_cell(`${m[3]}${m[4]}`.toUpperCase()) : s;
  return { startRow: Math.min(s.r, e.r), endRow: Math.max(s.r, e.r), startColumn: Math.min(s.c, e.c), endColumn: Math.max(s.c, e.c) };
}

/** Excel pivot tables as our definitions. `sheetIdOf` maps a sheet name or
 *  index to the imported sheet id. */
export async function readPivotTables(pkgOrBytes: XlsxPackage | Uint8Array, sheetIdOf: (nameOrIndex: string | number) => string | undefined): Promise<PivotDef[]> {
  const pkg = pkgOrBytes instanceof Uint8Array ? await openPackage(pkgOrBytes) : pkgOrBytes;
  const out: PivotDef[] = [];
  // A source given by name: an Excel table, or a defined name.
  const named = new Map<string, { sheet: string | number; range: PivotRange }>();
  for (const sheet of pkg.sheets)
    for (const r of (await pkg.read(relsPath(sheet.path))).matchAll(/<Relationship\b[^>]*>/g)) {
      if (attrIn(r[0], "Type") !== `${RELNS}/table`) continue;
      const head = /<table\b[^>]*>/.exec(await pkg.read(resolvePath(sheet.path, attrIn(r[0], "Target") || "")))?.[0] || "";
      const range = parseArea(attrIn(head, "ref") || "");
      for (const n of [attrIn(head, "name"), attrIn(head, "displayName")]) if (n && range) named.set(n.toLowerCase(), { sheet: sheet.index, range });
    }
  for (const m of pkg.workbookXml.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)) {
    const ref = /^'?((?:[^'!]|'')+)'?!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)$/.exec(xmlDecode(m[2]).trim());
    const name = attrIn(`<x ${m[1]}>`, "name");
    const range = ref && parseArea(ref[2]);
    if (name && ref && range && !named.has(name.toLowerCase())) named.set(name.toLowerCase(), { sheet: ref[1].replace(/''/g, "'"), range });
  }
  for (const sheet of pkg.sheets) {
    const sheetRels = await pkg.read(relsPath(sheet.path));
    for (const r of sheetRels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attrIn(r[0], "Type") !== REL.table) continue;
      const tablePath = resolvePath(sheet.path, attrIn(r[0], "Target") || "");
      const xml = await pkg.read(tablePath);
      const cacheRel = [...(await pkg.read(relsPath(tablePath))).matchAll(/<Relationship\b[^>]*>/g)].find((m) => attrIn(m[0], "Type") === REL.cache);
      if (!xml || !cacheRel) continue;
      const cachePath = resolvePath(tablePath, attrIn(cacheRel[0], "Target") || "");
      const cache = await pkg.read(cachePath);
      const ws = /<worksheetSource\b[^>]*>/.exec(cache)?.[0];
      const byName = ws && !attrIn(ws, "ref") ? named.get((attrIn(ws, "name") || "").toLowerCase()) : undefined;
      const srcRange = byName ? byName.range : ws && parseArea(attrIn(ws, "ref") || "");
      const srcSheet = byName ? sheetIdOf(byName.sheet) : ws && sheetIdOf(attrIn(ws, "sheet") || "");
      const targetSheet = sheetIdOf(sheet.index);
      const loc = /<location\b[^>]*>/.exec(xml)?.[0];
      const area = loc && parseArea(attrIn(loc, "ref") || "");
      if (!srcRange || !srcSheet || !targetSheet || !area) continue; // e.g. a named-range or external source
      const fields = [...cache.matchAll(/<cacheField\b[^>]*?(?:\/>|>([\s\S]*?)<\/cacheField>)/g)].map((m) => ({
        name: attrIn(m[0], "name") || "",
        items: [...(m[1] || "").matchAll(/<(s|n|b|d|e|m)\b[^>]*?(?:\/>|>)/g)].map((it) => (it[1] === "m" ? null : attrIn(it[0], "v") ?? null)),
      }));
      const pivotFields = [...xml.matchAll(/<pivotField\b[^>]*?(?:\/>|>([\s\S]*?)<\/pivotField>)/g)].map((m) => ({ tag: m[0], inner: m[1] || "" }));
      const list = (tagName: string, attr: string) =>
        [...(new RegExp(`<${tagName}s\\b[^>]*>([\\s\\S]*?)</${tagName}s>`).exec(xml)?.[1] || "").matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "g"))].map((m) => Number(attrIn(m[0], attr)));
      const nameOf = (x: number) => fields[x]?.name;
      const rowFields = [...(/<rowFields\b[^>]*>([\s\S]*?)<\/rowFields>/.exec(xml)?.[1] || "").matchAll(/<field\b[^>]*>/g)].map((m) => Number(attrIn(m[0], "x"))).filter((x) => x >= 0);
      const colFields = [...(/<colFields\b[^>]*>([\s\S]*?)<\/colFields>/.exec(xml)?.[1] || "").matchAll(/<field\b[^>]*>/g)].map((m) => Number(attrIn(m[0], "x"))).filter((x) => x >= 0);
      const pageFields = list("pageField", "fld");
      const dataFields = [...(/<dataFields\b[^>]*>([\s\S]*?)<\/dataFields>/.exec(xml)?.[1] || "").matchAll(/<dataField\b[^>]*>/g)].map((m) => ({
        field: nameOf(Number(attrIn(m[0], "fld"))),
        agg: AGG_FROM[attrIn(m[0], "subtotal") || "sum"] || "sum",
      }));
      const hiddenOf = (x: number) =>
        [...(pivotFields[x]?.inner || "").matchAll(/<item\b[^>]*>/g)]
          .filter((m) => attrIn(m[0], "h") === "1" && attrIn(m[0], "x") != null)
          .map((m) => keyText(fields[x]?.items[Number(attrIn(m[0], "x"))] ?? null));
      const name = attrIn(/<pivotTableDefinition\b[^>]*>/.exec(xml)?.[0] || "", "name") || `Pivot ${out.length + 1}`;
      const top = /<pivotTableDefinition\b[^>]*>/.exec(xml)?.[0] || "";
      const anySubtotals = pivotFields.some((f) => /\baxis="/.test(f.tag) && attrIn(f.tag, "defaultSubtotal") !== "0");
      out.push({
        id: `xlsx-pivot-${out.length + 1}`,
        name,
        source: { sheetId: srcSheet, range: srcRange },
        target: { sheetId: targetSheet, row: area.startRow, column: area.startColumn },
        rows: rowFields.map(nameOf).filter((x): x is string => !!x),
        columns: colFields.map(nameOf).filter((x): x is string => !!x),
        values: dataFields.filter((d): d is { field: string; agg: PivotAgg } => !!d.field),
        filters: [...pageFields, ...rowFields, ...colFields.filter((x) => x >= 0)]
          .map((x) => ({ field: nameOf(x) || "", exclude: hiddenOf(x) }))
          .filter((f, i) => f.field && (i < pageFields.length || f.exclude.length)),
        ...(attrIn(top, "rowGrandTotals") === "0" && attrIn(top, "colGrandTotals") === "0" ? { grandTotals: false } : {}),
        ...(rowFields.length && !anySubtotals ? { subtotals: false } : {}),
        lastSize: { rows: area.endRow - area.startRow + 1, columns: area.endColumn - area.startColumn + 1 },
      });
    }
  }
  return out;
}
