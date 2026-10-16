// Data tables (What-If Analysis > Data Table in Excel): a block of results
// for a formula under a list of input values (one variable) or a grid of two.
// The block's top row and first column hold the inputs and the formulas, the
// way Excel lays them out; the results are worked out by putting each input
// into the input cell and letting the formula engine recalculate. In .xlsx a
// data table is the {=TABLE(...)} formula (<f t="dataTable">) on its results.

export const DATA_TABLE_RESOURCE = "SHEET_SYNERGY_DATA_TABLE_PLUGIN";
export const SET_DATA_TABLES_MUTATION = "sheet.mutation.set-data-tables";

export type Cell = { row: number; column: number };
export type Block = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export type DataTableDef = {
  id: string;
  sheetId: string;
  /** The whole block: input values and formulas along its top row and first column. */
  range: Block;
  /** Cell the top-row values go into (Excel's "Row input cell"). */
  rowInput?: Cell | null;
  /** Cell the first-column values go into (Excel's "Column input cell"). */
  colInput?: Cell | null;
};

export type DataTableJob = {
  /** Values to put in the input cells for this recalculation. */
  inputs: { cell: Cell; value: unknown }[];
  /** Results to read after it: the formula cell, and where its value goes. */
  reads: { from: Cell; to: Cell }[];
};

/** Kind of table: column-oriented (inputs down the side), row-oriented, or two variables. */
export function dataTableKind(def: Pick<DataTableDef, "rowInput" | "colInput">): "column" | "row" | "two" {
  if (def.rowInput && def.colInput) return "two";
  if (def.rowInput) return "row";
  if (def.colInput) return "column";
  throw new Error("Enter a row input cell, a column input cell, or both.");
}

/** The recalculations needed to fill the table. `read` gives a cell's value. */
export function dataTableJobs(def: DataTableDef, read: (c: Cell) => unknown): DataTableJob[] {
  const g = def.range;
  if (g.endRow <= g.startRow || g.endColumn <= g.startColumn) throw new Error("Select the inputs and formulas with the cells for the results: at least two rows and two columns.");
  const kind = dataTableKind(def);
  const jobs: DataTableJob[] = [];
  if (kind === "two") {
    const formula = { row: g.startRow, column: g.startColumn };
    for (let r = g.startRow + 1; r <= g.endRow; r++)
      for (let c = g.startColumn + 1; c <= g.endColumn; c++)
        jobs.push({
          inputs: [
            { cell: def.rowInput!, value: read({ row: g.startRow, column: c }) },
            { cell: def.colInput!, value: read({ row: r, column: g.startColumn }) },
          ],
          reads: [{ from: formula, to: { row: r, column: c } }],
        });
  } else if (kind === "column") {
    // Inputs down the first column, formulas along the top row.
    for (let r = g.startRow + 1; r <= g.endRow; r++)
      jobs.push({
        inputs: [{ cell: def.colInput!, value: read({ row: r, column: g.startColumn }) }],
        reads: Array.from({ length: g.endColumn - g.startColumn }, (_, i) => ({ from: { row: g.startRow, column: g.startColumn + 1 + i }, to: { row: r, column: g.startColumn + 1 + i } })),
      });
  } else {
    // Inputs along the top row, formulas down the first column.
    for (let c = g.startColumn + 1; c <= g.endColumn; c++)
      jobs.push({
        inputs: [{ cell: def.rowInput!, value: read({ row: g.startRow, column: c }) }],
        reads: Array.from({ length: g.endRow - g.startRow }, (_, i) => ({ from: { row: g.startRow + 1 + i, column: g.startColumn }, to: { row: g.startRow + 1 + i, column: c } })),
      });
  }
  return jobs;
}

/** The results block (the cells the TABLE formula covers). */
export const resultBlock = (g: Block): Block => ({ startRow: g.startRow + 1, endRow: g.endRow, startColumn: g.startColumn + 1, endColumn: g.endColumn });

/** True when the cell is a result cell of one of the tables (typing there is refused in Excel). */
export const inResults = (defs: DataTableDef[], sheetId: string, row: number, column: number) =>
  defs.some((d) => d.sheetId === sheetId && row > d.range.startRow && row <= d.range.endRow && column > d.range.startColumn && column <= d.range.endColumn);

