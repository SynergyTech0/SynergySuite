// Parts of an .xlsx/.xlsm we don't edit but must not lose: the VBA project
// of a macro-enabled workbook (kept byte for byte, never run), the code names
// its modules use for the workbook and sheets, and custom XML parts (Power
// Query keeps its queries in one). Our own scripts travel in a custom XML
// part of their own. Pivot tables over external data or the Data Model are
// kept too (see lib/xlsx-kept-pivots.ts).
import { readKeptPivots, writeKeptPivots, type KeptPivotSources } from "./xlsx-kept-pivots.ts";

export const KEPT_RESOURCE = "SHEET_SYNERGY_KEPT_PARTS";
export const SCRIPT_RESOURCE = "SHEET_SYNERGY_SCRIPT_PLUGIN";

export type KeptParts = {
  /** xl/vbaProject.bin, base64, and its signature parts when signed. */
  vba?: { project: string; signatures: { name: string; type: string; contentType: string; data: string }[] };
  /** Code names VBA uses: the workbook's, and each sheet's by sheet id. */
  codeNames?: { workbook?: string; sheets: Record<string, string> };
  /** Other programs' custom XML items (base64), with their properties part. */
  customXml?: { item: string; props?: string }[];
  /** Pivot tables over external data or the Data Model, with what they stand on. */
  pivots?: KeptPivotSources;
};

export type Script = { id: string; name: string; code: string };

type Zip = {
  file: { (path: string): { async(type: "string" | "base64"): Promise<string> } | null; (path: string, data: string, options?: { base64?: boolean }): unknown };
  files: Record<string, unknown>;
  remove?: (path: string) => unknown;
};

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = {
  vba: "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
  customXml: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
  customXmlProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps",
};
const CT = {
  macroMain: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
  main: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  vba: "application/vnd.ms-office.vbaProject",
  customXmlProps: "application/vnd.openxmlformats-officedocument.customXmlProperties+xml",
};
const SCRIPTS_NS = "urn:synergy:scripts";

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
const addRel = (rels: string, type: string, target: string): string => {
  const base = rels || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
  const n = Math.max(0, ...[...base.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  return base.replace("</Relationships>", `<Relationship Id="rId${n}" Type="${type}" Target="${target}"/></Relationships>`);
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const fromBase64 = (b: string) => (typeof atob === "function" ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, "base64").toString("utf8"));
const toBase64 = (s: string) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"));

/** Reads what must be kept, and our scripts, from an imported package. */
export async function readKept(zip: Zip, sheetParts: { path: string; sheetId: string }[]): Promise<{ kept: KeptParts | null; scripts: Script[] }> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const b64 = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("base64") : "");
  const kept: KeptParts = {};
  const scripts: Script[] = [];
  const wbRels = relList(await read("xl/_rels/workbook.xml.rels"));
  const vbaRel = wbRels.find((r) => r.type === REL.vba);
  if (vbaRel) {
    const path = resolve("xl/workbook.xml", vbaRel.target);
    const project = await b64(path);
    if (project) {
      const types = await read("[Content_Types].xml");
      const signatures: NonNullable<KeptParts["vba"]>["signatures"] = [];
      for (const r of relList(await read(relsOf(path)))) {
        const sigPath = resolve(path, r.target);
        const data = await b64(sigPath);
        const contentType = new RegExp(`PartName="/${sigPath.replace(/[.]/g, "\\.")}" ContentType="([^"]+)"`).exec(types)?.[1] || "application/vnd.ms-office.vbaProjectSignature";
        if (data) signatures.push({ name: sigPath.split("/").pop()!, type: r.type, contentType, data });
      }
      kept.vba = { project, signatures };
    }
  }
  const wbXml = await read("xl/workbook.xml");
  const wbCode = /<workbookPr\b[^>]*\bcodeName="([^"]*)"/.exec(wbXml)?.[1];
  const sheetCodes: Record<string, string> = {};
  for (const p of sheetParts) {
    const code = /<sheetPr\b[^>]*\bcodeName="([^"]*)"/.exec(await read(p.path))?.[1];
    if (code) sheetCodes[p.sheetId] = unesc(code);
  }
  if (wbCode || Object.keys(sheetCodes).length) kept.codeNames = { ...(wbCode ? { workbook: unesc(wbCode) } : {}), sheets: sheetCodes };
  for (const r of wbRels.filter((x) => x.type === REL.customXml)) {
    const path = resolve("xl/workbook.xml", r.target);
    const item = await b64(path);
    if (!item) continue;
    const text = await read(path);
    if (text.includes(SCRIPTS_NS)) {
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        const a = (n: string) => unesc(new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1] || "");
        scripts.push({ id: a("id") || `s-${scripts.length + 1}`, name: a("name") || `Script ${scripts.length + 1}`, code: fromBase64(m[2].trim()) });
      }
      continue;
    }
    const propsRel = relList(await read(relsOf(path))).find((x) => x.type === REL.customXmlProps);
    const props = propsRel ? await b64(resolve(path, propsRel.target)) : "";
    (kept.customXml ||= []).push({ item, ...(props ? { props } : {}) });
  }
  const pivots = await readKeptPivots(zip, sheetParts);
  if (pivots) kept.pivots = pivots;
  return { kept: kept.vba || kept.codeNames || kept.customXml || kept.pivots ? kept : null, scripts };
}

