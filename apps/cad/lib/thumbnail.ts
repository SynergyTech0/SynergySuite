import type { Seg } from "./views";

/**
 * Library pictures. The browser draws one from the file's lines: a DXF's model-space entities
 * (`dxfLines`), or a model's isometric view (lib/views.ts). Nothing here depends on how the
 * editors draw, so a picture looks the same whichever editor made it.
 */

export const THUMB_W = 320;
export const THUMB_H = 240;
/** Above these, making a picture would hold up the page for too long, so the file keeps its label. */
export const MAX_THUMB_TEXT = 32 * 1024 * 1024;
const MAX_SEGS = 400_000;

type M = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e, y' = b x + d y + f
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const times = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

type Entity = { type: string; codes: [number, string][] };

/** Group-code pairs, grouped into entities per section, and blocks by name. */
function parse(text: string): { entities: Entity[]; blocks: Map<string, { base: [number, number]; entities: Entity[] }> } {
  const lines = text.split(/\r?\n/);
  const entities: Entity[] = [];
  const blocks = new Map<string, { base: [number, number]; entities: Entity[] }>();
  let section = "";
  let block: { name: string; base: [number, number]; entities: Entity[] } | null = null;
  let current: Entity | null = null;
  const finish = () => {
    if (!current) return;
    if (current.type === "BLOCK") {
      const get = (c: number) => current!.codes.find(([k]) => k === c)?.[1];
      block = { name: get(2) ?? "", base: [Number(get(10) ?? 0), Number(get(20) ?? 0)], entities: [] };
    } else if (current.type === "ENDBLK") {
      if (block) blocks.set(block.name, { base: block.base, entities: block.entities });
      block = null;
    } else if (section === "BLOCKS" && block) block.entities.push(current);
    else if (section === "ENTITIES") entities.push(current);
    current = null;
  };
  let nextIsSectionName = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    const value = lines[i + 1].trim();
    if (code === 0) {
      finish();
      if (value === "SECTION") nextIsSectionName = true;
      else if (value === "ENDSEC") section = "";
      else if (value !== "EOF") current = { type: value, codes: [] };
    } else if (code === 2 && nextIsSectionName) {
      section = value;
      nextIsSectionName = false;
    } else current?.codes.push([code, value]);
  }
  finish();
  return { entities, blocks };
}

/** Line segments of a DXF's model space: lines, polylines, circles, arcs, ellipses, splines, and block inserts. Text is left out. */
export function dxfLines(text: string): Seg[] {
  const { entities, blocks } = parse(text);
  const out: Seg[] = [];
  const seg = (m: M, x1: number, y1: number, x2: number, y2: number) => {
    if (out.length >= MAX_SEGS) return;
    const [a, b] = apply(m, x1, y1);
    const [c, d] = apply(m, x2, y2);
    if ([a, b, c, d].every(Number.isFinite)) out.push([a, b, c, d]);
  };
  const poly = (m: M, pts: [number, number][], closed: boolean) => {
    for (let i = 1; i < pts.length; i++) seg(m, ...pts[i - 1], ...pts[i]);
    if (closed && pts.length > 2) seg(m, ...pts[pts.length - 1], ...pts[0]);
  };
  const arc = (m: M, cx: number, cy: number, r: number, a0: number, a1: number) => {
    if (!(r > 0)) return;
    while (a1 <= a0) a1 += 2 * Math.PI;
    const n = Math.max(8, Math.ceil(((a1 - a0) / (2 * Math.PI)) * 48));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    poly(m, pts, false);
  };

  // POLYLINE is followed by VERTEX entities up to SEQEND.
  function draw(list: Entity[], m: M, depth: number) {
    let open: { pts: [number, number][]; closed: boolean } | null = null;
    for (const e of list) {
      const all = (c: number) => e.codes.filter(([k]) => k === c).map(([, v]) => Number(v));
      const one = (c: number, d = 0) => {
        const v = e.codes.find(([k]) => k === c);
        return v ? Number(v[1]) : d;
      };
      if (one(67) === 1) continue; // paper space
      switch (e.type) {
        case "LINE":
          seg(m, one(10), one(20), one(11), one(21));
          break;
        case "LWPOLYLINE": {
          const xs = all(10), ys = all(20);
          poly(m, xs.map((x, i) => [x, ys[i] ?? 0]), (one(70) & 1) === 1);
          break;
        }
        case "POLYLINE":
          open = { pts: [], closed: (one(70) & 1) === 1 };
          break;
        case "VERTEX":
          open?.pts.push([one(10), one(20)]);
          break;
        case "SEQEND":
          if (open) poly(m, open.pts, open.closed);
          open = null;
          break;
        case "CIRCLE":
          arc(m, one(10), one(20), one(40), 0, 2 * Math.PI);
          break;
        case "ARC":
          arc(m, one(10), one(20), one(40), (one(50) * Math.PI) / 180, (one(51) * Math.PI) / 180);
          break;
        case "ELLIPSE": {
          const cx = one(10), cy = one(20), mx = one(11), my = one(21), ratio = one(40, 1);
          const t0 = one(41, 0);
          let t1 = one(42, 2 * Math.PI);
          if (t1 <= t0) t1 += 2 * Math.PI;
          const pts: [number, number][] = [];
          for (let i = 0; i <= 48; i++) {
            const t = t0 + ((t1 - t0) * i) / 48;
            pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)]);
          }
          poly(m, pts, false);
          break;
        }
        case "SPLINE": {
          // Fit points when given, else the control polygon: close enough at this size.
          const fx = all(11), fy = all(21);
          const xs = fx.length ? fx : all(10), ys = fx.length ? fy : all(20);
          poly(m, xs.map((x, i) => [x, ys[i] ?? 0]), (one(70) & 1) === 1);
          break;
        }
        case "INSERT":
        case "DIMENSION": {
          const b = blocks.get(e.codes.find(([k]) => k === 2)?.[1] ?? "");
          if (!b || depth > 6) break;
          const rot = e.type === "INSERT" ? (one(50) * Math.PI) / 180 : 0;
          const sx = e.type === "INSERT" ? one(41, 1) : 1, sy = e.type === "INSERT" ? one(42, 1) : 1;
          const [ix, iy] = e.type === "INSERT" ? [one(10), one(20)] : [0, 0];
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const local: M = times([cos, sin, -sin, cos, ix, iy], times([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -b.base[0], -b.base[1]]));
          draw(b.entities, times(m, local), depth + 1);
          break;
        }
      }
    }
  }
  draw(entities, IDENTITY, 0);
  return out;
}

