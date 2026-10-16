/**
 * Orthographic and isometric views of a 3D model, as 2D line work with hidden lines.
 *
 * The 3D editor hands over each visible body as triangles (`Part`). The lines a drawing shows are
 * the model's sharp edges (where two faces meet at an angle, or a mesh ends) plus, for each view,
 * the silhouettes of curved faces (where the surface turns away from the viewer). Each line is then
 * cut into short pieces and every piece is tested against the triangles in front of it, so the
 * parts behind something become hidden lines.
 */

export type Part = {
  /** xyz per vertex, world coordinates (millimetres). */
  position: Float32Array;
  /** Three vertex numbers per triangle. */
  index: Uint32Array;
  /** The B-rep face each triangle belongs to. */
  face: Uint32Array;
  /** xyz pairs for bodies with no faces (sketches, wires). */
  edges: Float32Array;
};

export type V3 = [number, number, number];
/** A 2D segment: x1, y1, x2, y2. */
export type Seg = [number, number, number, number];

/**
 * A view looks along `dir` (from the viewer into the model); `right` and `up` are the drawing's
 * x and y axes. The model is Z-up, as in the 3D editor.
 */
export type ViewSpec = { name: string; dir: V3; right: V3; up: V3; hidden: boolean };

const s3 = 1 / Math.sqrt(3);
const s2 = 1 / Math.SQRT2;
const s6 = 1 / Math.sqrt(6);

export const FRONT: ViewSpec = { name: "Front", dir: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], hidden: true };
export const TOP: ViewSpec = { name: "Top", dir: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0], hidden: true };
export const RIGHT: ViewSpec = { name: "Right", dir: [-1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], hidden: true };
/** Seen from the front, right and above; hidden lines are left out, as is usual for a pictorial view. */
export const ISO: ViewSpec = { name: "Isometric", dir: [-s3, s3, -s3], right: [s2, s2, 0], up: [-s6, s6, 2 * s6], hidden: false };

/** Two triangles meeting at more than this are a sharp edge (B-rep bodies: anything not tangent). */
const CREASE_BREP = Math.cos((1 * Math.PI) / 180);
/** For plain triangle meshes (STL), where every facet is its own face, only real corners count. */
const CREASE_MESH = Math.cos((20 * Math.PI) / 180);

/** The model welded into one triangle mesh, with the edges every view draws and the ones only silhouettes can. */
export type Model = {
  /** xyz per welded vertex. */
  points: Float64Array;
  /** Unit normal per triangle (0,0,0 for degenerate ones). */
  normals: Float64Array;
  tris: Uint32Array;
  /** Sharp edges and wire segments: vertex pairs drawn in every view. */
  sharp: number[];
  /** Smooth edges: vertex pair and the two triangles either side. A silhouette where one faces the viewer and the other doesn't. */
  smooth: number[];
  /** Diagonal of the bounding box. */
  size: number;
};

