/**
 * A 2D drawing sheet from a 3D model: front, top and right views (third-angle projection) with
 * hidden lines, an isometric view, overall and hole dimensions, a border and a title block, as a
 * DXF the 2D editor opens.
 *
 * The geometry stays at full size, so dimensions measure true millimetres; the sheet (an A3
 * border, text and arrow sizes) is drawn larger or smaller around it instead, at the scale the
 * title block names. That's how a drawing is set up in model space in AutoCAD too.
 */
import { FRONT, ISO, RIGHT, TOP, buildModel, projectView, type Part, type Seg, type ViewLines } from "./views";

/** A3 landscape, millimetres. */
const SHEET = { w: 420, h: 297, name: "A3" };
const MARGIN = 10;
/** Room for dimensions beside the views, and between them, in sheet millimetres. */
const DIM_ROOM = 22;
const GAP = 24;
const TITLE = { w: 180, h: 36 };
/** Standard drawing scales, largest first. */
const SCALES = [10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200, 1 / 500, 1 / 1000];

export type DrawingOptions = { title: string; date: string };

export type Curve =
  | { kind: "line"; seg: Seg }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; end: number }
  | { kind: "polyline"; points: number[]; closed: boolean };

/** The DXF text of the drawing, or null when the model has nothing to draw. */
export function makeDrawing(parts: Part[], options: DrawingOptions): string | null {
  const model = buildModel(parts);
  if (!model.size) return null;
  const views = [FRONT, TOP, RIGHT, ISO].map((spec) => projectView(model, spec));
  if (views.every((v) => !v.visible.length)) return null;
  const tol = model.size * 1e-5;
  const [front, top, right, iso] = views.map((v) => ({ ...v, box: bounds(v) }));

  // The largest standard scale that fits the views (plus room for dimensions) on the sheet.
  const modelW = front.box.w + Math.max(right.box.w, iso.box.w);
  const modelH = front.box.h + Math.max(top.box.h, iso.box.h);
  const roomW = SHEET.w - 2 * MARGIN - DIM_ROOM - 10 - GAP;
  const roomH = SHEET.h - 2 * MARGIN - TITLE.h - DIM_ROOM - 10 - GAP;
  const fit = Math.min(roomW / Math.max(modelW, 1e-9), roomH / Math.max(modelH, 1e-9));
  const scale = SCALES.find((s) => s <= fit) ?? SCALES[SCALES.length - 1];
  const k = 1 / scale; // sheet millimetres → model millimetres

  // Third-angle layout: top above front, right beside it, isometric in the corner they leave.
  const gap = GAP * k;
  const contentW = front.box.w + gap + Math.max(right.box.w, iso.box.w);
  const contentH = front.box.h + gap + Math.max(top.box.h, iso.box.h);
  const areaX0 = (MARGIN + DIM_ROOM) * k, areaX1 = (SHEET.w - MARGIN - 10) * k;
  const areaY0 = (MARGIN + TITLE.h + DIM_ROOM) * k, areaY1 = (SHEET.h - MARGIN - 10) * k;
  const ox = areaX0 + (areaX1 - areaX0 - contentW) / 2;
  const oy = areaY0 + (areaY1 - areaY0 - contentH) / 2;
  const place = (view: typeof front, x: number, y: number) => ({ ...view, dx: x - view.box.x0, dy: y - view.box.y0 });
  const placed = [
    place(front, ox, oy),
    place(top, ox, oy + front.box.h + gap),
    place(right, ox + front.box.w + gap, oy),
    place(iso, ox + front.box.w + gap, oy + front.box.h + gap),
  ];

  const dxf = new Dxf(k);
  const circles: { cx: number; cy: number; r: number }[] = [];
  placed.forEach((view, i) => {
    for (const [layer, segs] of [["VISIBLE", view.visible], ["HIDDEN", view.hidden]] as const) {
      for (const curve of curves(segs, tol)) {
        const moved = shift(curve, view.dx, view.dy);
        dxf.curve(layer, moved);
        // Holes seen end-on in the three main views get a diameter.
        if (layer === "VISIBLE" && i < 3 && moved.kind === "circle") circles.push(moved);
      }
    }
  });

  // Overall sizes: width and height on the front view, depth under the right view.
  const [f, , r] = placed;
  const fx0 = f.box.x0 + f.dx, fx1 = f.box.x1 + f.dx, fy0 = f.box.y0 + f.dy, fy1 = f.box.y1 + f.dy;
  dxf.linear([fx0, fy0], [fx1, fy0], fy0 - 10 * k, 0);
  dxf.linear([fx0, fy0], [fx0, fy1], fx0 - 10 * k, 90);
  const rx0 = r.box.x0 + r.dx, rx1 = r.box.x1 + r.dx, ry0 = r.box.y0 + r.dy;
  if (r.box.w > tol) dxf.linear([rx0, ry0], [rx1, ry0], ry0 - 10 * k, 0);
  const seen = new Set<string>();
  for (const c of circles) {
    const key = c.r.toFixed(2);
    if (seen.has(key) || seen.size >= 6) continue;
    seen.add(key);
    dxf.diameter(c.cx, c.cy, c.r);
  }

  sheet(dxf, k, scale, options);
  return dxf.toString();
}

