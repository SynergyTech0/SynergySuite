// The live contents of a Sheet for mail merge. A Sheet that is open (or was
// edited since its last save) keeps its newest state in the collaboration
// document: a base workbook plus the log of Univer mutations after it. This
// replays the mutations that change cell contents or the layout of rows,
// columns and sheets onto the base, so a merge sees what people see in the
// Sheet right now rather than the last autosave. Number formats and defined
// names are replayed too, and formulas are worked out again on the result
// (lib/docs/sheet-recalc.ts, with Univer's own formula engine): formula results
// never travel in the log, since each client calculates them itself.
type Cell = Record<string, unknown>;
type CellData = Record<number, Record<number, Cell>>;
type Sheet = { id: string; name: string; cellData?: CellData; rowCount?: number; columnCount?: number; [k: string]: unknown };
export type LiveBook = { sheetOrder: string[]; sheets: Record<string, Sheet>; [k: string]: unknown };
type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type Op = { id: string; params?: Record<string, unknown> };

/** Mutations that never change what a merge reads (styles, sizes, protection, view state...). */
const IGNORED = /(style|width|height|hidden|visible|frozen|gridlines|tab-color|protection|permission|theme|filter|merge|right-to-left|row-data|col-data|row-count|column-count|default-style|workbook-name|empty|mark-dirty|auto-height|copy-worksheet-end|data-validation|conditional-rule|drawing|hyper-link|note|-table|calc-settings)/;

const NAMES = "SHEET_DEFINED_NAME_PLUGIN";
type Resource = { name: string; data: string };
/** The workbook's defined names (id -> Univer's definition), kept in its resources as Univer saves them. */
function names(book: LiveBook): Record<string, Record<string, unknown>> {
  const r = ((book.resources as Resource[] | undefined) || []).find((x) => x?.name === NAMES);
  try {
    return r?.data ? JSON.parse(r.data) : {};
  } catch {
    return {};
  }
}
function setNames(book: LiveBook, map: Record<string, Record<string, unknown>>) {
  if (!Array.isArray(book.resources)) book.resources = [];
  const list = book.resources as Resource[];
  const r = list.find((x) => x?.name === NAMES);
  if (r) r.data = JSON.stringify(map);
  else list.push({ name: NAMES, data: JSON.stringify(map) });
}

/** The style object of a cell (a registered style id resolved through the workbook's styles). */
function styleOf(book: LiveBook, cell: Cell | undefined): Record<string, unknown> {
  const s = cell?.s;
  if (!s) return {};
  if (typeof s === "string") return { ...(((book.styles as Record<string, Record<string, unknown>>) || {})[s] || {}) };
  return { ...(s as Record<string, unknown>) };
}
function eachCell(range: Range, f: (r: number, c: number) => void) {
  for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) f(r, c);
}

function rows(sheet: Sheet): CellData {
  return (sheet.cellData ??= {});
}

/** Univer's set-range-values merge: a null cell clears it, null properties delete them, others overwrite. */
function setValues(sheet: Sheet, matrix: Record<string, Record<string, Cell | null>>) {
  const data = rows(sheet);
  for (const [rk, row] of Object.entries(matrix || {})) {
    for (const [ck, nv] of Object.entries(row || {})) {
      const r = Number(rk);
      const c = Number(ck);
      if (!nv) {
        if (data[r]) delete data[r][c];
        continue;
      }
      const old: Cell = { ...(data[r]?.[c] || {}) };
      for (const [k, v] of Object.entries(nv)) {
        if (v === undefined) continue;
        if (v === null) delete old[k];
        else old[k] = v;
      }
      if (old.v === null) delete old.v;
      if (!Object.keys(old).length) {
        if (data[r]) delete data[r][c];
      } else (data[r] ??= {})[c] = old;
    }
  }
}

