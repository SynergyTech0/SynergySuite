// Table helpers: merged cells, borders, rows/columns and cell text. A table is
// a full grid (every row has one cell per column); a merged range keeps its
// content in the anchor cell (cs/rs) and marks the cells it covers `merged`.

import type { CellBorder, TableCell, TableEl } from "./model";

export const DEFAULT_BORDER = "BFBFBF";

export type CellRect = { r0: number; c0: number; r1: number; c1: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text of slide-text HTML: one line per paragraph or <br>. Works without a DOM. */
export function htmlPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li)>\s*(?=<)/gi, "</$1>\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m))
    .replace(/\n+$/, "");
}

/** The cell's content as paragraph HTML. */
export function cellHtml(c: TableCell): string {
  if (c.html) return c.html;
  if (!c.text) return "";
  return c.text.split("\n").map((l) => `<p>${esc(l)}</p>`).join("");
}

/** Set a cell's rich text (keeps `text` in step for search). */
export function withHtml(c: TableCell, html: string): TableCell {
  const text = htmlPlain(html);
  const n: TableCell = { ...c, text };
  if (html && html !== cellHtml({ text })) n.html = html;
  else delete n.html;
  return n;
}

export const gridCols = (rows: TableCell[][]) => Math.max(1, ...rows.map((r) => r.length));

/** Make the grid rectangular and the spans consistent (covered cells marked, orphans freed). */
export function normalizeTable(rows: TableCell[][]): TableCell[][] {
  const nc = gridCols(rows);
  const out = rows.map((r) => Array.from({ length: nc }, (_, c) => ({ ...(r[c] || { text: "" }) })));
  const covered = out.map((r) => r.map(() => false));
  out.forEach((r, ri) =>
    r.forEach((cell, ci) => {
      if (covered[ri][ci]) return;
      delete cell.merged;
      const cs = Math.max(1, Math.min(cell.cs || 1, nc - ci));
      const rs = Math.max(1, Math.min(cell.rs || 1, out.length - ri));
      if (cs > 1) cell.cs = cs; else delete cell.cs;
      if (rs > 1) cell.rs = rs; else delete cell.rs;
      for (let y = ri; y < ri + rs; y++)
        for (let x = ci; x < ci + cs; x++) {
          if (y === ri && x === ci) continue;
          covered[y][x] = true;
          const k = out[y][x];
          out[y][x] = { text: "", merged: true, ...(k.fill ? { fill: k.fill } : {}), ...(k.bd ? { bd: k.bd } : {}) };
        }
    }),
  );
  return out;
}

/** The anchor cell (row, col) of the merged range covering a grid position. */
export function anchorAt(rows: TableCell[][], r: number, c: number): [number, number] {
  for (let y = r; y >= 0; y--)
    for (let x = c; x >= 0; x--) {
      const k = rows[y]?.[x];
      if (!k || k.merged) continue;
      if (y + (k.rs || 1) > r && x + (k.cs || 1) > c) return [y, x];
    }
  return [r, c];
}

/** Grow a rectangle until no merged range crosses its edge. */
export function expandRect(rows: TableCell[][], rect: CellRect): CellRect {
  let { r0, c0, r1, c1 } = { r0: Math.min(rect.r0, rect.r1), c0: Math.min(rect.c0, rect.c1), r1: Math.max(rect.r0, rect.r1), c1: Math.max(rect.c0, rect.c1) };
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = r0; y <= r1; y++)
      for (let x = c0; x <= c1; x++) {
        const [ay, ax] = anchorAt(rows, y, x);
        const a = rows[ay][ax];
        const ey = ay + (a.rs || 1) - 1, ex = ax + (a.cs || 1) - 1;
        if (ay < r0 || ax < c0 || ey > r1 || ex > c1) {
          r0 = Math.min(r0, ay); c0 = Math.min(c0, ax); r1 = Math.max(r1, ey); c1 = Math.max(c1, ex);
          changed = true;
        }
      }
  }
  return { r0, c0, r1, c1 };
}

/** Merge a range: the anchor keeps every non-empty cell's content, one paragraph each. */
export function mergeCells(rows: TableCell[][], rect: CellRect): TableCell[][] {
  const g = normalizeTable(rows);
  const { r0, c0, r1, c1 } = expandRect(g, rect);
  if (r0 === r1 && c0 === c1) return g;
  const parts: string[] = [];
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (!g[y][x].merged && g[y][x].text.trim()) parts.push(cellHtml(g[y][x]));
  const anchor = g[r0][c0];
  g[r0][c0] = { ...withHtml(anchor, parts.join("")), cs: c1 - c0 + 1, rs: r1 - r0 + 1 };
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (y !== r0 || x !== c0) g[y][x] = { text: "", merged: true };
  return normalizeTable(g);
}