type Box = { x0: number; y0: number; x1: number; y1: number; w: number; h: number };

function bounds(view: ViewLines): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a, b, c, d] of [...view.visible, ...view.hidden]) {
    x0 = Math.min(x0, a, c);
    x1 = Math.max(x1, a, c);
    y0 = Math.min(y0, b, d);
    y1 = Math.max(y1, b, d);
  }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function shift(c: Curve, dx: number, dy: number): Curve {
  switch (c.kind) {
    case "line":
      return { kind: "line", seg: [c.seg[0] + dx, c.seg[1] + dy, c.seg[2] + dx, c.seg[3] + dy] };
    case "circle":
    case "arc":
      return { ...c, cx: c.cx + dx, cy: c.cy + dy };
    case "polyline":
      return { ...c, points: c.points.map((p, i) => p + (i % 2 ? dy : dx)) };
  }
}

/** Corners sharper than this split a chain; a tessellated curve turns at most ~11° per chord. */
const CORNER = Math.cos((15 * Math.PI) / 180);

/**
 * Line work as drawing entities: chains of short chords that lie on a circle become circles and
 * arcs (so holes and fillets measure as such), other curves become polylines, and the rest stay
 * lines.
 */
export function curves(segs: Seg[], tol: number): Curve[] {
  const key = (x: number, y: number) => `${Math.round(x / (tol * 10))},${Math.round(y / (tol * 10))}`;
  const at = new Map<string, number[]>();
  segs.forEach(([x1, y1, x2, y2], i) => {
    for (const k of [key(x1, y1), key(x2, y2)]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: Curve[] = [];

  // Walk from chain ends first, then around closed loops.
  const walk = (first: number, fromKey: string) => {
    const pts: number[] = [];
    let i = first;
    let k = fromKey;
    const [x1, y1, x2, y2] = segs[i];
    if (key(x1, y1) === k) pts.push(x1, y1);
    else pts.push(x2, y2);
    while (true) {
      used[i] = 1;
      const [a, b, c, d] = segs[i];
      const forward = key(a, b) === k;
      const [nx, ny] = forward ? [c, d] : [a, b];
      pts.push(nx, ny);
      k = key(nx, ny);
      const next = at.get(k) ?? [];
      if (next.length !== 2) break;
      const j = next[0] === i ? next[1] : next[0];
      if (used[j]) break;
      i = j;
    }
    return pts;
  };
  for (const [k, list] of at) {
    if (list.length === 2) continue;
    for (const i of list) if (!used[i]) out.push(...fit(walk(i, k), tol));
  }
  segs.forEach(([x1, y1], i) => {
    if (!used[i]) out.push(...fit(walk(i, key(x1, y1)), tol));
  });
  return out;
}

/** One chain of points as circles, arcs, polylines and lines. */
function fit(pts: number[], tol: number): Curve[] {
  const n = pts.length / 2;
  const closed = n > 3 && Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1]) < tol * 10;
  if (closed) {
    const c = circleThrough(pts, 0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3));
    if (c && n >= 7 && onCircle(pts, 0, n - 1, c, tol)) return [{ kind: "circle", ...c }];
  }
  // Split at corners, then grow arcs greedily along each smooth run.
  const out: Curve[] = [];
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (i === n - 1 || turn(pts, i) < CORNER) {
      out.push(...run(pts, start, i, tol));
      start = i;
    }
  }
  return out;
}

