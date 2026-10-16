// Custom motion paths: drawn on the slide as straight lines (click the
// corners) or a scribble (drag), shown over the object they move, and edited
// point by point. A path is OOXML path syntax in fractions of the slide size,
// relative to the object's place (0 0 is where it stands), as PowerPoint
// writes animMotion paths.
import { parseD, strokeToFreeform, type Geom } from "./freeform";
import { pathPoints, type Box } from "./model";

type Pt = { x: number; y: number };
const f = (v: number) => String(Math.round(v * 100000) / 100000);

/** Points clicked on the slide (px) -> a path from the first one, which the object's centre follows. */
export function linesToPath(pts: Pt[], W: number, H: number, closed = false): string | null {
  if (pts.length < 2) return null;
  const o = pts[0];
  const rel = pts.map((p) => `${f((p.x - o.x) / W)} ${f((p.y - o.y) / H)}`);
  return `M ${rel[0]} ${rel.slice(1).map((p) => `L ${p}`).join(" ")} ${closed ? "Z" : "E"}`;
}

/** A scribble (px) -> a smoothed curve path from its first point. */
export function scribbleToPath(pts: Pt[], W: number, H: number): string | null {
  if (pts.length < 2) return null;
  const fr = strokeToFreeform(pts, 0);
  if (!fr) return null;
  return geomToPath(fr.geom, fr.box, pts[0], W, H, false);
}

/** A freeform outline placed in `box` (slide px) -> a motion path relative to `origin` (px). */
export function geomToPath(g: Geom, box: Box, origin: Pt, W: number, H: number, closed?: boolean): string | null {
  const sx = g.w ? box.w / g.w : 1, sy = g.h ? box.h / g.h : 1;
  const X = (x: number) => f((box.x + x * sx - origin.x) / W), Y = (y: number) => f((box.y + y * sy - origin.y) / H);
  const out: string[] = [];
  let shut = false;
  for (const c of parseD(g.d)) {
    if (c.c === "Z") { shut = true; continue; }
    if (c.c === "Q") {
      // as a cubic: animMotion paths take M, L, C and Z
      out.push(`C ${X(c.p[0])} ${Y(c.p[1])} ${X(c.p[0])} ${Y(c.p[1])} ${X(c.p[2])} ${Y(c.p[3])}`);
      continue;
    }
    const args: string[] = [];
    for (let i = 0; i < c.p.length; i += 2) args.push(`${X(c.p[i])} ${Y(c.p[i + 1])}`);
    out.push(`${c.c} ${args.join(" ")}`);
  }
  if (!out.length) return null;
  return `${out.join(" ")} ${(closed ?? shut) ? "Z" : "E"}`;
}

/** The object's centre: where the path's 0 0 sits on the slide. */
export const pathOrigin = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A motion path as an SVG path in slide px, drawn from the object's centre. */
export function pathSvgD(path: string, origin: Pt, W: number, H: number): string {
  const tok = path.replace(/([MLCZEmlcze])/g, " $1 ").trim().split(/[\s,]+/).filter(Boolean);
  const out: string[] = [];
  let cmd = "M", i = 0;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) {
      cmd = tok[i++].toUpperCase();
      if (cmd === "E") break;
      if (cmd === "Z") { out.push("Z"); continue; }
      out.push(cmd);
    }
    if (i >= tok.length) break;
    const x = Number(tok[i++]) || 0, y = Number(tok[i++]) || 0;
    out.push(`${Math.round((origin.x + x * W) * 10) / 10} ${Math.round((origin.y + y * H) * 10) / 10}`);
  }
  return out.join(" ");
}

/** A motion path as a freeform outline (slide px) for Edit Points, and its box. */
export function pathToGeom(path: string, origin: Pt, W: number, H: number): { geom: Geom; box: Box; closed: boolean } | null {
  const pts = pathPoints(path, 4).map((p) => ({ x: origin.x + p.x * W, y: origin.y + p.y * H }));
  if (pts.length < 2) return null;
  const x0 = Math.min(...pts.map((p) => p.x)), y0 = Math.min(...pts.map((p) => p.y));
  const w = Math.max(1, Math.max(...pts.map((p) => p.x)) - x0), h = Math.max(1, Math.max(...pts.map((p) => p.y)) - y0);
  const d = pathSvgD(path, { x: origin.x - x0, y: origin.y - y0 }, W, H);
  return { geom: { w, h, d }, box: { x: x0, y: y0, w, h }, closed: /Z\s*$/i.test(d) };
}

/** The path's shape run backwards (Reverse Path Direction), still starting where the object stands. */
export function reversePath(path: string): string {
  const tok = path.replace(/([MLCZEmlcze])/g, " $1 ").trim().split(/[\s,]+/).filter(Boolean);
  type Seg = { c: string; p: number[] };
  const segs: Seg[] = [];
  let cmd = "M", i = 0, closed = false;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) {
      cmd = tok[i++].toUpperCase();
      if (cmd === "E") break;
      if (cmd === "Z") { closed = true; continue; }
    }
    const n = cmd === "C" ? 6 : 2;
    if (i + n > tok.length) break;
    segs.push({ c: cmd, p: tok.slice(i, i + n).map(Number) });
    i += n;
    if (cmd === "M") cmd = "L";
  }
  if (segs.length < 2) return path;
  const end = segs[segs.length - 1].p.slice(-2);
  const out: string[] = [`M ${f(end[0])} ${f(end[1])}`];
  for (let k = segs.length - 1; k > 0; k--) {
    const s = segs[k], prev = segs[k - 1].p.slice(-2);
    if (s.c === "C") out.push(`C ${f(s.p[2])} ${f(s.p[3])} ${f(s.p[0])} ${f(s.p[1])} ${f(prev[0])} ${f(prev[1])}`);
    else out.push(`L ${f(prev[0])} ${f(prev[1])}`);
  }
  // shift so the object still starts where it stands
  const [ox, oy] = end;
  const shifted = out.join(" ").replace(/-?\d*\.?\d+(?:e-?\d+)?\s+-?\d*\.?\d+(?:e-?\d+)?/gi, (m) => {
    const [x, y] = m.trim().split(/\s+/).map(Number);
    return `${f(x - ox)} ${f(y - oy)}`;
  });
  return `${shifted} ${closed ? "Z" : "E"}`;
}
