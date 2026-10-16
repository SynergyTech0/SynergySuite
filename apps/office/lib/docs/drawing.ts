// Floating objects: pictures, shapes and text boxes with Word's text
// wrapping. In the editor they are blocks with a `wrap` attribute (in line,
// square, tight, top and bottom, behind or in front of text); in .docx they
// are wp:inline or wp:anchor drawings. Shapes are DrawingML preset geometry
// (wps:wsp), drawn here as SVG.
import { child, attr, descendants, type XEl } from "../slides/xml";

export type Wrap = "inline" | "square" | "tight" | "topBottom" | "behind" | "front";
export const WRAPS: { id: Wrap; label: string }[] = [
  { id: "inline", label: "In line with text" },
  { id: "square", label: "Square" },
  { id: "tight", label: "Tight" },
  { id: "topBottom", label: "Top and bottom" },
  { id: "behind", label: "Behind text" },
  { id: "front", label: "In front of text" },
];

export type ShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "rightArrow" | "star5" | "wedgeRectCallout" | "line";
export const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "roundRect", label: "Rounded rectangle" },
  { id: "ellipse", label: "Oval" },
  { id: "triangle", label: "Triangle" },
  { id: "diamond", label: "Diamond" },
  { id: "rightArrow", label: "Right arrow" },
  { id: "star5", label: "Star" },
  { id: "wedgeRectCallout", label: "Callout" },
  { id: "line", label: "Line" },
];

