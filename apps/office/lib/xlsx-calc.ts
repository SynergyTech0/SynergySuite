// Calculation in .xlsx: dynamic-array formulas (the formula sits in the top
// left cell, Excel marks it with cell metadata, and the spilled cells hold
// their last values) and the workbook's iterative calculation settings.

/** Workbook calculation settings, as Excel's File > Options > Formulas has them. */
export type CalcSettings = {
  /** Let circular references calculate, going round up to `maxIterations` times. */
  iterate: boolean;
  maxIterations: number;
  /** Stop going round once no result changes by more than this. */
  maxChange: number;
};

export const CALC_RESOURCE = "SHEET_SYNERGY_CALC_SETTINGS";
export const DEFAULT_CALC: CalcSettings = { iterate: false, maxIterations: 100, maxChange: 0.001 };

export function calcSettings(o: unknown): CalcSettings {
  const x = (o && typeof o === "object" ? o : {}) as Partial<CalcSettings>;
  const n = Math.round(Number(x.maxIterations));
  const d = Number(x.maxChange);
  return {
    iterate: x.iterate === true,
    maxIterations: Number.isFinite(n) && n >= 1 ? Math.min(32767, n) : DEFAULT_CALC.maxIterations,
    maxChange: Number.isFinite(d) && d >= 0 ? d : DEFAULT_CALC.maxChange,
  };
}

/** One dynamic-array formula's spill: its anchor and the area it fills. */
export type Spill = { row: number; column: number; endRow: number; endColumn: number };
/** The spills on each sheet (by sheet id), with the values in the spilled cells. */
export type SpillInfo = Record<string, { spills: Spill[]; values: Record<number, Record<number, unknown>> }>;

const SHEET_METADATA_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml";
const SHEET_METADATA_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata";

/** Excel's cell metadata part that says "this array formula is a dynamic array". */
export const METADATA_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">' +
  '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>' +
  '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>' +
  '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';

/** Marks every array formula cell in a sheet part as a dynamic array (cm="1"). */
export function markDynamicArrays(sheetXml: string): string {
  return sheetXml.replace(/<c\b([^>]*)>(\s*<f\b[^>]*\bt="array")/g, (m, attrs: string, f: string) => (/\bcm="/.test(attrs) ? m : `<c${attrs} cm="1">${f}`));
}

/** Sets (or adds) the calcPr attributes for the settings in workbook.xml. */
export function patchCalcPr(workbookXml: string, calc: CalcSettings | null, fullCalcOnLoad: boolean): string {
  const attrs: Record<string, string> = {};
  if (calc?.iterate) {
    attrs.iterate = "1";
    attrs.iterateCount = String(calc.maxIterations);
    attrs.iterateDelta = String(calc.maxChange);
  }
  if (fullCalcOnLoad) attrs.fullCalcOnLoad = "1";
  if (!Object.keys(attrs).length) return workbookXml;
  const m = /<calcPr\b([^>]*?)\/?>/.exec(workbookXml);
  if (m) {
    let a = m[1];
    for (const [k, v] of Object.entries(attrs)) a = new RegExp(`\\b${k}="`).test(a) ? a.replace(new RegExp(`\\b${k}="[^"]*"`), `${k}="${v}"`) : `${a} ${k}="${v}"`;
    return workbookXml.replace(m[0], `<calcPr${a}/>`);
  }
  const el = `<calcPr calcId="191029"${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join("")}/>`;
  // CT_Workbook order: … definedNames, calcPr, oleSize, customWorkbookViews, pivotCaches, …
  const after = /<\/definedNames>|<definedNames\/>/.exec(workbookXml) || /<\/sheets>/.exec(workbookXml);
  return after ? workbookXml.replace(after[0], after[0] + el) : workbookXml;
}

/** Reads the iterative calculation settings from workbook.xml. */
export function readCalcPr(workbookXml: string): CalcSettings | null {
  const m = /<calcPr\b([^>]*?)\/?>/.exec(workbookXml);
  if (!m) return null;
  const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1];
  const iterate = attr("iterate");
  if (iterate !== "1" && iterate !== "true") return null;
  return calcSettings({ iterate: true, maxIterations: attr("iterateCount") ?? 100, maxChange: attr("iterateDelta") ?? 0.001 });
}

type Zip = {
  file: { (path: string): { async(type: "string"): Promise<string> } | null; (path: string, data: string): unknown };
};

/** Adds the dynamic-array metadata part (when any sheet has one) and the calcPr settings. */
export async function addCalcToZip(zip: Zip, o: { dynamicArrays: boolean; calc: CalcSettings | null }) {
  const wbPath = "xl/workbook.xml";
  const wbXml = await zip.file(wbPath)?.async("string");
  if (!wbXml) return;
  zip.file(wbPath, patchCalcPr(wbXml, o.calc, o.dynamicArrays));
  if (!o.dynamicArrays || zip.file("xl/metadata.xml")) return;
  zip.file("xl/metadata.xml", METADATA_XML);
  const ct = await zip.file("[Content_Types].xml")?.async("string");
  if (ct && !ct.includes('PartName="/xl/metadata.xml"'))
    zip.file("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/xl/metadata.xml" ContentType="${SHEET_METADATA_CT}"/></Types>`));
  const relsPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relsPath)?.async("string");
  if (rels && !rels.includes(SHEET_METADATA_REL)) {
    const n = Math.max(0, ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map((x) => Number(x[1]))) + 1;
    zip.file(relsPath, rels.replace("</Relationships>", `<Relationship Id="rId${n}" Type="${SHEET_METADATA_REL}" Target="metadata.xml"/></Relationships>`));
  }
}

/** Spill references (A1#) as Excel stores them: ANCHORARRAY(A1). */
export function spillRefsToAnchorArray(formula: string): string {
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)#/g, (_m, sheet: string | undefined, ref: string) => `ANCHORARRAY(${sheet || ""}${ref})`),
    )
    .join("");
}
