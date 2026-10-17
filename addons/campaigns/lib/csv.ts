// CSV in (subscriber imports) and out (subscriber exports).

/** Parses CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF) into rows. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string> = {
  email: "email", "e-mail": "email", "email address": "email", mail: "email",
  "first name": "firstName", firstname: "firstName", first_name: "firstName", "given name": "firstName",
  "last name": "lastName", lastname: "lastName", last_name: "lastName", surname: "lastName", "family name": "lastName",
  name: "name", "full name": "name",
  company: "company", organization: "company", organisation: "company", account: "company",
  tags: "tags", tag: "tags",
};

export type CsvPerson = { email: string; firstName: string; lastName: string; company: string; tags: string[]; fields: Record<string, string> };

/** Rows with a header line into people; unknown columns become custom fields. */
export function csvPeople(input: string): CsvPerson[] {
  const [header, ...rows] = parseCsv(input);
  if (!header) return [];
  const keys = header.map((h) => ALIASES[h.trim().toLowerCase()] ?? `field:${h.trim()}`);
  if (!keys.includes("email")) {
    // No header row: a plain list of addresses, maybe with names after them.
    return [header, ...rows].map((r) => ({ email: r[0]?.trim() ?? "", firstName: r[1]?.trim() ?? "", lastName: r[2]?.trim() ?? "", company: "", tags: [], fields: {} }));
  }
  return rows.map((r) => {
    const p: CsvPerson = { email: "", firstName: "", lastName: "", company: "", tags: [], fields: {} };
    keys.forEach((k, i) => {
      const v = (r[i] ?? "").trim();
      if (!v) return;
      if (k === "name") {
        const [f, ...rest] = v.split(/\s+/);
        p.firstName ||= f;
        p.lastName ||= rest.join(" ");
      } else if (k === "tags") p.tags = v.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
      else if (k.startsWith("field:")) p.fields[k.slice(6)] = v;
      else (p as unknown as Record<string, string>)[k] = v;
    });
    return p;
  });
}

function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // A cell starting with = + - @ (or a tab/CR) would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: [header: string, get: (r: T) => unknown][]): string {
  const lines = [columns.map(([h]) => cell(h)).join(",")];
  for (const r of rows) lines.push(columns.map(([, get]) => cell(get(r))).join(","));
  // The BOM tells Excel the file is UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}
