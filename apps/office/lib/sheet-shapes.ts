// Shapes and text boxes over the grid (Insert > Shape / Text box). Each one is
// a Univer floating DOM drawing (so it moves, resizes, saves and syncs like an
// image) whose data says what to draw. This file holds that data, the outline
// geometry and the .xlsx mapping: Excel keeps shapes as <xdr:sp> anchors in
// the sheet's drawing part, with a preset geometry, fill, line and text.

export const SHAPE_COMPONENT = "SynergyShape";
/** Univer's DrawingTypeEnum.DRAWING_DOM. */
export const DRAWING_DOM = 8;

import { SHAPES as PRESETS } from "./slides/shapes.ts";
import { isPreset, presetParts, type PresetPart } from "./shape-presets.ts";

/** Excel preset shapes drawn here (beyond the basic ones), with the slides' geometry. */
export const MORE_PRESETS = ["rtTriangle", "diamond", "parallelogram", "trapezoid", "pentagon", "hexagon", "octagon", "homePlate", "chevron", "leftArrow", "upArrow", "downArrow", "star5", "plus", "wedgeRectCallout"] as const;
export type ShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "rightArrow" | "line" | "textbox" | "group" | (typeof MORE_PRESETS)[number];
/** A shape inside a group: where it sits, as fractions of the group's box (so the group resizes as one). */
export type GroupChild = { data: ShapeData; x: number; y: number; w: number; h: number };
export type ShapeData = {
  kind: ShapeKind;
  /** Fill colour, or null for none. */
  fill: string | null;
  /** Outline colour, or null for none. */
  line: string | null;
  /** Outline width in points. */
  lineWidth: number;
  text: string;
  /** Font size in points. */
  fontSize: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align: "l" | "ctr" | "r";
  vAlign: "t" | "ctr" | "b";
  /** A line drawn from the top-right corner instead of the top-left. */
  flipH?: boolean;
  flipV?: boolean;
  name?: string;
  /** Alternative text, for screen readers (Excel's Alt Text); "" with `decorative` marks it decorative. */
  alt?: string;
  decorative?: boolean;
  /** A group's shapes (kind "group"), which may be groups themselves. */
  children?: GroupChild[];
  /** Excel's preset name when it isn't one of the kinds above: drawn from the preset's geometry, written back as it was. */
  prst?: string;
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  roundRect: "Rounded rectangle",
  ellipse: "Oval",
  triangle: "Triangle",
  rightArrow: "Arrow",
  line: "Line",
  textbox: "Text box",
  group: "Group",
  ...(Object.fromEntries(MORE_PRESETS.map((k) => [k, PRESETS.find((d) => d.id === k)?.label || k])) as Record<(typeof MORE_PRESETS)[number], string>),
};

export function newShape(kind: ShapeKind): ShapeData {
  if (kind === "textbox") return { kind, fill: "#FFFFFF", line: "#000000", lineWidth: 0.75, text: "", fontSize: 11, color: "#000000", align: "l", vAlign: "t" };
  if (kind === "line") return { kind, fill: null, line: "#4472C4", lineWidth: 1.5, text: "", fontSize: 11, color: "#000000", align: "ctr", vAlign: "ctr" };
  return { kind, fill: "#4472C4", line: "#2F528F", lineWidth: 1, text: "", fontSize: 11, color: "#FFFFFF", align: "ctr", vAlign: "ctr" };
}

/**
 * The outline in a w x h box, as subpaths (some presets have parts that are
 * only filled or only outlined): any of Excel's 187 preset shapes.
 */
export function shapeParts(s: Pick<ShapeData, "kind" | "flipH" | "flipV" | "prst">, w: number, h: number): PresetPart[] {
  if (s.kind !== "line" && s.kind !== "textbox" && isPreset(s.prst)) {
    const parts = presetParts(s.prst, Math.max(w, 0.01), Math.max(h, 0.01));
    if (parts?.length) return parts;
  }
  return [{ d: shapePath(s, w, h), fill: s.kind !== "line", stroke: true }];
}

