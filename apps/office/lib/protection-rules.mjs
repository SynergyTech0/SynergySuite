// Sheet and range protection rules, shared by the browser (which stops a
// blocked edit before it happens), the collaboration server (which refuses a
// blocked edit that reaches it anyway) and the REST save route. Plain
// JavaScript so `node server/collab.mjs` can import it without a build step.
//
// A protection covers a whole sheet (range: null) or one rectangle. The owner
// of the document and the people listed in `editors` may change what it
// covers; everyone else with edit access may not. A sheet protection can name
// `except` ranges that anyone with edit access may still change, like Excel's
// "allow edit ranges". Viewers and commenters never edit anything.
//
// Edits arrive as Univer mutations ({ id, params }). Each one is classified by
// what it touches: cells (values, formats, merges), whole rows or columns
// (insert, delete, move), or the sheet itself (rename, delete, row heights).

/**
 * @typedef {{ startRow: number, endRow: number, startColumn: number, endColumn: number }} Rect
 * @typedef {{ id: string, sheetId: string, range: Rect | null, editors: string[], description?: string, except?: Rect[], exceptPasswords?: (Record<string, string> | null)[], xlsx?: Record<string, string> }} Protection
 * @typedef {{ email?: string | null, role?: string | null }} Actor
 */

export const PROTECTION_RESOURCE = "SHEET_SYNERGY_PROTECTION_PLUGIN";
export const SET_PROTECTIONS_MUTATION = "sheet.mutation.set-protected-ranges";
export const PROTECTED_MESSAGE = "That part of the sheet is protected. Ask the owner for edit access.";

const BIG = 1 << 30;
const norm = (email) => String(email || "").trim().toLowerCase();

/**
 * May this person change what the protection covers? "*" among the editors
 * means anyone with edit access (a sheet locked by a password instead, which
 * the browser asks for; see lib/sheet-protection.ts).
 */
export function canEditProtection(p, actor) {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  if (actor.role !== "editor") return false;
  if ((p.editors || []).includes("*")) return true;
  const me = norm(actor.email);
  return !!me && (p.editors || []).some((e) => norm(e) === me);
}

const intersects = (a, b) => a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
const contains = (outer, r, c) => r >= outer.startRow && r <= outer.endRow && c >= outer.startColumn && c <= outer.endColumn;

/** Does protection `p` cover cell (r, c)? */
export function covers(p, r, c) {
  if (p.range) return contains(p.range, r, c);
  return !(p.except || []).some((x) => contains(x, r, c));
}

function rectCovered(p, rect) {
  if (p.range) return intersects(p.range, rect);
  const ex = p.except || [];
  if (!ex.length) return true;
  // Only blocked when some cell of the rectangle lies outside every exception.
  const cells = (rect.endRow - rect.startRow + 1) * (rect.endColumn - rect.startColumn + 1);
  if (cells > 200000) return true;
  for (let r = rect.startRow; r <= rect.endRow; r++)
    for (let c = rect.startColumn; c <= rect.endColumn; c++) if (!ex.some((x) => contains(x, r, c))) return true;
  return false;
}

/** A rectangle from a Univer range, with whole rows/columns made finite. */
function rect(g) {
  if (!g || typeof g !== "object") return null;
  const sr = Number.isFinite(g.startRow) && g.startRow >= 0 ? g.startRow : 0;
  const sc = Number.isFinite(g.startColumn) && g.startColumn >= 0 ? g.startColumn : 0;
  const er = Number.isFinite(g.endRow) && g.endRow >= 0 ? g.endRow : BIG;
  const ec = Number.isFinite(g.endColumn) && g.endColumn >= 0 ? g.endColumn : BIG;
  // Whole rows (rangeType 1) span every column; whole columns (2) every row; all (3) both.
  if (g.rangeType === 1) return { startRow: sr, endRow: er, startColumn: 0, endColumn: BIG };
  if (g.rangeType === 2) return { startRow: 0, endRow: BIG, startColumn: sc, endColumn: ec };
  if (g.rangeType === 3) return { startRow: 0, endRow: BIG, startColumn: 0, endColumn: BIG };
  return { startRow: sr, endRow: er, startColumn: sc, endColumn: ec };
}

