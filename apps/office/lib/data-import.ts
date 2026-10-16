// Get data (Power Query style): CSV, JSON or an HTML table, from a file or a
// web address, shaped by a few steps (skip rows, headers, choose columns,
// drop empty rows, then applied steps such as filter, sort, group and
// custom columns) and put into the sheet. A query remembers its source and
// steps, so Refresh fetches and shapes the data again. In .xlsx each query is
// a workbook connection (xl/connections.xml) with a query table on its sheet,
// the way Excel keeps web and text queries; the full definition rides along
// in the connection's extension list.

import { applyTransforms, type Transform } from "./query-transforms.ts";

export const QUERY_RESOURCE = "SHEET_SYNERGY_QUERY_PLUGIN";
export const SET_QUERIES_MUTATION = "sheet.mutation.set-queries";

export type Format = "csv" | "json" | "html";
export type QuerySteps = {
  /** Rows dropped from the top before anything else. */
  skipRows?: number;
  /** The first (remaining) row holds the column names. */
  headers: boolean;
  /** Columns to keep (by name when there are headers, else "Column1"...), in order; empty keeps all. */
  columns?: string[];
  removeEmptyRows?: boolean;
  /** CSV: the separator ("auto" detects it). */
  delimiter?: "auto" | "," | ";" | "\t" | "|";
  /** JSON: where the list sits, as a dotted path ("data.items"); empty for the top level. */
  jsonPath?: string;
  /** HTML: which table on the page (1 is the first). */
  table?: number;
  /** Applied steps after the above: filter, sort, rename, group and the rest (query-transforms.ts). */
  transforms?: Transform[];
};
export type QueryDef = {
  id: string;
  name: string;
  sheetId: string;
  /** Top-left cell of the data. */
  anchor: { row: number; column: number };
  source: { kind: "web"; url: string; format: Format } | { kind: "file"; fileName: string; format: Format };
  steps: QuerySteps;
  /** Size of the data last written (cleared on the next refresh). */
  size?: { rows: number; columns: number };
  refreshedAt?: string;
  /** A connection from another program we don't refresh, kept for the way back. */
  foreign?: { connection: string };
};

export type Grid = (string | number | boolean | null)[][];

// ---- Parsing --------------------------------------------------------------------

