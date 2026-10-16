// Pivot tables: summarize a range by row and column fields.
//
// The definition (source range, fields, target cell) is kept in a workbook
// resource and the result is written into ordinary cells, so it prints,
// exports and recalculates like any other data. "Refresh" recomputes it from
// the source. The engine below is pure: a table of values in, a grid out.

export const PIVOT_RESOURCE = "SHEET_SYNERGY_PIVOT_PLUGIN";

export type PivotAgg = "sum" | "count" | "average" | "min" | "max";
export type PivotRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };
export type PivotValue = { field: string; agg: PivotAgg };
export type PivotFilter = { field: string; exclude: string[] };

export type PivotDef = {
  id: string;
  name: string;
  /** Source block; its first row holds the field names. */
  source: { sheetId: string; range: PivotRange };
  /** Top-left cell of the output. */
  target: { sheetId: string; row: number; column: number };
  rows: string[];
  columns: string[];
  values: PivotValue[];
  filters: PivotFilter[];
  grandTotals?: boolean; // default on
  subtotals?: boolean; // default on (outer row fields)
  /** Size of the last output, so a refresh clears exactly what it wrote. */
  lastSize?: { rows: number; columns: number };
};

export type PivotResource = { pivots: PivotDef[] };

export type PivotCell = string | number | null;
export type PivotGrid = {
  cells: PivotCell[][];
  /** Rows to show in bold: headers, subtotals, grand total. */
  boldRows: number[];
  boldColumns: number[];
  headerRows: number;
};

export const AGG_LABEL: Record<PivotAgg, string> = { sum: "Sum", count: "Count", average: "Average", min: "Min", max: "Max" };
export const valueLabel = (v: PivotValue) => `${AGG_LABEL[v.agg]} of ${v.field}`;

const BLANK = "(blank)";

export function keyText(v: unknown): string {
  if (v == null || v === "") return BLANK;
  return String(v);
}

export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === BLANK) return 1;
  if (b === BLANK) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

class Acc {
  sum = 0;
  n = 0; // numeric values
  count = 0; // non-empty values
  min = Infinity;
  max = -Infinity;
  add(v: unknown) {
    if (v == null || v === "") return;
    this.count++;
    const x = asNumber(v);
    if (x == null) return;
    this.n++;
    this.sum += x;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }
  result(agg: PivotAgg): number | null {
    switch (agg) {
      case "count":
        return this.count;
      case "sum":
        return this.n ? round(this.sum) : null;
      case "average":
        return this.n ? round(this.sum / this.n) : null;
      case "min":
        return this.n ? this.min : null;
      case "max":
        return this.n ? this.max : null;
    }
  }
}

// Floating point noise from long sums (0.1 + 0.2) shouldn't reach the sheet.
const round = (x: number) => Math.round(x * 1e10) / 1e10;

