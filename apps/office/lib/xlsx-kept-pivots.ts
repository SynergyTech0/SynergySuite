// Pivot tables we can't rebuild in the browser (over an external database
// connection, an OLAP cube, or the workbook's Data Model from Power Pivot)
// are kept as Excel wrote them: the pivot table, its cache and records, the
// workbook connections nothing else here reads back, and the Data Model
// itself. Their last results stay in the cells; Excel refreshes them as usual.

export type KeptPivot = {
  /** The sheet the pivot table sits on. */
  sheetId: string;
  table: string;
  cache: string;
  records?: string;
  /** The name of the workbook connection its cache reads (connection ids are renumbered on save). */
  connection?: string;
};
export type KeptPivotSources = {
  pivots: KeptPivot[];
  /** The Data Model's <connection> elements (others come back with the queries, see lib/data-import.ts). */
  connections: string[];
  /** The Data Model part (base64) and how the workbook points at it. */
  model?: { path: string; type: string; contentType: string; data: string };
  /** Workbook <ext> elements the Data Model needs (x15:dataModel and the like). */
  workbookExts: string[];
};

type Zip = {
  file: { (path: string): { async(type: "string" | "base64"): Promise<string> } | null; (path: string, data: string, options?: { base64?: boolean }): unknown };
  files: Record<string, unknown>;
};

const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = {
  table: `${RELNS}/pivotTable`,
  cache: `${RELNS}/pivotCacheDefinition`,
  records: `${RELNS}/pivotCacheRecords`,
  connections: `${RELNS}/connections`,
};
const CT = {
  cache: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml",
  records: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml",
  table: "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml",
  connections: "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml",
};
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
// The workbook extension that lists the Data Model's tables (x15:dataModel).
const MODEL_EXT = "{FCE6A71B-6B00-49CD-AB44-F6B1AE7CDE65}";

const relsOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const resolve = (from: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};
const relList = (xml: string) =>
  [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
    id: /\bId="([^"]*)"/.exec(m[0])?.[1] || "",
    type: /\bType="([^"]*)"/.exec(m[0])?.[1] || "",
    target: /\bTarget="([^"]*)"/.exec(m[0])?.[1] || "",
  }));
const addRel = (rels: string, type: string, target: string): { xml: string; id: string } => {
  const base = rels || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const n = Math.max(0, ...[...base.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  return { xml: base.replace("</Relationships>", `<Relationship Id="rId${n}" Type="${type}" Target="${target}"/></Relationships>`), id: `rId${n}` };
};
// The same test lib/data-import.ts uses to leave a connection to the Data Model out.
const isModelConnection = (xml: string) => /\bmodel="1"|ThisWorkbookDataModel/.test(xml);
const sourceType = (cache: string) => /<cacheSource\b[^>]*\btype="([^"]*)"/.exec(cache)?.[1] || "worksheet";

