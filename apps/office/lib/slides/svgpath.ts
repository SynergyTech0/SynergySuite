// SVG path data -> the absolute M/L/C/Q/Z subset our freeform shapes use
// (relative commands made absolute, H/V/S/T expanded, arcs as cubic curves),
// and SVG basic shapes (circle, rect, line, ...) as paths. Used for icons.

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ARGC: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** An elliptical arc (SVG endpoint form) as cubic Bézier segments: [x1 y1 x2 y2 x y]... */
export function arcToCubics(x0: number, y0: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x: number, y: number): number[][] {
  if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) return x0 === x && y0 === y ? [] : [[x0, y0, x, y, x, y]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const rad = (phi * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2, cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const kk = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const der = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = t1, b = t1 + step;
    const p0 = pt(a), p1 = pt(b), d0 = der(a), d1 = der(b);
    out.push([p0.x + kk * d0.x, p0.y + kk * d0.y, p1.x - kk * d1.x, p1.y - kk * d1.y, p1.x, p1.y]);
    t1 = b;
  }
  // land exactly on the end point
  if (out.length) {
    out[out.length - 1][4] = x;
    out[out.length - 1][5] = y;
  }
  return out;
}

/** Any SVG path data as absolute M/L/C/Q/Z commands. */
export function normalizePath(d: string): string {
  const tok = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out: string[] = [];
  let i = 0, cmd = "", cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC: [number, number] | null = null, lastQ: [number, number] | null = null;
  const P = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
  while (i < tok.length) {
    if (/^[a-zA-Z]$/.test(tok[i])) cmd = tok[i++];
    else if (!cmd) break;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (!(up in ARGC)) break;
    if (up === "Z") {
      out.push("Z");
      cx = sx; cy = sy;
      lastC = lastQ = null;
      cmd = "";
      continue;
    }
    // flags in arcs may be written without separators ("a1 1 0 011 1")
    if (up === "A") {
      const a: number[] = [];
      while (a.length < 7 && i < tok.length && !/^[a-zA-Z]$/.test(tok[i])) {
        const t = tok[i++];
        if ((a.length === 3 || a.length === 4) && t.length > 1 && /^[01]/.test(t)) {
          a.push(Number(t[0]));
          tok.splice(i, 0, t.slice(1));
        } else a.push(Number(t));
      }
      if (a.length < 7) break;
      const [rx, ry, rot, lg, sw, ex0, ey0] = a;
      const ex = rel ? cx + ex0 : ex0, ey = rel ? cy + ey0 : ey0;
      for (const c of arcToCubics(cx, cy, rx, ry, rot, !!lg, !!sw, ex, ey)) out.push(`C${P(c[0], c[1])} ${P(c[2], c[3])} ${P(c[4], c[5])}`);
      cx = ex; cy = ey;
      lastC = lastQ = null;
      continue;
    }
    const n = ARGC[up];
    const v = tok.slice(i, i + n).map(Number);
    if (v.length < n || v.some((x) => !Number.isFinite(x))) break;
    i += n;
    const ax = (k: number) => (rel ? cx + v[k] : v[k]);
    const ay = (k: number) => (rel ? cy + v[k] : v[k]);
    switch (up) {
      case "M":
        cx = ax(0); cy = ay(1); sx = cx; sy = cy;
        out.push(`M${P(cx, cy)}`);
        cmd = rel ? "l" : "L";
        lastC = lastQ = null;
        break;
      case "L":
        cx = ax(0); cy = ay(1);
        out.push(`L${P(cx, cy)}`);
        lastC = lastQ = null;
        break;
      case "H":
        cx = rel ? cx + v[0] : v[0];
        out.push(`L${P(cx, cy)}`);
        lastC = lastQ = null;
        break;
      case "V":
        cy = rel ? cy + v[0] : v[0];
        out.push(`L${P(cx, cy)}`);
        lastC = lastQ = null;
        break;
      case "C": {
        const x1 = ax(0), y1 = ay(1), x2 = ax(2), y2 = ay(3);
        cx = ax(4); cy = ay(5);
        out.push(`C${P(x1, y1)} ${P(x2, y2)} ${P(cx, cy)}`);
        lastC = [x2, y2]; lastQ = null;
        break;
      }
      case "S": {
        const x1 = lastC ? 2 * cx - lastC[0] : cx, y1 = lastC ? 2 * cy - lastC[1] : cy;
        const x2 = ax(0), y2 = ay(1);
        cx = ax(2); cy = ay(3);
        out.push(`C${P(x1, y1)} ${P(x2, y2)} ${P(cx, cy)}`);
        lastC = [x2, y2]; lastQ = null;
        break;
      }
      case "Q": {
        const x1 = ax(0), y1 = ay(1);
        cx = ax(2); cy = ay(3);
        out.push(`Q${P(x1, y1)} ${P(cx, cy)}`);
        lastQ = [x1, y1]; lastC = null;
        break;
      }
      case "T": {
        const x1: number = lastQ ? 2 * cx - lastQ[0] : cx, y1: number = lastQ ? 2 * cy - lastQ[1] : cy;
        cx = ax(0); cy = ay(1);
        out.push(`Q${P(x1, y1)} ${P(cx, cy)}`);
        lastQ = [x1, y1]; lastC = null;
        break;
      }
    }
  }
  return out.join(" ");
}

const n = (v: string | number | undefined) => Number(v) || 0;

/** One SVG element (path, circle, ellipse, rect, line, polyline, polygon) as absolute path data. */
export function shapeToPath(tag: string, a: Record<string, string | number | undefined>): string {
  switch (tag) {
    case "path":
      return normalizePath(String(a.d || ""));
    case "circle":
    case "ellipse": {
      const cx = n(a.cx), cy = n(a.cy);
      const rx = tag === "circle" ? n(a.r) : n(a.rx), ry = tag === "circle" ? n(a.r) : n(a.ry);
      return normalizePath(`M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`);
    }
    case "rect": {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      let rx = n(a.rx ?? a.ry), ry = n(a.ry ?? a.rx);
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return normalizePath(`M${x} ${y} H${x + w} V${y + h} H${x} Z`);
      return normalizePath(
        `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`,
      );
    }
    case "line":
      return normalizePath(`M${n(a.x1)} ${n(a.y1)} L${n(a.x2)} ${n(a.y2)}`);
    case "polyline":
    case "polygon": {
      const pts = String(a.points || "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return "";
      let d = `M${pts[0]} ${pts[1]}`;
      for (let k = 2; k + 1 < pts.length; k += 2) d += ` L${pts[k]} ${pts[k + 1]}`;
      return normalizePath(tag === "polygon" ? `${d} Z` : d);
    }
  }
  return "";
}