// ---- .xlsx ------------------------------------------------------------------

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const ref = (c: Cell) => `${col(c.column)}${c.row + 1}`;
const cellOf = (a: string): Cell | null => {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a.trim());
  return m ? { row: Number(m[2]) - 1, column: colIndex(m[1]) } : null;
};

/** The <f> element Excel puts on the first result cell. */
export function dataTableFormulaXml(def: DataTableDef): string {
  const g = resultBlock(def.range);
  const kind = dataTableKind(def);
  const area = `${ref({ row: g.startRow, column: g.startColumn })}:${ref({ row: g.endRow, column: g.endColumn })}`;
  if (kind === "two") return `<f t="dataTable" ref="${area}" dt2D="1" dtr="1" r1="${ref(def.rowInput!)}" r2="${ref(def.colInput!)}"/>`;
  if (kind === "row") return `<f t="dataTable" ref="${area}" dt2D="0" dtr="1" r1="${ref(def.rowInput!)}"/>`;
  return `<f t="dataTable" ref="${area}" dt2D="0" dtr="0" r1="${ref(def.colInput!)}"/>`;
}

/** Puts the TABLE formulas into a worksheet part (whose result cells already hold the values). */
export function patchDataTables(sheetXml: string, defs: DataTableDef[]): string {
  let xml = sheetXml;
  for (const def of defs) {
    const first = ref({ row: def.range.startRow + 1, column: def.range.startColumn + 1 });
    const f = dataTableFormulaXml(def);
    const cell = new RegExp(`<c r="${first}"([^>]*?)(/>|>([\\s\\S]*?)</c>)`);
    const m = cell.exec(xml);
    if (m) {
      const inner = (m[3] || "").replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/, "");
      xml = xml.replace(m[0], `<c r="${first}"${m[1]}>${f}${inner}</c>`);
      continue;
    }
    // No cell yet: add it to its row (creating the row when needed).
    const rowNo = def.range.startRow + 2;
    const row = new RegExp(`<row r="${rowNo}"([^>]*?)(/>|>([\\s\\S]*?)</row>)`).exec(xml);
    const c = `<c r="${first}">${f}</c>`;
    if (row) {
      const cells = row[3] || "";
      // Keep the cells in column order.
      const parts = [...cells.matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)];
      const after = parts.find((p) => colIndex(p[1]) > def.range.startColumn + 1);
      const body = after ? cells.slice(0, after.index) + c + cells.slice(after.index) : cells + c;
      xml = xml.replace(row[0], `<row r="${rowNo}"${row[1]}>${body}</row>`);
    } else {
      const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
      const next = rows.find((r) => Number(r[1]) > rowNo);
      const rowXml = `<row r="${rowNo}">${c}</row>`;
      xml = next ? xml.slice(0, next.index) + rowXml + xml.slice(next.index) : xml.replace(/<sheetData\/>|<\/sheetData>/, (t) => (t === "<sheetData/>" ? `<sheetData>${rowXml}</sheetData>` : `${rowXml}</sheetData>`));
    }
  }
  return xml;
}

/** Data tables in a worksheet part. */
export function readDataTables(sheetXml: string, sheetId: string): DataTableDef[] {
  const out: DataTableDef[] = [];
  for (const m of sheetXml.matchAll(/<f\b([^>]*\bt="dataTable"[^>]*)\/?>/g)) {
    const a = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1];
    const area = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(a("ref") || "");
    if (!area) continue;
    const r1 = Number(area[2]) - 1;
    const c1 = colIndex(area[1]);
    const r2 = area[4] ? Number(area[4]) - 1 : r1;
    const c2 = area[3] ? colIndex(area[3]) : c1;
    const range = { startRow: r1 - 1, endRow: r2, startColumn: c1 - 1, endColumn: c2 };
    if (range.startRow < 0 || range.startColumn < 0) continue;
    const one = cellOf(a("r1") || "");
    const two = cellOf(a("r2") || "");
    const twoD = a("dt2D") === "1" || a("dt2D") === "true";
    const rowWise = a("dtr") === "1" || a("dtr") === "true";
    const def: DataTableDef = { id: `xlsx-dt-${sheetId}-${out.length + 1}`, sheetId, range };
    if (twoD) {
      if (!one || !two) continue;
      def.rowInput = one;
      def.colInput = two;
    } else if (rowWise) {
      if (!one) continue;
      def.rowInput = one;
    } else {
      if (!one) continue;
      def.colInput = one;
    }
    out.push(def);
  }
  return out;
}