/** The separator a CSV most likely uses, from its first lines. */
export function detectDelimiter(text: string): "," | ";" | "\t" | "|" {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  let best: "," | ";" | "\t" | "|" = ",";
  let score = -1;
  for (const d of [",", ";", "\t", "|"] as const) {
    const n = splitCsv(sample, d).map((r) => r.length);
    const consistent = n.filter((x) => x === n[0]).length;
    const s = n[0] > 1 ? consistent * n[0] : 0;
    if (s > score) {
      score = s;
      best = d;
    }
  }
  return best;
}

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. */
function splitCsv(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const t = text.replace(/^﻿/, "");
  while (i < t.length) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === d) {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && t[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const parseCsv = (text: string, delimiter: QuerySteps["delimiter"] = "auto"): Grid => splitCsv(text, delimiter === "auto" || !delimiter ? detectDelimiter(text) : delimiter);

const flatten = (o: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> => {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || "Value"] = Array.isArray(o) ? JSON.stringify(o) : o;
  return out;
};

/** A JSON list (of objects, arrays or values) as a grid, with a header row for objects. */
export function parseJson(text: string, path = ""): Grid {
  let data: unknown = JSON.parse(text);
  for (const key of path.split(".").map((s) => s.trim()).filter(Boolean)) {
    if (data == null || typeof data !== "object") throw new Error(`There is nothing at "${path}" in the JSON.`);
    data = (data as Record<string, unknown>)[key];
  }
  if (!Array.isArray(data)) {
    // An object whose values are the list (or a single record).
    if (data && typeof data === "object") {
      const lists = Object.entries(data).filter(([, v]) => Array.isArray(v));
      if (!path && lists.length === 1) return parseJson(text, lists[0][0]);
      data = [data];
    } else throw new Error("The JSON is not a list.");
  }
  const list = data as unknown[];
  const cell = (v: unknown): Grid[number][number] => (v == null ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean));
  if (list.every((x) => Array.isArray(x))) return (list as unknown[][]).map((r) => r.map(cell));
  if (list.every((x) => x && typeof x === "object")) {
    const rows = list.map((x) => flatten(x));
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    return [keys, ...rows.map((r) => keys.map((k) => cell(r[k])))];
  }
  return [["Value"], ...list.map((v) => [cell(v)])];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );
const textOf = (html: string) =>
  decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

/** The tables on an HTML page (outermost first; nested tables count on their own). */
export function parseHtmlTables(html: string): { caption: string; grid: Grid }[] {
  const out: { caption: string; grid: Grid }[] = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  // Find each <table> with its matching </table>.
  const tags = [...clean.matchAll(/<(\/?)table\b[^>]*>/gi)];
  const stack: number[] = [];
  const spans: { start: number; end: number; inner: string }[] = [];
  for (const t of tags) {
    if (!t[1]) stack.push(t.index! + t[0].length);
    else if (stack.length) {
      const start = stack.pop()!;
      spans.push({ start, end: t.index!, inner: clean.slice(start, t.index!) });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  for (const s of spans) {
    // Leave nested tables out of this one.
    const own = s.inner.replace(/<table\b[\s\S]*<\/table>/gi, "");
    const caption = textOf(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(own)?.[1] || "");
    const grid: Grid = [];
    const carry: { col: number; left: number; value: string }[] = [];
    for (const tr of own.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody|<\/thead|<\/tfoot|$)/gi)) {
      const row: (string | null)[] = [];
      const place = () => {
        // Cells spanning down from earlier rows.
        for (let hit = carry.find((c) => c.col === row.length && c.left > 0); hit; hit = carry.find((c) => c.col === row.length && c.left > 0)) {
          row.push(hit.value);
          hit.left--;
        }
      };
      for (const td of tr[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<td\b|<th\b|<\/tr|$)/gi)) {
        place();
        const value = textOf(td[3].replace(/<\/t[dh]>[\s\S]*$/i, ""));
        const colspan = Math.min(50, Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] || 1)));
        const rowspan = Math.min(500, Math.max(1, Number(/rowspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] || 1)));
        for (let k = 0; k < colspan; k++) {
          if (rowspan > 1) carry.push({ col: row.length, left: rowspan - 1, value });
          row.push(value);
        }
      }
      place();
      if (row.length) grid.push(row);
    }
    if (grid.length) out.push({ caption, grid });
  }
  return out;
}

/** A guess at the format, from the content type, the address and the text. */
export function detectFormat(contentType: string, name: string, text: string): Format {
  const t = contentType.toLowerCase();
  if (/json/.test(t) || /\.json(\?|$)/i.test(name)) return "json";
  if (/html|xml/.test(t) || /\.html?(\?|$)/i.test(name)) return "html";
  if (/csv|tab-separated/.test(t) || /\.(csv|tsv|txt)(\?|$)/i.test(name)) return "csv";
  const head = text.trimStart().slice(0, 200);
  if (/^[[{]/.test(head)) return "json";
  if (/^<(!doctype|html|table|\?xml)/i.test(head) || /<table\b/i.test(text)) return "html";
  return "csv";
}

/** Text that looks like a number becomes one (but not codes with leading zeros). */
export function typed(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v !== "string") return v as number | boolean;
  const s = v.trim();
  if (s === "") return null;
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?([eE][-+]?\d+)?$/.test(s) && !/^[-+]?0\d/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^[-+]?\.\d+$/.test(s)) return Number(s);
  return v;
}

/** The raw grid for a source's text. */
export function rawGrid(text: string, format: Format, steps: QuerySteps): Grid {
  if (format === "json") return parseJson(text, steps.jsonPath);
  if (format === "html") {
    const tables = parseHtmlTables(text);
    if (!tables.length) throw new Error("There are no tables on that page.");
    const n = Math.max(1, steps.table || 1);
    if (n > tables.length) throw new Error(`The page has ${tables.length} table${tables.length === 1 ? "" : "s"}.`);
    return tables[n - 1].grid;
  }
  return parseCsv(text, steps.delimiter);
}