/** Undo the merge covering (r, c); the freed cells take the anchor's fill. */
export function splitCell(rows: TableCell[][], r: number, c: number): TableCell[][] {
  const g = normalizeTable(rows);
  const [ay, ax] = anchorAt(g, r, c);
  const a = g[ay][ax];
  const rs = a.rs || 1, cs = a.cs || 1;
  if (rs === 1 && cs === 1) return g;
  g[ay][ax] = { ...a };
  delete g[ay][ax].rs;
  delete g[ay][ax].cs;
  for (let y = ay; y < ay + rs; y++)
    for (let x = ax; x < ax + cs; x++) if (y !== ay || x !== ax) g[y][x] = { text: "", ...(a.fill ? { fill: a.fill } : {}), ...(a.valign ? { valign: a.valign } : {}) };
  return g;
}

/** Insert a row before `at` (rows.length = append). Merges crossing the new row grow over it. */
export function insertRow(el: TableEl, at: number): Pick<TableEl, "rows" | "rowH" | "h"> {
  const g = normalizeTable(el.rows);
  const nc = gridCols(g);
  const proto = g[Math.max(0, Math.min(at, g.length) - 1)] || [];
  const row: TableCell[] = Array.from({ length: nc }, (_, c) => ({ text: "", ...(proto[c]?.fill && !proto[c]?.merged ? { fill: proto[c].fill } : {}) }));
  if (at > 0 && at < g.length)
    for (let c = 0; c < nc; c++) {
      const [ay, ax] = anchorAt(g, at, c);
      if (ay < at && ax === c) {
        // a vertical merge passes through: it grows by one row
        const a = g[ay][ax];
        a.rs = (a.rs || 1) + 1;
        for (let x = ax; x < ax + (a.cs || 1); x++) row[x] = { text: "", merged: true };
      }
    }
  const rows = [...g.slice(0, at), row, ...g.slice(at)];
  const rh = el.h / Math.max(1, g.length);
  const rowH = el.rowH && el.rowH.length === g.length ? [...el.rowH.slice(0, at), rh, ...el.rowH.slice(at)] : undefined;
  return { rows: normalizeTable(rows), ...(rowH ? { rowH } : {}), h: el.h + rh };
}

/** Insert a column before `at` (cols = append). */
export function insertCol(el: TableEl, at: number): Pick<TableEl, "rows" | "colW"> {
  const g = normalizeTable(el.rows);
  const nc = gridCols(g);
  const rows = g.map((r, ri) => {
    const left = r[at - 1];
    let cell: TableCell = { text: "", ...(left?.fill && !left.merged && ri === 0 ? { fill: left.fill } : {}) };
    if (at > 0 && at < nc) {
      const [ay, ax] = anchorAt(g, ri, at);
      if (ax < at) {
        if (ay === ri) g[ay][ax].cs = (g[ay][ax].cs || 1) + 1;
        cell = { text: "", merged: true };
      }
    }
    return [...r.slice(0, at), cell, ...r.slice(at)];
  });
  const cw = el.colW && el.colW.length === nc ? [...el.colW.slice(0, at), el.colW[Math.max(0, at - 1)] || el.w / nc, ...el.colW.slice(at)] : undefined;
  return { rows: normalizeTable(rows), ...(cw ? { colW: cw } : {}) };
}

/** Delete row `at`. A merge starting there moves its anchor down; one crossing it shrinks. */
export function deleteRow(el: TableEl, at: number): Pick<TableEl, "rows" | "rowH" | "h"> | null {
  const g = normalizeTable(el.rows);
  if (g.length <= 1) return null;
  const nc = gridCols(g);
  for (let c = 0; c < nc; c++) {
    const [ay, ax] = anchorAt(g, at, c);
    if (ax !== c) continue;
    const a = g[ay][ax];
    if ((a.rs || 1) < 2) continue;
    if (ay < at) a.rs = (a.rs || 1) - 1;
    else g[at + 1][ax] = { ...a, rs: (a.rs || 1) - 1 };
  }
  const rh = el.rowH && el.rowH.length === g.length ? el.rowH[at] : el.h / g.length;
  const rows = g.filter((_, i) => i !== at);
  return { rows: normalizeTable(rows), ...(el.rowH && el.rowH.length === g.length ? { rowH: el.rowH.filter((_, i) => i !== at) } : {}), h: Math.max(8, el.h - rh) };
}

/** Delete column `at`. */
export function deleteCol(el: TableEl, at: number): Pick<TableEl, "rows" | "colW"> | null {
  const g = normalizeTable(el.rows);
  const nc = gridCols(g);
  if (nc <= 1) return null;
  for (let r = 0; r < g.length; r++) {
    const [ay, ax] = anchorAt(g, r, at);
    if (ay !== r) continue;
    const a = g[ay][ax];
    if ((a.cs || 1) < 2) continue;
    if (ax < at) a.cs = (a.cs || 1) - 1;
    else g[ay][at + 1] = { ...a, cs: (a.cs || 1) - 1 };
  }
  const rows = g.map((r) => r.filter((_, i) => i !== at));
  return { rows: normalizeTable(rows), ...(el.colW && el.colW.length === nc ? { colW: el.colW.filter((_, i) => i !== at) } : {}) };
}