function turn(pts: number[], i: number): number {
  const ax = pts[2 * i] - pts[2 * i - 2], ay = pts[2 * i + 1] - pts[2 * i - 1];
  const bx = pts[2 * i + 2] - pts[2 * i], by = pts[2 * i + 3] - pts[2 * i + 1];
  return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
}

/** Points start..end (inclusive) of a run with no corners. */
function run(pts: number[], start: number, end: number, tol: number): Curve[] {
  const out: Curve[] = [];
  const loose: number[] = [];
  const flush = () => {
    if (loose.length === 4) out.push({ kind: "line", seg: [loose[0], loose[1], loose[2], loose[3]] });
    else if (loose.length > 4) out.push({ kind: "polyline", points: [...loose], closed: false });
    loose.length = 0;
  };
  let i = start;
  while (i < end) {
    let best = -1;
    let bestCircle: { cx: number; cy: number; r: number } | null = null;
    for (let j = i + 3; j <= end; j++) {
      const c = circleThrough(pts, i, Math.floor((i + j) / 2), j);
      if (!c || !onCircle(pts, i, j, c, tol)) break;
      best = j;
      bestCircle = c;
    }
    if (bestCircle && best > 0) {
      flush();
      out.push(arc(pts, i, best, bestCircle));
      i = best;
    } else {
      if (!loose.length) loose.push(pts[2 * i], pts[2 * i + 1]);
      loose.push(pts[2 * i + 2], pts[2 * i + 3]);
      i++;
    }
  }
  flush();
  return out;
}

function circleThrough(pts: number[], a: number, b: number, c: number) {
  const [ax, ay, bx, by, cx, cy] = [pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1], pts[2 * c], pts[2 * c + 1]];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { cx: x, cy: y, r: Math.hypot(ax - x, ay - y) };
}

/**
 * Every point from a to b on the circle, and the chords even and short enough to be a curve's
 * tessellation rather than a polygon's sides (the end chords may be cut short by hidden-line splits).
 */
function onCircle(pts: number[], a: number, b: number, c: { cx: number; cy: number; r: number }, tol: number): boolean {
  const slack = Math.max(tol * 10, c.r * 1e-3);
  let lo = Infinity, hi = 0, ends = 0;
  for (let i = a; i <= b; i++) {
    if (Math.abs(Math.hypot(pts[2 * i] - c.cx, pts[2 * i + 1] - c.cy) - c.r) > slack) return false;
    if (i === a) continue;
    const chord = Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    if (chord > c.r * 0.45) return false; // over ~26°
    if (i > a + 1 && i < b) {
      lo = Math.min(lo, chord);
      hi = Math.max(hi, chord);
    } else ends = Math.max(ends, chord);
  }
  return hi <= lo * 3 && ends <= hi * 1.5;
}

function arc(pts: number[], a: number, b: number, c: { cx: number; cy: number; r: number }): Curve {
  const angle = (i: number) => (Math.atan2(pts[2 * i + 1] - c.cy, pts[2 * i] - c.cx) * 180) / Math.PI;
  // DXF arcs run counter-clockwise from start to end.
  const m = Math.floor((a + b) / 2);
  const cross = (pts[2 * m] - pts[2 * a]) * (pts[2 * b + 1] - pts[2 * a + 1]) - (pts[2 * m + 1] - pts[2 * a + 1]) * (pts[2 * b] - pts[2 * a]);
  const ccw = cross > 0; // the middle point bulges to the right of a counter-clockwise chord
  return { kind: "arc", ...c, start: ccw ? angle(a) : angle(b), end: ccw ? angle(b) : angle(a) };
}

