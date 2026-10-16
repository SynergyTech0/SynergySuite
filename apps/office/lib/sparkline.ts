// Sparklines: tiny line, column and win/loss charts drawn inside a cell, as in
// Excel (Insert > Sparklines). A group shares its type and colours; each
// sparkline in it reads one row or column of values and draws in one cell.
// The groups live in a workbook resource and change through one mutation.
// This file holds the model, the drawing geometry and the .xlsx mapping
// (Excel stores sparklines in the worksheet's x14 extension list).

export const SPARKLINE_RESOURCE = "SHEET_SYNERGY_SPARKLINE_PLUGIN";
export const SET_SPARKLINES_MUTATION = "sheet.mutation.set-sparklines";

export type SparkType = "line" | "column" | "winloss";
export type SparkRange = { sheetId: string; startRow: number; endRow: number; startColumn: number; endColumn: number };
export type Sparkline = { row: number; column: number; source: SparkRange };
export type SparklineGroup = {
  id: string;
  sheetId: string;
  type: SparkType;
  color: string;
  negativeColor: string;
  markerColor: string;
  /** Point markers on a line sparkline. */
  markers?: boolean;
  high?: boolean;
  low?: boolean;
  first?: boolean;
  last?: boolean;
  negative?: boolean;
  /** Line width in points (Excel's default is 0.75). */
  lineWeight?: number;
  items: Sparkline[];
  /** Excel attributes we don't model, kept for the way back. */
  xlsx?: Record<string, string>;
};
export type SparklineResource = { groups: SparklineGroup[] };

export const SPARK_DEFAULTS = { color: "#376092", negativeColor: "#D00000", markerColor: "#D00000" };

/**
 * One sparkline per row of the data range (or per column when the location
 * runs across), placed in the location cells, the way Excel's dialog pairs them.
 */
export function sparklinesFor(data: SparkRange, location: { startRow: number; endRow: number; startColumn: number; endColumn: number }): Sparkline[] {
  const locCells: { row: number; column: number }[] = [];
  for (let r = location.startRow; r <= location.endRow; r++) for (let c = location.startColumn; c <= location.endColumn; c++) locCells.push({ row: r, column: c });
  const rows = data.endRow - data.startRow + 1;
  const cols = data.endColumn - data.startColumn + 1;
  if (locCells.length === 1) return [{ ...locCells[0], source: data }];
  // Vertical location: one sparkline per data row; horizontal: per data column.
  const vertical = location.startColumn === location.endColumn;
  if (vertical && rows === locCells.length)
    return locCells.map((cell, i) => ({ ...cell, source: { ...data, startRow: data.startRow + i, endRow: data.startRow + i } }));
  if (!vertical && cols === locCells.length)
    return locCells.map((cell, i) => ({ ...cell, source: { ...data, startColumn: data.startColumn + i, endColumn: data.startColumn + i } }));
  throw new Error("The location must have one cell for each row (or column) of the data range.");
}

// ---- Geometry ---------------------------------------------------------------

export type SparkShape =
  | { kind: "line"; points: [number, number][]; markers: { x: number; y: number; color: string }[] }
  | { kind: "bars"; bars: { x: number; y: number; w: number; h: number; color: string }[]; axisY: number | null };

/**
 * What to draw for a list of values in a w x h box (pixels, origin top-left).
 * Empty cells are gaps. Returns null when there is nothing to draw.
 */
export function sparkShape(values: (number | null)[], group: Pick<SparklineGroup, "type" | "color" | "negativeColor" | "markerColor" | "markers" | "high" | "low" | "first" | "last" | "negative">, w: number, h: number, pad = 2): SparkShape | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length || w <= pad * 2 || h <= pad * 2) return null;
  const n = values.length;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  const hi = Math.max(...nums);
  const lo = Math.min(...nums);
  const firstIdx = values.findIndex((v) => v != null && Number.isFinite(v));
  let lastIdx = -1;
  values.forEach((v, i) => v != null && Number.isFinite(v) && (lastIdx = i));
  const special = (v: number, i: number): string | null => {
    if (group.high && v === hi) return group.markerColor;
    if (group.low && v === lo) return group.markerColor;
    if (group.first && i === firstIdx) return group.markerColor;
    if (group.last && i === lastIdx) return group.markerColor;
    if (group.negative && v < 0) return group.negativeColor;
    return null;
  };

  if (group.type === "line") {
    const span = hi - lo || 1;
    const x = (i: number) => pad + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v: number) => pad + (hi === lo ? ih / 2 : ((hi - v) / span) * ih);
    const points: [number, number][] = [];
    const markers: { x: number; y: number; color: string }[] = [];
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      points.push([x(i), y(v)]);
      const c = special(v, i) || (group.markers ? group.color : null);
      if (c) markers.push({ x: x(i), y: y(v), color: c });
    });
    return { kind: "line", points, markers };
  }

  const slot = iw / n;
  const bw = Math.max(1, slot * 0.7);
  const bars: { x: number; y: number; w: number; h: number; color: string }[] = [];
  if (group.type === "winloss") {
    const mid = pad + ih / 2;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v) || v === 0) return;
      const up = v > 0;
      const color = special(v, i) || (up ? group.color : group.negative ? group.negativeColor : group.color);
      bars.push({ x: pad + i * slot + (slot - bw) / 2, y: up ? pad : mid, w: bw, h: ih / 2, color });
    });
    return { kind: "bars", bars, axisY: mid };
  }
  // Columns grow from zero when the values cross it, else from the lowest value.
  const top = Math.max(hi, 0);
  const bottom = Math.min(lo, 0);
  const span = top - bottom || 1;
  const yOf = (v: number) => pad + ((top - v) / span) * ih;
  const zero = yOf(0);
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return;
    const y1 = yOf(v);
    // A zero-height column still shows as a hairline.
    const hgt = Math.max(1, Math.abs(zero - y1));
    bars.push({ x: pad + i * slot + (slot - bw) / 2, y: Math.min(y1, zero), w: bw, h: hgt, color: special(v, i) || group.color });
  });
  return { kind: "bars", bars, axisY: bottom < 0 && top > 0 ? zero : null };
}

