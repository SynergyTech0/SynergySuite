// Icons (Lucide, see icon-data.ts) inserted as freeform shapes: the icon's
// strokes become one custGeom outline, so it recolours, resizes and exports
// to PowerPoint as a real vector shape.
import { parseXml } from "./xml";
import { shapeToPath } from "./svgpath";
import type { Geom } from "./freeform";
import { ICON_SETS } from "./icon-data";

export { ICON_SETS };

const cache = new Map<string, Geom>();

/** An icon's outline on its 24 × 24 canvas. */
export function iconGeom(svg: string): Geom {
  const hit = cache.get(svg);
  if (hit) return hit;
  const root = parseXml(`<g>${svg}</g>`);
  const d = (root?.children || []).map((c) => shapeToPath(c.local, c.attrs)).filter(Boolean).join(" ");
  const g = { w: 24, h: 24, d };
  cache.set(svg, g);
  return g;
}

/** Find icons by name across the sets. */
export function searchIcons(q: string): [string, string][] {
  const s = q.trim().toLowerCase();
  const all = ICON_SETS.flatMap((x) => x.icons);
  if (!s) return all;
  return all.filter(([n]) => n.includes(s.replace(/\s+/g, "-")));
}

/** Stroke width (px) of an icon drawn at `size` px: Lucide draws 2 px on 24. */
export const iconStroke = (size: number) => Math.round(((2 * size) / 24) * 100) / 100;