export function buildModel(parts: Part[]): Model {
  let lo: V3 = [Infinity, Infinity, Infinity];
  let hi: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (arr: Float32Array) => {
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], arr[i + k]);
        hi[k] = Math.max(hi[k], arr[i + k]);
      }
    }
  };
  for (const p of parts) {
    grow(p.position);
    grow(p.edges);
  }
  const size = Number.isFinite(lo[0]) ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
  if (!size) lo = hi = [0, 0, 0];

  // Weld vertices that share a position, so neighbouring triangles (and faces) share edges.
  const q = size * 1e-6 || 1e-9;
  const ids = new Map<string, number>();
  const points: number[] = [];
  const weld = (x: number, y: number, z: number) => {
    const key = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length / 3;
      ids.set(key, id);
      points.push(x, y, z);
    }
    return id;
  };

  const tris: number[] = [];
  const triFace: number[] = [];
  const triCrease: number[] = [];
  const sharp: number[] = [];
  let faceBase = 0;
  for (const p of parts) {
    const local = new Uint32Array(p.position.length / 3);
    for (let i = 0; i < local.length; i++) local[i] = weld(p.position[3 * i], p.position[3 * i + 1], p.position[3 * i + 2]);
    const count = Math.floor(p.index.length / 3);
    let faces = 0;
    for (let t = 0; t < count; t++) faces = Math.max(faces, p.face[t] + 1);
    // A triangle mesh (STL) is all one-triangle faces; a B-rep body has a few faces of many.
    const crease = faces > count / 2 ? CREASE_MESH : CREASE_BREP;
    for (let t = 0; t < count; t++) {
      tris.push(local[p.index[3 * t]], local[p.index[3 * t + 1]], local[p.index[3 * t + 2]]);
      triFace.push(faceBase + (p.face[t] ?? 0));
      triCrease.push(crease);
    }
    faceBase += faces;
    for (let i = 0; i + 5 < p.edges.length; i += 6) {
      sharp.push(weld(p.edges[i], p.edges[i + 1], p.edges[i + 2]), weld(p.edges[i + 3], p.edges[i + 4], p.edges[i + 5]));
    }
  }

  const pts = Float64Array.from(points);
  const triArr = Uint32Array.from(tris);
  const normals = new Float64Array(triArr.length);
  for (let t = 0; t < triArr.length / 3; t++) {
    const [a, b, c] = [triArr[3 * t], triArr[3 * t + 1], triArr[3 * t + 2]];
    const ux = pts[3 * b] - pts[3 * a], uy = pts[3 * b + 1] - pts[3 * a + 1], uz = pts[3 * b + 2] - pts[3 * a + 2];
    const vx = pts[3 * c] - pts[3 * a], vy = pts[3 * c + 1] - pts[3 * a + 1], vz = pts[3 * c + 2] - pts[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      normals[3 * t] = nx / len;
      normals[3 * t + 1] = ny / len;
      normals[3 * t + 2] = nz / len;
    }
  }

  // Which triangles each edge borders.
  const edges = new Map<string, number[]>();
  for (let t = 0; t < triArr.length / 3; t++) {
    if (!normals[3 * t] && !normals[3 * t + 1] && !normals[3 * t + 2]) continue;
    for (let k = 0; k < 3; k++) {
      const a = triArr[3 * t + k], b = triArr[3 * t + ((k + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  }
  const smooth: number[] = [];
  for (const [key, list] of edges) {
    const [a, b] = key.split(",").map(Number);
    if (list.length !== 2) {
      sharp.push(a, b); // the edge of an open mesh, or where more than two faces meet
      continue;
    }
    const [t1, t2] = list;
    const cos = normals[3 * t1] * normals[3 * t2] + normals[3 * t1 + 1] * normals[3 * t2 + 1] + normals[3 * t1 + 2] * normals[3 * t2 + 2];
    if (triFace[t1] !== triFace[t2] && cos < Math.max(triCrease[t1], triCrease[t2])) sharp.push(a, b);
    else smooth.push(a, b, t1, t2);
  }
  return { points: pts, normals, tris: triArr, sharp, smooth, size };
}

export type ViewLines = { visible: Seg[]; hidden: Seg[] };

/** The view's line work in its own 2D coordinates (millimetres, x right, y up). */
export function projectView(model: Model, view: ViewSpec): ViewLines {
  const { points, tris, normals, size } = model;
  const n = points.length / 3;
  const u = new Float64Array(n), v = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    u[i] = x * view.right[0] + y * view.right[1] + z * view.right[2];
    v[i] = x * view.up[0] + y * view.up[1] + z * view.up[2];
    w[i] = x * view.dir[0] + y * view.dir[1] + z * view.dir[2]; // larger is further away
  }
  const occluder = new Occluder(u, v, w, tris, size);

  const candidates: number[] = [...model.sharp];
  const facing = (t: number) => normals[3 * t] * view.dir[0] + normals[3 * t + 1] * view.dir[1] + normals[3 * t + 2] * view.dir[2];
  for (let i = 0; i < model.smooth.length; i += 4) {
    if (facing(model.smooth[i + 2]) < 0 !== facing(model.smooth[i + 3]) < 0) candidates.push(model.smooth[i], model.smooth[i + 1]);
  }

  const visible: Seg[] = [];
  const hidden: Seg[] = [];
  const step = size / 400 || 1;
  const eps = size * 2e-4;
  for (let i = 0; i < candidates.length; i += 2) {
    const a = candidates[i], b = candidates[i + 1];
    const len = Math.hypot(u[b] - u[a], v[b] - v[a]);
    if (len < size * 1e-7) continue; // seen end-on
    const pieces = Math.min(200, Math.max(1, Math.ceil(len / step)));
    let runStart = 0;
    let runHidden = false;
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const hiddenHere = occluder.hides(u[a] + (u[b] - u[a]) * t, v[a] + (v[b] - v[a]) * t, w[a] + (w[b] - w[a]) * t - eps);
      if (k === 0) runHidden = hiddenHere;
      else if (hiddenHere !== runHidden) {
        push(runHidden ? hidden : visible, a, b, runStart / pieces, k / pieces);
        runStart = k;
        runHidden = hiddenHere;
      }
    }
    push(runHidden ? hidden : visible, a, b, runStart / pieces, 1);
  }

  function push(out: Seg[], a: number, b: number, t0: number, t1: number) {
    out.push([u[a] + (u[b] - u[a]) * t0, v[a] + (v[b] - v[a]) * t0, u[a] + (u[b] - u[a]) * t1, v[a] + (v[b] - v[a]) * t1]);
  }

  const tol = size * 1e-5;
  const vis = mergeCollinear(visible, tol);
  return { visible: vis, hidden: view.hidden ? subtractCovered(mergeCollinear(hidden, tol), vis, tol) : [] };
}

/** A grid over the projected triangles, to ask whether anything lies in front of a point. */
class Occluder {
  private readonly cells: number[][];
  private readonly x0: number;
  private readonly y0: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    private readonly u: Float64Array,
    private readonly v: Float64Array,
    private readonly w: Float64Array,
    private readonly tris: Uint32Array,
    size: number,
  ) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < u.length; i++) {
      x0 = Math.min(x0, u[i]);
      y0 = Math.min(y0, v[i]);
      x1 = Math.max(x1, u[i]);
      y1 = Math.max(y1, v[i]);
    }
    const count = tris.length / 3;
    const span = Math.max(x1 - x0, y1 - y0, size * 1e-6, 1e-9);
    const res = Math.min(512, Math.max(8, Math.ceil(Math.sqrt(count) * 1.5)));
    this.cell = span / res;
    this.x0 = Number.isFinite(x0) ? x0 : 0;
    this.y0 = Number.isFinite(y0) ? y0 : 0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / this.cell) + 1);
    this.rows = Math.max(1, Math.ceil((y1 - y0) / this.cell) + 1);
    this.cells = Array.from({ length: Number.isFinite(x0) ? this.cols * this.rows : 0 }, () => []);
    for (let t = 0; t < count; t++) {
      const [a, b, c] = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
      const area = (u[b] - u[a]) * (v[c] - v[a]) - (u[c] - u[a]) * (v[b] - v[a]);
      if (Math.abs(area) < 1e-12 * span * span) continue; // edge-on: covers nothing
      const cx0 = this.col(Math.min(u[a], u[b], u[c])), cx1 = this.col(Math.max(u[a], u[b], u[c]));
      const cy0 = this.row(Math.min(v[a], v[b], v[c])), cy1 = this.row(Math.max(v[a], v[b], v[c]));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) this.cells[y * this.cols + x].push(t);
    }
  }

  private col(x: number) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private row(y: number) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  /** Whether some triangle covers (x, y) nearer to the viewer than `depth`. */
  hides(x: number, y: number, depth: number): boolean {
    if (!this.cells.length) return false;
    const { u, v, w, tris } = this;
    for (const t of this.cells[this.row(y) * this.cols + this.col(x)]) {
      const [a, b, c] = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
      const d = (v[b] - v[c]) * (u[a] - u[c]) + (u[c] - u[b]) * (v[a] - v[c]);
      const l1 = ((v[b] - v[c]) * (x - u[c]) + (u[c] - u[b]) * (y - v[c])) / d;
      const l2 = ((v[c] - v[a]) * (x - u[c]) + (u[a] - u[c]) * (y - v[c])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      if (l1 * w[a] + l2 * w[b] + l3 * w[c] < depth) return true;
    }
    return false;
  }
}