/** SVG for a preset shape filling w × h (stroke drawn inside the box). */
export function shapeSvg(kind: string, w: number, h: number, fill: string, stroke: string, sw: number): string {
  const i = sw / 2;
  const W = Math.max(1, w - sw);
  const H = Math.max(1, h - sw);
  const p = (pts: [number, number][]) => `<polygon points="${pts.map(([x, y]) => `${(i + x * W).toFixed(1)},${(i + y * H).toFixed(1)}`).join(" ")}"/>`;
  let body: string;
  switch (kind) {
    case "ellipse":
      body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${W / 2}" ry="${H / 2}"/>`;
      break;
    case "roundRect": {
      const r = Math.min(W, H) * 0.1667;
      body = `<rect x="${i}" y="${i}" width="${W}" height="${H}" rx="${r}" ry="${r}"/>`;
      break;
    }
    case "triangle":
      body = p([[0.5, 0], [1, 1], [0, 1]]);
      break;
    case "diamond":
      body = p([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
      break;
    case "rightArrow":
      body = p([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]);
      break;
    case "star5": {
      const pts: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 0.19 : 0.5;
        pts.push([0.5 + r * Math.cos(a) * 1.0, 0.53 + r * Math.sin(a) * 1.05]);
      }
      body = p(pts);
      break;
    }
    case "wedgeRectCallout":
      body = p([[0, 0], [1, 0], [1, 0.8], [0.42, 0.8], [0.2, 1], [0.25, 0.8], [0, 0.8]]);
      break;
    case "line":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="${i}" y1="${i}" x2="${w - i}" y2="${h - i}" stroke="${stroke}" stroke-width="${Math.max(1, sw)}"/></svg>`;
    default:
      body = `<rect x="${i}" y="${i}" width="${W}" height="${H}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><g fill="${fill || "none"}" stroke="${stroke || "none"}" stroke-width="${sw}">${body}</g></svg>`;
}

/** Where shape text sits for a shape: the box inside the geometry that holds the text (fractions). */
export function textInset(kind: string): { l: number; t: number; r: number; b: number } {
  switch (kind) {
    case "ellipse":
      return { l: 0.15, t: 0.15, r: 0.15, b: 0.15 };
    case "triangle":
      return { l: 0.25, t: 0.45, r: 0.25, b: 0.05 };
    case "diamond":
      return { l: 0.25, t: 0.25, r: 0.25, b: 0.25 };
    case "star5":
      return { l: 0.3, t: 0.35, r: 0.3, b: 0.25 };
    case "rightArrow":
      return { l: 0.02, t: 0.25, r: 0.25, b: 0.25 };
    case "wedgeRectCallout":
      return { l: 0, t: 0, r: 0, b: 0.2 };
    default:
      return { l: 0, t: 0, r: 0, b: 0 };
  }
}

const EMU_PX = 9525;
const TIGHT_POLY = `<wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon>`;

export type Placement = { wrap?: string | null; align?: string | null; offsetX?: number | null; offsetY?: number | null };

/** wp:inline or wp:anchor around a graphic. Sizes in px. */
export function drawingXml(o: Placement & { w: number; h: number; id: number; name: string; descr?: string; graphic: string; z?: number; lockAspect?: boolean }): string {
  const cx = Math.round(o.w * EMU_PX);
  const cy = Math.round(o.h * EMU_PX);
  const docPr = `<wp:docPr id="${o.id}" name="${o.name}"${o.descr ? ` descr="${o.descr}"` : ""}/>`;
  const frame = `<wp:cNvGraphicFramePr>${o.lockAspect ? '<a:graphicFrameLocks noChangeAspect="1"/>' : ""}</wp:cNvGraphicFramePr>`;
  const wrap = (o.wrap || "inline") as Wrap;
  if (wrap === "inline") return `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${frame}${o.graphic}</wp:inline>`;
  const free = wrap === "behind" || wrap === "front";
  const align = o.align === "right" ? "right" : o.align === "center" ? "center" : "left";
  const posH = free && o.offsetX ? `<wp:positionH relativeFrom="column"><wp:posOffset>${Math.round(o.offsetX * EMU_PX)}</wp:posOffset></wp:positionH>` : `<wp:positionH relativeFrom="column"><wp:align>${align}</wp:align></wp:positionH>`;
  const posV = `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round((free ? o.offsetY || 0 : 0) * EMU_PX)}</wp:posOffset></wp:positionV>`;
  const wrapXml =
    wrap === "square" ? '<wp:wrapSquare wrapText="bothSides"/>' : wrap === "tight" ? `<wp:wrapTight wrapText="bothSides">${TIGHT_POLY}</wp:wrapTight>` : wrap === "topBottom" ? "<wp:wrapTopAndBottom/>" : "<wp:wrapNone/>";
  const dist = free ? 'distT="0" distB="0" distL="0" distR="0"' : 'distT="45720" distB="45720" distL="114300" distR="114300"';
  return (
    `<wp:anchor ${dist} simplePos="0" relativeHeight="${o.z ?? 251659264}" behindDoc="${wrap === "behind" ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>${posH}${posV}<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrapXml}${docPr}${frame}${o.graphic}</wp:anchor>`
  );
}

/** Wrap, side and offset of a drawing (wp:anchor), or nothing for an inline one. */
export function readPlacement(drawing: XEl): Placement {
  const a = descendants(drawing, "anchor")[0];
  if (!a) return {};
  const behind = attr(a, "behindDoc") === "1" || attr(a, "behindDoc") === "true";
  const wrap: Wrap = child(a, "wrapSquare") ? "square" : child(a, "wrapTight") || child(a, "wrapThrough") ? "tight" : child(a, "wrapTopAndBottom") ? "topBottom" : behind ? "behind" : "front";
  const ph = child(a, "positionH");
  const pv = child(a, "positionV");
  const al = child(ph, "align")?.text?.trim();
  const ox = Number(child(ph, "posOffset")?.text || 0) / EMU_PX;
  const oy = Number(child(pv, "posOffset")?.text || 0) / EMU_PX;
  const out: Placement = { wrap };
  if (al === "right" || al === "center") out.align = al;
  else if (al === "outside") out.align = "right";
  if (wrap === "behind" || wrap === "front") {
    if (ox) out.offsetX = Math.round(ox);
    if (oy) out.offsetY = Math.round(oy);
  } else if (!al && ox > 200) out.align = "right";
  return out;
}

/** DrawingML colour of an element holding srgbClr / schemeClr / sysClr (and noFill). */
export function drawingColor(el: XEl | undefined, scheme: Record<string, string>): string | undefined {
  if (!el) return undefined;
  if (child(el, "noFill")) return "none";
  const f = child(el, "solidFill") || (el.local === "solidFill" ? el : undefined);
  if (!f) return undefined;
  const s = child(f, "srgbClr");
  if (s) return `#${(attr(s, "val") || "000000").toLowerCase()}`;
  const sys = child(f, "sysClr");
  if (sys) return `#${(attr(sys, "lastClr") || "000000").toLowerCase()}`;
  const sc = child(f, "schemeClr");
  if (sc) return scheme[attr(sc, "val") || ""] || undefined;
  return undefined;
}