/** Draws a sparkline into a canvas context, inside the given cell box. */
export function drawSparkline(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, values: (number | null)[], group: SparklineGroup) {
  const shape = sparkShape(values, group, box.w, box.h, 3);
  if (!shape) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x, box.y);
  if (shape.kind === "line") {
    ctx.strokeStyle = group.color;
    ctx.lineWidth = Math.max(1, ((group.lineWeight ?? 0.75) * 96) / 72);
    ctx.lineJoin = "round";
    ctx.beginPath();
    shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    for (const m of shape.markers) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const b of shape.bars) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    if (shape.axisY != null && group.type === "column") {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, shape.axisY);
      ctx.lineTo(box.w, shape.axisY);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Values of a source range (one row or column), numbers or gaps. */
export function sourceValues(read: (row: number, column: number) => unknown, r: SparkRange): (number | null)[] {
  const out: (number | null)[] = [];
  for (let row = r.startRow; row <= r.endRow; row++)
    for (let col = r.startColumn; col <= r.endColumn; col++) {
      const v = read(row, col);
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      out.push(Number.isFinite(n) ? n : null);
    }
  return out;
}

// ---- .xlsx (x14:sparklineGroups) --------------------------------------------

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const XM = "http://schemas.microsoft.com/office/excel/2006/main";
const SPARK_EXT = "{05C60535-1F16-4fd2-B633-F4F36F0B64E0}";