function shiftRows(sheet: Sheet, at: number, by: number) {
  const data = rows(sheet);
  const out: CellData = {};
  for (const [rk, row] of Object.entries(data)) {
    const r = Number(rk);
    if (by < 0 && r >= at && r < at - by) continue; // removed
    out[r >= at ? r + by : r] = row;
  }
  sheet.cellData = out;
  if (typeof sheet.rowCount === "number") sheet.rowCount += by;
}
function shiftCols(sheet: Sheet, at: number, by: number) {
  const data = rows(sheet);
  for (const [rk, row] of Object.entries(data)) {
    const out: Record<number, Cell> = {};
    for (const [ck, cell] of Object.entries(row || {})) {
      const c = Number(ck);
      if (by < 0 && c >= at && c < at - by) continue;
      out[c >= at ? c + by : c] = cell;
    }
    data[Number(rk)] = out;
  }
  if (typeof sheet.columnCount === "number") sheet.columnCount += by;
}
/** Move `count` rows (or columns) starting at `from` to before index `to` (counted before the move), as Univer's moveRows does. */
function moveLines<T>(list: Map<number, T>, from: number, count: number, to: number): Map<number, T> {
  const max = Math.max(from + count, to, ...list.keys()) + 1;
  const order = Array.from({ length: max }, (_, i) => i);
  const moving = order.splice(from, count);
  const dest = to > from ? to - count : to;
  order.splice(dest, 0, ...moving);
  const out = new Map<number, T>();
  order.forEach((old, i) => list.has(old) && out.set(i, list.get(old)!));
  return out;
}