/** Field names of a source table (its header row), made unique and non-empty. */
export function fieldNames(header: unknown[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    let name = h == null || String(h).trim() === "" ? `Column ${i + 1}` : String(h).trim();
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} ${n + 1}`;
    return name;
  });
}

/** Distinct values of a field, sorted, for the filter list. */
export function fieldItems(table: unknown[][], field: string): string[] {
  const names = fieldNames(table[0] || []);
  const i = names.indexOf(field);
  if (i < 0) return [];
  return [...new Set(table.slice(1).map((r) => keyText(r[i])))].sort(compareKeys);
}

type Tree = { key: string; children: Map<string, Tree>; accs: Map<string, Acc[]> };

const SEP = "\u0000";

export function computePivot(table: unknown[][], def: Pick<PivotDef, "rows" | "columns" | "values" | "filters" | "grandTotals" | "subtotals">): PivotGrid {
  const names = fieldNames(table[0] || []);
  const idx = (f: string) => names.indexOf(f);
  const rowF = def.rows.map(idx).filter((i) => i >= 0);
  const colF = def.columns.map(idx).filter((i) => i >= 0);
  const vals = def.values.filter((v) => idx(v.field) >= 0);
  const grand = def.grandTotals !== false;
  const subtotals = def.subtotals !== false;
  const filters = def.filters
    .map((f) => ({ i: idx(f.field), exclude: new Set(f.exclude) }))
    .filter((f) => f.i >= 0 && f.exclude.size);

  const records = table.slice(1).filter((r) => r.some((v) => v != null && v !== "") && filters.every((f) => !f.exclude.has(keyText(r[f.i]))));

  // Numbers stay numbers in the output labels (years, quantities...).
  const raw = new Map<string, number>();
  for (const r of records) for (const i of [...rowF, ...colF]) if (typeof r[i] === "number") raw.set(keyText(r[i]), r[i] as number);
  const label = (k: string): PivotCell => raw.get(k) ?? k;

  // Column keys (combinations of the column fields), sorted level by level.
  const colKeySet = new Map<string, string[]>();
  for (const r of records) {
    const k = colF.map((i) => keyText(r[i]));
    colKeySet.set(k.join(SEP), k);
  }
  const colKeys = [...colKeySet.values()].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      const c = compareKeys(a[i], b[i]);
      if (c) return c;
    }
    return 0;
  });
  if (!colF.length) colKeys.splice(0, colKeys.length, []);
  const TOTAL = `${SEP}total`;

  // Row tree with accumulators per (column key, value field), plus totals.
  const newAccs = () => vals.map(() => new Acc());
  const root: Tree = { key: "", children: new Map(), accs: new Map() };
  const accsOf = (t: Tree, ck: string) => {
    let a = t.accs.get(ck);
    if (!a) t.accs.set(ck, (a = newAccs()));
    return a;
  };
  for (const r of records) {
    const ck = colF.map((i) => keyText(r[i])).join(SEP);
    const path: Tree[] = [root];
    let t = root;
    for (const i of rowF) {
      const k = keyText(r[i]);
      let child = t.children.get(k);
      if (!child) t.children.set(k, (child = { key: k, children: new Map(), accs: new Map() }));
      t = child;
      path.push(t);
    }
    for (const node of path)
      for (const key of [ck, TOTAL])
        accsOf(node, key).forEach((acc, vi) => acc.add(r[idx(vals[vi].field)]));
  }

  // Leaf columns: each column key x value field, then the grand totals.
  type Leaf = { ck: string; vi: number; labels: string[] };
  const leaves: Leaf[] = [];
  for (const k of colKeys) vals.forEach((_v, vi) => leaves.push({ ck: k.join(SEP), vi, labels: k }));
  if (!vals.length) leaves.length = 0;
  const totalLeaves: Leaf[] = colF.length && grand ? vals.map((_v, vi) => ({ ck: TOTAL, vi, labels: [] })) : [];
  const allLeaves = [...leaves, ...totalLeaves];

  const lead = Math.max(1, rowF.length);
  const width = lead + allLeaves.length;
  const cells: PivotCell[][] = [];
  const boldRows: number[] = [];
  const blankRow = () => new Array<PivotCell>(width).fill(null);

  // Header. With column fields: a title row (the value name, and the column
  // field names), one row per column field, and a row of value names when
  // there are several. Row field names sit on the last header row.
  const multiVal = vals.length > 1;
  const headerRows = colF.length ? 1 + colF.length + (multiVal ? 1 : 0) : 1;
  for (let h = 0; h < headerRows; h++) cells.push(blankRow());
  if (colF.length) {
    cells[0][0] = vals.length === 1 ? valueLabel(vals[0]) : null;
    cells[0][lead] = colF.map((fi) => names[fi]).join(" / ");
    colF.forEach((_fi, h) => {
      let prev: string | null = null;
      leaves.forEach((leaf, li) => {
        const run = leaf.labels.slice(0, h + 1).join(SEP);
        if (run !== prev || h === colF.length - 1) cells[1 + h][lead + li] = label(leaf.labels[h]);
        prev = run;
      });
    });
    if (totalLeaves.length) cells[1][lead + leaves.length] = "Grand Total";
    if (multiVal) {
      const r = headerRows - 1;
      leaves.forEach((leaf, li) => (cells[r][lead + li] = valueLabel(vals[leaf.vi])));
      totalLeaves.forEach((leaf, ti) => (cells[r][lead + leaves.length + ti] = valueLabel(vals[leaf.vi])));
    }
  } else {
    vals.forEach((v, vi) => (cells[0][lead + vi] = valueLabel(v)));
  }
  rowF.forEach((fi, i) => (cells[headerRows - 1][i] = names[fi]));
  for (let h = 0; h < headerRows; h++) boldRows.push(h);

  const valueCells = (t: Tree): PivotCell[] =>
    allLeaves.map((leaf) => {
      const accs = t.accs.get(leaf.ck);
      return accs ? accs[leaf.vi].result(vals[leaf.vi].agg) : null;
    });

  // Body: rows in tree order; outer fields get a subtotal row after their items.
  const sorted = (t: Tree) => [...t.children.values()].sort((a, b) => compareKeys(a.key, b.key));
  const walk = (t: Tree, depth: number, prefix: string[]) => {
    for (const child of sorted(t)) {
      const keys = [...prefix, child.key];
      if (depth === rowF.length - 1) {
        const row = blankRow();
        keys.forEach((k, i) => (row[i] = i === keys.length - 1 || isFirstOf(keys, i) ? label(k) : null));
        valueCells(child).forEach((v, i) => (row[lead + i] = v));
        cells.push(row);
        lastKeys = keys;
      } else {
        walk(child, depth + 1, keys);
        if (subtotals) {
          const row = blankRow();
          row[depth] = `${child.key} Total`;
          valueCells(child).forEach((v, i) => (row[lead + i] = v));
          boldRows.push(cells.length);
          cells.push(row);
          lastKeys = [];
        }
      }
    }
  };
  // Repeat an outer label only on the first row of its block (Excel's tabular form).
  let lastKeys: string[] = [];
  const isFirstOf = (keys: string[], i: number) => keys.slice(0, i + 1).join(SEP) !== lastKeys.slice(0, i + 1).join(SEP);
  if (rowF.length) walk(root, 0, []);

  if (grand && (rowF.length || !colF.length)) {
    const row = blankRow();
    row[0] = "Grand Total";
    valueCells(root).forEach((v, i) => (row[lead + i] = v));
    boldRows.push(cells.length);
    cells.push(row);
  } else if (!rowF.length) {
    const row = blankRow();
    valueCells(root).forEach((v, i) => (row[lead + i] = v));
    cells.push(row);
  }

  return { cells, boldRows, boldColumns: totalLeaves.length ? totalLeaves.map((_l, i) => lead + leaves.length + i) : [], headerRows };
}