/** Border and title block. */
function sheet(dxf: Dxf, k: number, scale: number, options: DrawingOptions) {
  const W = SHEET.w * k, H = SHEET.h * k, m = MARGIN * k;
  dxf.curve("BORDER", { kind: "polyline", points: [m, m, W - m, m, W - m, H - m, m, H - m], closed: true });
  const tx = W - m - TITLE.w * k, ty = m, th = TITLE.h * k;
  dxf.curve("BORDER", { kind: "polyline", points: [tx, ty, W - m, ty, W - m, ty + th, tx, ty + th], closed: true });
  dxf.curve("BORDER", { kind: "line", seg: [tx, ty + th / 2, W - m, ty + th / 2] });
  const cell = (TITLE.w * k) / 4;
  for (let i = 1; i < 4; i++) dxf.curve("BORDER", { kind: "line", seg: [tx + cell * i, ty, tx + cell * i, ty + th / 2] });
  const label = scale >= 1 ? `${scale}:1` : `1:${Math.round(1 / scale)}`;
  dxf.text("TITLE", tx + 3 * k, ty + th * 0.68, 6 * k, options.title);
  dxf.text("TITLE", tx + 3 * k, ty + th * 0.56, 2.5 * k, "Synergy CAD");
  const cells: [string, string][] = [
    ["SCALE", `${label} (${SHEET.name})`],
    ["UNITS", "mm"],
    ["PROJECTION", "Third angle"],
    ["DATE", options.date],
  ];
  cells.forEach(([name, value], i) => {
    dxf.text("TITLE", tx + cell * i + 2 * k, ty + th * 0.36, 2 * k, name);
    dxf.text("TITLE", tx + cell * i + 2 * k, ty + th * 0.12, 3.5 * k, value);
  });
}

/**
 * A small DXF writer: LINE, CIRCLE, ARC, LWPOLYLINE, TEXT and DIMENSION on named layers, with the
 * layer, linetype and dimension-style tables they use. Dimensions carry no geometry block; the 2D
 * editor draws them from their points and writes the blocks when the drawing is saved.
 */
class Dxf {
  private readonly out: string[] = [];

  constructor(private readonly k: number) {}

  private g(code: number, value: string | number) {
    this.out.push(String(code), typeof value === "number" ? num(value) : value);
  }

  curve(layer: string, c: Curve) {
    switch (c.kind) {
      case "line":
        this.entity("LINE", layer);
        this.pt(10, c.seg[0], c.seg[1]);
        this.pt(11, c.seg[2], c.seg[3]);
        break;
      case "circle":
        this.entity("CIRCLE", layer);
        this.pt(10, c.cx, c.cy);
        this.g(40, c.r);
        break;
      case "arc":
        this.entity("ARC", layer);
        this.pt(10, c.cx, c.cy);
        this.g(40, c.r);
        this.g(50, c.start);
        this.g(51, c.end);
        break;
      case "polyline":
        this.entity("LWPOLYLINE", layer);
        this.g(90, c.points.length / 2);
        this.g(70, c.closed ? 1 : 0);
        for (let i = 0; i < c.points.length; i += 2) {
          this.g(10, c.points[i]);
          this.g(20, c.points[i + 1]);
        }
        break;
    }
  }

  text(layer: string, x: number, y: number, height: number, value: string) {
    this.entity("TEXT", layer);
    this.pt(10, x, y);
    this.g(40, height);
    this.g(1, value.replace(/[\r\n]+/g, " "));
  }

  /** A linear dimension from p to q, its line through `at` (y for 0°, x for 90°). */
  linear(p: [number, number], q: [number, number], at: number, rotation: 0 | 90) {
    const def: [number, number] = rotation === 0 ? [q[0], at] : [at, q[1]];
    const mid: [number, number] = rotation === 0 ? [(p[0] + q[0]) / 2, at] : [at, (p[1] + q[1]) / 2];
    this.entity("DIMENSION", "DIMS");
    this.pt(10, def[0], def[1]);
    this.pt(11, mid[0], mid[1]);
    this.g(70, 0);
    this.g(3, "Standard");
    this.pt(13, p[0], p[1]);
    this.pt(14, q[0], q[1]);
    this.g(50, rotation);
  }

  diameter(cx: number, cy: number, r: number) {
    const d = Math.SQRT1_2;
    this.entity("DIMENSION", "DIMS");
    this.pt(10, cx - r * d, cy - r * d);
    this.pt(11, cx + (r + 8 * this.k) * d, cy + (r + 8 * this.k) * d);
    this.g(70, 3);
    this.g(3, "Standard");
    this.pt(15, cx + r * d, cy + r * d);
  }

