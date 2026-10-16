import { describe, expect, it } from "vitest";
import { curves, makeDrawing } from "../lib/drawing";
import { FRONT, ISO, TOP, buildModel, mergeCollinear, projectView, subtractCovered, type Part, type Seg } from "../lib/views";

type P = [number, number, number];

/** Builds a Part from triangles, each wound so its normal points along `out`. */
class Mesh {
  position: number[] = [];
  index: number[] = [];
  face: number[] = [];
  faces = 0;

  tri(a: P, b: P, c: P, out: P) {
    const n = cross(sub(b, a), sub(c, a));
    const [p, q] = dot(n, out) >= 0 ? [b, c] : [c, b];
    const base = this.position.length / 3;
    this.position.push(...a, ...p, ...q);
    this.index.push(base, base + 1, base + 2);
    this.face.push(this.faces);
  }

  quad(a: P, b: P, c: P, d: P, out: P) {
    this.tri(a, b, c, out);
    this.tri(a, c, d, out);
  }

  next() {
    this.faces++;
  }

  part(): Part {
    return {
      position: Float32Array.from(this.position),
      index: Uint32Array.from(this.index),
      face: Uint32Array.from(this.face),
      edges: new Float32Array(),
    };
  }
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function box(m: Mesh, [x0, y0, z0]: P, [x1, y1, z1]: P) {
  const c = (x: number, y: number, z: number): P => [x, y, z];
  m.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1), [0, -1, 0]); m.next();
  m.quad(c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1), [0, 1, 0]); m.next();
  m.quad(c(x0, y0, z0), c(x0, y1, z0), c(x0, y1, z1), c(x0, y0, z1), [-1, 0, 0]); m.next();
  m.quad(c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1), [1, 0, 0]); m.next();
  m.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0), [0, 0, -1]); m.next();
  m.quad(c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1), [0, 0, 1]); m.next();
}

/** A tube standing on the XY plane: outer wall, inner wall, top and bottom rings. */
function tube(m: Mesh, cx: number, cy: number, rIn: number, rOut: number, z0: number, z1: number, n = 48) {
  const at = (r: number, i: number, z: number): P => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z];
  const radial = (i: number, s: number): P => [s * Math.cos((2 * Math.PI * (i + 0.5)) / n), s * Math.sin((2 * Math.PI * (i + 0.5)) / n), 0];
  for (let i = 0; i < n; i++) m.quad(at(rOut, i, z0), at(rOut, i + 1, z0), at(rOut, i + 1, z1), at(rOut, i, z1), radial(i, 1));
  m.next();
  for (let i = 0; i < n; i++) m.quad(at(rIn, i, z0), at(rIn, i + 1, z0), at(rIn, i + 1, z1), at(rIn, i, z1), radial(i, -1));
  m.next();
  for (let i = 0; i < n; i++) m.quad(at(rIn, i, z1), at(rOut, i, z1), at(rOut, i + 1, z1), at(rIn, i + 1, z1), [0, 0, 1]);
  m.next();
  for (let i = 0; i < n; i++) m.quad(at(rIn, i, z0), at(rOut, i, z0), at(rOut, i + 1, z0), at(rIn, i + 1, z0), [0, 0, -1]);
  m.next();
}

const length = (segs: Seg[]) => segs.reduce((s, [a, b, c, d]) => s + Math.hypot(c - a, d - b), 0);

