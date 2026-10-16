// Freeform shapes: a path in its own coordinate box (geom.w × geom.h) that is
// stretched to the element's box. Paths use absolute M/L/C/Q/Z commands, map
// onto DrawingML custGeom (export) and are read back from custGeom (import).
import { child, kids, num, attr, type XEl } from "./xml";
import type { Box } from "./model";

export type Geom = { w: number; h: number; d: string };
type Cmd = { c: "M" | "L" | "C" | "Q" | "Z"; p: number[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const ARGS: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };

export function parseD(d: string): Cmd[] {
  const tok = d.replace(/([MLCQZmlcqz])/g, " $1 ").trim().split(/[\s,]+/).filter(Boolean);
  const out: Cmd[] = [];
  let i = 0;
  let c: Cmd["c"] = "M";
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) {
      c = tok[i++].toUpperCase() as Cmd["c"];
      if (!(c in ARGS)) return out;
    }
    if (c === "Z") { out.push({ c, p: [] }); continue; }
    const n = ARGS[c];
    const p = tok.slice(i, i + n).map(Number);
    if (p.length < n || p.some((x) => !Number.isFinite(x))) break;
    i += n;
    out.push({ c, p });
    if (c === "M") c = "L"; // implicit lineto after moveto
  }
  return out;
}

const fmt = (cmds: Cmd[]) => cmds.map((x) => (x.c === "Z" ? "Z" : `${x.c}${x.p.map(r2).join(" ")}`)).join(" ");

/** The path stretched to a w × h box (for SVG). */
export function scaledD(g: Geom, w: number, h: number): string {
  const sx = g.w ? w / g.w : 1, sy = g.h ? h / g.h : 1;
  return fmt(parseD(g.d).map((x) => ({ c: x.c, p: x.p.map((v, k) => (k % 2 ? v * sy : v * sx)) })));
}

export const isClosed = (g: Geom) => /Z\s*$/i.test(g.d.trim());

/** Drop points closer than `tol` to the line through their neighbours (Ramer–Douglas–Peucker). */
export function simplify(pts: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0, at = 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dist = len === 1 && a.x === b.x && a.y === b.y ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
    if (dist > worst) { worst = dist; at = i; }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/**
 * A drawn stroke (slide px) as a freeform: simplified, smoothed with
 * Catmull-Rom curves, closed when it ends near where it started.
 */
export function strokeToFreeform(raw: { x: number; y: number }[], closeWithin = 12): { box: Box; geom: Geom; closed: boolean } | null {
  if (raw.length < 2) return null;
  const closed = raw.length > 4 && Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].y - raw[raw.length - 1].y) <= closeWithin;
  let pts = simplify(raw, 1.5);
  if (closed && pts.length > 2) pts = pts.slice(0, -1);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
  const P = pts.map((p) => ({ x: p.x - x0, y: p.y - y0 }));
  const cmds: Cmd[] = [{ c: "M", p: [P[0].x, P[0].y] }];
  const n = P.length;
  const at = (i: number) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    if (n === 2) { cmds.push({ c: "L", p: [p2.x, p2.y] }); continue; }
    cmds.push({ c: "C", p: [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y] });
  }
  if (closed) cmds.push({ c: "Z", p: [] });
  // keep curve handles inside the box by clamping (they rarely leave it by much)
  const clamp = (v: number, m: number) => Math.max(0, Math.min(m, v));
  for (const x of cmds) x.p = x.p.map((v, k) => clamp(v, k % 2 ? h : w));
  return { box: { x: r2(x0), y: r2(y0), w: r2(w), h: r2(h) }, geom: { w: r2(w), h: r2(h), d: fmt(cmds) }, closed };
}

/**
 * Clicked points (slide px) as a straight-line freeform, PowerPoint's
 * "Freeform: Shape": every vertex kept, joined by lines, closed on request.
 */
export function polygonToFreeform(raw: { x: number; y: number }[], closed: boolean): { box: Box; geom: Geom; closed: boolean } | null {
  const pts = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 0.5);
  if (pts.length < 2) return null;
  const close = closed && pts.length > 2;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
  const cmds: Cmd[] = pts.map((p, i) => ({ c: i ? "L" : "M", p: [p.x - x0, p.y - y0] }));
  if (close) cmds.push({ c: "Z", p: [] });
  return { box: { x: r2(x0), y: r2(y0), w: r2(w), h: r2(h) }, geom: { w: r2(w), h: r2(h), d: fmt(cmds) }, closed: close };
}