/** Replay a mutation log onto a base workbook. `unsupported` lists value-changing mutations that could not be replayed. */
export function replayOps(base: LiveBook, ops: Op[]): { book: LiveBook; unsupported: string[] } {
  const book = JSON.parse(JSON.stringify(base)) as LiveBook;
  book.sheets ||= {};
  book.sheetOrder ||= Object.keys(book.sheets);
  const unsupported = new Set<string>();
  for (const op of ops) {
    const p = (op.params || {}) as Record<string, unknown>;
    const sheet = book.sheets[String(p.subUnitId)];
    const range = p.range as Range | undefined;
    switch (op.id) {
      case "sheet.mutation.set-range-values":
        if (sheet) setValues(sheet, p.cellValue as never);
        break;
      case "sheet.mutation.insert-row":
        if (sheet && range) shiftRows(sheet, range.startRow, range.endRow - range.startRow + 1);
        break;
      case "sheet.mutation.remove-rows":
        if (sheet && range) shiftRows(sheet, range.startRow, -(range.endRow - range.startRow + 1));
        break;
      case "sheet.mutation.insert-col":
        if (sheet && range) shiftCols(sheet, range.startColumn, range.endColumn - range.startColumn + 1);
        break;
      case "sheet.mutation.remove-col":
        if (sheet && range) shiftCols(sheet, range.startColumn, -(range.endColumn - range.startColumn + 1));
        break;
      case "sheet.mutation.move-rows": {
        const s = p.sourceRange as Range;
        const t = p.targetRange as Range;
        if (sheet && s && t) {
          const m = moveLines(new Map(Object.entries(rows(sheet)).map(([k, v]) => [Number(k), v])), s.startRow, s.endRow - s.startRow + 1, t.startRow);
          sheet.cellData = Object.fromEntries(m);
        }
        break;
      }
      case "sheet.mutation.move-columns": {
        const s = p.sourceRange as Range;
        const t = p.targetRange as Range;
        if (sheet && s && t) {
          const data = rows(sheet);
          for (const rk of Object.keys(data)) {
            const m = moveLines(new Map(Object.entries(data[Number(rk)] || {}).map(([k, v]) => [Number(k), v])), s.startColumn, s.endColumn - s.startColumn + 1, t.startColumn);
            data[Number(rk)] = Object.fromEntries(m);
          }
        }
        break;
      }
      case "sheet.mutation.move-range": {
        for (const side of ["from", "to"] as const) {
          const v = p[side] as { subUnitId?: string; value?: Record<string, Record<string, Cell | null>> } | undefined;
          const sh = v?.subUnitId ? book.sheets[v.subUnitId] : undefined;
          if (!sh || !v?.value) continue;
          const data = rows(sh);
          for (const [rk, row] of Object.entries(v.value))
            for (const [ck, cell] of Object.entries(row || {})) {
              if (cell == null) delete data[Number(rk)]?.[Number(ck)];
              else (data[Number(rk)] ??= {})[Number(ck)] = cell;
            }
        }
        break;
      }
      case "sheet.mutation.reorder-range": {
        // sort: row r takes the cells row order[r] had
        const order = (p.order || {}) as Record<string, number>;
        if (sheet && range) {
          const data = rows(sheet);
          const snap = JSON.parse(JSON.stringify(data)) as CellData;
          for (const [rk, from] of Object.entries(order)) {
            const r = Number(rk);
            for (let c = range.startColumn; c <= range.endColumn; c++) {
              const cell = snap[from]?.[c];
              if (cell) (data[r] ??= {})[c] = cell;
              else if (data[r]) delete data[r][c];
            }
          }
        }
        break;
      }
      case "sheet.mutation.insert-sheet": {
        const s = p.sheet as Sheet | undefined;
        if (s?.id) {
          book.sheets[s.id] = JSON.parse(JSON.stringify(s));
          if (!book.sheetOrder.includes(s.id)) book.sheetOrder.splice(typeof p.index === "number" ? p.index : book.sheetOrder.length, 0, s.id);
        }
        break;
      }
      case "sheet.mutation.remove-sheet":
        delete book.sheets[String(p.subUnitId)];
        book.sheetOrder = book.sheetOrder.filter((x) => x !== String(p.subUnitId));
        break;
      case "sheet.mutation.set-worksheet-name":
        if (sheet && typeof p.name === "string") sheet.name = p.name;
        break;
      case "sheet.mutation.set-worksheet-order": {
        const id = String(p.subUnitId);
        if (typeof p.toOrder === "number" && book.sheetOrder.includes(id)) {
          book.sheetOrder = book.sheetOrder.filter((x) => x !== id);
          book.sheetOrder.splice(p.toOrder, 0, id);
        }
        break;
      }
      case "sheet.mutation.set.numfmt": {
        // number formats live in the cells' styles (n.pattern), as Univer's numfmt service puts them
        const values = (p.values || {}) as Record<string, { ranges?: Range[] }>;
        const refMap = (p.refMap || {}) as Record<string, { pattern?: string }>;
        if (!sheet) break;
        const data = rows(sheet);
        for (const [id, v] of Object.entries(values)) {
          const pattern = refMap[id]?.pattern;
          if (!pattern) continue;
          for (const range of v.ranges || [])
            eachCell(range, (r, c) => {
              const cell = data[r]?.[c];
              (data[r] ??= {})[c] = { ...(cell || {}), s: { ...styleOf(book, cell), n: { pattern } } };
            });
        }
        break;
      }
      case "sheet.mutation.remove.numfmt": {
        if (!sheet) break;
        const data = rows(sheet);
        for (const range of (p.ranges || []) as Range[])
          eachCell(range, (r, c) => {
            const cell = data[r]?.[c];
            if (!cell?.s) return;
            const { n: _n, ...rest } = styleOf(book, cell);
            data[r][c] = { ...cell, s: rest };
          });
        break;
      }
      case "formula.mutation.set-defined-name": {
        const id = String(p.id || "");
        if (!id) break;
        const map = names(book);
        map[id] = { ...map[id], ...p };
        delete map[id].unitId;
        setNames(book, map);
        break;
      }
      case "formula.mutation.remove-defined-name": {
        const map = names(book);
        delete map[String(p.id || "")];
        setNames(book, map);
        break;
      }
      default:
        if (!IGNORED.test(op.id)) unsupported.add(op.id);
    }
  }
  return { book, unsupported: [...unsupported] };
}

/** Parse the collaboration document's base and log; null when the Sheet has not been opened collaboratively. */
export function liveBookFrom(baseJson: string | undefined, opStrings: string[]): { book: LiveBook; unsupported: string[]; ops: number } | null {
  if (!baseJson) return null;
  let base: LiveBook;
  try {
    base = JSON.parse(baseJson);
  } catch {
    return null;
  }
  if (!base?.sheets) return null;
  const ops: Op[] = [];
  for (const s of opStrings) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o.id === "string") ops.push(o);
    } catch {
      /* skip a damaged entry */
    }
  }
  return { ...replayOps(base, ops), ops: ops.length };
}