const argb = (hex: string) => "FF" + hex.replace(/^#/, "").toUpperCase().padStart(6, "0").slice(-6);
const hexOf = (tag: string | undefined, fallback: string) => {
  const rgb = tag && /\brgb="([0-9A-Fa-f]{6,8})"/.exec(tag)?.[1];
  return rgb ? `#${rgb.slice(-6).toUpperCase()}` : fallback;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const col = (c: number) => {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colIndex = (s: string) => s.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const quote = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** The <ext> element holding a sheet's sparkline groups. */
export function sparklineExtXml(groups: SparklineGroup[], sheetName: (sheetId: string) => string | undefined): string {
  const body = groups
    .map((g) => {
      const attrs: Record<string, string> = { ...(g.xlsx || {}) };
      delete attrs.type;
      if (g.type === "column") attrs.type = "column";
      if (g.type === "winloss") attrs.type = "stacked";
      attrs.displayEmptyCellsAs = attrs.displayEmptyCellsAs || "gap";
      if (g.lineWeight != null && g.lineWeight !== 0.75) attrs.lineWeight = String(g.lineWeight);
      for (const k of ["markers", "high", "low", "first", "last", "negative"] as const) {
        if (g[k]) attrs[k] = "1";
        else delete attrs[k];
      }
      const sparks = g.items
        .map((s) => {
          const name = sheetName(s.source.sheetId);
          if (!name) return "";
          const a = `$${col(s.source.startColumn)}$${s.source.startRow + 1}`;
          const b = `$${col(s.source.endColumn)}$${s.source.endRow + 1}`;
          return `<x14:sparkline><xm:f>${esc(`${quote(name)}!${a}${a === b ? "" : `:${b}`}`)}</xm:f><xm:sqref>${col(s.column)}${s.row + 1}</xm:sqref></x14:sparkline>`;
        })
        .join("");
      if (!sparks) return "";
      const colors = [
        ["colorSeries", g.color],
        ["colorNegative", g.negativeColor],
        ["colorAxis", "#000000"],
        ["colorMarkers", g.markerColor],
        ["colorFirst", g.markerColor],
        ["colorLast", g.markerColor],
        ["colorHigh", g.markerColor],
        ["colorLow", g.markerColor],
      ]
        .map(([k, v]) => `<x14:${k} rgb="${argb(v)}"/>`)
        .join("");
      const attrText = Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join("");
      return `<x14:sparklineGroup${attrText}>${colors}<x14:sparklines>${sparks}</x14:sparklines></x14:sparklineGroup>`;
    })
    .join("");
  if (!body) return "";
  return `<ext uri="${SPARK_EXT}" xmlns:x14="${X14}"><x14:sparklineGroups xmlns:xm="${XM}">${body}</x14:sparklineGroups></ext>`;
}

/** Adds (or replaces) the sparkline extension in a worksheet part. */
export function patchSparklines(sheetXml: string, ext: string): string {
  let xml = sheetXml.replace(new RegExp(`<ext\\b[^>]*uri="${SPARK_EXT.replace(/[{}]/g, "\\$&")}"[^>]*>[\\s\\S]*?</ext>`, "i"), "");
  xml = xml.replace(/<extLst>\s*<\/extLst>/, "");
  if (!ext) return xml;
  if (/<extLst>/.test(xml)) return xml.replace("</extLst>", `${ext}</extLst>`);
  return xml.replace("</worksheet>", `<extLst>${ext}</extLst></worksheet>`);
}

/** Sparkline groups in a worksheet part. `sheetIdOf` maps a sheet name to its id. */
export function readSparklines(sheetXml: string, hostSheetId: string, sheetIdOf: (name: string) => string | undefined): SparklineGroup[] {
  const out: SparklineGroup[] = [];
  const groups = sheetXml.match(/<(?:\w+:)?sparklineGroup\b[\s\S]*?<\/(?:\w+:)?sparklineGroup>/g) || [];
  for (const [gi, g] of groups.entries()) {
    const open = /<(?:\w+:)?sparklineGroup\b([^>]*)>/.exec(g)!;
    const attrs: Record<string, string> = {};
    for (const m of open[1].matchAll(/([\w:]+)="([^"]*)"/g)) if (!m[1].startsWith("xmlns")) attrs[m[1]] = unesc(m[2]);
    const colorTag = (name: string) => new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`).exec(g)?.[0];
    const items: Sparkline[] = [];
    for (const s of g.matchAll(/<(?:\w+:)?sparkline>([\s\S]*?)<\/(?:\w+:)?sparkline>/g)) {
      const f = unesc(/<(?:\w+:)?f>([\s\S]*?)<\/(?:\w+:)?f>/.exec(s[1])?.[1] || "");
      const sqref = /<(?:\w+:)?sqref>([\s\S]*?)<\/(?:\w+:)?sqref>/.exec(s[1])?.[1] || "";
      const m = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(f.trim());
      const at = /^([A-Z]{1,3})(\d+)$/i.exec(sqref.trim());
      if (!m || !at) continue;
      const sheetName = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
      const sheetId = sheetName ? sheetIdOf(sheetName) : hostSheetId;
      if (!sheetId) continue;
      const r1 = Number(m[4]) - 1;
      const c1 = colIndex(m[3]);
      const r2 = m[6] ? Number(m[6]) - 1 : r1;
      const c2 = m[5] ? colIndex(m[5]) : c1;
      items.push({ row: Number(at[2]) - 1, column: colIndex(at[1]), source: { sheetId, startRow: Math.min(r1, r2), endRow: Math.max(r1, r2), startColumn: Math.min(c1, c2), endColumn: Math.max(c1, c2) } });
    }
    if (!items.length) continue;
    const on = (k: string) => attrs[k] === "1" || attrs[k] === "true";
    const group: SparklineGroup = {
      id: `xlsx-spark-${hostSheetId}-${gi + 1}`,
      sheetId: hostSheetId,
      type: attrs.type === "column" ? "column" : attrs.type === "stacked" ? "winloss" : "line",
      color: hexOf(colorTag("colorSeries"), SPARK_DEFAULTS.color),
      negativeColor: hexOf(colorTag("colorNegative"), SPARK_DEFAULTS.negativeColor),
      markerColor: hexOf(colorTag("colorMarkers") || colorTag("colorHigh"), SPARK_DEFAULTS.markerColor),
      ...(on("markers") ? { markers: true } : {}),
      ...(on("high") ? { high: true } : {}),
      ...(on("low") ? { low: true } : {}),
      ...(on("first") ? { first: true } : {}),
      ...(on("last") ? { last: true } : {}),
      ...(on("negative") ? { negative: true } : {}),
      ...(attrs.lineWeight ? { lineWeight: Number(attrs.lineWeight) } : {}),
      items,
    };
    const keep = Object.fromEntries(Object.entries(attrs).filter(([k]) => !["type", "markers", "high", "low", "first", "last", "negative", "lineWeight"].includes(k)));
    if (Object.keys(keep).length) group.xlsx = keep;
    out.push(group);
  }
  return out;
}