// ------------------------------------------------------------- DrawingML

/** custGeom for a freeform (path units: hundredths of the geom box). */
export function custGeomXml(g: Geom): string {
  const k = 100;
  const pt = (x: number, y: number) => `<a:pt x="${Math.round(x * k)}" y="${Math.round(y * k)}"/>`;
  const body = parseD(g.d)
    .map((x) => {
      if (x.c === "M") return `<a:moveTo>${pt(x.p[0], x.p[1])}</a:moveTo>`;
      if (x.c === "L") return `<a:lnTo>${pt(x.p[0], x.p[1])}</a:lnTo>`;
      if (x.c === "C") return `<a:cubicBezTo>${pt(x.p[0], x.p[1])}${pt(x.p[2], x.p[3])}${pt(x.p[4], x.p[5])}</a:cubicBezTo>`;
      if (x.c === "Q") return `<a:quadBezTo>${pt(x.p[0], x.p[1])}${pt(x.p[2], x.p[3])}</a:quadBezTo>`;
      return "<a:close/>";
    })
    .join("");
  const W = Math.max(1, Math.round(g.w * k)), H = Math.max(1, Math.round(g.h * k));
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${W}" h="${H}"${isClosed(g) ? "" : ' fill="none"'}>${body}</a:path></a:pathLst></a:custGeom>`;
}

/** Read a custGeom into a path in the element's own px box (w × h). Arcs are sampled into lines. */
export function readCustGeom(cg: XEl, w: number, h: number): Geom | null {
  const cmds: Cmd[] = [];
  for (const p of kids(child(cg, "pathLst"), "path")) {
    const pw = num(p, "w") || 0, ph = num(p, "h") || 0;
    const sx = pw ? w / pw : 1 / 9525, sy = ph ? h / ph : 1 / 9525;
    const pts = (el: XEl) => kids(el, "pt").flatMap((q) => [(num(q, "x") ?? 0) * sx, (num(q, "y") ?? 0) * sy]);
    let cx = 0, cy = 0;
    for (const c of p.children) {
      if (c.local === "moveTo" || c.local === "lnTo") {
        const v = pts(c);
        if (v.length < 2) continue;
        cmds.push({ c: c.local === "moveTo" ? "M" : "L", p: v.slice(0, 2) });
        [cx, cy] = v;
      } else if (c.local === "cubicBezTo") {
        const v = pts(c);
        if (v.length < 6) continue;
        cmds.push({ c: "C", p: v.slice(0, 6) });
        [cx, cy] = [v[4], v[5]];
      } else if (c.local === "quadBezTo") {
        const v = pts(c);
        if (v.length < 4) continue;
        cmds.push({ c: "Q", p: v.slice(0, 4) });
        [cx, cy] = [v[2], v[3]];
      } else if (c.local === "arcTo") {
        const wR = (num(c, "wR") ?? 0) * sx, hR = (num(c, "hR") ?? 0) * sy;
        const st = ((num(c, "stAng") ?? 0) / 60000) * (Math.PI / 180), sw = ((num(c, "swAng") ?? 0) / 60000) * (Math.PI / 180);
        const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st);
        const steps = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 12)));
        for (let k = 1; k <= steps; k++) {
          const a = st + (sw * k) / steps;
          cmds.push({ c: "L", p: [ox + wR * Math.cos(a), oy + hR * Math.sin(a)] });
        }
        [cx, cy] = cmds[cmds.length - 1].p;
      } else if (c.local === "close") cmds.push({ c: "Z", p: [] });
    }
    if (attr(p, "fill") === "none" && cmds[cmds.length - 1]?.c === "Z") cmds.pop();
  }
  if (!cmds.length || cmds[0].c !== "M") return null;
  return { w: r2(w), h: r2(h), d: fmt(cmds) };
}

// ------------------------------------------------------------- edit points

/** A point of a path: an anchor (where the outline passes) or a curve's control point. */
export type PathPoint = { cmd: number; pair: number; x: number; y: number; ctrl: boolean };

/** Every point of a freeform's path, in its geom box. */
export function pathPoints(g: Geom): PathPoint[] {
  const out: PathPoint[] = [];
  parseD(g.d).forEach((x, cmd) => {
    const n = x.p.length / 2;
    for (let pair = 0; pair < n; pair++) out.push({ cmd, pair, x: x.p[pair * 2], y: x.p[pair * 2 + 1], ctrl: pair < n - 1 });
  });
  return out;
}