describe("views", () => {
  it("draws a box as its outline in each view, with no hidden lines", () => {
    const m = new Mesh();
    box(m, [0, 0, 0], [100, 50, 30]);
    const model = buildModel([m.part()]);
    const front = projectView(model, FRONT);
    expect(front.hidden).toEqual([]);
    expect(front.visible).toHaveLength(4);
    expect(length(front.visible)).toBeCloseTo(2 * (100 + 30), 3);
    expect(length(projectView(model, TOP).visible)).toBeCloseTo(2 * (100 + 50), 3);
  });

  it("shows a tube's bore as hidden lines from the front and as circles from the top", () => {
    const m = new Mesh();
    tube(m, 0, 0, 10, 20, 0, 40);
    const model = buildModel([m.part()]);
    const front = projectView(model, FRONT);
    // Two outer silhouettes and the two rim lines; the bore's two silhouettes are hidden.
    const vertical = (segs: Seg[]) => segs.filter(([a, , c]) => Math.abs(a - c) < 1e-6);
    expect(vertical(front.visible).map((s) => Math.abs(s[0])).sort()).toEqual([20, 20].map((x) => expect.closeTo(x, 1)));
    expect(vertical(front.hidden).map((s) => Math.abs(s[0])).sort()).toEqual([10, 10].map((x) => expect.closeTo(x, 1)));
    const top = curves(projectView(model, TOP).visible, model.size * 1e-5);
    const circles = top.filter((c) => c.kind === "circle");
    expect(circles.map((c) => (c.kind === "circle" ? Math.round(c.r) : 0)).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("draws an isometric view without hidden lines", () => {
    const m = new Mesh();
    box(m, [0, 0, 0], [10, 10, 10]);
    const iso = projectView(buildModel([m.part()]), ISO);
    expect(iso.hidden).toEqual([]);
    expect(iso.visible.length).toBe(9); // a cube shows nine edges
  });

  it("drops a hidden line that lies under a visible one", () => {
    const tol = 1e-6;
    const vis = mergeCollinear([[0, 0, 5, 0], [5, 0, 10, 0], [10, 0, 5, 0]], tol);
    expect(vis).toEqual([[0, 0, 10, 0]]);
    expect(subtractCovered([[-5, 0, 15, 0], [0, 1, 10, 1]], vis, tol)).toEqual([
      [-5, 0, 0, 0],
      [10, 0, 15, 0],
      [0, 1, 10, 1],
    ]);
  });
});

describe("curves", () => {
  it("turns chords of a quarter circle between two lines into an arc", () => {
    const segs: Seg[] = [[0, 0, 50, 0]];
    for (let i = 0; i < 12; i++) {
      const a = (-Math.PI / 2) + (i * Math.PI) / 2 / 12, b = (-Math.PI / 2) + ((i + 1) * Math.PI) / 2 / 12;
      segs.push([50 + 10 * Math.cos(a), 10 + 10 * Math.sin(a), 50 + 10 * Math.cos(b), 10 + 10 * Math.sin(b)]);
    }
    segs.push([60, 10, 60, 40]);
    const out = curves(segs, 1e-4);
    expect(out.map((c) => c.kind).sort()).toEqual(["arc", "line", "line"]);
    const arc = out.find((c) => c.kind === "arc");
    expect(arc).toMatchObject({ cx: expect.closeTo(50, 4), cy: expect.closeTo(10, 4), r: expect.closeTo(10, 4), start: expect.closeTo(-90, 3), end: expect.closeTo(0, 3) });
  });

  it("keeps a square a square", () => {
    const out = curves([[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 10], [0, 10, 0, 0]], 1e-4);
    expect(out.every((c) => c.kind === "line")).toBe(true);
    expect(out).toHaveLength(4);
  });
});

describe("makeDrawing", () => {
  it("writes a DXF with the views, dimensions and title block", () => {
    const m = new Mesh();
    box(m, [0, 0, 0], [120, 60, 20]);
    tube(m, 60, 30, 8, 15, 20, 50);
    const dxf = makeDrawing([m.part()], { title: "Bracket", date: "2026-10-15" })!;
    expect(dxf).toMatch(/^0\nSECTION\n2\nHEADER/);
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    expect(dxf).toContain("\nBracket\n");
    expect(dxf.match(/\nDIMENSION\n/g)?.length).toBeGreaterThanOrEqual(4); // width, height, depth, a diameter
    expect(dxf).toContain("\nCIRCLE\n");
    expect(dxf).toMatch(/\n1:1 \(A3\)\n|\n1:2 \(A3\)\n/);
    expect(dxf).toContain("\nHIDDEN\n");
  });

  it("returns null for an empty model", () => {
    expect(makeDrawing([], { title: "x", date: "" })).toBeNull();
  });
});