/** The pivot tables (and what they stand on) that the pivot reader leaves out. */
export async function readKeptPivots(zip: Zip, sheetParts: { path: string; sheetId: string }[]): Promise<KeptPivotSources | null> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const out: KeptPivotSources = { pivots: [], connections: [], workbookExts: [] };
  const wbRels = relList(await read("xl/_rels/workbook.xml.rels"));
  const connRel = wbRels.find((x) => x.type === REL.connections);
  const connXml = connRel ? await read(resolve("xl/workbook.xml", connRel.target)) : "";
  const connections = [...connXml.matchAll(/<connection\b[^>]*?(?:\/>|>[\s\S]*?<\/connection>)/g)].map((m) => ({
    xml: m[0],
    id: /\bid="(\d+)"/.exec(m[0])?.[1] || "",
    name: /\bname="([^"]*)"/.exec(m[0])?.[1] || "",
  }));
  for (const sheet of sheetParts) {
    for (const r of relList(await read(relsOf(sheet.path))).filter((x) => x.type === REL.table)) {
      const tablePath = resolve(sheet.path, r.target);
      const table = await read(tablePath);
      const cacheRel = relList(await read(relsOf(tablePath))).find((x) => x.type === REL.cache);
      if (!table || !cacheRel) continue;
      const cachePath = resolve(tablePath, cacheRel.target);
      const cache = await read(cachePath);
      if (!cache || sourceType(cache) === "worksheet") continue;
      const recordsRel = relList(await read(relsOf(cachePath))).find((x) => x.type === REL.records);
      const records = recordsRel ? await read(resolve(cachePath, recordsRel.target)) : "";
      const connId = /<cacheSource\b[^>]*\bconnectionId="(\d+)"/.exec(cache)?.[1];
      const connection = connections.find((c) => c.id === connId)?.name;
      out.pivots.push({ sheetId: sheet.sheetId, table, cache, ...(records ? { records } : {}), ...(connection ? { connection } : {}) });
    }
  }
  // The Data Model (Power Pivot): one binary part the workbook points at.
  const modelRel = wbRels.find((x) => /(^|\/)model\//.test(x.target) || /powerPivotData$/i.test(x.type));
  if (modelRel) {
    const path = resolve("xl/workbook.xml", modelRel.target);
    const data = zip.file(path) ? await zip.file(path)!.async("base64") : "";
    const types = await read("[Content_Types].xml");
    const ext = path.split(".").pop() || "";
    const contentType =
      new RegExp(`PartName="/${path.replace(/[.]/g, "\\.")}" ContentType="([^"]+)"`).exec(types)?.[1] ||
      new RegExp(`Extension="${ext}" ContentType="([^"]+)"`, "i").exec(types)?.[1] ||
      "application/vnd.openxmlformats-officedocument.model+data";
    if (data) out.model = { path, type: modelRel.type, contentType, data };
  }
  // Its connections mean nothing without the model itself.
  if (out.model) for (const c of connections) if (isModelConnection(c.xml)) out.connections.push(c.xml);
  const wb = await read("xl/workbook.xml");
  for (const m of wb.matchAll(/<ext\b[^>]*\buri="([^"]*)"[^>]*>[\s\S]*?<\/ext>/g)) if (m[1] === MODEL_EXT || /<x15:dataModel\b/.test(m[0])) out.workbookExts.push(m[0]);
  return out.pivots.length || out.model || out.connections.length ? out : null;
}