/** Cells of an object matrix ({ row: { col: value } }) as one-cell rectangles. */
function matrixCells(m, out) {
  if (!m || typeof m !== "object") return;
  for (const [rk, row] of Object.entries(m)) {
    const r = Number(rk);
    if (!Number.isFinite(r) || !row || typeof row !== "object") continue;
    for (const ck of Object.keys(row)) {
      const c = Number(ck);
      if (Number.isFinite(c)) out.push({ startRow: r, endRow: r, startColumn: c, endColumn: c });
    }
  }
}

// Sheet-level mutations anyone with edit access may run on a protected sheet:
// view settings and bookkeeping the engine runs as a side effect of allowed edits.
const ALWAYS_ALLOWED = new Set([
  "sheet.mutation.insert-sheet",
  "sheet.mutation.copy-worksheet-end",
  "sheet.mutation.set-worksheet-order",
  "sheet.mutation.set-frozen",
  "sheet.mutation.toggle-gridlines",
  "sheet.mutation.set-gridlines-color",
  "sheet.mutation.set-worksheet-row-auto-height",
  "sheet.mutation.set-worksheet-row-is-auto-height",
  "sheet.mutation.set-worksheet-row-count",
  "sheet.mutation.set-worksheet-column-count",
  "sheet.mutation.set-workbook-name",
  "sheet.mutation.set-pivot-tables",
  "sheet.mutation.set-sheet-charts",
  "sheet.mutation.empty",
  "formula.mutation.set-defined-name",
  "formula.mutation.remove-defined-name",
]);
// Row and column layout changes: blocked by a sheet protection, not by a range one.
const LAYOUT = new Set([
  "sheet.mutation.set-worksheet-row-height",
  "sheet.mutation.set-worksheet-col-width",
  "sheet.mutation.set-row-hidden",
  "sheet.mutation.set-row-visible",
  "sheet.mutation.set-col-hidden",
  "sheet.mutation.set-col-visible",
  "sheet.mutation.set-row-data",
  "sheet.mutation.set-col-data",
]);

/**
 * What a mutation touches.
 * @returns {{ sheets: string[], cells: Array<{ sheetId: string, rect: Rect }>, rows?: { sheetId: string, kind: string, start: number, end: number, to?: number }, cols?: { sheetId: string, kind: string, start: number, end: number, to?: number }, removesSheet?: string, layout?: boolean, sheetLevel?: boolean, protections?: boolean, free?: boolean }}
 */