/** The outline as an SVG path in a w x h box. */
export function shapePath(s: Pick<ShapeData, "kind" | "flipH" | "flipV">, w: number, h: number): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  switch (s.kind) {
    case "ellipse":
      return `M0 ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(w)} ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 0 ${n(h / 2)}Z`;
    case "roundRect": {
      const r = n(Math.min(w, h) * 0.1667);
      return `M${r} 0H${n(w - r)}Q${n(w)} 0 ${n(w)} ${r}V${n(h - r)}Q${n(w)} ${n(h)} ${n(w - r)} ${n(h)}H${r}Q0 ${n(h)} 0 ${n(h - r)}V${r}Q0 0 ${r} 0Z`;
    }
    case "triangle":
      return `M${n(w / 2)} 0L${n(w)} ${n(h)}H0Z`;
    case "rightArrow": {
      // Excel's defaults: the shaft is half the height, the head as long as half the height.
      const head = n(Math.min(w, h / 2));
      return `M0 ${n(h / 4)}H${n(w - head)}V0L${n(w)} ${n(h / 2)}L${n(w - head)} ${n(h)}V${n((3 * h) / 4)}H0Z`;
    }
    case "line": {
      const x1 = s.flipH ? w : 0;
      const y1 = s.flipV ? h : 0;
      return `M${n(x1)} ${n(y1)}L${n(w - x1)} ${n(h - y1)}`;
    }
    default: {
      const preset = (MORE_PRESETS as readonly string[]).includes(s.kind) ? PRESETS.find((d) => d.id === s.kind) : undefined;
      if (preset) return preset.path(Math.max(w, 0.01), Math.max(h, 0.01));
      return `M0 0H${n(w)}V${n(h)}H0Z`;
    }
  }
}

// ---- .xlsx ------------------------------------------------------------------