/** Puts the kept pivot tables, connections and Data Model back into an exported package. */
export async function writeKeptPivots(zip: Zip, kept: KeptPivotSources, sheetParts: { path: string; sheetId: string }[]): Promise<void> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  let types = await read("[Content_Types].xml");
  let wbRels = await read("xl/_rels/workbook.xml.rels");
  let wb = await read("xl/workbook.xml");
  const override = (part: string, type: string) => {
    if (!types.includes(`PartName="/${part}"`)) types = types.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  };
  // The Data Model's connections, after the ones the queries wrote, renumbered.
  const rel = relList(wbRels).find((x) => x.type === REL.connections);
  const connPath = rel ? resolve("xl/workbook.xml", rel.target) : "xl/connections.xml";
  let connXml = await read(connPath);
  if (kept.connections.length) {
    connXml ||= `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="${MAIN}"></connections>`;
    let next = Math.max(0, ...[...connXml.matchAll(/<connection\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    for (const c of kept.connections) {
      const name = /\bname="([^"]*)"/.exec(c)?.[1];
      if (name && connXml.includes(` name="${name}"`)) continue;
      connXml = connXml.replace("</connections>", `${c.replace(/\bid="\d+"/, `id="${next++}"`)}</connections>`);
    }
    zip.file(connPath, connXml);
    override(connPath, CT.connections);
    if (!rel) wbRels = addRel(wbRels, REL.connections, "connections.xml").xml;
  }
  const connectionId = (name: string | undefined) => (name ? new RegExp(`<connection\\b[^>]*\\bid="(\\d+)"[^>]*\\bname="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).exec(connXml)?.[1] : undefined);
  if (kept.model) {
    zip.file(kept.model.path, kept.model.data, { base64: true });
    override(kept.model.path, kept.model.contentType);
    if (!relList(wbRels).some((x) => resolve("xl/workbook.xml", x.target) === kept.model!.path)) wbRels = addRel(wbRels, kept.model.type, kept.model.path.replace(/^xl\//, "")).xml;
  }
  if (kept.workbookExts.length) {
    const exts = kept.workbookExts.filter((e) => !wb.includes(/\buri="([^"]*)"/.exec(e)?.[1] || "\u0000")).join("");
    if (exts) wb = /<extLst>/.test(wb) ? wb.replace("</extLst>", `${exts}</extLst>`) : wb.replace("</workbook>", `<extLst>${exts}</extLst></workbook>`);
  }
  // Pivot tables: new part names and cache ids; the cache's connection renumbered.
  const free = (prefix: string) => {
    let k = 1;
    while (zip.file(`${prefix}${k}.xml`)) k++;
    return k;
  };
  let cacheId = Math.max(0, ...[...wb.matchAll(/<pivotCache\b[^>]*\bcacheId="(\d+)"/g)].map((m) => Number(m[1])));
  const entries: string[] = [];
  for (const p of kept.pivots) {
    const sheet = sheetParts.find((s) => s.sheetId === p.sheetId);
    if (!sheet) continue;
    cacheId++;
    const n = free("xl/pivotCache/pivotCacheDefinition");
    const cachePath = `xl/pivotCache/pivotCacheDefinition${n}.xml`;
    const conn = connectionId(p.connection);
    let cache = conn ? p.cache.replace(/(<cacheSource\b[^>]*\bconnectionId=")\d+"/, `$1${conn}"`) : p.cache;
    if (p.records) {
      const recordsPath = `xl/pivotCache/pivotCacheRecords${free("xl/pivotCache/pivotCacheRecords")}.xml`;
      zip.file(recordsPath, p.records);
      override(recordsPath, CT.records);
      zip.file(relsOf(cachePath), addRel("", REL.records, recordsPath.split("/").pop()!).xml);
      cache = /\br:id="[^"]*"/.test(/<pivotCacheDefinition\b[^>]*>/.exec(cache)?.[0] || "")
        ? cache.replace(/(<pivotCacheDefinition\b[^>]*?)\br:id="[^"]*"/, '$1r:id="rId1"')
        : cache.replace(/<pivotCacheDefinition\b/, `<pivotCacheDefinition xmlns:r="${RELNS}" r:id="rId1"`).replace(/xmlns:r="[^"]*"\s+xmlns:r="[^"]*"/, `xmlns:r="${RELNS}"`);
    } else cache = cache.replace(/(<pivotCacheDefinition\b[^>]*?)\s+r:id="[^"]*"/, "$1");
    zip.file(cachePath, cache);
    override(cachePath, CT.cache);
    const wr = addRel(wbRels, REL.cache, `pivotCache/pivotCacheDefinition${n}.xml`);
    wbRels = wr.xml;
    entries.push(`<pivotCache cacheId="${cacheId}" r:id="${wr.id}"/>`);
    const tablePath = `xl/pivotTables/pivotTable${free("xl/pivotTables/pivotTable")}.xml`;
    zip.file(tablePath, p.table.replace(/(<pivotTableDefinition\b[^>]*?\bcacheId=")\d+"/, `$1${cacheId}"`));
    override(tablePath, CT.table);
    zip.file(relsOf(tablePath), addRel("", REL.cache, `../pivotCache/pivotCacheDefinition${n}.xml`).xml);
    zip.file(relsOf(sheet.path), addRel(await read(relsOf(sheet.path)), REL.table, `../pivotTables/${tablePath.split("/").pop()}`).xml);
  }
  if (entries.length) {
    if (!/<workbook\b[^>]*xmlns:r=/.test(wb)) wb = wb.replace(/<workbook\b/, `<workbook xmlns:r="${RELNS}"`);
    if (/<pivotCaches>/.test(wb)) wb = wb.replace("</pivotCaches>", `${entries.join("")}</pivotCaches>`);
    else {
      const before = /<(smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/.exec(wb)!;
      wb = wb.slice(0, before.index) + `<pivotCaches>${entries.join("")}</pivotCaches>` + wb.slice(before.index);
    }
  }
  zip.file("xl/workbook.xml", wb);
  zip.file("xl/_rels/workbook.xml.rels", wbRels);
  zip.file("[Content_Types].xml", types);
}
