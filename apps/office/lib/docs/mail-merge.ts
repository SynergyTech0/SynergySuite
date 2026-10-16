// Mail merge: a Sheet as the recipient list (its first row names the fields),
// merge fields in the document (Word's MERGEFIELD), and the merged result:
// one copy of the document per recipient, separated by page breaks.
import type { PMNode } from "./model";

export type MergeSource = { docId: string; title: string; sheetId?: string; sheetName?: string };
export const sourceKey = (s: Pick<MergeSource, "docId" | "sheetId">) => `${s.docId}:${s.sheetId || ""}`;
export type MergeTable = { fields: string[]; records: Record<string, string>[]; /** read from the Sheet's live (collaboration) state */ live?: boolean; /** Sheet changes that could not be replayed (the saved copy may be needed) */ unsupported?: string[]; /** which Sheet and tab it came from */ source?: string };

type Book = { sheetOrder: string[]; sheets: Record<string, { id: string; name: string; cellData?: Record<number, Record<number, unknown>> } | undefined> };

/** The rows of a sheet as records keyed by the header row (blank rows skipped; blank or repeated headers named). */
export function sheetTable(book: Book, sheetId: string | undefined, display: (cell: unknown) => string): MergeTable {
  const s = book.sheets[sheetId && book.sheets[sheetId] ? sheetId : book.sheetOrder[0]];
  if (!s) return { fields: [], records: [] };
  const cells = s.cellData || {};
  let maxR = -1;
  let maxC = -1;
  for (const [rk, row] of Object.entries(cells))
    for (const [ck, c] of Object.entries(row || {}))
      if (display(c).trim()) {
        maxR = Math.max(maxR, Number(rk));
        maxC = Math.max(maxC, Number(ck));
      }
  if (maxR < 0) return { fields: [], records: [] };
  const fields: string[] = [];
  for (let c = 0; c <= maxC; c++) {
    let name = display(cells[0]?.[c]).trim().replace(/\s+/g, " ") || `Column ${c + 1}`;
    for (let k = 2; fields.includes(name); k++) name = `${name.replace(/ \(\d+\)$/, "")} (${k})`;
    fields.push(name);
  }
  const records: Record<string, string>[] = [];
  for (let r = 1; r <= maxR; r++) {
    const rec: Record<string, string> = {};
    let any = false;
    fields.forEach((f, c) => {
      const v = display(cells[r]?.[c]);
      if (v.trim()) any = true;
      rec[f] = v;
    });
    if (any) records.push(rec);
  }
  return { fields, records };
}

/** Field name as Word writes it in MERGEFIELD (quoted when it has spaces). */
export function mergeInstr(name: string): string {
  return `MERGEFIELD ${/[\s"]/.test(name) ? `"${name.replace(/"/g, "")}"` : name} \\* MERGEFORMAT`;
}

/** The field name of a MERGEFIELD instruction, or null. */
export function parseMergeInstr(instr: string): string | null {
  const m = /^\s*MERGEFIELD\s+(?:"([^"]*)"|(\S+))/i.exec(instr);
  return m ? (m[1] ?? m[2]).trim() || null : null;
}

/** A record's value for a field (exact name first, then ignoring case, spaces and underscores). */
export function fieldValue(record: Record<string, string>, name: string): string {
  if (name in record) return record[name];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");
  const k = Object.keys(record).find((x) => norm(x) === norm(name));
  return k ? record[k] : "";
}

/** The document with each merge field replaced by the record's value (in the field's formatting). */
export function mergeRecord(content: PMNode[], record: Record<string, string>): PMNode[] {
  const walk = (n: PMNode): PMNode[] => {
    if (n.type === "mergeField") {
      const v = fieldValue(record, String(n.attrs?.name || ""));
      return v ? [{ type: "text", text: v, ...(n.marks?.length ? { marks: n.marks } : {}) }] : [];
    }
    if (!n.content) return [n];
    const content = n.content.flatMap(walk);
    // join text that now sits side by side with the same marks
    const joined: PMNode[] = [];
    for (const c of content) {
      const prev = joined[joined.length - 1];
      if (prev && prev.type === "text" && c.type === "text" && JSON.stringify(prev.marks || []) === JSON.stringify(c.marks || [])) joined[joined.length - 1] = { ...prev, text: (prev.text || "") + (c.text || "") };
      else joined.push(c);
    }
    return [{ ...n, content: joined }];
  };
  return content.flatMap(walk);
}

/** One copy per record, each starting on a new page. */
export function mergeAll(content: PMNode[], records: Record<string, string>[]): PMNode[] {
  const out: PMNode[] = [];
  records.forEach((r, i) => {
    if (i > 0) out.push({ type: "pageBreak" });
    out.push(...mergeRecord(content, r));
  });
  return out.length ? out : [{ type: "paragraph" }];
}

/** Names of the merge fields used in a document. */
export function mergeFieldsIn(content: PMNode[]): string[] {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "mergeField" && n.attrs?.name && !out.includes(String(n.attrs.name))) out.push(String(n.attrs.name));
    n.content?.forEach(walk);
  };
  content.forEach(walk);
  return out;
}
