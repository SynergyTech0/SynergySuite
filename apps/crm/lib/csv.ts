// CSV export of the record lists, readable by Excel, Sheets and other CRMs' importers.

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
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
