// The outlines of all 187 DrawingML preset shapes (the shapes of Excel's and
// PowerPoint's Insert > Shapes: flowchart symbols, callouts, stars and
// banners, arrows, brackets, action buttons and the rest), drawn as SVG paths
// at any size. The data (lib/shape-presets.json, built by
// scripts/gen-shape-presets.mjs) holds each preset's adjustment defaults,
// guide formulas, path commands and points.

import data from "./shape-presets.json";

type Param = number | string;
type Preset = { e: string[]; c: [Param, Param][]; s: [number, number][]; a?: [string, number][]; v?: [number, number][]; t?: [[Param, Param], [Param, Param]] };
const PRESETS = data as unknown as Record<string, Preset>;

/** Every preset name, as Excel writes it in <a:prstGeom prst="…">. */
export const PRESET_NAMES: string[] = Object.keys(PRESETS).sort();
export const isPreset = (name: string | undefined): name is string => !!name && Object.prototype.hasOwnProperty.call(PRESETS, name);

/** "flowChartProcess" -> "Flow chart process". */
export function presetLabel(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---- Guide formulas ---------------------------------------------------------
// LibreOffice's syntax: numbers, ?n (another formula), $n (an adjustment),
// logwidth, logheight, pi, + - * / with brackets, and if(a,b,c) (b when a > 0),
// min, max, abs, sqrt, sin, cos, tan, atan2.

type Node = (env: Env) => number;
type Env = { w: number; h: number; adj: number[]; eq: (i: number) => number };
const compiled = new Map<string, Node>();

function compile(src: string): Node {
  const hit = compiled.get(src);
  if (hit) return hit;
  let i = 0;
  const peek = () => src[i];
  const expect = (ch: string) => {
    if (src[i] !== ch) throw new Error(`"${ch}" expected in ${src} at ${i}`);
    i++;
  };
  const FN: Record<string, (a: number[]) => number> = {
    if: ([a, b, c]) => (a > 0 ? b : c),
    min: ([a, b]) => Math.min(a, b),
    max: ([a, b]) => Math.max(a, b),
    abs: ([a]) => Math.abs(a),
    sqrt: ([a]) => Math.sqrt(Math.max(0, a)),
    sin: ([a]) => Math.sin(a),
    cos: ([a]) => Math.cos(a),
    tan: ([a]) => Math.tan(a),
    atan: ([a]) => Math.atan(a),
    atan2: ([a, b]) => Math.atan2(a, b),
  };
  const primary = (): Node => {
    const ch = peek();
    if (ch === "(") {
      i++;
      const n = sum();
      expect(")");
      return n;
    }
    if (ch === "-") {
      i++;
      const n = primary();
      return (env) => -n(env);
    }
    if (ch === "?" || ch === "$") {
      i++;
      const m = /^\d+/.exec(src.slice(i))!;
      i += m[0].length;
      const k = Number(m[0]);
      return ch === "?" ? (env) => env.eq(k) : (env) => env.adj[k] ?? 0;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      const v = Number(num[0]);
      return () => v;
    }
    const word = /^[a-z][a-z0-9]*/.exec(src.slice(i));
    if (!word) throw new Error(`Unexpected "${ch}" in ${src}`);
    i += word[0].length;
    const name = word[0];
    if (name === "logwidth" || name === "width") return (env) => env.w;
    if (name === "logheight" || name === "height") return (env) => env.h;
    if (name === "pi") return () => Math.PI;
    const fn = FN[name];
    if (!fn) throw new Error(`Unknown function ${name}`);
    expect("(");
    const args: Node[] = [sum()];
    while (peek() === ",") {
      i++;
      args.push(sum());
    }
    expect(")");
    return (env) => fn(args.map((a) => a(env)));
  };
  const product = (): Node => {
    let left = primary();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const l = left;
      const r = primary();
      left = op === "*" ? (env) => l(env) * r(env) : (env) => {
        const d = r(env);
        return d === 0 ? 0 : l(env) / d;
      };
    }
    return left;
  };
  const sum = (): Node => {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const l = left;
      const r = product();
      left = op === "+" ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    return left;
  };
  const node = sum();
  if (i !== src.length) throw new Error(`Trailing text in ${src}`);
  compiled.set(src, node);
  return node;
}

// ---- Paths --------------------------------------------------------------------

/** One subpath of a preset: SVG path data, and whether it is filled and outlined. */
export type PresetPart = { d: string; fill: boolean; stroke: boolean };

const CMD = { MOVETO: 1, LINETO: 2, CURVETO: 3, CLOSE: 4, END: 5, NOFILL: 6, NOSTROKE: 7, QUADTO: 16, ARCANGLETO: 17 } as const;

/**
 * A preset's outline in a w x h box, as subpaths. `adjust` overrides the
 * adjustment values by name (adj, adj1, …), in the preset's own units.
 */
