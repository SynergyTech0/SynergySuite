// Which cells a formula reads (precedents) and which formulas read a cell
// (dependents), worked out from the formula text. Used by Trace precedents /
// Trace dependents. Names, structured table references and functions that
// build references at run time (INDIRECT, OFFSET) are not followed.

export type RefRange = { sheetId: string; startRow: number; endRow: number; startColumn: number; endColumn: number };
export type CellAt = { sheetId: string; row: number; column: number };

type Book = {
  sheetOrder: string[];
  sheets: Record<string, { id?: string; name: string; rowCount?: number; columnCount?: number; cellData?: Record<string, Record<string, { f?: string | null; si?: string | null } | null | undefined>> }>;
};

const MAX_ROW = 1048575;
const MAX_COL = 16383;
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// One reference: optional sheet, then A1, A1:B2, A:B or 1:3.
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!`;
const CELL = String.raw`\$?([A-Za-z]{1,3})\$?(\d{1,7})`;
const REF = new RegExp(
  String.raw`(?<![\w.$])(?:${SHEET})?(?:${CELL}(?::${CELL})?|\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})|\$?(\d{1,7}):\$?(\d{1,7}))(?![\w(!])`,
  "g",
);

/** The text with string literals blanked out, so "A1" in quotes isn't a reference. */
function withoutStrings(f: string): string {
  return f.replace(/"(?:[^"]|"")*"/g, (m) => " ".repeat(m.length));
}

/** References in a formula, resolved against the book's sheet names. */
export function formulaRefs(formula: string, book: Book, hostSheetId: string): RefRange[] {
  const byName = new Map(book.sheetOrder.map((id) => [book.sheets[id]?.name.toLowerCase(), id]));
  const out: RefRange[] = [];
  const text = withoutStrings(formula.replace(/^=/, ""));
  for (const m of text.matchAll(REF)) {
    const sheetName = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
    const sheetId = sheetName != null ? byName.get(sheetName.toLowerCase()) : hostSheetId;
    if (!sheetId) continue; // another workbook, or a name that only looks like a sheet
    let r: RefRange | null = null;
    if (m[3]) {
      const r1 = Number(m[4]) - 1;
      const c1 = colIndex(m[3]);
      const r2 = m[6] ? Number(m[6]) - 1 : r1;
      const c2 = m[5] ? colIndex(m[5]) : c1;
      if (c1 > MAX_COL || c2 > MAX_COL || r1 < 0 || r2 < 0) continue;
      r = { sheetId, startRow: Math.min(r1, r2), endRow: Math.max(r1, r2), startColumn: Math.min(c1, c2), endColumn: Math.max(c1, c2) };
    } else if (m[7]) {
      const a = colIndex(m[7]);
      const b = colIndex(m[8]);
      r = { sheetId, startRow: 0, endRow: MAX_ROW, startColumn: Math.min(a, b), endColumn: Math.max(a, b) };
    } else if (m[9]) {
      const a = Number(m[9]) - 1;
      const b = Number(m[10]) - 1;
      if (a < 0 || b < 0) continue;
      r = { sheetId, startRow: Math.min(a, b), endRow: Math.max(a, b), startColumn: 0, endColumn: MAX_COL };
    }
    if (r) out.push(r);
  }
  return out;
}

/** The formula text of a cell, expanding Univer's shared formulas (si). */
export function formulaAt(book: Book, at: CellAt): string | null {
  const data = book.sheets[at.sheetId]?.cellData;
  const cell = data?.[at.row]?.[at.column];
  if (!cell) return null;
  if (cell.f) return cell.f;
  if (!cell.si) return null;
  for (const [rk, row] of Object.entries(data || {}))
    for (const [ck, other] of Object.entries(row || {}))
      if (other?.si === cell.si && other.f) return shift(other.f, at.row - Number(rk), at.column - Number(ck));
  return null;
}

// Move relative references by (dr, dc), as filling a formula does.
function shift(f: string, dr: number, dc: number): string {
  const name = (c: number) => {
    let s = "";
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  let out = "";
  let last = 0;
  const text = withoutStrings(f);
  for (const m of text.matchAll(/(?<![\w.$])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(!])/g)) {
    out += f.slice(last, m.index);
    const c = m[1] ? colIndex(m[2]) : colIndex(m[2]) + dc;
    const r = m[3] ? Number(m[4]) : Number(m[4]) + dr;
    out += `${m[1]}${name(Math.max(0, c))}${m[3]}${Math.max(1, r)}`;
    last = m.index! + m[0].length;
  }
  return out + f.slice(last);
}

/** Ranges the cell's formula reads. */
export function precedentsOf(book: Book, at: CellAt): RefRange[] {
  const f = formulaAt(book, at);
  return f ? formulaRefs(f, book, at.sheetId) : [];
}

const inside = (r: RefRange, at: CellAt) => r.sheetId === at.sheetId && at.row >= r.startRow && at.row <= r.endRow && at.column >= r.startColumn && at.column <= r.endColumn;

/** Cells whose formulas read the given cell, in sheet order. */
export function dependentsOf(book: Book, at: CellAt): CellAt[] {
  const out: CellAt[] = [];
  for (const sheetId of book.sheetOrder) {
    for (const [rk, row] of Object.entries(book.sheets[sheetId]?.cellData || {}))
      for (const [ck, cell] of Object.entries(row || {})) {
        if (!cell?.f && !cell?.si) continue;
        const here = { sheetId, row: Number(rk), column: Number(ck) };
        if (precedentsOf(book, here).some((r) => inside(r, at))) out.push(here);
      }
  }
  return out;
}

/** One level of arrows from a set of cells, for repeated "Trace" clicks. */
export type Arrow = { from: RefRange; to: CellAt };

export function traceLevel(book: Book, cells: CellAt[], direction: "precedents" | "dependents"): Arrow[] {
  const arrows: Arrow[] = [];
  for (const at of cells) {
    if (direction === "precedents") for (const r of precedentsOf(book, at)) arrows.push({ from: r, to: at });
    else for (const d of dependentsOf(book, at)) arrows.push({ from: { sheetId: at.sheetId, startRow: at.row, endRow: at.row, startColumn: at.column, endColumn: at.column }, to: d });
  }
  return arrows;
}
