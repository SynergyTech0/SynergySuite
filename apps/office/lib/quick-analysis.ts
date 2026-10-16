// Quick Analysis (Ctrl+Q in Excel): one-click formatting, charts, totals,
// tables and sparklines for the selected data. The totals are worked out
// here as formulas; the rest reuse the editor's own commands.

export type Rect = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export type TotalKind = "sum" | "average" | "count" | "percent" | "running";
export type TotalCell = { row: number; column: number; formula?: string; value?: string; bold?: boolean; percent?: boolean };

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const a1 = (r: number, c: number) => `${col(c)}${r + 1}`;
const LABEL: Record<TotalKind, string> = { sum: "Sum", average: "Average", count: "Count", percent: "% Total", running: "Running Total" };

/**
 * The cells a total writes: a row under the data ("rows") or a column to its
 * right ("columns"), with formulas over each column or row. `header` is true
 * when the first row of the selection is a header (left out of the totals).
 */
export function totalCells(g: Rect, kind: TotalKind, dir: "rows" | "columns", header = false): TotalCell[] {
  const out: TotalCell[] = [];
  const top = header ? g.startRow + 1 : g.startRow;
  if (top > g.endRow) return out;
  if (dir === "rows") {
    // A row under the data: each column's total (or its share of the whole, or the running sum across).
    const r = g.endRow + 1;
    const all = `${a1(top, g.startColumn)}:${a1(g.endRow, g.endColumn)}`;
    if (g.startColumn > 0) out.push({ row: r, column: g.startColumn - 1, value: LABEL[kind], bold: true });
    for (let c = g.startColumn; c <= g.endColumn; c++) {
      const range = `${a1(top, c)}:${a1(g.endRow, c)}`;
      const formula = kind === "average" ? `=AVERAGE(${range})` : kind === "count" ? `=COUNT(${range})` : kind === "percent" ? `=SUM(${range})/SUM(${all})` : kind === "running" ? `=SUM(${a1(top, g.startColumn)}:${a1(g.endRow, c)})` : `=SUM(${range})`;
      out.push({ row: r, column: c, formula, bold: true, ...(kind === "percent" ? { percent: true } : {}) });
    }
    return out;
  }
  const c = g.endColumn + 1;
  if (header) out.push({ row: g.startRow, column: c, value: LABEL[kind], bold: true });
  const all = `${col(g.startColumn)}$${top + 1}:${col(g.endColumn)}$${g.endRow + 1}`;
  for (let r = top; r <= g.endRow; r++) {
    const range = `${a1(r, g.startColumn)}:${a1(r, g.endColumn)}`;
    const formula =
      kind === "average" ? `=AVERAGE(${range})` : kind === "count" ? `=COUNT(${range})` : kind === "percent" ? `=SUM(${range})/SUM(${all.replace(/^([A-Z]+)/, "$$$1").replace(/:([A-Z]+)/, ":$$$1")})` : kind === "running" ? `=SUM(${col(g.startColumn)}$${top + 1}:${a1(r, g.endColumn)})` : `=SUM(${range})`;
    out.push({ row: r, column: c, formula, bold: true, ...(kind === "percent" ? { percent: true } : {}) });
  }
  return out;
}

/** Is the first row of the selection a header: text over numbers? */
export function hasHeader(values: unknown[][]): boolean {
  if (values.length < 2) return false;
  const first = values[0];
  const rest = values.slice(1);
  return first.some((v) => typeof v === "string" && v.trim() !== "") && rest.some((row) => row.some((v) => typeof v === "number"));
}
