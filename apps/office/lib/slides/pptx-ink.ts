// Ink in .pptx as PowerPoint writes it: each stroke is a p:contentPart (in an
// mc:AlternateContent that requires p14) related to an InkML part
// (ppt/ink/inkN.xml, W3C InkML), with our freeform kept as the fallback for
// applications without ink. Reading goes the other way: InkML traces become
// freeforms, so PowerPoint's own ink opens as editable strokes.
import { parseD, strokeToFreeform, type Geom } from "./freeform";
import type { Box } from "./model";

export const INKML = "http://www.w3.org/2003/InkML";
export const INK_CT = "application/inkml+xml";
export const INK_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** Ink space: 1000 units per centimetre (PowerPoint's resolution). */
const UNITS_PER_PX = 1000 * (2.54 / 96);
const r = (n: number) => Math.round(n);

/** Points along a freeform in slide px (curves sampled), for a trace. */
export function strokePoints(g: Geom, box: Box): { x: number; y: number }[] {
  const sx = g.w ? box.w / g.w : 1, sy = g.h ? box.h / g.h : 1;
  const P = (x: number, y: number) => ({ x: box.x + x * sx, y: box.y + y * sy });
  const out: { x: number; y: number }[] = [];
  let cx = 0, cy = 0, sx0 = 0, sy0 = 0;
  for (const c of parseD(g.d)) {
    if (c.c === "M") {
      [cx, cy] = c.p;
      [sx0, sy0] = c.p;
      out.push(P(cx, cy));
    } else if (c.c === "L") {
      [cx, cy] = c.p;
      out.push(P(cx, cy));
    } else if (c.c === "C" || c.c === "Q") {
      const pts = c.c === "C" ? [cx, cy, ...c.p] : [cx, cy, cx + (2 / 3) * (c.p[0] - cx), cy + (2 / 3) * (c.p[1] - cy), c.p[2] + (2 / 3) * (c.p[0] - c.p[2]), c.p[3] + (2 / 3) * (c.p[1] - c.p[3]), c.p[2], c.p[3]];
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        const x = u * u * u * pts[0] + 3 * u * u * t * pts[2] + 3 * u * t * t * pts[4] + t * t * t * pts[6];
        const y = u * u * u * pts[1] + 3 * u * u * t * pts[3] + 3 * u * t * t * pts[5] + t * t * t * pts[7];
        out.push(P(x, y));
      }
      [cx, cy] = [pts[6], pts[7]];
    } else if (c.c === "Z") {
      [cx, cy] = [sx0, sy0];
      out.push(P(cx, cy));
    }
  }
  return out;
}

export type InkStrokeOut = { pts: { x: number; y: number }[]; color: string; width: number; hl: boolean };

/** One stroke as an InkML document (coordinates in ink units from the slide's corner). */
export function inkmlXml(s: InkStrokeOut): string {
  const cm = (px: number) => Math.round(px * (2.54 / 96) * 100000) / 100000;
  const hl = s.hl ? `<inkml:brushProperty name="tip" value="rectangle"/><inkml:brushProperty name="rasterOp" value="maskPen"/>` : "";
  const trace = s.pts.map((p) => `${r(p.x * UNITS_PER_PX)} ${r(p.y * UNITS_PER_PX)}`).join(", ");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<inkml:ink xmlns:inkml="${INKML}"><inkml:definitions>` +
    `<inkml:context xml:id="ctx0"><inkml:inkSource xml:id="inkSrc0"><inkml:traceFormat><inkml:channel name="X" type="integer" max="32767" units="cm"/><inkml:channel name="Y" type="integer" max="32767" units="cm"/></inkml:traceFormat>` +
    `<inkml:channelProperties><inkml:channelProperty channel="X" name="resolution" value="1000" units="1/cm"/><inkml:channelProperty channel="Y" name="resolution" value="1000" units="1/cm"/></inkml:channelProperties></inkml:inkSource></inkml:context>` +
    `<inkml:brush xml:id="br0"><inkml:brushProperty name="width" value="${cm(s.width)}" units="cm"/><inkml:brushProperty name="height" value="${cm(s.width)}" units="cm"/><inkml:brushProperty name="color" value="#${s.color.toUpperCase()}"/>${hl}</inkml:brush>` +
    `</inkml:definitions><inkml:trace contextRef="#ctx0" brushRef="#br0">${trace}</inkml:trace></inkml:ink>`
  );
}

/** The stroke's place on the slide, and the AlternateContent around its fallback shape. */
export function inkContentXml(fallback: string, rid: string, spid: string, name: string, off: { x: number; y: number }, ext: { cx: number; cy: number }): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const part = `<p:contentPart p14:bwMode="auto" r:id="${rid}"><p14:nvContentPartPr><p14:cNvPr id="${spid}" name="${esc(name)}"/><p14:cNvContentPartPr/><p14:nvPr/></p14:nvContentPartPr><p14:xfrm><a:off x="${off.x}" y="${off.y}"/><a:ext cx="${ext.cx}" cy="${ext.cy}"/></p14:xfrm></p:contentPart>`;
  return `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14">${part}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
}