/** Apply `patch` to the anchor cells inside a range. */
export function patchCells(rows: TableCell[][], rect: CellRect, patch: (c: TableCell) => TableCell): TableCell[][] {
  const g = normalizeTable(rows);
  const { r0, c0, r1, c1 } = expandRect(g, rect);
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (!g[y][x].merged) g[y][x] = patch(g[y][x]);
  return g;
}

export type BorderMode = "all" | "outer" | "inner" | "none" | "top" | "bottom" | "left" | "right";
export const BORDER_MODES: { id: BorderMode; label: string }[] = [
  { id: "all", label: "All borders" },
  { id: "outer", label: "Outside borders" },
  { id: "inner", label: "Inside borders" },
  { id: "none", label: "No border" },
  { id: "top", label: "Top border" },
  { id: "bottom", label: "Bottom border" },
  { id: "left", label: "Left border" },
  { id: "right", label: "Right border" },
];

/**
 * Set borders on a range. Each edge is written on both cells that share it, so
 * the drawn table and PowerPoint (which reads either side) agree. "none" clears
 * every edge of the range; the other modes set only their edges.
 */
export function setBorders(rows: TableCell[][], rect: CellRect, mode: BorderMode, line: CellBorder): TableCell[][] {
  const g = normalizeTable(rows);
  const { r0, c0, r1, c1 } = expandRect(g, rect);
  const b = mode === "none" ? { c: line.c, w: 0 } : line;
  const set = (y: number, x: number, side: "t" | "r" | "b" | "l") => {
    if (y < 0 || x < 0 || y >= g.length || x >= g[y].length) return;
    const [ay, ax] = anchorAt(g, y, x);
    const a = g[ay][ax];
    // only an anchor's outer edge on that side is drawn
    const ey = ay + (a.rs || 1) - 1, ex = ax + (a.cs || 1) - 1;
    if ((side === "t" && y !== ay) || (side === "b" && y !== ey) || (side === "l" && x !== ax) || (side === "r" && x !== ex)) return;
    g[ay][ax] = { ...a, bd: { ...a.bd, [side]: b } };
  };
  const edge = (y: number, x: number, side: "t" | "r" | "b" | "l") => {
    set(y, x, side);
    if (side === "t") set(y - 1, x, "b");
    if (side === "b") set(y + 1, x, "t");
    if (side === "l") set(y, x - 1, "r");
    if (side === "r") set(y, x + 1, "l");
  };
  for (let y = r0; y <= r1; y++)
    for (let x = c0; x <= c1; x++) {
      const top = y === r0, bottom = y === r1, left = x === c0, right = x === c1;
      const want = (side: "t" | "r" | "b" | "l", outer: boolean) =>
        mode === "all" || mode === "none" || (mode === "outer" && outer) || (mode === "inner" && !outer) ||
        (mode === "top" && side === "t" && outer) || (mode === "bottom" && side === "b" && outer) ||
        (mode === "left" && side === "l" && outer) || (mode === "right" && side === "r" && outer);
      if (want("t", top)) edge(y, x, "t");
      if (want("b", bottom)) edge(y, x, "b");
      if (want("l", left)) edge(y, x, "l");
      if (want("r", right)) edge(y, x, "r");
    }
  return g;
}

/** Fractions of the table's width/height for each column/row. */
export function fractions(sizes: number[] | undefined, n: number): number[] {
  if (!sizes || sizes.length !== n || sizes.some((v) => !(v > 0))) return Array.from({ length: n }, () => 1 / n);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((v) => v / sum);
}

/** CSS for one side of a cell border. */
export function borderCss(b: CellBorder | undefined, table: string | undefined): string {
  if (!b) return `1px solid #${table || DEFAULT_BORDER}`;
  return b.w > 0 ? `${b.w}px solid #${b.c}` : "none";
}

/** The smallest a row or column can be dragged to (px). */
export const MIN_CELL = 12;
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Drag the border to the right of column `i` by `d` px: an inner border
 * trades width with the next column (the table keeps its width), the right
 * edge widens or narrows the table.
 */
export function dragColBorder(widths: number[], i: number, d: number): { colW: number[]; w: number } {
  const w = [...widths];
  if (i < w.length - 1) {
    const k = Math.max(MIN_CELL - w[i], Math.min(w[i + 1] - MIN_CELL, d));
    w[i] += k;
    w[i + 1] -= k;
  } else w[i] = Math.max(MIN_CELL, w[i] + d);
  const colW = w.map(r1);
  return { colW, w: r1(colW.reduce((a, b) => a + b, 0)) };
}

/** Drag the border below row `i` by `d` px: that row grows or shrinks and the table with it. */
export function dragRowBorder(heights: number[], i: number, d: number): { rowH: number[]; h: number } {
  const rowH = heights.map((v, k) => r1(k === i ? Math.max(MIN_CELL, v + d) : v));
  return { rowH, h: r1(rowH.reduce((a, b) => a + b, 0)) };
}
