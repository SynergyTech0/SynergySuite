// Data tools that Univer's open-source packages don't ship.

/** Which rows of a block to keep when removing duplicates, Excel-style:
 *  the first occurrence wins, text compares case-insensitively, and only the
 *  chosen columns (indexes into each row) are compared. */
export function rowsToKeep(rows: unknown[][], columns: number[], hasHeader: boolean): number[] {
  const keep: number[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (hasHeader && i === 0) {
      keep.push(i);
      return;
    }
    const key = JSON.stringify(
      columns.map((c) => {
        const v = row[c];
        if (v == null || v === "") return "";
        return typeof v === "string" ? v.trim().toLowerCase() : v;
      }),
    );
    if (seen.has(key)) return;
    seen.add(key);
    keep.push(i);
  });
  return keep;
}

/** Excel's "current region": the block of filled cells around (row, col),
 *  grown until it is surrounded by empty rows and columns. */
export function currentRegion(valueAt: (row: number, col: number) => unknown, row: number, col: number, limit = 10000) {
  const filled = (r: number, c: number) => r >= 0 && c >= 0 && (() => {
    const v = valueAt(r, c);
    return v != null && v !== "";
  })();
  const g = { startRow: row, endRow: row, startColumn: col, endColumn: col };
  for (let grown = true, steps = 0; grown && steps < limit; steps++) {
    grown = false;
    const anyInRow = (r: number) => { for (let c = g.startColumn - 1; c <= g.endColumn + 1; c++) if (filled(r, c)) return true; return false; };
    const anyInCol = (c: number) => { for (let r = g.startRow - 1; r <= g.endRow + 1; r++) if (filled(r, c)) return true; return false; };
    if (g.startRow > 0 && anyInRow(g.startRow - 1)) { g.startRow--; grown = true; }
    if (anyInRow(g.endRow + 1)) { g.endRow++; grown = true; }
    if (g.startColumn > 0 && anyInCol(g.startColumn - 1)) { g.startColumn--; grown = true; }
    if (anyInCol(g.endColumn + 1)) { g.endColumn++; grown = true; }
  }
  return g;
}