type Line = { angle: number; offset: number; spans: [number, number][] };

/** Segments grouped by the infinite line they lie on, as spans along it. */
function byLine(segs: Seg[], tol: number): Map<string, Line> {
  const lines = new Map<string, Line>();
  for (const [x1, y1, x2, y2] of segs) {
    let angle = Math.atan2(y2 - y1, x2 - x1);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI - 1e-9) angle = 0;
    const c = Math.cos(angle), s = Math.sin(angle);
    const offset = -s * x1 + c * y1;
    const key = `${Math.round(angle * 1e4)},${Math.round(offset / (tol * 10))}`;
    const t1 = c * x1 + s * y1, t2 = c * x2 + s * y2;
    const span: [number, number] = t1 < t2 ? [t1, t2] : [t2, t1];
    const line = lines.get(key);
    if (line) line.spans.push(span);
    else lines.set(key, { angle, offset, spans: [span] });
  }
  for (const line of lines.values()) line.spans = union(line.spans, tol);
  return lines;
}

function union(spans: [number, number][], tol: number): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + tol) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

function toSegs(lines: Iterable<Line>, tol: number): Seg[] {
  const out: Seg[] = [];
  for (const { angle, offset, spans } of lines) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const [t0, t1] of spans) {
      if (t1 - t0 <= tol) continue;
      out.push([c * t0 - s * offset, s * t0 + c * offset, c * t1 - s * offset, s * t1 + c * offset]);
    }
  }
  return out;
}

/** Overlapping and touching segments on the same line joined into one; duplicates dropped. */
export function mergeCollinear(segs: Seg[], tol: number): Seg[] {
  return toSegs(byLine(segs, tol).values(), tol);
}

/** `segs` without the parts that lie along `cover` (a hidden line under a visible one isn't drawn). */
export function subtractCovered(segs: Seg[], cover: Seg[], tol: number): Seg[] {
  const covering = byLine(cover, tol);
  const lines = byLine(segs, tol);
  for (const [key, line] of lines) {
    const over = covering.get(key);
    if (!over) continue;
    const kept: [number, number][] = [];
    for (const [a, b] of line.spans) {
      let start = a;
      for (const [c, d] of over.spans) {
        if (d < start || c > b) continue;
        if (c > start) kept.push([start, c]);
        start = Math.max(start, d);
      }
      if (start < b) kept.push([start, b]);
    }
    line.spans = kept;
  }
  return toSegs(lines.values(), tol);
}