/** Column names of a raw grid under the steps (before choosing columns). */
export function columnNames(grid: Grid, steps: QuerySteps): string[] {
  const rows = grid.slice(Math.max(0, steps.skipRows || 0));
  const width = Math.max(0, ...rows.map((r) => r.length));
  const header = steps.headers ? rows[0] || [] : [];
  const used = new Set<string>();
  return Array.from({ length: width }, (_, j) => {
    let name = String(header[j] ?? "").trim() || `Column${j + 1}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${String(header[j] ?? "").trim() || "Column"}${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Applies the steps: the result has a header row when `headers` is on. */
export function shape(grid: Grid, steps: QuerySteps): Grid {
  let rows = grid.slice(Math.max(0, steps.skipRows || 0));
  const names = columnNames(grid, steps);
  if (steps.headers) rows = rows.slice(1);
  let body = rows.map((r) => names.map((_, j) => typed(r[j])));
  if (steps.removeEmptyRows) body = body.filter((r) => r.some((v) => v !== null && v !== ""));
  let keep = names.map((_, j) => j);
  if (steps.columns?.length) {
    const lower = names.map((n) => n.toLowerCase());
    keep = steps.columns.map((c) => lower.indexOf(c.toLowerCase())).filter((j) => j >= 0);
    if (!keep.length) throw new Error("None of the chosen columns are in the data any more.");
  }
  const pick = (r: Grid[number]) => keep.map((j) => r[j] ?? null);
  return steps.headers ? [pick(names), ...body.map(pick)] : body.map(pick);
}

export const MAX_CELLS = 500_000;

/** Fetches nothing: turns a source's text into the grid for the sheet. */
export function gridFor(text: string, format: Format, steps: QuerySteps): Grid {
  const out = applyTransforms(shape(rawGrid(text, format, steps), steps), steps.headers, steps.transforms);
  const cells = out.length * Math.max(0, ...out.map((r) => r.length));
  if (cells > MAX_CELLS) throw new Error(`That is ${cells.toLocaleString()} cells; up to ${MAX_CELLS.toLocaleString()} can be imported.`);
  return out;
}

/** The cells a refresh writes: the new grid, and blanks where the old data was larger. */
export function refreshCells(anchor: { row: number; column: number }, grid: Grid, old?: { rows: number; columns: number }) {
  const rows = Math.max(grid.length, old?.rows || 0);
  const width = Math.max(0, ...grid.map((r) => r.length));
  const columns = Math.max(width, old?.columns || 0);
  const out: { row: number; column: number; value: Grid[number][number]; header: boolean }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const inside = r < grid.length && c < width;
      if (!inside && (!old || r >= old.rows || c >= old.columns)) continue;
      out.push({ row: anchor.row + r, column: anchor.column + c, value: inside ? (grid[r][c] ?? null) : null, header: false });
    }
  return { cells: out, size: { rows: grid.length, columns: width } };
}

// ---- .xlsx ------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const EXT_URI = "{5F3C2A71-9B4E-4D8A-A6C1-3E2B7D9F0A12}";
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** One <connection> for a query (Excel's web query, or a text query for files). */
export function connectionXml(q: QueryDef, id: number): string {
  if (q.foreign) return q.foreign.connection.replace(/\bid="\d+"/, `id="${id}"`);
  const def = esc(JSON.stringify({ ...q, size: undefined, foreign: undefined }));
  const ext = `<extLst><ext uri="${EXT_URI}" xmlns:sq="urn:synergy:query"><sq:query>${def}</sq:query></ext></extLst>`;
  const name = esc(q.name.slice(0, 255));
  const desc = esc(q.source.kind === "web" ? q.source.url : q.source.fileName);
  if (q.source.kind === "web") {
    const html = q.source.format === "html";
    const tables = html ? `<tables count="1"><x v="${Math.max(1, q.steps.table || 1)}"/></tables>` : "";
    return `<connection id="${id}" name="${name}" description="${desc}" type="4" refreshedVersion="8" background="1" saveData="1"><webPr ${html ? 'htmlTables="1" ' : 'textDates="1" '}url="${esc(q.source.url)}"${html ? "" : ' sourceData="1"'}>${tables}</webPr>${ext}</connection>`;
  }
  const d = q.steps.delimiter && q.steps.delimiter !== "auto" ? q.steps.delimiter : ",";
  const delim = d === "\t" ? 'tab="1" comma="0"' : d === ";" ? 'tab="0" semicolon="1"' : d === "|" ? `tab="0" delimiter="|"` : 'tab="0" comma="1"';
  return `<connection id="${id}" name="${name}" description="${desc}" type="6" refreshedVersion="8" background="1" saveData="1"><textPr codePage="65001" sourceFile="${esc(q.source.fileName)}" delimited="1" ${delim} firstRow="${(q.steps.skipRows || 0) + 1}"/>${ext}</connection>`;
}

export const connectionsXml = (queries: QueryDef[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="${SPREADSHEET_NS}">${queries.map((q, i) => connectionXml(q, i + 1)).join("")}</connections>`;

/** The query table on the sheet that ties the connection to its cells. */
export const queryTableXml = (q: QueryDef, connectionId: number, name: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<queryTable xmlns="${SPREADSHEET_NS}" name="${esc(name)}" connectionId="${connectionId}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0"${q.steps.headers ? "" : ' headers="0"'}/>`;

/** Queries in an imported connections part; `range` finds a query table's cells by connection id. */
export function readConnections(xml: string, place: (connectionId: number) => { sheetId: string; anchor: { row: number; column: number }; size?: { rows: number; columns: number } } | null): QueryDef[] {
  const out: QueryDef[] = [];
  for (const m of xml.matchAll(/<connection\b([^>]*?)(?:\/>|>([\s\S]*?)<\/connection>)/g)) {
    const a = (n: string) => {
      const v = new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1];
      return v == null ? undefined : unesc(v);
    };
    const id = Number(a("id"));
    const at = place(id);
    const ours = /<sq:query>([\s\S]*?)<\/sq:query>/.exec(m[2] || "")?.[1];
    if (ours && at) {
      try {
        const q = JSON.parse(unesc(ours)) as QueryDef;
        out.push({ ...q, sheetId: at.sheetId, anchor: at.anchor, ...(at.size ? { size: at.size } : {}) });
        continue;
      } catch {
        /* fall through to the plain connection */
      }
    }
    const web = /<webPr\b([^>]*)/.exec(m[2] || "")?.[1];
    const url = web && /\burl="([^"]*)"/.exec(web)?.[1];
    if (at && url && /^https?:/i.test(unesc(url))) {
      const html = /htmlTables="1"|htmlFormat=/.test(web);
      const table = Number(/<x v="(\d+)"/.exec(m[2] || "")?.[1] || 1);
      out.push({ id: `xlsx-q-${id}`, name: a("name") || `Connection ${id}`, sheetId: at.sheetId, anchor: at.anchor, ...(at.size ? { size: at.size } : {}), source: { kind: "web", url: unesc(url), format: html ? "html" : "csv" }, steps: { headers: true, ...(html ? { table } : {}) } });
      continue;
    }
    // Power Query, databases and others: kept as they are, not refreshed here.
    out.push({ id: `xlsx-c-${id}`, name: a("name") || `Connection ${id}`, sheetId: at?.sheetId || "", anchor: at?.anchor || { row: 0, column: 0 }, source: { kind: "file", fileName: a("description") || a("name") || "", format: "csv" }, steps: { headers: true }, foreign: { connection: m[0] } });
  }
  return out;
}

// ---- Package parts ----------------------------------------------------------------

type Zip = { file: { (path: string): { async(type: "string"): Promise<string> } | null; (path: string, data: string): unknown }; files: Record<string, unknown> };
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_CONNECTIONS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections";
const REL_QUERY_TABLE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable";
const relsOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const addRel = (rels: string, type: string, target: string): string => {
  const base = rels || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
  const n = Math.max(0, ...[...base.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  return base.replace("</Relationships>", `<Relationship Id="rId${n}" Type="${type}" Target="${target}"/></Relationships>`);
};

/** The query table name and defined name for the n-th query (1-based). */
export const externalDataName = (n: number) => `ExternalData_${n}`;

/**
 * Writes the queries into an .xlsx package: xl/connections.xml for all of
 * them, and a query table on the sheet of each one that has its data there
 * (the matching ExternalData_n names are written with the other names).
 */
export async function addQueriesToZip(zip: Zip, items: { query: QueryDef; sheetPath?: string }[]): Promise<void> {
  if (!items.length) return;
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  let types = await read("[Content_Types].xml");
  const override = (part: string, type: string) => {
    if (!types.includes(`PartName="/${part}"`)) types = types.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  };
  zip.file("xl/connections.xml", connectionsXml(items.map((i) => i.query)));
  override("xl/connections.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml");
  const wbRels = await read("xl/_rels/workbook.xml.rels");
  if (!wbRels.includes(REL_CONNECTIONS)) zip.file("xl/_rels/workbook.xml.rels", addRel(wbRels, REL_CONNECTIONS, "connections.xml"));
  let n = Math.max(0, ...Object.keys(zip.files).map((p) => Number(/^xl\/queryTables\/queryTable(\d+)\.xml$/.exec(p)?.[1] || 0)));
  for (const [i, { query, sheetPath }] of items.entries()) {
    if (!sheetPath || query.foreign) continue;
    n++;
    const part = `xl/queryTables/queryTable${n}.xml`;
    zip.file(part, queryTableXml(query, i + 1, externalDataName(i + 1)));
    override(part, "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml");
    zip.file(relsOf(sheetPath), addRel(await read(relsOf(sheetPath)), REL_QUERY_TABLE, `../queryTables/queryTable${n}.xml`));
  }
  zip.file("[Content_Types].xml", types);
}

const resolvePart = (from: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

/**
 * Queries in an imported package. `sheets` are the worksheet parts in order
 * with their ids; `names` are the sheet-level ExternalData names (sheet index,
 * name, A1 range).
 */
export async function readQueries(
  read: (p: string) => Promise<string>,
  sheets: { path: string; sheetId: string }[],
  names: { localSheetId: number; name: string; ref: string }[],
): Promise<QueryDef[]> {
  const wbRels = await read("xl/_rels/workbook.xml.rels");
  const target = [...wbRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(REL_CONNECTIONS));
  const connPath = target ? resolvePart("xl/workbook.xml", /Target="([^"]+)"/.exec(target)![1]) : "";
  const xml = connPath ? await read(connPath) : "";
  if (!xml) return [];
  const where = new Map<number, { sheetId: string; anchor: { row: number; column: number }; size?: { rows: number; columns: number } }>();
  for (const [index, s] of sheets.entries()) {
    const rels = await read(relsOf(s.path));
    for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (!r[0].includes(REL_QUERY_TABLE)) continue;
      const qt = await read(resolvePart(s.path, /Target="([^"]+)"/.exec(r[0])![1]));
      const id = Number(/\bconnectionId="(\d+)"/.exec(qt)?.[1]);
      const name = /<queryTable\b[^>]*\bname="([^"]+)"/.exec(qt)?.[1];
      const dn = names.find((x) => x.localSheetId === index && x.name.toLowerCase() === name?.toLowerCase());
      const m = dn && /\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(dn.ref);
      if (!id) continue;
      const colIdx = (t: string) => t.toUpperCase().split("").reduce((k, ch) => k * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      if (m) {
        const row = Number(m[2]) - 1;
        const column = colIdx(m[1]);
        const endRow = m[4] ? Number(m[4]) - 1 : row;
        const endColumn = m[3] ? colIdx(m[3]) : column;
        where.set(id, { sheetId: s.sheetId, anchor: { row, column }, size: { rows: endRow - row + 1, columns: endColumn - column + 1 } });
      } else where.set(id, { sheetId: s.sheetId, anchor: { row: 0, column: 0 } });
    }
  }
  // Connections tied to the workbook's data model can't come along without the model.
  return readConnections(xml, (id) => where.get(id) || null).filter((q) => !q.foreign || !/\bmodel="1"|ThisWorkbookDataModel/.test(q.foreign.connection));
}