export function presetParts(name: string, w: number, h: number, adjust: Record<string, number> = {}): PresetPart[] | null {
  const p = isPreset(name) ? PRESETS[name] : null;
  if (!p) return null;
  const adj = (p.a || []).map(([k, v]) => (Number.isFinite(adjust[k]) ? adjust[k] : v));
  const cache = new Map<number, number>();
  const busy = new Set<number>();
  const env: Env = {
    w,
    h,
    adj,
    eq: (k) => {
      const hit = cache.get(k);
      if (hit !== undefined) return hit;
      if (busy.has(k) || !p.e[k]) return 0;
      busy.add(k);
      let v = 0;
      try {
        v = compile(p.e[k])(env);
      } catch {
        v = 0;
      }
      busy.delete(k);
      if (!Number.isFinite(v)) v = 0;
      cache.set(k, v);
      return v;
    },
  };
  const val = (x: Param) => (typeof x === "number" ? x : x[0] === "?" ? env.eq(Number(x.slice(1))) : adj[Number(x.slice(1))] ?? 0);
  const n = (v: number) => Math.round(v * 100) / 100;
  const parts: PresetPart[] = [];
  let at = 0;
  let sub = 0;
  let d = "";
  let fill = true;
  let stroke = true;
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  // A subpath with its own coordinate space (<a:path w h>) is scaled to the box.
  const scale = () => {
    const v = p.v?.[sub];
    return { sx: v && v[0] ? w / v[0] : 1, sy: v && v[1] ? h / v[1] : 1 };
  };
  const pt = () => {
    const pair = p.c[at++] || [0, 0];
    const { sx, sy } = scale();
    return { x: val(pair[0]) * sx, y: val(pair[1]) * sy };
  };
  const flush = () => {
    if (d) parts.push({ d: d.trim(), fill, stroke });
    d = "";
    fill = true;
    stroke = true;
  };
  for (const [cmd, count] of p.s) {
    const times = Math.max(1, count);
    switch (cmd) {
      case CMD.MOVETO:
        for (let k = 0; k < times; k++) {
          cur = start = pt();
          d += `M${n(cur.x)} ${n(cur.y)}`;
        }
        break;
      case CMD.LINETO:
        for (let k = 0; k < count; k++) {
          cur = pt();
          d += `L${n(cur.x)} ${n(cur.y)}`;
        }
        break;
      case CMD.CURVETO:
        for (let k = 0; k < count; k++) {
          const a = pt();
          const b = pt();
          cur = pt();
          d += `C${n(a.x)} ${n(a.y)} ${n(b.x)} ${n(b.y)} ${n(cur.x)} ${n(cur.y)}`;
        }
        break;
      case CMD.QUADTO:
        for (let k = 0; k < count; k++) {
          const a = pt();
          cur = pt();
          d += `Q${n(a.x)} ${n(a.y)} ${n(cur.x)} ${n(cur.y)}`;
        }
        break;
      case CMD.ARCANGLETO:
        for (let k = 0; k < count; k++) {
          const radii = p.c[at++] || [0, 0];
          const angles = p.c[at++] || [0, 0];
          const { sx, sy } = scale();
          const wR = val(radii[0]) * sx;
          const hR = val(radii[1]) * sy;
          const stAng = val(angles[0]);
          const swAng = val(angles[1]);
          const arc = arcTo(cur, wR, hR, stAng, swAng);
          d += arc.d;
          cur = arc.end;
        }
        break;
      case CMD.CLOSE:
        d += "Z";
        cur = start;
        break;
      case CMD.END:
        flush();
        sub++;
        break;
      case CMD.NOFILL:
        fill = false;
        break;
      case CMD.NOSTROKE:
        stroke = false;
        break;
      default:
        // Shading changes (darken, lighten) don't move the pen.
        break;
    }
  }
  flush();
  return parts;
}

/** DrawingML's arcTo: from the current point, round an ellipse (wR, hR) from stAng through swAng (degrees). */
function arcTo(from: { x: number; y: number }, wR: number, hR: number, stAng: number, swAng: number) {
  const n = (v: number) => Math.round(v * 100) / 100;
  if (wR <= 0 || hR <= 0 || !swAng) return { d: "", end: from };
  // The angles are visual; on the ellipse they become parametric.
  const param = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return Math.atan2(wR * Math.sin(t), hR * Math.cos(t));
  };
  const t1 = param(stAng);
  const cx = from.x - wR * Math.cos(t1);
  const cy = from.y - hR * Math.sin(t1);
  let d = "";
  let end = from;
  // A full turn (or more) goes as two halves, which SVG can draw.
  const steps = Math.abs(swAng) > 180 ? 2 : 1;
  for (let k = 1; k <= steps; k++) {
    const t = param(stAng + (swAng * k) / steps);
    end = { x: cx + wR * Math.cos(t), y: cy + hR * Math.sin(t) };
    d += `A${n(wR)} ${n(hR)} 0 0 ${swAng > 0 ? 1 : 0} ${n(end.x)} ${n(end.y)}`;
  }
  return { d, end };
}

/** The preset's text box (left, top, right, bottom) in a w x h box. */
export function presetTextRect(name: string, w: number, h: number): { l: number; t: number; r: number; b: number } | null {
  const p = isPreset(name) ? PRESETS[name] : null;
  if (!p?.t) return null;
  const parts = presetParts(name, w, h);
  if (!parts) return null;
  // Evaluate the text frame's points with the same formulas.
  const adj = (p.a || []).map(([, v]) => v);
  const cache = new Map<number, number>();
  const env: Env = {
    w,
    h,
    adj,
    eq: (k) => {
      if (cache.has(k)) return cache.get(k)!;
      let v = 0;
      try {
        v = compile(p.e[k])(env);
      } catch {
        v = 0;
      }
      cache.set(k, Number.isFinite(v) ? v : 0);
      return cache.get(k)!;
    },
  };
  const val = (x: Param) => (typeof x === "number" ? x : x[0] === "?" ? env.eq(Number(x.slice(1))) : adj[Number(x.slice(1))] ?? 0);
  const [[l, t], [r, b]] = p.t;
  return { l: val(l), t: val(t), r: val(r), b: val(b) };
}