export const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
export type AnchorPoint = { column: number; columnOffset: number; row: number; rowOffset: number };
export type ShapeAnchor = { from: AnchorPoint; to: AnchorPoint };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DECORATIVE_EXT = "{C183D7F6-B498-43B3-948B-1728B52AA6E4}";
/** A cNvPr element with the alt text (descr) and Office's decorative mark. */
export const cNvPrXml = (id: number | string, name: string, s: { alt?: string; decorative?: boolean }) => {
  const open = `<xdr:cNvPr id="${id}" name="${esc(name)}"${s.alt ? ` descr="${esc(s.alt)}"` : ""}`;
  return s.decorative ? `${open}><a:extLst><a:ext uri="${DECORATIVE_EXT}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></xdr:cNvPr>` : `${open}/>`;
};
/** The alt text of the first cNvPr in some drawing XML. */
export function altOf(xml: string): { alt?: string; decorative?: boolean } {
  const tag = openTag(xml, "cNvPr");
  const descr = attrOf(tag, "descr");
  const decorative = /<adec:decorative\b[^>]*val="1"/.test(xml.slice(0, xml.indexOf("cNvPr") + 600));
  return { ...(descr ? { alt: unesc(descr) } : {}), ...(decorative ? { decorative: true } : {}) };
}
const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const hex6 = (c: string) => c.replace(/^#/, "").toUpperCase().padStart(6, "0").slice(-6);
const solid = (c: string | null) => (c ? `<a:solidFill><a:srgbClr val="${hex6(c)}"/></a:solidFill>` : "<a:noFill/>");
const marker = (tag: string, p: AnchorPoint) =>
  `<xdr:${tag}><xdr:col>${p.column}</xdr:col><xdr:colOff>${Math.round(p.columnOffset * EMU_PER_PX)}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${Math.round(p.rowOffset * EMU_PER_PX)}</xdr:rowOff></xdr:${tag}>`;

/** How many drawing ids a shape takes (a group: one for itself and one for each shape in it). */
export const shapeIdCount = (s: ShapeData): number => (s.kind === "group" ? 1 + (s.children || []).reduce((n, c) => n + shapeIdCount(c.data), 0) : 1);

/** One shape as a two-cell anchor; `size` is its width and height in px. */
export function shapeAnchorXml(s: ShapeData, anchor: ShapeAnchor, size: { width: number; height: number }, id: number): string {
  const box = { x: 0, y: 0, cx: Math.round(size.width * EMU_PER_PX), cy: Math.round(size.height * EMU_PER_PX) };
  return `<xdr:twoCellAnchor editAs="oneCell">${marker("from", anchor.from)}${marker("to", anchor.to)}${shapeXml(s, box, id)}<xdr:clientData/></xdr:twoCellAnchor>`;
}

/** A shape (<xdr:sp>) or group (<xdr:grpSp>) at `box` (EMU, in its parent's coordinates). */
function shapeXml(s: ShapeData, box: { x: number; y: number; cx: number; cy: number }, id: number): string {
  if (s.kind === "group") {
    let next = id + 1;
    const kids = (s.children || []).map((c) => {
      const xml = shapeXml(c.data, { x: Math.round(c.x * box.cx), y: Math.round(c.y * box.cy), cx: Math.round(c.w * box.cx), cy: Math.round(c.h * box.cy) }, next);
      next += shapeIdCount(c.data);
      return xml;
    });
    const xfrm = `<a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`;
    return `<xdr:grpSp><xdr:nvGrpSpPr>${cNvPrXml(id, s.name || `Group ${id}`, s)}<xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr>${xfrm}</xdr:grpSpPr>${kids.join("")}</xdr:grpSp>`;
  }
  const prst = s.kind === "textbox" ? "rect" : s.prst || s.kind;
  const name = s.name || `${s.kind === "textbox" ? "TextBox" : SHAPE_LABELS[s.kind]} ${id}`;
  const flips = `${s.flipH ? ' flipH="1"' : ""}${s.flipV ? ' flipV="1"' : ""}`;
  const xfrm = `<a:xfrm${flips}><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`;
  const ln = `<a:ln w="${Math.round(s.lineWidth * EMU_PER_PT)}">${solid(s.line)}</a:ln>`;
  const spPr = `<xdr:spPr>${xfrm}<a:prstGeom prst="${esc(prst)}"><a:avLst/></a:prstGeom>${s.kind === "line" ? "<a:noFill/>" : solid(s.fill)}${ln}</xdr:spPr>`;
  const rPr = `<a:rPr lang="en-US" sz="${Math.round(s.fontSize * 100)}"${s.bold ? ' b="1"' : ""}${s.italic ? ' i="1"' : ""}>${solid(s.color)}</a:rPr>`;
  const paras = (s.text || "").split("\n").map((line) => `<a:p><a:pPr algn="${s.align}"/>${line ? `<a:r>${rPr}<a:t>${esc(line)}</a:t></a:r>` : `<a:endParaRPr lang="en-US" sz="${Math.round(s.fontSize * 100)}"/>`}</a:p>`);
  const txBody = s.kind === "line" ? "" : `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="${s.vAlign}"/><a:lstStyle/>${paras.join("")}</xdr:txBody>`;
  const nv = `<xdr:nvSpPr>${cNvPrXml(id, name, s)}<xdr:cNvSpPr${s.kind === "textbox" ? ' txBox="1"' : ""}/></xdr:nvSpPr>`;
  return `<xdr:sp macro="" textlink="">${nv}${spPr}${txBody}</xdr:sp>`;
}

const inner = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;
const openTag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>`).exec(xml)?.[0] ?? null;
const attrOf = (tag: string | null, name: string) => (tag ? new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] : undefined);

// Office's default theme, for shapes coloured by scheme rather than RGB.
const SCHEME: Record<string, string> = { accent1: "#4472C4", accent2: "#ED7D31", accent3: "#A5A5A5", accent4: "#FFC000", accent5: "#5B9BD5", accent6: "#70AD47", tx1: "#000000", dk1: "#000000", bg1: "#FFFFFF", lt1: "#FFFFFF", tx2: "#44546A", dk2: "#44546A", bg2: "#E7E6E6", lt2: "#E7E6E6" };

/** A colour from a fill-like element: RGB, a theme colour, none (null) or not given (undefined). */
function colorIn(xml: string | null): string | null | undefined {
  if (xml == null) return undefined;
  if (/<(?:\w+:)?noFill\b/.test(xml)) return null;
  const fill = inner(xml, "solidFill");
  if (fill == null) return undefined;
  const rgb = attrOf(openTag(fill, "srgbClr"), "val");
  if (rgb) return `#${rgb.toUpperCase()}`;
  const scheme = attrOf(openTag(fill, "schemeClr"), "val");
  if (scheme) {
    const base = SCHEME[scheme] || "#4472C4";
    // A darker shade (lumMod), as Office uses for the default outline.
    const lum = Number(attrOf(openTag(fill, "lumMod"), "val"));
    if (lum && lum < 100000) {
      const k = lum / 100000;
      return `#${[1, 3, 5].map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    }
    return base;
  }
  return undefined;
}

const KINDS = new Set<ShapeKind>(["rect", "roundRect", "ellipse", "triangle", "rightArrow", "line", ...MORE_PRESETS]);

function point(xml: string | null): AnchorPoint | null {
  if (!xml) return null;
  const num = (n: string) => Number(inner(xml, n) ?? 0) || 0;
  return { column: num("col"), columnOffset: Math.round(num("colOff") / EMU_PER_PX), row: num("row"), rowOffset: Math.round(num("rowOff") / EMU_PER_PX) };
}

export type ReadShape = { data: ShapeData; from: AnchorPoint; to: AnchorPoint | null; size: { width: number; height: number } };

/** The elements directly inside `xml` (not nested ones) with these names, with their inner XML. */
function topLevel(xml: string, names: string[]): { name: string; xml: string }[] {
  const out: { name: string; xml: string }[] = [];
  const re = new RegExp(`<(/?)(?:\\w+:)?(${names.join("|")})\\b[^>]*?(/?)>`, "g");
  let depth = 0;
  let open: { name: string; start: number } | null = null;
  for (const m of xml.matchAll(re)) {
    const [tag, close, name, selfClose] = m;
    if (selfClose) continue;
    if (!close) {
      if (depth === 0) open = { name, start: (m.index ?? 0) + tag.length };
      depth++;
    } else {
      depth--;
      if (depth === 0 && open) {
        out.push({ name: open.name, xml: xml.slice(open.start, m.index) });
        open = null;
      }
    }
  }
  return out;
}

/** A shape's look from its <xdr:sp> or <xdr:cxnSp> inner XML. */
function shapeData(tag: string, spXml: string): ShapeData {
  const spPr = inner(spXml, "spPr") ?? "";
  const style = inner(spXml, "style");
  const xfrm = openTag(spPr, "xfrm");
  const prst = attrOf(openTag(spPr, "prstGeom"), "prst") || "rect";
  const textbox = attrOf(openTag(spXml, "cNvSpPr"), "txBox") === "1";
  const kind: ShapeKind = textbox ? "textbox" : prst === "straightConnector1" || prst === "line" || tag === "cxnSp" ? "line" : KINDS.has(prst as ShapeKind) ? (prst as ShapeKind) : "rect";
  const base = newShape(kind);
  // Without explicit colours the shape style's theme colours apply.
  const styleFill = style ? colorIn(`<a:solidFill>${inner(style, "fillRef") ?? ""}</a:solidFill>`) : undefined;
  const styleLine = style ? colorIn(`<a:solidFill>${inner(style, "lnRef") ?? ""}</a:solidFill>`) : undefined;
  const spFill = colorIn(spPr.replace(/<(?:\w+:)?ln\b[\s\S]*?<\/(?:\w+:)?ln>/, ""));
  const lnXml = inner(spPr, "ln");
  const lnColor = colorIn(lnXml);
  const w = Number(attrOf(openTag(spPr, "ln"), "w"));
  const txBody = inner(spXml, "txBody") ?? "";
  const paras = [...txBody.matchAll(/<(?:\w+:)?p>([\s\S]*?)<\/(?:\w+:)?p>|<(?:\w+:)?p\/>/g)].map((p) => p[1] ?? "");
  const text = paras.map((p) => [...p.matchAll(/<(?:\w+:)?t>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\/>/g)].map((t) => unesc(t[1] ?? "")).join("")).join("\n").replace(/\n+$/, "");
  const rPr = openTag(txBody, "rPr") || openTag(txBody, "defRPr") || openTag(txBody, "endParaRPr");
  const runColor = colorIn(inner(txBody, "rPr"));
  const fontRef = style ? colorIn(`<a:solidFill>${inner(style, "fontRef") ?? ""}</a:solidFill>`) : undefined;
  const algn = attrOf(openTag(txBody, "pPr"), "algn");
  const anchor = attrOf(openTag(txBody, "bodyPr"), "anchor");
  const data: ShapeData = {
    ...base,
    fill: kind === "line" ? null : spFill !== undefined ? spFill : styleFill !== undefined ? styleFill : base.fill,
    line: lnColor !== undefined ? lnColor : styleLine !== undefined ? styleLine : base.line,
    lineWidth: w ? Math.round((w / EMU_PER_PT) * 100) / 100 : base.lineWidth,
    text,
    fontSize: Number(attrOf(rPr, "sz")) / 100 || base.fontSize,
    color: runColor || fontRef || base.color,
    align: algn === "l" || algn === "r" || algn === "ctr" ? algn : base.align,
    vAlign: anchor === "t" || anchor === "b" || anchor === "ctr" ? anchor : base.vAlign,
    ...(attrOf(rPr, "b") === "1" ? { bold: true } : {}),
    ...(attrOf(rPr, "i") === "1" ? { italic: true } : {}),
    ...(attrOf(xfrm, "flipH") === "1" ? { flipH: true } : {}),
    ...(attrOf(xfrm, "flipV") === "1" ? { flipV: true } : {}),
  };
  const name = attrOf(openTag(spXml, "cNvPr"), "name");
  if (name) data.name = unesc(name);
  Object.assign(data, altOf(spXml));
  if (kind === "rect" && prst !== "rect" && !textbox) data.prst = prst;
  return data;
}

type Xfrm = { x: number; y: number; cx: number; cy: number; chx: number; chy: number; chcx: number; chcy: number };
function xfrmOf(prXml: string): Xfrm {
  const x = inner(prXml, "xfrm") ?? "";
  const n = (tag: string, a: string) => Number(attrOf(openTag(x, tag), a) || 0);
  return { x: n("off", "x"), y: n("off", "y"), cx: n("ext", "cx"), cy: n("ext", "cy"), chx: n("chOff", "x"), chy: n("chOff", "y"), chcx: n("chExt", "cx"), chcy: n("chExt", "cy") };
}

/** A group as one shape whose children sit where they are in it (pictures and charts in groups are left out). */
function groupData(grpXml: string): ShapeData | null {
  const g = xfrmOf(inner(grpXml, "grpSpPr") ?? "");
  const cw = g.chcx || g.cx || 1;
  const ch = g.chcy || g.cy || 1;
  const children: GroupChild[] = [];
  for (const child of topLevel(grpXml, ["sp", "cxnSp", "grpSp", "pic", "graphicFrame"])) {
    const pr = child.name === "grpSp" ? inner(child.xml, "grpSpPr") ?? "" : inner(child.xml, "spPr") ?? "";
    const c = xfrmOf(pr);
    const data = child.name === "grpSp" ? groupData(child.xml) : child.name === "sp" || child.name === "cxnSp" ? shapeData(child.name, child.xml) : null;
    if (!data) continue;
    children.push({ data, x: (c.x - g.chx) / cw, y: (c.y - g.chy) / ch, w: c.cx / cw, h: c.cy / ch });
  }
  if (!children.length) return null;
  const name = attrOf(openTag(grpXml, "cNvPr"), "name");
  return { ...newShape("group"), fill: null, line: null, kind: "group", children, ...(name ? { name: unesc(name) } : {}), ...altOf(grpXml) };
}

/**
 * Shapes (not pictures or charts) in a drawing part. A group comes out as one
 * shape holding its shapes (and groups), as Excel keeps it.
 */
export function readShapes(drawingXml: string): ReadShape[] {
  const out: ReadShape[] = [];
  for (const m of drawingXml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
    const body = m[2];
    const from = point(inner(body, "from")) ?? (m[1] === "absoluteAnchor" ? (() => {
      const pos = openTag(body, "pos");
      return { column: 0, columnOffset: Math.round(Number(attrOf(pos, "x") || 0) / EMU_PER_PX), row: 0, rowOffset: Math.round(Number(attrOf(pos, "y") || 0) / EMU_PER_PX) };
    })() : null);
    if (!from) continue;
    const [top] = topLevel(body, ["sp", "cxnSp", "grpSp", "pic", "graphicFrame"]);
    if (!top) continue;
    if (top.name === "grpSp") {
      const data = groupData(top.xml);
      if (!data) continue;
      const g = xfrmOf(inner(top.xml, "grpSpPr") ?? "");
      const ext = openTag(body, "ext");
      const size = { width: Math.max(1, Math.round((g.cx || Number(attrOf(ext, "cx") || 0)) / EMU_PER_PX)), height: Math.max(1, Math.round((g.cy || Number(attrOf(ext, "cy") || 0)) / EMU_PER_PX)) };
      out.push({ data, from, to: m[1] === "twoCellAnchor" ? point(inner(body, "to")) : null, size });
      continue;
    }
    if (top.name !== "sp" && top.name !== "cxnSp") continue;
    const to = m[1] === "twoCellAnchor" ? point(inner(body, "to")) : null;
    const spPr = inner(top.xml, "spPr") ?? "";
    const ext = openTag(inner(spPr, "xfrm") ?? "", "ext") || openTag(body, "ext");
    const size = { width: Math.round(Number(attrOf(ext, "cx") || 0) / EMU_PER_PX), height: Math.round(Number(attrOf(ext, "cy") || 0) / EMU_PER_PX) };
    out.push({ data: shapeData(top.name, top.xml), from, to, size });
  }
  return out;
}

export function placeInWorksheet(sheetXml: string, element: string): string {
  const after = /<(?:legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(sheetXml);
  if (after) return sheetXml.slice(0, after.index) + element + sheetXml.slice(after.index);
  return sheetXml.replace("</worksheet>", `${element}</worksheet>`);
}

type Zip = { file(path: string): { async(type: "string"): Promise<string> } | null; file(path: string, data: string): unknown; files: Record<string, unknown> };

const relsOf = (xml: string) => {
  const m = new Map<string, string>();
  for (const r of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attrOf(r[0], "Id");
    const target = attrOf(r[0], "Target");
    if (id && target) m.set(id, target);
  }
  return m;
};
const resolvePart = (base: string, target: string) => (target.startsWith("/") ? target.slice(1) : new URL(target, `http://parts/${base}`).pathname.slice(1));
const relPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");

/** The drawing part of a worksheet part, if it has one. */
export async function drawingPartOf(zip: Zip, sheetPath: string): Promise<string | null> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const sheetXml = await read(sheetPath);
  const id = attrOf(/<drawing\b[^>]*\/?>/.exec(sheetXml)?.[0] ?? null, "r:id");
  const target = id ? relsOf(await read(relPath(sheetPath))).get(id) : undefined;
  return target ? resolvePart(sheetPath, target) : null;
}

export type SheetShapes = { sheetPath: string; shapes: { data: ShapeData; anchor: ShapeAnchor; size: { width: number; height: number } }[] };

/** Adds shapes to the worksheets' drawing parts (creating parts where needed). */
/**
 * Adds anchors to a sheet's drawing part (made, with its relationship, when the
 * sheet has none). `build` gets the first free shape id and returns the anchors.
 */
export async function appendDrawingAnchors(zip: Zip, sheetPath: string, build: (firstId: number) => string): Promise<void> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  let contentTypes = await read("[Content_Types].xml");
  let drawingPath = await drawingPartOf(zip, sheetPath);
  let drawingXml = drawingPath ? await read(drawingPath) : "";
  if (!drawingPath || !drawingXml) {
    const nextDrawing = Math.max(0, ...Object.keys(zip.files).map((p) => Number(/^xl\/drawings\/drawing(\d+)\.xml$/.exec(p)?.[1] || 0))) + 1;
    drawingPath = `xl/drawings/drawing${nextDrawing}.xml`;
    drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>`;
    let sheetRels = await read(relPath(sheetPath));
    if (!sheetRels) sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const n = Math.max(0, ...[...sheetRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    sheetRels = sheetRels.replace("</Relationships>", `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingPath.split("/").at(-1)}"/></Relationships>`);
    let sheetXml = await read(sheetPath);
    if (!/xmlns:r=/.test(sheetXml.slice(0, sheetXml.indexOf(">", sheetXml.indexOf("<worksheet")))))
      sheetXml = sheetXml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    sheetXml = placeInWorksheet(sheetXml, `<drawing r:id="rId${n}"/>`);
    zip.file(sheetPath, sheetXml);
    zip.file(relPath(sheetPath), sheetRels);
    contentTypes = contentTypes.replace("</Types>", `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    zip.file("[Content_Types].xml", contentTypes);
  }
  if (!/xmlns:a=/.test(drawingXml)) drawingXml = drawingXml.replace(/<(xdr:)?wsDr\b/, '<$1wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"');
  const id = Math.max(0, ...[...drawingXml.matchAll(/cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  drawingXml = drawingXml.replace(/<\/(?:xdr:)?wsDr>/, `${build(id)}$&`);
  zip.file(drawingPath, drawingXml);
}

export async function addShapesToZip(zip: Zip, sheets: SheetShapes[]): Promise<void> {
  for (const { sheetPath, shapes } of sheets) {
    if (!shapes.length) continue;
    await appendDrawingAnchors(zip, sheetPath, (first) => {
      let id = first;
      return shapes
        .map((s) => {
          const xml = shapeAnchorXml(s.data, s.anchor, s.size, id);
          id += shapeIdCount(s.data);
          return xml;
        })
        .join("");
    });
  }
}

// ---- Printing -------------------------------------------------------------------

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A shape's outline as SVG markup in a w x h pixel box (groups draw their shapes in place). Its text is printed as text, see shapeTexts. */
export function shapeSvg(s: ShapeData, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(w))}" height="${Math.max(1, Math.round(h))}" viewBox="0 0 ${w} ${h}" overflow="visible">${shapeSvgBody(s, 0, 0, w, h)}</svg>`;
}

function shapeSvgBody(s: ShapeData, x: number, y: number, w: number, h: number): string {
  if (s.kind === "group") return (s.children || []).map((c) => shapeSvgBody(c.data, x + c.x * w, y + c.y * h, c.w * w, c.h * h)).join("");
  const lw = s.line ? Math.max(0.5, (s.lineWidth * 96) / 72) : 0;
  const iw = Math.max(0, w - lw);
  const ih = Math.max(0, h - lw);
  if (iw <= 0 && ih <= 0) return "";
  const parts = shapeParts(s, iw, ih);
  const fills = s.fill && s.kind !== "line" ? parts.filter((p) => p.fill).map((p) => `<path d="${p.d}" fill="${attr(s.fill!)}" stroke="none"/>`) : [];
  const strokes = s.line ? parts.filter((p) => p.stroke).map((p) => `<path d="${p.d}" fill="none" stroke="${attr(s.line!)}" stroke-width="${lw}" stroke-linejoin="round"/>`) : [];
  return `<g transform="translate(${x + lw / 2} ${y + lw / 2})">${fills.join("")}${strokes.join("")}</g>`;
}

/** The shapes with text (a group's too), each with its box as fractions of the outer box. */
export function shapeTexts(s: ShapeData, x = 0, y = 0, w = 1, h = 1): { x: number; y: number; w: number; h: number; data: ShapeData }[] {
  if (s.kind === "group") return (s.children || []).flatMap((c) => shapeTexts(c.data, x + c.x * w, y + c.y * h, c.w * w, c.h * h));
  return s.kind !== "line" && s.text ? [{ x, y, w, h, data: s }] : [];
}

/** The VML (legacy) drawing part of a worksheet part, if it has one. */
export async function legacyDrawingPartOf(zip: Zip, sheetPath: string): Promise<string | null> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const id = attrOf(/<legacyDrawing\b[^>]*\/?>/.exec(await read(sheetPath))?.[0] ?? null, "r:id");
  const target = id ? relsOf(await read(relPath(sheetPath))).get(id) : undefined;
  return target ? resolvePart(sheetPath, target) : null;
}

/** A part a worksheet's relationship points at. */
export async function sheetRelTarget(zip: Zip, sheetPath: string, relId: string): Promise<string | null> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const target = relsOf(await read(relPath(sheetPath))).get(relId);
  return target ? resolvePart(sheetPath, target) : null;
}