/**
 * Scales segments to fill a w × h picture with a margin, y up. The extent leaves out the
 * farthest 0.5% of points on each side, so one stray entity far from the drawing doesn't shrink it to a dot.
 */
export function fitSegments(segs: Seg[], w = THUMB_W, h = THUMB_H, pad = 12): Seg[] {
  if (!segs.length) return [];
  const xs: number[] = [], ys: number[] = [];
  for (const [a, b, c, d] of segs) xs.push(a, c), ys.push(b, d);
  xs.sort((p, q) => p - q);
  ys.sort((p, q) => p - q);
  const cut = Math.floor(xs.length * 0.005);
  const x0 = xs[cut], x1 = xs[xs.length - 1 - cut], y0 = ys[cut], y1 = ys[ys.length - 1 - cut];
  const k = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const ox = (w - k * (x1 - x0)) / 2, oy = (h - k * (y1 - y0)) / 2;
  return segs.map(([a, b, c, d]) => [ox + k * (a - x0), h - (oy + k * (b - y0)), ox + k * (c - x0), h - (oy + k * (d - y0))]);
}

/** Draws the picture and returns it as PNG bytes. Null when there's nothing to draw. Browser only. */
export async function thumbnailPng(segs: Seg[]): Promise<Blob | null> {
  const fitted = fitSegments(segs);
  if (!fitted.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, THUMB_W, THUMB_H);
  g.strokeStyle = "#1f2937";
  g.lineWidth = 1;
  g.lineCap = "round";
  g.beginPath();
  for (const [a, b, c, d] of fitted) {
    g.moveTo(a, b);
    g.lineTo(c, d);
  }
  g.stroke();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Makes and uploads a library picture for a DXF's text. Quietly does nothing when it can't. */
export async function uploadDxfThumb(fileId: string, dxf: string): Promise<string | null> {
  if (dxf.length > MAX_THUMB_TEXT) return null;
  return uploadThumb(fileId, dxfLines(dxf));
}

export async function uploadThumb(fileId: string, segs: Seg[]): Promise<string | null> {
  try {
    const png = await thumbnailPng(segs);
    if (!png) return null;
    const res = await fetch(`/api/files/${fileId}/thumb`, { method: "PUT", body: png });
    return res.ok ? (((await res.json()) as { file: { thumb?: string } }).file.thumb ?? null) : null;
  } catch {
    return null;
  }
}

/** True when the file has no library picture, or one older than its last save. */
export function needsThumb(file: { thumb?: string; modified: string }): boolean {
  return !file.thumb || file.thumb < file.modified;
}