/** Puts the kept parts and our scripts back into an exported package. Returns whether it is now macro-enabled. */
export async function writeKept(zip: Zip, kept: KeptParts | null, scripts: Script[], sheetParts: { path: string; sheetId: string }[]): Promise<boolean> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  let types = await read("[Content_Types].xml");
  let wbRels = await read("xl/_rels/workbook.xml.rels");
  const override = (part: string, type: string) => {
    if (!types.includes(`PartName="/${part}"`)) types = types.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  };
  let macro = false;
  if (kept?.vba?.project) {
    macro = true;
    zip.file("xl/vbaProject.bin", kept.vba.project, { base64: true });
    override("xl/vbaProject.bin", CT.vba);
    wbRels = addRel(wbRels, REL.vba, "vbaProject.bin");
    let vbaRels = "";
    for (const s of kept.vba.signatures) {
      zip.file(`xl/${s.name}`, s.data, { base64: true });
      override(`xl/${s.name}`, s.contentType);
      vbaRels = addRel(vbaRels, s.type, s.name);
    }
    if (vbaRels) zip.file("xl/_rels/vbaProject.bin.rels", vbaRels);
    types = types.replace(`PartName="/xl/workbook.xml" ContentType="${CT.main}"`, `PartName="/xl/workbook.xml" ContentType="${CT.macroMain}"`);
  }
  if (kept?.codeNames) {
    const cn = kept.codeNames;
    if (cn.workbook) {
      let wb = await read("xl/workbook.xml");
      wb = /<workbookPr\b/.test(wb)
        ? wb.replace(/<workbookPr\b([^>]*?)(\s*\/?>)/, (_m, a: string, end: string) => `<workbookPr codeName="${esc(cn.workbook!)}"${a.replace(/\s*codeName="[^"]*"/, "")}${end}`)
        : wb.replace(/(<workbook\b[^>]*>(?:\s*<fileVersion\b[^>]*\/>)?)/, `$1<workbookPr codeName="${esc(cn.workbook)}"/>`);
      zip.file("xl/workbook.xml", wb);
    }
    for (const { path, sheetId } of sheetParts) {
      const code = cn.sheets[sheetId];
      if (!code) continue;
      let xml = await read(path);
      if (!xml) continue;
      xml = /<sheetPr\b/.test(xml)
        ? xml.replace(/<sheetPr\b([^>]*?)(\s*\/?>)/, (_m, a: string, end: string) => `<sheetPr codeName="${esc(code)}"${a.replace(/\s*codeName="[^"]*"/, "")}${end}`)
        : xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${esc(code)}"/>`);
      zip.file(path, xml);
    }
  }
  let n = Math.max(0, ...Object.keys(zip.files).map((p) => Number(/^customXml\/item(\d+)\.xml$/.exec(p)?.[1] || 0)));
  const addItem = (item: string, props?: string, base64 = true) => {
    n++;
    const itemPath = `customXml/item${n}.xml`;
    zip.file(itemPath, item, base64 ? { base64: true } : undefined);
    wbRels = addRel(wbRels, REL.customXml, `../${itemPath}`);
    if (props) {
      zip.file(`customXml/itemProps${n}.xml`, props, base64 ? { base64: true } : undefined);
      override(`customXml/itemProps${n}.xml`, CT.customXmlProps);
      zip.file(`customXml/_rels/item${n}.xml.rels`, addRel("", REL.customXmlProps, `itemProps${n}.xml`));
    }
  };
  for (const c of kept?.customXml || []) addItem(c.item, c.props);
  if (scripts.length) {
    const body = scripts.map((s) => `<script id="${esc(s.id)}" name="${esc(s.name)}">${toBase64(s.code)}</script>`).join("");
    const guid = `{${"5C1A7E2B-3D4F-4A6B-8C9D-0E1F2A3B4C5D"}}`;
    addItem(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<scripts xmlns="${SCRIPTS_NS}">${body}</scripts>`,
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="${guid}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${SCRIPTS_NS}"/></ds:schemaRefs></ds:datastoreItem>`,
      false,
    );
  }
  zip.file("xl/_rels/workbook.xml.rels", wbRels);
  zip.file("[Content_Types].xml", types);
  if (kept?.pivots) await writeKeptPivots(zip, kept.pivots, sheetParts);
  return macro;
}