export function classify(op) {
  const id = op?.id || "";
  const p = op?.params || {};
  const sheetId = p.subUnitId || p.sheetId || null;
  const out = { sheets: sheetId ? [sheetId] : [], cells: [] };
  if (id === SET_PROTECTIONS_MUTATION) return { ...out, protections: true };
  if (ALWAYS_ALLOWED.has(id)) return { ...out, free: true };
  if (!sheetId && id !== "sheet.mutation.move-range") return { ...out, free: true }; // workbook-level
  const push = (sid, g) => {
    const r = rect(g);
    if (r) out.cells.push({ sheetId: sid, rect: r });
  };
  switch (id) {
    case "sheet.mutation.insert-row":
      return { ...out, rows: { sheetId, kind: "insert", start: p.range?.startRow ?? 0, end: p.range?.endRow ?? 0 } };
    case "sheet.mutation.remove-rows":
      return { ...out, rows: { sheetId, kind: "remove", start: p.range?.startRow ?? 0, end: p.range?.endRow ?? 0 } };
    case "sheet.mutation.insert-col":
      return { ...out, cols: { sheetId, kind: "insert", start: p.range?.startColumn ?? 0, end: p.range?.endColumn ?? 0 } };
    case "sheet.mutation.remove-col":
      return { ...out, cols: { sheetId, kind: "remove", start: p.range?.startColumn ?? 0, end: p.range?.endColumn ?? 0 } };
    case "sheet.mutation.move-rows":
      return { ...out, rows: { sheetId, kind: "move", start: p.sourceRange?.startRow ?? 0, end: p.sourceRange?.endRow ?? 0, to: p.targetRange?.startRow ?? 0 } };
    case "sheet.mutation.move-columns":
      return { ...out, cols: { sheetId, kind: "move", start: p.sourceRange?.startColumn ?? 0, end: p.sourceRange?.endColumn ?? 0, to: p.targetRange?.startColumn ?? 0 } };
    case "sheet.mutation.remove-sheet":
      return { ...out, removesSheet: sheetId };
    case "sheet.mutation.move-range": {
      const from = p.from?.subUnitId;
      const to = p.to?.subUnitId;
      const cells = [];
      const a = [];
      matrixCells(p.from?.value, a);
      a.forEach((r) => cells.push({ sheetId: from, rect: r }));
      const b = [];
      matrixCells(p.to?.value, b);
      b.forEach((r) => cells.push({ sheetId: to, rect: r }));
      return { sheets: [from, to].filter(Boolean), cells };
    }
  }
  if (LAYOUT.has(id)) return { ...out, layout: true };
  // Cell-level: gather every place the params name.
  if (p.cellValue) {
    const a = [];
    matrixCells(p.cellValue, a);
    a.forEach((r) => push(sheetId, r));
  }
  if (p.range) push(sheetId, p.range);
  if (Array.isArray(p.ranges)) p.ranges.forEach((g) => push(sheetId, g));
  if (p.rule?.ranges) p.rule.ranges.forEach((g) => push(sheetId, g));
  if (Array.isArray(p.rule)) p.rule.forEach((r) => (r?.ranges || []).forEach((g) => push(sheetId, g)));
  if (p.values && typeof p.values === "object")
    for (const v of Object.values(p.values)) (v?.ranges || []).forEach((g) => push(sheetId, g));
  if (Number.isFinite(p.row) && (Number.isFinite(p.col) || Number.isFinite(p.column))) {
    const c = Number.isFinite(p.col) ? p.col : p.column;
    push(sheetId, { startRow: p.row, endRow: p.row, startColumn: c, endColumn: c });
  }
  if (p.link && Number.isFinite(p.link.row)) push(sheetId, { startRow: p.link.row, endRow: p.link.row, startColumn: p.link.column, endColumn: p.link.column });
  if (!out.cells.length) out.sheetLevel = true; // nothing narrower to go on
  return out;
}

/**
 * Why `actor` may not apply `op` under `protections`, or null when allowed.
 * @param {Protection[]} protections
 * @param {{ id: string, params?: any }} op
 * @param {Actor} actor
 */
export function violation(protections, op, actor) {
  if (actor?.role === "owner") return null;
  const k = classify(op);
  if (k.protections) return "Only the owner can change protections.";
  if (k.free || !protections?.length) return null;
  const blocking = protections.filter((p) => !canEditProtection(p, actor));
  if (!blocking.length) return null;
  for (const p of blocking) {
    if (!k.sheets.includes(p.sheetId) && !k.cells.some((c) => c.sheetId === p.sheetId)) continue;
    const whole = !p.range;
    if (k.removesSheet === p.sheetId) return PROTECTED_MESSAGE;
    if (whole && (k.sheetLevel || k.layout || k.rows || k.cols)) return PROTECTED_MESSAGE;
    for (const c of k.cells) if (c.sheetId === p.sheetId && rectCovered(p, c.rect)) return PROTECTED_MESSAGE;
    if (p.range && k.rows?.sheetId === p.sheetId && axisBlocked(k.rows, p.range.startRow, p.range.endRow)) return PROTECTED_MESSAGE;
    if (p.range && k.cols?.sheetId === p.sheetId && axisBlocked(k.cols, p.range.startColumn, p.range.endColumn)) return PROTECTED_MESSAGE;
  }
  return null;
}