/** Writes VML into a worksheet's legacy drawing (made, with its relationship and content type, when the sheet has none). */
export async function writeLegacyDrawing(zip: Zip, sheetPath: string, build: (existing: string, idBlock: number) => string): Promise<void> {
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : "");
  const existing = await legacyDrawingPartOf(zip, sheetPath);
  if (existing) {
    const vml = await read(existing);
    zip.file(existing, build(vml, Number(/<o:idmap\b[^>]*data="(\d+)/.exec(vml)?.[1]) || 1));
    return;
  }
  const n = Math.max(0, ...Object.keys(zip.files).map((p) => Number(/^xl\/drawings\/vmlDrawing(\d+)\.vml$/.exec(p)?.[1] || 0))) + 1;
  const path = `xl/drawings/vmlDrawing${n}.vml`;
  // An id block of its own, past those comment drawings use.
  zip.file(path, build("", 20 + n));
  let sheetRels = await read(relPath(sheetPath));
  if (!sheetRels) sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const rid = Math.max(0, ...[...sheetRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  zip.file(relPath(sheetPath), sheetRels.replace("</Relationships>", `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${n}.vml"/></Relationships>`));
  let sheetXml = await read(sheetPath);
  if (!/xmlns:r=/.test(sheetXml.slice(0, sheetXml.indexOf(">", sheetXml.indexOf("<worksheet")))))
    sheetXml = sheetXml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  const after = /<(?:legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(sheetXml);
  const el = `<legacyDrawing r:id="rId${rid}"/>`;
  zip.file(sheetPath, after ? sheetXml.slice(0, after.index) + el + sheetXml.slice(after.index) : sheetXml.replace("</worksheet>", `${el}</worksheet>`));
  const types = await read("[Content_Types].xml");
  if (types && !/Extension="vml"/i.test(types)) zip.file("[Content_Types].xml", types.replace("</Types>", `<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>`));
}
