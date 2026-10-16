/**
 * CSV, written out and read back.
 *
 * Deliberately small: enough of RFC 4180 to survive Excel and Jira (quoted fields, doubled quotes,
 * CRLF, a BOM), and nothing else. A card description with a comma and a newline in it is the normal
 * case here, not the edge case, so the quoting rules are the whole point.
 */

const needsQuote = (v: string) => /[",\n\r]/.test(v);

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

/** Rows as objects keyed by the header. A repeated header collects its values into one comma list. */
export function parseCsv(text: string): Record<string, string>[] {
  const table = parseRows(text);
  if (!table.length) return [];
  const header = table[0];
  return table.slice(1)
    // A trailing newline leaves one empty row; a genuinely blank line carries nothing either.
    .filter((r) => r.some((v) => v !== ""))
    .map((r) => {
      const row: Record<string, string> = {};
      header.forEach((h, i) => {
        const v = r[i] ?? "";
        if (!h) return;
        // Jira exports one column per value for multi-valued fields, repeating the header.
        row[h] = row[h] ? (v ? `${row[h]},${v}` : row[h]) : v;
      });
      return row;
    });
}

/** Character-by-character, because a field may contain the separator, a quote or a newline. */
function parseRows(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