// Inserting above or deleting entirely outside a protected range just moves it;
// inserting inside, deleting any of it, or moving lines into or out of it is a change.
function axisBlocked(a, ps, pe) {
  if (a.kind === "insert") return a.start > ps && a.start <= pe;
  if (a.kind === "remove") return a.start <= pe && a.end >= ps;
  if (a.kind === "move") return (a.start <= pe && a.end >= ps) || (a.to > ps && a.to <= pe);
  return false;
}

function shiftIndex(i, a) {
  const n = a.end - a.start + 1;
  if (a.kind === "insert") return i >= a.start ? i + n : i;
  if (a.kind === "remove") return i > a.end ? i - n : i;
  if (a.kind === "move") {
    if (i >= a.start && i <= a.end) return a.to > a.end ? i + (a.to - a.end - 1) : i - (a.start - a.to);
    if (a.to > a.end && i > a.end && i < a.to) return i - n;
    if (a.to < a.start && i >= a.to && i < a.start) return i + n;
  }
  return i;
}

/** [start, end] after a structural change, or null when it was deleted. */
function shiftSpan(s, e, a) {
  if (a.kind === "remove") {
    const n = a.end - a.start + 1;
    if (a.start <= s && a.end >= e) return null;
    const ns = s > a.end ? s - n : s >= a.start ? a.start : s;
    const ne = e > a.end ? e - n : e >= a.start ? a.start - 1 : e;
    return ne < ns ? null : [ns, ne];
  }
  if (a.kind === "insert" && a.start > s && a.start <= e) return [s, e + (a.end - a.start + 1)];
  const ns = shiftIndex(s, a);
  const ne = shiftIndex(e, a);
  return [Math.min(ns, ne), Math.max(ns, ne)];
}

function shiftRect(r, k) {
  let out = { ...r };
  if (k.rows) {
    const s = shiftSpan(out.startRow, out.endRow, k.rows);
    if (!s) return null;
    out = { ...out, startRow: s[0], endRow: s[1] };
  }
  if (k.cols) {
    const s = shiftSpan(out.startColumn, out.endColumn, k.cols);
    if (!s) return null;
    out = { ...out, startColumn: s[0], endColumn: s[1] };
  }
  return out;
}

/**
 * Where a rectangle on `sheetId` ends up after `op` (rows or columns inserted,
 * deleted or moved): the same object when nothing moved, null when its cells
 * or its sheet were deleted. Other features (sparklines) follow edits with it.
 * @template {Rect} R
 * @param {R} r
 * @param {string} sheetId
 * @param {any} op
 * @returns {R | null}
 */
export function rectAfter(r, sheetId, op) {
  const k = classify(op);
  if (k.removesSheet) return k.removesSheet === sheetId ? null : r;
  const axis = k.rows || k.cols;
  if (!axis || axis.sheetId !== sheetId) return r;
  const out = shiftRect(r, k);
  if (!out) return null;
  return out.startRow === r.startRow && out.endRow === r.endRow && out.startColumn === r.startColumn && out.endColumn === r.endColumn ? r : out;
}

/**
 * Protections after `op`: structural edits move or shrink the ranges, a
 * deleted sheet takes its protections with it, and the protections mutation
 * replaces the list. Every client and the server run this in the same op
 * order, so they agree on where each protection is.
 * @param {Protection[]} protections
 * @returns {Protection[]}
 */
export function foldProtections(protections, op) {
  if (!op?.id) return protections;
  if (op.id === SET_PROTECTIONS_MUTATION) return Array.isArray(op.params?.value) ? op.params.value : protections;
  const k = classify(op);
  if (k.removesSheet) return protections.filter((p) => p.sheetId !== k.removesSheet);
  const axis = k.rows || k.cols;
  if (!axis) return protections;
  let changed = false;
  const next = [];
  for (const p of protections) {
    if (p.sheetId !== axis.sheetId) {
      next.push(p);
      continue;
    }
    const range = p.range ? shiftRect(p.range, k) : null;
    if (p.range && !range) {
      changed = true;
      continue; // its cells were deleted
    }
    // A deleted exception takes its password with it.
    const moved = (p.except || []).map((x, i) => ({ rect: shiftRect(x, k), pw: p.exceptPasswords?.[i] ?? null })).filter((x) => x.rect);
    const except = moved.map((x) => x.rect);
    const q = { ...p, ...(p.range ? { range } : {}), ...(p.except ? { except } : {}), ...(p.exceptPasswords ? { exceptPasswords: moved.map((x) => x.pw) } : {}) };
    if (JSON.stringify(q) !== JSON.stringify(p)) changed = true;
    next.push(q);
  }
  return changed ? next : protections;
}