  private entity(type: string, layer: string) {
    this.g(0, type);
    this.g(8, layer);
  }

  private pt(code: number, x: number, y: number) {
    this.g(code, x);
    this.g(code + 10, y);
    this.g(code + 20, 0);
  }

  toString(): string {
    const entities = this.out;
    const k = this.k;
    const h: string[] = [];
    const g = (code: number, value: string | number) => h.push(String(code), typeof value === "number" ? num(value) : value);
    g(0, "SECTION");
    g(2, "HEADER");
    for (const [name, code, value] of [
      ["$ACADVER", 1, "AC1009"],
      ["$INSUNITS", 70, 4],
      ["$MEASUREMENT", 70, 1],
      ["$LUNITS", 70, 2],
      ["$LUPREC", 70, 2],
      ["$LTSCALE", 40, k],
      ["$DIMSCALE", 40, k],
      ["$DIMSTYLE", 2, "Standard"],
      ["$CLAYER", 8, "VISIBLE"],
      ["$EXTMIN", 10, 0],
      ["$EXTMAX", 10, 0],
    ] as const) {
      g(9, name);
      if (name === "$EXTMIN" || name === "$EXTMAX") {
        const x = name === "$EXTMIN" ? 0 : SHEET.w * k;
        const y = name === "$EXTMIN" ? 0 : SHEET.h * k;
        g(10, x);
        g(20, y);
        g(30, 0);
      } else g(code, value);
    }
    g(0, "ENDSEC");

    g(0, "SECTION");
    g(2, "TABLES");
    g(0, "TABLE");
    g(2, "LTYPE");
    g(70, 2);
    for (const [name, desc, pattern] of [
      ["CONTINUOUS", "Solid line", [] as number[]],
      ["HIDDEN", "Hidden __ __ __ __", [3, -1.5]],
    ] as const) {
      g(0, "LTYPE");
      g(2, name);
      g(70, 0);
      g(3, desc);
      g(72, 65);
      g(73, pattern.length);
      g(40, pattern.reduce((s, x) => s + Math.abs(x), 0));
      for (const x of pattern) g(49, x);
    }
    g(0, "ENDTAB");
    g(0, "TABLE");
    g(2, "LAYER");
    g(70, LAYERS.length);
    for (const [name, color, ltype] of LAYERS) {
      g(0, "LAYER");
      g(2, name);
      g(70, 0);
      g(62, color);
      g(6, ltype);
    }
    g(0, "ENDTAB");
    g(0, "TABLE");
    g(2, "DIMSTYLE");
    g(70, 1);
    g(0, "DIMSTYLE");
    g(2, "Standard");
    g(70, 0);
    // Sheet millimetres; DIMSCALE sizes them to the drawing.
    for (const [code, value] of [
      [40, k], // DIMSCALE
      [41, 3], // DIMASZ arrow size
      [42, 1.5], // DIMEXO extension line offset
      [44, 2], // DIMEXE extension beyond the dimension line
      [140, 3.5], // DIMTXT text height
      [141, 1.5], // DIMCEN centre mark
      [147, 1], // DIMGAP
      [77, 1], // DIMTAD text above the line
      [78, 8], // DIMZIN drop trailing zeros
      [271, 2], // DIMDEC
      [277, 2], // DIMLUNIT decimal
    ] as const) {
      g(code, value);
    }
    g(0, "ENDTAB");
    g(0, "ENDSEC");

    g(0, "SECTION");
    g(2, "ENTITIES");
    return [...h, ...entities, "0", "ENDSEC", "0", "EOF", ""].join("\n");
  }
}

/** Layer, colour (AutoCAD index), linetype. */
const LAYERS: [string, number, string][] = [
  ["0", 7, "CONTINUOUS"],
  ["VISIBLE", 7, "CONTINUOUS"],
  ["HIDDEN", 8, "HIDDEN"],
  ["DIMS", 4, "CONTINUOUS"],
  ["BORDER", 7, "CONTINUOUS"],
  ["TITLE", 7, "CONTINUOUS"],
];

function num(x: number): string {
  if (!Number.isFinite(x)) return "0";
  const s = x.toFixed(6).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}
