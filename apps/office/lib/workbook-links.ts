// Links to other workbooks: formulas like =[Budget]Plan!B2 or
// ='[Sales 2024]Q1'!A1:A9 read cells of another spreadsheet in the suite.
// Each link keeps the other workbook's values (so the formulas still work
// when it can't be opened), and an .xlsx keeps them the way Excel does: an
// external link part per workbook, with its sheet names and cached values,
// and formulas that name it by number ([1]Plan!B2).

export const LINKS_RESOURCE = "SHEET_SYNERGY_WORKBOOK_LINKS";

export type LinkCache = { sheets: { name: string; cells: Record<number, Record<number, string | number | boolean | null>> }[] };
export type WorkbookLink = {
  /** The name formulas use between the brackets. */
  name: string;
  /** The suite spreadsheet it points to (none for a link that came from an Excel file). */
  docId?: string;
  /** The other file's name, for a link from Excel (Budget.xlsx). */
  file?: string;
  title: string;
  /** When the values were last brought in (ms). */
  updated: number;
  cache: LinkCache;
};

const MAX_CACHE_CELLS = 50_000;

/** Splits a formula around its "string" literals; fn sees only the parts outside them. */
function outsideStrings(formula: string, fn: (s: string) => string): string {
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** The workbook names a formula refers to ([Budget]Plan!A1 → Budget). */
export function linkNamesIn(formula: string): string[] {
  const names = new Set<string>();
  outsideStrings(formula, (s) => {
    for (const m of s.matchAll(/\[([^\]\[]+)\](?='?[^!'\]]*'?!|[A-Za-z_])/g)) names.add(m[1]);
    return s;
  });
  return [...names];
}

/** A name a formula can use for a workbook title (no brackets or quotes). */
export function linkNameFor(title: string, taken: Iterable<string> = []): string {
  const base = title.replace(/[\[\]'!*?:/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Workbook";
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

/** The values of a workbook snapshot, to keep with a link. */
export function cacheOf(book: any, max = MAX_CACHE_CELLS): LinkCache {
  let left = max;
  const sheets: LinkCache["sheets"] = [];
  for (const id of book?.sheetOrder || []) {
    const s = book?.sheets?.[id];
    if (!s) continue;
    const cells: LinkCache["sheets"][number]["cells"] = {};
    for (const [r, row] of Object.entries((s.cellData || {}) as Record<string, Record<string, any>>))
      for (const [c, cell] of Object.entries(row || {})) {
        if (left <= 0) break;
        let v = cell?.v;
        if (v == null && cell?.p?.body?.dataStream) v = String(cell.p.body.dataStream).replace(/\r?\n$/, "").replace(/\r\n?$/, "");
        if (v == null || v === "") continue;
        (cells[Number(r)] ||= {})[Number(c)] = typeof v === "number" || typeof v === "boolean" ? v : String(v);
        left--;
      }
    sheets.push({ name: String(s.name), cells });
  }
  return { sheets };
}

/** The hidden workbook a link's formulas read: its values, under the link's name. */
export function unitFromCache(link: WorkbookLink) {
  const sheetOrder = link.cache.sheets.map((_, i) => `s${i}`);
  const sheets: Record<string, unknown> = {};
  link.cache.sheets.forEach((sh, i) => {
    const cellData: Record<number, Record<number, { v: unknown; t: number }>> = {};
    for (const [r, row] of Object.entries(sh.cells))
      for (const [c, v] of Object.entries(row)) (cellData[Number(r)] ||= {})[Number(c)] = { v: typeof v === "boolean" ? (v ? 1 : 0) : v, t: typeof v === "number" ? 2 : typeof v === "boolean" ? 3 : 1 };
    sheets[`s${i}`] = { id: `s${i}`, name: sh.name, cellData, rowCount: 1048576, columnCount: 16384 };
  });
  return { id: link.name, name: link.name, appVersion: "", locale: "enUS", sheetOrder, sheets, styles: {}, resources: [] };
}

// ---- .xlsx: external link parts ----

const quoteSheet = (s: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`);

/**
 * [Budget]Plan!A1 → [1]Plan!A1 (index by link name); names with no index
 * stay as they are.
 */
export function formulaLinksToExcel(formula: string, indexOf: (name: string) => number | undefined): string {
  return outsideStrings(formula, (s) =>
    s
      .replace(/'\[([^\]]+)\]((?:[^']|'')+)'!/g, (m, name: string, sheet: string) => {
        const i = indexOf(name);
        if (!i) return m;
        const plain = sheet.replace(/''/g, "'");
        return quoteSheet(plain) === plain ? `[${i}]${plain}!` : `'[${i}]${sheet}'!`;
      })
      .replace(/\[([^\]]+)\]([A-Za-z_][A-Za-z0-9_.]*)!/g, (m, name: string, sheet: string) => {
        const i = indexOf(name);
        return i ? `[${i}]${sheet}!` : m;
      }),
  );
}

/** [1]Plan!A1 → [Budget]Plan!A1 (name by Excel's link number). */
export function formulaLinksFromExcel(formula: string, nameOf: (index: number) => string | undefined): string {
  return outsideStrings(formula, (s) =>
    s
      .replace(/'\[(\d+)\]/g, (m, n: string) => {
        const name = nameOf(Number(n));
        return name ? `'[${name.replace(/'/g, "''")}]` : m;
      })
      .replace(/(?<!')\[(\d+)\]([A-Za-z_][A-Za-z0-9_.]*)!/g, (m, n: string, sheet: string) => {
        const name = nameOf(Number(n));
        if (!name) return m;
        // A name with spaces or other signs needs the quotes around it and the sheet.
        return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? `[${name}]${sheet}!` : `'[${name.replace(/'/g, "''")}]${sheet}'!`;
      }),
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function externalLinkXml(link: WorkbookLink): string {
  const names = link.cache.sheets.map((s) => `<sheetName val="${esc(s.name)}"/>`).join("");
  const data = link.cache.sheets
    .map((s, i) => {
      const rows = Object.keys(s.cells)
        .map(Number)
        .sort((a, b) => a - b)
        .map((r) => {
          const cells = Object.keys(s.cells[r])
            .map(Number)
            .sort((a, b) => a - b)
            .map((c) => {
              const v = s.cells[r][c];
              const ref = `${colName(c)}${r + 1}`;
              if (typeof v === "number") return `<cell r="${ref}"><v>${v}</v></cell>`;
              if (typeof v === "boolean") return `<cell r="${ref}" t="b"><v>${v ? 1 : 0}</v></cell>`;
              return `<cell r="${ref}" t="str"><v>${esc(String(v))}</v></cell>`;
            })
            .join("");
          return `<row r="${r + 1}">${cells}</row>`;
        })
        .join("");
      return `<sheetData sheetId="${i}">${rows}</sheetData>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<externalBook r:id="rId1"><sheetNames>${names}</sheetNames><sheetDataSet>${data}</sheetDataSet></externalBook></externalLink>`
  );
}

/** The other workbook's values from an external link part. */
export function readExternalLinkXml(xml: string): LinkCache {
  const names = [...xml.matchAll(/<sheetName\s+val="([^"]*)"/g)].map((m) => unesc(m[1]));
  const sheets: LinkCache["sheets"] = names.map((name) => ({ name, cells: {} }));
  for (const m of xml.matchAll(/<sheetData\b[^>]*\bsheetId="(\d+)"[^>]*>([\s\S]*?)<\/sheetData>/g)) {
    const sheet = sheets[Number(m[1])];
    if (!sheet) continue;
    for (const c of m[2].matchAll(/<cell\b([^>]*)>(?:\s*<v>([\s\S]*?)<\/v>)?/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(c[1]);
      if (!ref || c[2] === undefined) continue;
      const t = /\bt="([^"]*)"/.exec(c[1])?.[1];
      const raw = unesc(c[2]);
      const v = t === "b" ? raw === "1" : t === "str" || t === "s" || t === "e" || t === "inlineStr" ? raw : Number.isFinite(Number(raw)) ? Number(raw) : raw;
      (sheet.cells[Number(ref[2]) - 1] ||= {})[colIndex(ref[1])] = v;
    }
  }
  return { sheets };
}

