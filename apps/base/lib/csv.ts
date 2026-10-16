/**
 * CSV in and out. Import makes a new table: the first row names the fields, and each column's
 * data type is worked out from its values (the way Access's import wizard and Lists' "create
 * from CSV" do). Export writes what a datasheet shows, which is also the feed Sheets can link to.
 */
import { parseDate, parseDateTime, parseNumber, parseYesNo, MAX_TEXT, type Field, type FieldType } from "./fields";

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. Detects ; and tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = [",", ";", "\t"].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const needsQuotes = /[",\r\n]|^\s|\s$/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  // Cells starting with = + - @ would run as formulas in a spreadsheet; neutralise them.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** The data type that fits every non-empty value in a column. */
export function inferType(values: string[]): FieldType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return "text";
  if (filled.every((v) => /^(true|false|yes|no)$/i.test(v) && parseYesNo(v) !== null)) return "yesno";
  if (filled.every((v) => /^\$-?[\d,]+(\.\d{1,4})?$|^-?\$[\d,]+(\.\d{1,4})?$/.test(v))) return "currency";
  // Codes with leading zeros (ZIP codes, part numbers) stay text so the zeros aren't lost.
  if (filled.every((v) => parseNumber(v) !== null && !/^[-+]?0\d/.test(v))) return "number";
  if (filled.every((v) => /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/.test(v) && parseDate(v) !== null)) return "date";
  if (filled.every((v) => parseDateTime(v) !== null)) return "datetime";
  if (filled.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return "email";
  if (filled.every((v) => /^https?:\/\/\S+$/i.test(v))) return "hyperlink";
  if (values.some((v) => v.length > MAX_TEXT || /[\r\n]/.test(v))) return "longtext";
  return "text";
}

/** Field names from a header row: blanks become Field1..., repeats get a number, ID is renamed. */
export function headerNames(header: string[]): string[] {
  const seen = new Set<string>(["id"]);
  return header.map((h, i) => {
    let base = h.replace(/\s+/g, " ").trim().slice(0, 60) || `Field${i + 1}`;
    // eslint-disable-next-line no-control-regex
    base = base.replace(/[\u0000-\u001f\u007f]/g, "");
    if (base.toLowerCase() === "id") base = `${base} (imported)`;
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Text as a datasheet shows it, for CSV export. */
export function exportValue(f: Field, v: unknown, label?: string | null): unknown {
  if (v === null || v === undefined) return "";
  if (f.type === "lookup" || f.type === "multilookup") return label ?? v;
  if (f.type === "currency") return Number(v).toFixed(f.options.decimals ?? 2);
  return v;
}