/** The path with one point moved (geom box coordinates; may leave the box until refit). */
export function setPoint(g: Geom, cmd: number, pair: number, x: number, y: number): Geom {
  const cmds = parseD(g.d);
  const c = cmds[cmd];
  if (!c || pair * 2 + 1 >= c.p.length) return g;
  const p = [...c.p];
  // an anchor drags the control points next to it along
  if (pair === p.length / 2 - 1) {
    const dx = x - p[pair * 2], dy = y - p[pair * 2 + 1];
    if (c.c === "C") { p[2] += dx; p[3] += dy; }
    const nx = cmds[cmd + 1];
    if (nx?.c === "C") cmds[cmd + 1] = { c: "C", p: [nx.p[0] + dx, nx.p[1] + dy, ...nx.p.slice(2)] };
  }
  p[pair * 2] = x;
  p[pair * 2 + 1] = y;
  cmds[cmd] = { c: c.c, p };
  return { ...g, d: fmt(cmds) };
}

/** The path without the anchor ending command `cmd` (null when too few points would be left). */
export function deleteVertex(g: Geom, cmd: number): Geom | null {
  const cmds = parseD(g.d);
  const anchors = cmds.filter((x) => x.c !== "Z").length;
  if (anchors <= (isClosed(g) ? 3 : 2) || !cmds[cmd] || cmds[cmd].c === "Z") return null;
  if (cmds[cmd].c === "M") {
    // the next point starts the path
    const nx = cmds[cmd + 1];
    if (!nx || nx.c === "Z") return null;
    cmds.splice(cmd, 2, { c: "M", p: nx.p.slice(-2) });
  } else cmds.splice(cmd, 1);
  return { ...g, d: fmt(cmds) };
}

/** A new anchor halfway along the segment that command `cmd` draws (a line, or a curve split in two). */
export function insertVertex(g: Geom, cmd: number): Geom {
  const cmds = parseD(g.d);
  const c = cmds[cmd];
  const prev = cmds.slice(0, cmd).reverse().find((x) => x.c !== "Z");
  if (!c || !prev || c.c === "M" || c.c === "Z") return g;
  const [x0, y0] = prev.p.slice(-2);
  const mid = (a: number, b: number) => (a + b) / 2;
  if (c.c === "L") cmds.splice(cmd, 0, { c: "L", p: [mid(x0, c.p[0]), mid(y0, c.p[1])] });
  else if (c.c === "C") {
    // de Casteljau at t = 0.5
    const [x1, y1, x2, y2, x3, y3] = c.p;
    const ax = mid(x0, x1), ay = mid(y0, y1), bx = mid(x1, x2), by = mid(y1, y2), cx = mid(x2, x3), cy = mid(y2, y3);
    const dx = mid(ax, bx), dy = mid(ay, by), ex = mid(bx, cx), ey = mid(by, cy), fx = mid(dx, ex), fy = mid(dy, ey);
    cmds.splice(cmd, 1, { c: "C", p: [ax, ay, dx, dy, fx, fy] }, { c: "C", p: [ex, ey, cx, cy, x3, y3] });
  } else if (c.c === "Q") {
    const [x1, y1, x2, y2] = c.p;
    const ax = mid(x0, x1), ay = mid(y0, y1), bx = mid(x1, x2), by = mid(y1, y2), fx = mid(ax, bx), fy = mid(ay, by);
    cmds.splice(cmd, 1, { c: "Q", p: [ax, ay, fx, fy] }, { c: "Q", p: [bx, by, x2, y2] });
  }
  return { ...g, d: fmt(cmds) };
}

/**
 * After editing: the path moved into a box fitting all its points again, and
 * the element's box (slide px) moved and resized to match, so the shape stays
 * where it was drawn.
 */
export function refit(g: Geom, box: Box): { geom: Geom; box: Box } {
  const pts = pathPoints(g);
  if (!pts.length) return { geom: g, box };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const sx = g.w ? box.w / g.w : 1, sy = g.h ? box.h / g.h : 1;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const cmds = parseD(g.d).map((x) => ({ c: x.c, p: x.p.map((v, k) => (k % 2 ? v - y0 : v - x0)) }));
  return {
    geom: { w: r2(w), h: r2(h), d: fmt(cmds) },
    box: { x: r2(box.x + x0 * sx), y: r2(box.y + y0 * sy), w: r2(Math.max(1, w * sx)), h: r2(Math.max(1, h * sy)) },
  };
}
