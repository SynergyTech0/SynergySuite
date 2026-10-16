// Preset shape geometry (names follow OOXML prstGeom so they round-trip
// through .pptx). Paths are generated for the real box size so corner radii
// and arrow heads keep their proportions when a shape is stretched.

export type ShapeDef = { id: string; label: string; path: (w: number, h: number) => string };

const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L")} Z`;
const round = (n: number) => Math.round(n * 100) / 100;

function star(w: number, h: number, n: number, inner: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2]);
  }
  return poly(pts);
}
function regular(w: number, h: number, n: number, offset = -Math.PI / 2): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i * 2 * Math.PI) / n;
    pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
  }
  return poly(pts);
}

export const SHAPES: ShapeDef[] = [
  { id: "rect", label: "Rectangle", path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  {
    id: "roundRect",
    label: "Rounded rectangle",
    path: (w, h) => {
      const r = Math.min(w, h) * 0.1667;
      return `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
    },
  },
  { id: "ellipse", label: "Oval", path: (w, h) => `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z` },
  { id: "triangle", label: "Triangle", path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  { id: "rtTriangle", label: "Right triangle", path: (w, h) => poly([[0, 0], [w, h], [0, h]]) },
  { id: "diamond", label: "Diamond", path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  { id: "parallelogram", label: "Parallelogram", path: (w, h) => { const d = Math.min(w, h) * 0.25; return poly([[d, 0], [w, 0], [w - d, h], [0, h]]); } },
  { id: "trapezoid", label: "Trapezoid", path: (w, h) => { const d = Math.min(w, h) * 0.25; return poly([[d, 0], [w - d, 0], [w, h], [0, h]]); } },
  { id: "pentagon", label: "Pentagon", path: (w, h) => regular(w, h, 5) },
  { id: "hexagon", label: "Hexagon", path: (w, h) => { const d = Math.min(w, h) * 0.25; return poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); } },
  { id: "octagon", label: "Octagon", path: (w, h) => { const d = Math.min(w, h) * 0.29; return poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]); } },
  { id: "homePlate", label: "Pentagon arrow", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]); } },
  { id: "chevron", label: "Chevron", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); } },
  { id: "rightArrow", label: "Right arrow", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[0, h * 0.25], [w - d, h * 0.25], [w - d, 0], [w, h / 2], [w - d, h], [w - d, h * 0.75], [0, h * 0.75]]); } },
  { id: "leftArrow", label: "Left arrow", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[w, h * 0.25], [d, h * 0.25], [d, 0], [0, h / 2], [d, h], [d, h * 0.75], [w, h * 0.75]]); } },
  { id: "upArrow", label: "Up arrow", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[w * 0.25, h], [w * 0.25, d], [0, d], [w / 2, 0], [w, d], [w * 0.75, d], [w * 0.75, h]]); } },
  { id: "downArrow", label: "Down arrow", path: (w, h) => { const d = Math.min(w * 0.5, h * 0.5); return poly([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - d], [w, h - d], [w / 2, h], [0, h - d], [w * 0.25, h - d]]); } },
  { id: "star5", label: "Star", path: (w, h) => star(w, h, 5, 0.38) },
  { id: "plus", label: "Plus", path: (w, h) => { const a = w * 0.33, b = h * 0.33; return poly([[a, 0], [w - a, 0], [w - a, b], [w, b], [w, h - b], [w - a, h - b], [w - a, h], [a, h], [a, h - b], [0, h - b], [0, b], [a, b]]); } },
  { id: "wedgeRectCallout", label: "Callout", path: (w, h) => { const b = h * 0.8; return `M0 0 H${w} V${b} H${w * 0.42} L${w * 0.2} ${h} L${w * 0.25} ${b} H0 Z`; } },
  { id: "line", label: "Line", path: (w, h) => `M0 0 L${w} ${h}` },
  { id: "lineArrow", label: "Arrow", path: (w, h) => `M0 0 L${w} ${h}` },
];

export const isLineShape = (id: string) => id === "line" || id === "lineArrow" || id === "straightConnector1";

export function shapePath(id: string, w: number, h: number): string {
  const d = SHAPES.find((s) => s.id === id) || (isLineShape(id) ? SHAPES.find((s) => s.id === "line") : SHAPES[0]);
  return (d as ShapeDef).path(Math.max(w, 0.01), Math.max(h, 0.01));
}