type Zip = {
  file: { (path: string): { async(type: "string"): Promise<string> } | null; (path: string, data: string): unknown };
  files: Record<string, unknown>;
};

const REL_EXTERNAL_LINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink";
const REL_EXTERNAL_PATH = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath";
const CT_EXTERNAL_LINK = "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml";

/** The file name a link's .xlsx part points at. */
export const linkFileName = (link: WorkbookLink) => link.file || `${link.title.replace(/[\\/:*?"<>|]/g, " ").trim() || link.name}.xlsx`;

/** Writes external link parts for the links (in order: link 1, 2, …). */
export async function addExternalLinks(zip: Zip, links: WorkbookLink[]) {
  if (!links.length) return;
  const wbPath = "xl/workbook.xml";
  const relsPath = "xl/_rels/workbook.xml.rels";
  let wb = (await zip.file(wbPath)?.async("string")) || "";
  let rels = (await zip.file(relsPath)?.async("string")) || "";
  let ct = (await zip.file("[Content_Types].xml")?.async("string")) || "";
  const refs: string[] = [];
  links.forEach((link, i) => {
    const n = i + 1;
    zip.file(`xl/externalLinks/externalLink${n}.xml`, externalLinkXml(link));
    zip.file(
      `xl/externalLinks/_rels/externalLink${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_EXTERNAL_PATH}" Target="${esc(linkFileName(link))}" TargetMode="External"/></Relationships>`,
    );
    const id = `rIdLink${n}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${REL_EXTERNAL_LINK}" Target="externalLinks/externalLink${n}.xml"/></Relationships>`);
    ct = ct.replace("</Types>", `<Override PartName="/xl/externalLinks/externalLink${n}.xml" ContentType="${CT_EXTERNAL_LINK}"/></Types>`);
    refs.push(`<externalReference r:id="${id}"/>`);
  });
  // CT_Workbook order: … sheets, functionGroups, externalReferences, definedNames, calcPr …
  const block = `<externalReferences>${refs.join("")}</externalReferences>`;
  wb = /<functionGroups\b[^>]*\/>|<\/functionGroups>/.test(wb) ? wb.replace(/(<functionGroups\b[^>]*\/>|<\/functionGroups>)/, `$1${block}`) : wb.replace("</sheets>", `</sheets>${block}`);
  if (!/xmlns:r=/.test(wb.slice(0, wb.indexOf(">", wb.indexOf("<workbook")) + 1))) wb = wb.replace(/<workbook\b/, '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  zip.file(wbPath, wb);
  zip.file(relsPath, rels);
  zip.file("[Content_Types].xml", ct);
}

/** The external links of an .xlsx, by Excel's link number. */
export async function readExternalLinks(zip: Zip): Promise<{ index: number; file: string; cache: LinkCache }[]> {
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) || "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) || "";
  const ids = [...(/<externalReferences>([\s\S]*?)<\/externalReferences>/.exec(wb)?.[1] || "").matchAll(/r:id="([^"]+)"/g)].map((m) => m[1]);
  const out: { index: number; file: string; cache: LinkCache }[] = [];
  for (const [i, id] of ids.entries()) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${id}"`));
    const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1];
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const linkRels = (await zip.file(path.replace(/([^/]+)$/, "_rels/$1.rels"))?.async("string")) || "";
    const file = unesc(/\bTarget="([^"]+)"/.exec(linkRels)?.[1] || `Workbook${i + 1}.xlsx`);
    out.push({ index: i + 1, file: decodeURIComponent(file.split(/[\\/]/).pop() || file), cache: readExternalLinkXml(xml) });
  }
  return out;
}
