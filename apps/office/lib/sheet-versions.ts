// Version history for spreadsheets: a version is the whole workbook snapshot,
// stored through the same /api/docs/<id>/versions endpoints Docs and Slides
// use, as JSON with a prefix so it is never mistaken for a document's HTML.
import { cellDisplayText, type UniverWorkbook } from "./xlsx";

export const WORKBOOK_SNAPSHOT_PREFIX = "synergy-workbook:v1:";

export const encodeWorkbook = (book: unknown) => WORKBOOK_SNAPSHOT_PREFIX + JSON.stringify(book);

export function decodeWorkbook(text: string | null | undefined): UniverWorkbook | null {
  if (!text || !text.startsWith(WORKBOOK_SNAPSHOT_PREFIX)) return null;
  try {
    const book = JSON.parse(text.slice(WORKBOOK_SNAPSHOT_PREFIX.length)) as UniverWorkbook;
    if (!book || typeof book !== "object" || !Array.isArray(book.sheetOrder) || !book.sheets || typeof book.sheets !== "object") return null;
    return book;
  } catch {
    return null;
  }
}

/** Column letters for a 0-based index (0 → A, 26 → AA). */
export function columnName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export type PreviewGrid = { rows: number[]; columns: number[]; cells: string[][]; more: { rows: boolean; columns: boolean } };

/**
 * The top left of one sheet of a version as text, for a read-only preview:
 * up to `maxRows` × `maxColumns`, trimmed to the cells in use.
 */
export function previewGrid(book: UniverWorkbook, sheetId: string, maxRows = 40, maxColumns = 12): PreviewGrid {
  const sheet = book.sheets[sheetId];
  const data = (sheet?.cellData || {}) as Record<string, Record<string, any>>;
  let lastRow = -1;
  let lastColumn = -1;
  for (const [r, row] of Object.entries(data))
    for (const [c, cell] of Object.entries(row || {}))
      if (cell && (cell.v != null || cell.p || cell.f)) {
        lastRow = Math.max(lastRow, Number(r));
        lastColumn = Math.max(lastColumn, Number(c));
      }
  const nRows = Math.min(maxRows, Math.max(lastRow + 1, 10));
  const nColumns = Math.min(maxColumns, Math.max(lastColumn + 1, 5));
  const rows = Array.from({ length: nRows }, (_, i) => i);
  const columns = Array.from({ length: nColumns }, (_, i) => i);
  return {
    rows,
    columns,
    cells: rows.map((r) => columns.map((c) => cellDisplayText(book, data[r]?.[c]))),
    more: { rows: lastRow + 1 > nRows, columns: lastColumn + 1 > nColumns },
  };
}

/** A one-line summary of what changed between two versions (sheets and cells). */
export function versionDiff(before: UniverWorkbook, after: UniverWorkbook): { sheetsAdded: string[]; sheetsRemoved: string[]; cellsChanged: number } {
  const names = (b: UniverWorkbook) => new Map(b.sheetOrder.filter((id) => b.sheets[id]).map((id) => [id, b.sheets[id].name]));
  const a = names(before);
  const b = names(after);
  const key = (c: any) => JSON.stringify([c?.v ?? null, c?.f ?? null]);
  let cellsChanged = 0;
  for (const id of b.keys()) {
    if (!a.has(id)) continue;
    const x = (before.sheets[id].cellData || {}) as Record<string, Record<string, any>>;
    const y = (after.sheets[id].cellData || {}) as Record<string, Record<string, any>>;
    const seen = new Set<string>();
    for (const grid of [x, y])
      for (const [r, row] of Object.entries(grid))
        for (const c of Object.keys(row || {})) {
          const k = `${r}:${c}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (key(x[r]?.[c]) !== key(y[r]?.[c])) cellsChanged++;
        }
  }
  return {
    sheetsAdded: [...b.entries()].filter(([id]) => !a.has(id)).map(([, n]) => n),
    sheetsRemoved: [...a.entries()].filter(([id]) => !b.has(id)).map(([, n]) => n),
    cellsChanged,
  };
}