/** True when a mutation could move a protection (cheap pre-check on the raw JSON). */
export const mayMoveProtections = (json) =>
  /"sheet\.mutation\.(insert-row|remove-rows|insert-col|remove-col|move-rows|move-columns|remove-sheet|set-protected-ranges)"/.test(json);

/**
 * The protections stored in a workbook snapshot.
 * @returns {Protection[]}
 */
export function protectionsOf(snapshot) {
  const res = (snapshot?.resources || []).find((r) => r?.name === PROTECTION_RESOURCE);
  if (!res?.data) return [];
  try {
    const v = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    return Array.isArray(v?.protections) ? v.protections : [];
  } catch {
    return [];
  }
}

/**
 * A copy of the snapshot holding `protections`.
 * @template T
 * @param {T} snapshot
 * @param {Protection[]} protections
 * @returns {T}
 */
export function withProtections(snapshot, protections) {
  const resources = (snapshot?.resources || []).filter((r) => r?.name !== PROTECTION_RESOURCE);
  if (protections.length) resources.push({ name: PROTECTION_RESOURCE, data: JSON.stringify({ protections }) });
  return { ...snapshot, resources };
}

export const sameProtections = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/**
 * For a save that someone other than the owner sends: put back the stored
 * protections and every protected cell they may not change, so a crafted
 * save can't get around the rules. Returns the corrected snapshot.
 */
export function enforceOnSnapshot(stored, incoming, actor) {
  if (!incoming || typeof incoming !== "object" || actor?.role === "owner") return incoming;
  const protections = protectionsOf(stored);
  let next = withProtections(incoming, protections);
  const blocking = protections.filter((p) => !canEditProtection(p, actor));
  if (!blocking.length) return next;
  const sheets = { ...(next.sheets || {}) };
  for (const p of blocking) {
    const before = stored?.sheets?.[p.sheetId];
    const after = sheets[p.sheetId];
    if (!before) continue;
    if (!after) {
      sheets[p.sheetId] = before; // a protected sheet can't be deleted
      continue;
    }
    if (!p.range) {
      // Whole sheet: keep the stored sheet, then take only the exception cells from the save.
      const kept = { ...before, cellData: clone(before.cellData || {}) };
      for (const [rk, row] of Object.entries(after.cellData || {}))
        for (const [ck, cell] of Object.entries(row || {}))
          if (!covers(p, Number(rk), Number(ck))) (kept.cellData[rk] ||= {})[ck] = cell;
      for (const [rk, row] of Object.entries(kept.cellData))
        for (const ck of Object.keys(row || {}))
          if (!covers(p, Number(rk), Number(ck)) && !after.cellData?.[rk]?.[ck]) delete kept.cellData[rk][ck];
      sheets[p.sheetId] = kept;
      continue;
    }
    const cellData = clone(after.cellData || {});
    const g = p.range;
    for (const [rk, row] of Object.entries(cellData))
      for (const ck of Object.keys(row || {})) if (contains(g, Number(rk), Number(ck))) delete row[ck];
    for (const [rk, row] of Object.entries(before.cellData || {}))
      for (const [ck, cell] of Object.entries(row || {})) if (contains(g, Number(rk), Number(ck))) (cellData[rk] ||= {})[ck] = cell;
    sheets[p.sheetId] = { ...after, cellData };
  }
  next = { ...next, sheets, sheetOrder: Array.from(new Set([...(next.sheetOrder || []), ...Object.keys(sheets).filter((id) => !(next.sheetOrder || []).includes(id))])) };
  return next;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