export type InkRead = { pts: { x: number; y: number }[]; color: string; width: number; hl: boolean };

/**
 * The strokes of an InkML part, in ink units (any origin): trace points (the
 * first two channels), brush colour, width and highlighter tip. Differences
 * ("'" and '"' prefixes) are summed as InkML defines them.
 */
export function readInkml(xml: string): InkRead[] {
  const brushes = new Map<string, { color: string; width: number; hl: boolean }>();
  for (const m of xml.matchAll(/<(?:\w+:)?brush\b[^>]*xml:id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?brush>/g)) {
    const prop = (n: string) => new RegExp(`<(?:\\w+:)?brushProperty\\b[^>]*name="${n}"[^>]*value="([^"]*)"(?:[^>]*units="([^"]*)")?`).exec(m[2]);
    const color = (prop("color")?.[1] || "#000000").replace("#", "").toUpperCase();
    const w = prop("width");
    const width = w ? (Number(w[1]) || 0.05) * (w[2] === "mm" ? 0.1 : w[2] === "in" ? 2.54 : 1) : 0.05;
    brushes.set(m[1], { color: /^[0-9A-F]{6}$/.test(color) ? color : "000000", width, hl: prop("tip")?.[1] === "rectangle" || /maskPen/.test(prop("rasterOp")?.[1] || "") });
  }
  const out: InkRead[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?trace\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?trace>/g)) {
    const ref = /brushRef="#?([^"]+)"/.exec(m[1])?.[1];
    const b = (ref && brushes.get(ref)) || [...brushes.values()][0] || { color: "000000", width: 0.05, hl: false };
    const pts: { x: number; y: number }[] = [];
    let last: number[] = [], vel: number[] = [];
    // a "!", "'" or '"' prefix holds for that channel until the next one
    const mode: ("abs" | "d1" | "d2")[] = [];
    for (const raw of m[2].split(",")) {
      const toks = raw.trim().match(/[!'"]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
      const vals: number[] = [];
      let k = 0;
      for (const t of toks) {
        if (t === "!") mode[k] = "abs";
        else if (t === "'") mode[k] = "d1";
        else if (t === '"') mode[k] = "d2";
        else {
          const v = Number(t), md = mode[k] || "abs";
          let val = v;
          if (md === "d1") { vel[k] = v; val = (last[k] || 0) + v; }
          else if (md === "d2") { vel[k] = (vel[k] || 0) + v; val = (last[k] || 0) + vel[k]; }
          vals[k] = val;
          k++;
        }
      }
      if (vals.length >= 2) {
        pts.push({ x: vals[0], y: vals[1] });
        last = vals;
      }
    }
    if (pts.length) out.push({ pts, color: b.color, width: b.width, hl: b.hl });
  }
  return out;
}

/**
 * PowerPoint ink placed in `box` (slide px, from the content part's xfrm):
 * the traces' extent maps onto the box, and each stroke becomes a freeform.
 */
export function inkToFreeforms(strokes: InkRead[], box: Box): { box: Box; geom: Geom; line: string; lineW: number; hl: boolean }[] {
  const all = strokes.flatMap((s) => s.pts);
  if (!all.length) return [];
  const minX = Math.min(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y));
  const spanX = Math.max(1, Math.max(...all.map((p) => p.x)) - minX), spanY = Math.max(1, Math.max(...all.map((p) => p.y)) - minY);
  const kx = box.w > 1 ? box.w / spanX : 1 / UNITS_PER_PX, ky = box.h > 1 ? box.h / spanY : 1 / UNITS_PER_PX;
  const out: { box: Box; geom: Geom; line: string; lineW: number; hl: boolean }[] = [];
  for (const s of strokes) {
    const pts = s.pts.map((p) => ({ x: box.x + (p.x - minX) * kx, y: box.y + (p.y - minY) * ky }));
    const f = strokeToFreeform(pts.length > 1 ? pts : [pts[0], { x: pts[0].x + 0.5, y: pts[0].y + 0.5 }], 0);
    if (f) out.push({ box: f.box, geom: f.geom, line: s.color, lineW: Math.max(0.5, Math.round(s.width * (96 / 2.54) * 100) / 100), hl: s.hl });
  }
  return out;
}
