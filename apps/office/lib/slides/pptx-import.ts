// .pptx importer: reads the OOXML package (a zip) with JSZip (MIT) and maps it
// onto the presentation model (lib/slides/model.ts).
//
// Covered: slide size and order, hidden slides, title/body placeholders (with
// position + text-style inheritance from layout and master), text boxes with
// runs (bold/italic/underline/strike/colour/size/font), bullets & numbering
// with levels, alignment, vertical anchor, autofit scale, pictures, preset
// shapes (fill/outline/rotation/flip, theme style refs), connectors, groups,
// tables, SmartArt (via its pre-rendered drawing), backgrounds (solid,
// gradient → first stop, picture), master/layout decoration, speaker notes,
// and scheme colours with lumMod/lumOff/tint/shade, headers/footers (date,
// footer text, slide numbers) and sections.
// Charts (column/bar, line, area, pie, doughnut, scatter) are imported from
// their cached data; transitions and entrance animations are read too. Media
// and other effects are reported in `warnings`.
import JSZip from "jszip";
import { parseXml, child, kids, path, attr, num, descendants, type XEl } from "./xml";
import { effectiveTheme, themeById, themeColors, type ThemeColors } from "./themes";
import { LINE_UNIT, safeHref } from "./text";
import { readMediaTiming, readTiming, readTransition } from "./pptx-anim";
import { NOT_WEB, mimeForExt } from "./media-client";
import { BUILTIN_PREFIX, BUILTIN_SOUNDS } from "./anim-sound";
import { readCustGeom } from "./freeform";
import { fromAngle60k, normDeg } from "./model3d";
import { validWarp } from "./warp";
import { metafilePlaceholder, metafileToSvg } from "./metafile";
import { normalizeTable } from "./table";
import { BUILTIN_STYLES, DEFAULT_TABLE_STYLE, PART_TAG, TABLE_PARTS, builtinLook } from "./table-style";
import { ommlToLatex } from "./math";
import { buildDiagram, paragraphTexts, type DiagramKind, type OutlineItem } from "./smartart";
import { kindOfLayout } from "./pptx-smartart";
import { inkToFreeforms, readInkml } from "./pptx-ink";
import { type CustomShow, type ShowSettings } from "./show";
import { readAxes, readTrend } from "./pptx-chart";
import {
  type AnimSound,
  type FooterBoxes,
  footerBoxes,
  DATE_FORMATS,
  cleanHf,
  EMU_PER_PX,
  LAYOUTS,
  MASTER_KEYS,
  applyMaster,
  isCustomKey,
  isAddedMaster,
  masterKeyOf,
  escapeHtml,
  genId,
  layoutBoxes,
  masterLayout,
  titlePt,
  type Anim,
  type ZoomEl,
  type Model3dEl,
  type WordArt,
  type TableStyle,
  type TableLook,
  type TableLookPart,
  type BodyStyle,
  type Box,
  type Crop,
  type Gradient,
  type Shadow,
  type HeaderFooter,
  type MasterKey,
  type Masters,
  type ChartEl,
  type Slide,
  type SlideElement,
  type SlideLayout,
  type TableCell,
  type CellBorder,
  type TitleStyle,
  BODY_LEVELS,
  cleanLevels,
  mergeLevels,
  type LevelLook,
  richTitle,
  type SlotKind,
  SLOT_KINDS,
} from "./model";

export type ImportedDeck = {
  w: number;
  h: number;
  theme: string;
  font?: string; // deck body font (theme minor latin)
  headFont?: string;
  colors?: ThemeColors;
  hf?: HeaderFooter;
  masters?: Masters;
  /** comment threads from the file (PowerPoint legacy and modern comments) */
  comments?: ImportedComment[];
  /** Set Up Slide Show settings and custom shows (slide ids are the imported slides') */
  show?: ShowSettings;
  shows?: CustomShow[];
  slides: Slide[];
  warnings: string[];
};

/** A comment thread read from a deck: where it sits and its messages in order. */
export type ImportedComment = { slide: number; x: number; y: number; messages: { author: string; text: string; ms: number }[] };

type Rels = Record<string, { target: string; type: string; external: boolean }>;

type Part = { path: string; xml: XEl; rels: Rels };

type ColorCtx = { scheme: Record<string, string>; map: Record<string, string> };

type DeckCtx = {
  zip: JSZip;
  /** SVG drawings of metafile pictures -> the original EMF/WMF (data URLs) */
  metaOrig?: Map<string, string>;
  parts: Map<string, Promise<Part | null>>;
  media: Map<string, Promise<string | null>>;
  warnings: Set<string>;
  font?: string; // minor font
  /** header/footer placeholders seen on slides (decks from other writers) */
  hf: { num?: boolean; footer?: string; date?: string; dateAuto?: string; boxes?: FooterBoxes };
  /** our own decks: the masters, to know what a slide inherits */
  masters?: Masters;
  /** pictures that jump to another slide (zoom fallbacks): the slide part they jump to, and the zoom they stand for */
  jumps?: Map<SlideElement, { target: string; zoom?: ZoomInfo }>;
  /** ppt/tableStyles.xml: each style by id, and the default */
  tableStyles?: { byId: Map<string, XEl>; def?: string };
};

type ZoomInfo = { kind: "slide" | "section"; ret?: boolean };

/** PowerPoint's slide, section and summary zooms (the mc:Choice of a zoom's AlternateContent). */
function zoomInfo(choice: XEl | undefined): ZoomInfo | undefined {
  if (!choice) return undefined;
  const all = descendants(choice, "zmPr");
  const kinds = ["sldZm", "sectionZm", "summaryZm"].filter((k) => descendants(choice, k).length);
  if (!kinds.length) return undefined;
  return { kind: kinds[0] === "sldZm" ? "slide" : "section", ...(all.some((z) => attr(z, "returnToParent") === "1") ? { ret: true } : {}) };
}

type SlideCtx = {
  deck: DeckCtx;
  colors: ColorCtx;
  fonts: { major?: string; minor?: string };
  slide: Part;
  layout?: Part;
  master?: Part;
  defaultTextStyle?: XEl; // presentation.xml defaultTextStyle
  own: boolean; // deck written by our own exporter
  textColor: string; // run colours equal to this are left implicit
};

// ---------------------------------------------------------------- package I/O

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function relsPathFor(p: string): string {
  const i = p.lastIndexOf("/");
  return `${p.slice(0, i)}/_rels/${p.slice(i + 1)}.rels`;
}

async function readText(zip: JSZip, p: string): Promise<string | null> {
  const f = zip.file(p);
  return f ? f.async("string") : null;
}

function loadPart(deck: DeckCtx, p: string): Promise<Part | null> {
  let pr = deck.parts.get(p);
  if (!pr) {
    pr = (async () => {
      const src = await readText(deck.zip, p);
      if (src == null) return null;
      const rels: Rels = {};
      const rsrc = await readText(deck.zip, relsPathFor(p));
      if (rsrc) {
        for (const r of kids(parseXml(rsrc), "Relationship")) {
          const external = attr(r, "TargetMode") === "External";
          const target = attr(r, "Target") || "";
          rels[attr(r, "Id") || ""] = { target: external ? target : resolvePath(p, target), type: attr(r, "Type") || "", external };
        }
      }
      return { path: p, xml: parseXml(src), rels };
    })();
    deck.parts.set(p, pr);
  }
  return pr;
}

function relOfType(part: Part | undefined | null, suffix: string): string | undefined {
  if (!part) return undefined;
  for (const r of Object.values(part.rels)) if (r.type.endsWith(suffix) && !r.external) return r.target;
  return undefined;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  glb: "model/gltf-binary",
};

const b64 = (s: string) => (typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s))));

function mediaDataUrl(deck: DeckCtx, p: string): Promise<string | null> {
  let pr = deck.media.get(p);
  if (!pr) {
    pr = (async () => {
      const ext = (p.split(".").pop() || "").toLowerCase();
      const mime = MIME[ext];
      const f = deck.zip.file(p);
      if (!f) return null;
      if (ext === "emf" || ext === "wmf") {
        // drawn as SVG here; the original goes back into exported files
        const bytes = await f.async("uint8array");
        const svg = metafileToSvg(bytes) || metafilePlaceholder(ext);
        const url = `data:image/svg+xml;base64,${b64(svg)}`;
        (deck.metaOrig ??= new Map()).set(url, `data:image/x-${ext};base64,${await f.async("base64")}`);
        return url;
      }
      if (!mime) {
        deck.warnings.add(`Some pictures use a format browsers can't show (.${ext}) and were skipped.`);
        return null;
      }
      return `data:${mime};base64,${await f.async("base64")}`;
    })();
    deck.media.set(p, pr);
  }
  return pr;
}

// ---------------------------------------------------------------------- colour

const PRESET: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00",
  gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3", orange: "FFA500", purple: "800080",
  navy: "000080", maroon: "800000", silver: "C0C0C0", teal: "008080", cyan: "00FFFF", magenta: "FF00FF",
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return (c(r) + c(g) + c(b)).toUpperCase();
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function applyMods(hex: string, el: XEl): string {
  let [r, g, b] = hexToRgb(hex);
  for (const m of el.children) {
    const v = (num(m, "val") ?? 0) / 100000;
    if (m.local === "lumMod" || m.local === "lumOff") {
      const [h, s, l] = rgbToHsl(r, g, b);
      const nl = m.local === "lumMod" ? l * v : l + v;
      [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, nl)));
    } else if (m.local === "tint") {
      r = r + (255 - r) * (1 - v); g = g + (255 - g) * (1 - v); b = b + (255 - b) * (1 - v);
    } else if (m.local === "shade") {
      r *= v; g *= v; b *= v;
    }
  }
  return rgbToHex(r, g, b);
}

/** Resolve the colour child of a fill-like element (solidFill, a ref, a gradient stop...). */
function colorOf(el: XEl | undefined, cc: ColorCtx, phClr?: string): string | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    let base: string | undefined;
    if (c.local === "srgbClr") base = (attr(c, "val") || "").toUpperCase();
    else if (c.local === "sysClr") base = (attr(c, "lastClr") || (attr(c, "val") === "window" ? "FFFFFF" : "000000")).toUpperCase();
    else if (c.local === "prstClr") base = PRESET[attr(c, "val") || ""];
    else if (c.local === "scrgbClr") {
      const p = (k: string) => ((num(c, k) ?? 0) / 100000) * 255;
      base = rgbToHex(p("r"), p("g"), p("b"));
    } else if (c.local === "hslClr") {
      base = rgbToHex(...hslToRgb((num(c, "hue") ?? 0) / 21600000, (num(c, "sat") ?? 0) / 100000, (num(c, "lum") ?? 0) / 100000));
    } else if (c.local === "schemeClr") {
      const v = attr(c, "val") || "";
      if (v === "phClr") base = phClr;
      else base = cc.scheme[cc.map[v] || v];
    } else continue;
    if (!base || !/^[0-9A-F]{6}$/.test(base)) return undefined;
    return applyMods(base, c);
  }
  return undefined;
}

/** The colour of a fill container (spPr / bgPr / tcPr): undefined = not specified, null = explicitly none. */
function fillOf(container: XEl | undefined, cc: ColorCtx, phClr?: string): string | null | undefined {
  if (!container) return undefined;
  if (child(container, "noFill")) return null;
  const solid = child(container, "solidFill");
  if (solid) return colorOf(solid, cc, phClr) ?? null;
  const grad = child(container, "gradFill");
  if (grad) {
    const stops = kids(child(grad, "gsLst"), "gs");
    return colorOf(stops[0], cc, phClr) ?? null;
  }
  if (child(container, "pattFill")) return colorOf(child(child(container, "pattFill"), "fgClr"), cc, phClr) ?? null;
  return undefined;
}

/** A gradient fill (gradFill) with its stops resolved to RGB. */
function gradientOf(container: XEl | undefined, cc: ColorCtx, phClr?: string): Gradient | undefined {
  const g = child(container, "gradFill");
  if (!g) return undefined;
  const stops = kids(child(g, "gsLst"), "gs")
    .map((gs) => ({ pos: round((num(gs, "pos") ?? 0) / 1000), color: colorOf(gs, cc, phClr) || "" }))
    .filter((st) => HEX6.test(st.color));
  if (stops.length < 2) return undefined;
  const lin = child(g, "lin");
  const shade = child(g, "path");
  if (shade) return { kind: "radial", angle: 0, stops };
  return { kind: "linear", angle: round((num(lin, "ang") ?? 0) / 60000), stops };
}

/** Text columns (bodyPr numCol/spcCol) and WordArt effects (from the first run: outline, gradient fill, shadow, glow). */
function textFxOf(txBody: XEl | undefined, cc: ColorCtx): { cols?: number; colGap?: number; wa?: WordArt; warp?: string } {
  const out: { cols?: number; colGap?: number; wa?: WordArt; warp?: string } = {};
  const bodyPr = child(txBody, "bodyPr");
  const warp = attr(child(bodyPr, "prstTxWarp"), "prst");
  if (validWarp(warp)) out.warp = warp;
  const n = num(bodyPr, "numCol");
  if (n && n > 1) {
    out.cols = Math.min(16, Math.round(n));
    const gap = num(bodyPr, "spcCol");
    if (gap !== undefined) out.colGap = round(gap / EMU_PER_PX);
  }
  const rPr = descendants(txBody, "rPr")[0];
  if (rPr) {
    const wa: WordArt = {};
    const ln = child(rPr, "ln");
    const lc = ln && !child(ln, "noFill") ? colorOf(child(ln, "solidFill"), cc) : undefined;
    if (lc) wa.stroke = { c: lc, w: round((num(ln, "w") ?? 9525) / EMU_PER_PX) };
    const g = gradientOf(rPr, cc);
    if (g) wa.grad = g;
    const sh = shadowOf(rPr, cc);
    if (sh) wa.shadow = sh;
    const glow = path(rPr, "effectLst", "glow");
    const gc = glow ? colorOf(glow, cc) : undefined;
    if (glow && gc) wa.glow = { c: gc, r: round((num(glow, "rad") ?? 0) / EMU_PER_PX) };
    if (Object.keys(wa).length) out.wa = wa;
  }
  return out;
}

/** An outer shadow from an effect list (spPr/effectLst). */
function shadowOf(spPr: XEl | undefined, cc: ColorCtx): Shadow | undefined {
  const sh = path(spPr, "effectLst", "outerShdw");
  if (!sh) return undefined;
  const clr = sh.children.find((c) => c.local.endsWith("Clr"));
  const color = colorOf(sh, cc) || "000000";
  const alphaEl = clr?.children.find((c) => c.local === "alpha");
  const alpha = alphaEl ? (num(alphaEl, "val") ?? 100000) / 100000 : 1;
  return { color, blur: round((num(sh, "blurRad") ?? 0) / EMU_PER_PX), dist: round((num(sh, "dist") ?? 0) / EMU_PER_PX), dir: round((num(sh, "dir") ?? 0) / 60000), alpha: round(alpha) };
}

/** Picture crop from blipFill/srcRect (negative values pad the picture; those are ignored). */
function cropOf(blipFill: XEl | undefined): Crop | undefined {
  const r = child(blipFill, "srcRect");
  if (!r) return undefined;
  const f = (k: string) => Math.max(0, Math.min(0.95, (num(r, k) ?? 0) / 100000));
  const c = { l: f("l"), t: f("t"), r: f("r"), b: f("b") };
  return c.l || c.t || c.r || c.b ? (c.l + c.r < 0.98 && c.t + c.b < 0.98 ? c : undefined) : undefined;
}

/** A namespaced attribute (e.g. r:id) whose local name collides with a plain one. */
function nsAttr(el: XEl, local: string): string | undefined {
  for (const [k, v] of Object.entries(el.attrs)) if (k.endsWith(`:${local}`)) return v;
  return undefined;
}

// ------------------------------------------------------------------ geometry

type Xform = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };
type GroupTf = (b: Box) => Box;
const identity: GroupTf = (b) => b;

function readXfrm(x: XEl | undefined): Xform | undefined {
  const off = child(x, "off");
  const ext = child(x, "ext");
  if (!off || !ext) return undefined;
  return {
    x: (num(off, "x") ?? 0) / EMU_PER_PX,
    y: (num(off, "y") ?? 0) / EMU_PER_PX,
    w: (num(ext, "cx") ?? 0) / EMU_PER_PX,
    h: (num(ext, "cy") ?? 0) / EMU_PER_PX,
    rot: (num(x, "rot") ?? 0) / 60000,
    flipH: attr(x, "flipH") === "1",
    flipV: attr(x, "flipV") === "1",
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

// --------------------------------------------------------------- placeholders

type Ph = { type: string; idx?: string };
function phOf(nv: XEl | undefined): Ph | undefined {
  const ph = path(nv, "nvPr", "ph");
  if (!ph) return undefined;
  return { type: attr(ph, "type") || "obj", idx: attr(ph, "idx") };
}
const phFamily = (t: string) => (t === "ctrTitle" || t === "title" ? "title" : t === "subTitle" || t === "obj" || t === "body" ? "body" : t);

const SLOT_OF: Record<string, SlotKind> = { obj: "obj", body: "text", subTitle: "text", pic: "pic", clipArt: "pic", chart: "chart", tbl: "tbl", media: "media", dgm: "dgm" };

/**
 * A layout placeholder that is a slot (a picture, chart, table, content or
 * second text placeholder): any but the title, the footer ones and the
 * layout's first body placeholder, which is the slide body.
 */
function slotOf(part: Part | undefined, sp: XEl | undefined): { kind: SlotKind; id: string } | undefined {
  if (!part || part.xml.local !== "sldLayout" || !sp) return undefined;
  const ph = phOf(child(sp, "nvSpPr"));
  const kind = ph ? SLOT_OF[ph.type] : undefined;
  if (!ph || !kind) return undefined;
  const all = descendants(path(part.xml, "cSld", "spTree"), "sp");
  if (all.find((x) => { const p = phOf(child(x, "nvSpPr")); return p && phFamily(p.type) === "body"; }) === sp) return undefined;
  const name = attr(child(child(sp, "nvSpPr"), "cNvPr"), "name") || "";
  return { kind, id: name.startsWith("syn-slot-") ? name.slice(9) : `slot${ph.idx ?? all.indexOf(sp)}` };
}

/** The layout slot a slide placeholder fills (matched by index). */
function slideSlot(sc: SlideCtx, ph: Ph | undefined): { kind: SlotKind; id: string } | undefined {
  if (!ph || ph.idx === undefined || !sc.layout) return undefined;
  const sp = descendants(path(sc.layout.xml, "cSld", "spTree"), "sp").find((s) => phOf(child(s, "nvSpPr"))?.idx === ph.idx);
  return slotOf(sc.layout, sp);
}

/** Find the placeholder shape a slide placeholder inherits from inside a layout/master spTree. */
function findPh(part: Part | undefined, ph: Ph, byIdx: boolean): XEl | undefined {
  if (!part) return undefined;
  const tree = path(part.xml, "cSld", "spTree");
  const all = descendants(tree, "sp");
  if (byIdx && ph.idx !== undefined) {
    const m = all.find((s) => phOf(child(s, "nvSpPr"))?.idx === ph.idx);
    if (m) return m;
  }
  const exact = all.find((s) => phOf(child(s, "nvSpPr"))?.type === ph.type);
  if (exact) return exact;
  const fam = phFamily(ph.type);
  return all.find((s) => {
    const p = phOf(child(s, "nvSpPr"));
    return p && phFamily(p.type) === fam;
  });
}

// ------------------------------------------------------------------ text

type LevelStyle = {
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: string;
  font?: string;
  algn?: string;
  bullet?: "bullet" | "number" | "none";
  lnPct?: number; // line spacing multiple
  lnPts?: number; // exact line spacing (pt)
  spBef?: number; // space before (pt)
  spAft?: number; // space after (pt)
  spBefPct?: number; // space before/after as a fraction of a line
  spAftPct?: number;
  baseline?: number; // >0 superscript, <0 subscript
  hl?: string; // highlight colour
  href?: string;
};

/** Read one lvlNpPr / pPr (+ its defRPr) into a LevelStyle. */
function readLevel(pPr: XEl | undefined, sc: SlideCtx): LevelStyle {
  const out: LevelStyle = {};
  if (!pPr) return out;
  const algn = attr(pPr, "algn");
  if (algn) out.algn = algn;
  if (child(pPr, "buNone")) out.bullet = "none";
  else if (child(pPr, "buAutoNum")) out.bullet = "number";
  else if (child(pPr, "buChar") || child(pPr, "buBlip")) out.bullet = "bullet";
  const ln = child(pPr, "lnSpc");
  if (child(ln, "spcPct")) out.lnPct = (num(child(ln, "spcPct"), "val") ?? 100000) / 100000;
  else if (child(ln, "spcPts")) out.lnPts = (num(child(ln, "spcPts"), "val") ?? 0) / 100;
  for (const [tag, pts, pct] of [["spcBef", "spBef", "spBefPct"], ["spcAft", "spAft", "spAftPct"]] as const) {
    const sp = child(pPr, tag);
    if (child(sp, "spcPts")) out[pts] = (num(child(sp, "spcPts"), "val") ?? 0) / 100;
    else if (child(sp, "spcPct")) out[pct] = (num(child(sp, "spcPct"), "val") ?? 0) / 100000;
  }
  Object.assign(out, readRun(child(pPr, "defRPr"), sc));
  return out;
}

function fontName(tf: string | undefined, sc: SlideCtx): string | undefined {
  if (!tf) return undefined;
  if (tf.startsWith("+mj")) return sc.fonts.major;
  if (tf.startsWith("+mn")) return sc.fonts.minor;
  return tf;
}

function readRun(rPr: XEl | undefined, sc: SlideCtx): LevelStyle {
  const out: LevelStyle = {};
  if (!rPr) return out;
  const sz = num(rPr, "sz");
  if (sz) out.sz = sz / 100;
  const b = attr(rPr, "b");
  if (b !== undefined) out.b = b === "1" || b === "true";
  const i = attr(rPr, "i");
  if (i !== undefined) out.i = i === "1" || i === "true";
  const u = attr(rPr, "u");
  if (u !== undefined) out.u = u !== "none";
  const st = attr(rPr, "strike");
  if (st !== undefined) out.strike = st !== "noStrike";
  const fill = child(rPr, "solidFill") || child(rPr, "gradFill");
  if (fill) {
    const c = fill.local === "solidFill" ? colorOf(fill, sc.colors) : colorOf(kids(child(fill, "gsLst"), "gs")[0], sc.colors);
    if (c) out.color = c;
  }
  const f = fontName(attr(child(rPr, "latin"), "typeface"), sc);
  if (f) out.font = f;
  const bl = num(rPr, "baseline");
  if (bl !== undefined) out.baseline = bl;
  const hl = colorOf(child(rPr, "highlight"), sc.colors);
  if (hl) out.hl = hl;
  // hyperlinks: resolved against the slide part's relationships
  const rid = attr(child(rPr, "hlinkClick"), "r:id") ?? attr(child(rPr, "hlinkClick"), "id");
  const rel = rid ? sc.slide.rels[rid] : undefined;
  if (rel?.external && rel.type.endsWith("/hyperlink") && safeHref(rel.target)) out.href = rel.target;
  return out;
}

/** Ordered style sources (highest priority first) for one shape's text. */
type StyleChain = (lvl: number) => LevelStyle;

function makeChain(sources: (XEl | undefined)[], sc: SlideCtx, override: LevelStyle = {}): StyleChain {
  const cache = new Map<number, LevelStyle>();
  return (lvl) => {
    let s = cache.get(lvl);
    if (!s) {
      s = {};
      // apply lowest priority first so higher priority overwrites
      for (let k = sources.length - 1; k >= 0; k--) {
        const src = sources[k];
        if (!src) continue;
        const l = child(src, `lvl${lvl + 1}pPr`);
        if (l) Object.assign(s, strip(readLevel(l, sc)));
      }
      Object.assign(s, override);
      cache.set(lvl, s);
    }
    return s;
  };
}
function strip<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  return r;
}

type Para = { level: number; bullet: "bullet" | "number" | "none"; align?: string; html: string; text: string; first?: LevelStyle; css?: string[] };

type TextOpts = {
  chain: StyleChain;
  scale: number; // autofit fontScale
  defaultPt?: number; // omit size spans equal to this
  defaultColor?: string; // omit colour spans equal to this
  defaultFont?: string;
};

function paragraphs(txBody: XEl, o: TextOpts, sc: SlideCtx): Para[] {
  const out: Para[] = [];
  for (const p of kids(txBody, "p")) {
    const pPr = child(p, "pPr");
    const level = Math.min(8, num(pPr, "lvl") ?? 0);
    const own = strip(readLevel(pPr, sc));
    const lvlStyle = { ...o.chain(level), ...own };
    let html = "";
    let text = "";
    let first: LevelStyle | undefined;
    for (const r of p.children) {
      if (r.local === "br") {
        html += "<br>";
        text += "\n";
        continue;
      }
      if (r.local !== "r" && r.local !== "fld") continue;
      const t = child(r, "t")?.text ?? "";
      if (!t) continue;
      const st: LevelStyle = { ...lvlStyle, ...strip(readRun(child(r, "rPr"), sc)) };
      if (!first) first = st;
      text += t;
      let h = escapeHtml(t);
      if (st.strike) h = `<s>${h}</s>`;
      if (st.u && !st.href) h = `<u>${h}</u>`; // links are drawn underlined anyway
      if (st.i) h = `<em>${h}</em>`;
      if (st.b) h = `<strong>${h}</strong>`;
      if (st.baseline && st.baseline > 0) h = `<sup>${h}</sup>`;
      else if (st.baseline && st.baseline < 0) h = `<sub>${h}</sub>`;
      const css: string[] = [];
      if (st.color && st.color !== o.defaultColor) css.push(`color: #${st.color.toLowerCase()}`);
      const pt = st.sz ? round(st.sz * o.scale) : undefined;
      if (pt && pt !== o.defaultPt) css.push(`font-size: ${pt}pt`);
      if (st.font && st.font !== o.defaultFont) css.push(`font-family: ${cssFont(st.font)}`);
      if (css.length) h = `<span style="${css.join("; ")}">${h}</span>`;
      if (st.hl) h = `<mark data-color="#${st.hl.toLowerCase()}" style="background-color: #${st.hl.toLowerCase()}">${h}</mark>`;
      if (st.href) h = `<a href="${escapeHtml(st.href)}" target="_blank" rel="noopener noreferrer nofollow">${h}</a>`;
      html += h;
    }
    const align = lvlStyle.algn === "ctr" ? "center" : lvlStyle.algn === "r" ? "right" : lvlStyle.algn === "just" ? "justify" : undefined;
    const bullet = text ? lvlStyle.bullet || "none" : "none";
    // spacing set on the paragraph itself, as CSS (line-height in single-spacing units, margins in pt);
    // template defaults are left to the slide text styles
    const lineOf = (pct?: number) => (pct ? round(pct * (lvlStyle.sz || first?.sz || 18) * o.scale * LINE_UNIT) : undefined);
    const css: string[] = [];
    if (own.lnPct && Math.abs(own.lnPct - 1) > 0.001) css.push(`line-height: ${round(own.lnPct * LINE_UNIT * 1000) / 1000}`);
    else if (own.lnPts) css.push(`line-height: ${round(own.lnPts)}pt`);
    const bef = own.spBef ?? lineOf(own.spBefPct);
    const aft = own.spAft ?? lineOf(own.spAftPct);
    if (bef) css.push(`margin-top: ${bef}pt`);
    if (aft) css.push(`margin-bottom: ${aft}pt`);
    out.push({ level, bullet, align, html, text, first: first || lvlStyle, css });
  }
  // drop trailing empty paragraphs
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

/**
 * A title's runs as HTML when they differ from one another (one bold word, a
 * coloured word, a link): formatting that covers a whole paragraph is the
 * title's own style and is left out.
 */
export function titleRunsHtml(paras: Para[], style: TitleStyle = {}): string {
  let rich = false;
  const same = (d: string) => {
    const [k, v = ""] = d.split(":").map((x) => x.trim());
    if (k === "color") return !!style.color && v.toLowerCase() === `#${style.color.toLowerCase()}`;
    if (k === "font-size") return !!style.size && v === `${style.size}pt`;
    if (k === "font-family") return !!style.font && v.replace(/'/g, "") === style.font;
    return false;
  };
  const ps = paras.map((p) => {
    // what the title's own style already says is left to it
    let h = p.html.replace(/<span style="([^"]*)">/g, (_, css: string) => {
      const keep = css.split(";").map((d) => d.trim()).filter((d) => d && !same(d));
      return keep.length ? `<span style="${keep.join("; ")}">` : "<span>";
    });
    while (/<span>((?:(?!<\/?span\b)[\s\S])*)<\/span>/.test(h)) h = h.replace(/<span>((?:(?!<\/?span\b)[\s\S])*)<\/span>/g, "$1");
    if (style.bold === true) h = h.replace(/<\/?strong>/g, "");
    for (let m; (m = /^<(strong|span)\b[^>]*>([\s\S]*)<\/\1>$/.exec(h)) && !new RegExp(`</?${m[1]}\\b`).test(m[2]); ) h = m[2];
    if (richTitle(h)) rich = true;
    return `<p>${h}</p>`;
  });
  return rich ? ps.join("") : "";
}

function cssFont(f: string): string {
  return /^[\w-]+$/.test(f) ? f : `'${f.replace(/['"<>;]/g, "")}'`;
}

function pHtml(p: Para): string {
  const css = [...(p.align ? [`text-align: ${p.align}`] : []), ...(p.css || [])];
  return `<p${css.length ? ` style="${css.join("; ")}"` : ""}>${p.html}</p>`;
}

/** Paragraphs -> TipTap-compatible HTML (nested <ul>/<ol> for bullet levels). */
export function parasToHtml(paras: Para[]): string {
  let i = 0;
  const list = (level: number): string => {
    const type = paras[i].bullet;
    const tag = type === "number" ? "ol" : "ul";
    let h = `<${tag}>`;
    while (i < paras.length && paras[i].bullet !== "none" && paras[i].level >= level) {
      if (paras[i].level === level) {
        if (paras[i].bullet !== type) break;
        let li = `<li>${pHtml(paras[i])}`;
        i++;
        if (i < paras.length && paras[i].bullet !== "none" && paras[i].level > level) li += list(paras[i].level);
        h += `${li}</li>`;
      } else {
        h += `<li><p></p>${list(paras[i].level)}</li>`;
      }
    }
    return `${h}</${tag}>`;
  };
  let out = "";
  while (i < paras.length) {
    if (paras[i].bullet === "none") out += pHtml(paras[i++]);
    else out += list(paras[i].level);
  }
  return out;
}

function anchorOf(bodyPr: XEl | undefined): "top" | "middle" | "bottom" | undefined {
  const a = attr(bodyPr, "anchor");
  return a === "ctr" ? "middle" : a === "b" ? "bottom" : a === "t" ? "top" : undefined;
}

function fontScale(bodyPr: XEl | undefined): number {
  const n = child(bodyPr, "normAutofit");
  const s = num(n, "fontScale");
  return s ? s / 100000 : 1;
}

/** The autofit mode of the first bodyPr in the chain that sets one. */
function autofitOf(...chain: (XEl | undefined)[]): "shrink" | "resize" | "none" | undefined {
  for (const b of chain) {
    if (child(b, "normAutofit")) return "shrink";
    if (child(b, "spAutoFit")) return "resize";
    if (child(b, "noAutofit")) return "none";
  }
  return undefined;
}

// ----------------------------------------------------------------- shapes

type Collected = {
  title?: { text: string; box: Box; style: TitleStyle; layoutHint?: SlideLayout; html?: string };
  body?: { html: string; box: Box; valign?: "top" | "middle" | "bottom"; fit?: "shrink" | "resize" | "none" };
  els: SlideElement[];
  hasTitlePh: boolean;
  hasCtrTitle: boolean;
  hasBodyPh: boolean;
  phAt?: number; // number of elements collected before the first title/body placeholder
  recording?: boolean; // map shape ids (cNvPr id) to what they became, for animations
  spids: Map<number, string[]>;
  kinds?: Map<string, "mel" | "lel">; // master/layout objects of our own decks
  zoom?: ZoomInfo; // inside a zoom's fallback
};

/** cNvPr of a shape-like node (sp, pic, cxnSp, grpSp, graphicFrame). */
function cNvPrOf(n: XEl): XEl | undefined {
  const nv = n.children.find((c) => c.local.startsWith("nv"));
  return child(nv, "cNvPr");
}

function txStyleFor(master: Part | undefined, fam: string): XEl | undefined {
  const tx = child(master?.xml, "txStyles");
  return child(tx, fam === "title" ? "titleStyle" : fam === "body" ? "bodyStyle" : "otherStyle");
}

async function walkTree(tree: XEl | undefined, part: Part, sc: SlideCtx, out: Collected, tf: GroupTf, fromMaster: boolean) {
  if (!tree) return;
  for (const n of tree.children) {
    const before = out.els.length;
    if (n.local === "AlternateContent") {
      // equations live in the a14 choice (its fallback is a picture or plain text); otherwise prefer the fallback
      const choice = child(n, "Choice");
      // ink (p14 content part with InkML): its strokes as freeforms
      const cp = choice ? descendants(choice, "contentPart")[0] : undefined;
      if (cp && (await doInk(cp, part, sc, out, tf))) continue;
      const pick = choice && descendants(choice, "oMath").length ? choice : child(n, "Fallback") || choice;
      if (!pick) continue;
      const zoom = out.zoom;
      out.zoom = zoomInfo(choice) || zoom;
      await walkTree(pick, part, sc, out, tf, fromMaster);
      out.zoom = zoom;
      // a PowerPoint 3D model: its fallback picture becomes the model (the picture stays as its poster)
      const m3 = descendants(choice, "model3d")[0];
      const img = out.els.length === before + 1 ? out.els[before] : undefined;
      if (m3 && img?.type === "image") {
        const rel = part.rels[nsAttr(m3, "embed") || ""];
        const src = rel && !rel.external ? await mediaDataUrl(sc.deck, rel.target) : null;
        if (src) out.els[before] = model3dOf(img, src, path(m3, "trans", "rot"));
      }
      continue;
    }
    if (n.local === "sp") await doSp(n, part, sc, out, tf, fromMaster);
    else if (n.local === "pic") await doPic(n, part, sc, out, tf);
    else if (n.local === "cxnSp") doCxn(n, sc, out, tf);
    else if (n.local === "grpSp") {
      const x = path(n, "grpSpPr", "xfrm");
      const off = readXfrm(x);
      const chOff = child(x, "chOff");
      const chExt = child(x, "chExt");
      let inner = tf;
      if (off && chOff && chExt) {
        const cx = (num(chOff, "x") ?? 0) / EMU_PER_PX, cy = (num(chOff, "y") ?? 0) / EMU_PER_PX;
        const cw = (num(chExt, "cx") ?? 0) / EMU_PER_PX || 1, ch = (num(chExt, "cy") ?? 0) / EMU_PER_PX || 1;
        const sx = off.w / cw, sy = off.h / ch;
        inner = (b) => tf({ x: off.x + (b.x - cx) * sx, y: off.y + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy });
      }
      await walkTree(n, part, sc, out, inner, fromMaster);
      // keep the group together; a group inside it stays a group inside it
      const g = genId("g");
      for (let k = before; k < out.els.length; k++) {
        const e = out.els[k];
        if (e.group) e.sub = [e.group, ...(e.sub || [])];
        e.group = g;
      }
    } else if (n.local === "graphicFrame") {
      const rec = out.recording;
      out.recording = false; // SmartArt drawing shapes have their own id space
      await doFrame(n, part, sc, out, tf);
      out.recording = rec;
    }
    // an object that fills one of its layout's placeholder slots
    if (!fromMaster && part.xml.local === "sld" && out.els.length > before && (n.local === "sp" || n.local === "pic" || n.local === "graphicFrame")) {
      const nv = n.children.find((k) => k.local.startsWith("nv"));
      const slot = slideSlot(sc, phOf(nv));
      if (slot) out.els[before].ph = slot.id;
    }
    if (out.els.length === before + 1) {
      // decorative objects, and alternative text on objects other than pictures
      const pr = cNvPrOf(n);
      const e = out.els[before];
      if (descendants(pr, "decorative").some((d) => attr(d, "val") === "1" || attr(d, "val") === "true")) e.deco = true;
      const descr = attr(pr, "descr");
      if (descr && !e.alt && e.type !== "image" && e.type !== "media" && e.type !== "zoom" && !(e.type === "chart" && (descr === e.title || descr === `${e.chartType} chart`))) e.alt = descr.slice(0, 2000);
    }
    if (out.els.length > before) {
      const pr = cNvPrOf(n);
      const name = attr(pr, "name") || "";
      // our exporter names shapes syn-el-<id> (syn-mel-/syn-lel- on the master/layouts): keep the id across a round trip
      const own = /^syn-(el|mel|lel|slot)-(.+)$/.exec(name);
      if (own && out.els.length === before + 1) {
        out.els[before].id = own[2];
        if (own[1] !== "el") (out.kinds ??= new Map()).set(own[2], own[1] === "mel" ? "mel" : "lel");
        // our layout's placeholder slot: its kind and prompt (the default prompt is left implicit)
        const kind = own[1] === "slot" ? SLOT_OF[phOf(n.children.find((k) => k.local.startsWith("nv")))?.type || ""] : undefined;
        if (kind) {
          const text = kids(child(n, "txBody"), "p").map((p) => descendants(p, "t").map((t) => t.text).join("")).join(" ").trim();
          const def = SLOT_KINDS.find((k) => k.id === kind)?.prompt;
          const b = out.els[before];
          out.els[before] = { id: b.id, z: b.z, type: "text", html: text && text !== def ? `<p>${escapeHtml(text)}</p>` : "", slot: kind, x: b.x, y: b.y, w: b.w, h: b.h };
        }
      }
      const spid = num(pr, "id");
      if (out.recording && spid !== undefined) out.spids.set(spid, out.els.slice(before).map((e) => e.id));
    }
  }
}

/** PowerPoint ink: each InkML trace becomes a freeform in the content part's box. */
async function doInk(cp: XEl, part: Part, sc: SlideCtx, out: Collected, tf: GroupTf): Promise<boolean> {
  const rel = part.rels[nsAttr(cp, "id") || ""];
  if (!rel || rel.external) return false;
  const raw = await sc.deck.zip.file(rel.target)?.async("string");
  const strokes = raw && raw.length < 5_000_000 ? readInkml(raw) : [];
  const xf = readXfrm(child(cp, "xfrm"));
  if (!strokes.length || !xf) return false;
  const pr = path(cp, "nvContentPartPr", "cNvPr");
  const own = /^syn-el-(.+)$/.exec(attr(pr, "name") || "")?.[1];
  const ids: string[] = [];
  for (const [k, f] of inkToFreeforms(strokes, place(xf, tf)).entries()) {
    const id = own && k === 0 ? own : genId("e");
    ids.push(id);
    out.els.push({ id, z: out.els.length + 1, type: "shape", shape: "freeform", geom: f.geom, fill: null, line: f.line, lineW: f.lineW, ink: f.hl ? "hl" : "pen", ...(f.hl ? { lineA: 0.4 } : {}), ...f.box });
  }
  const spid = num(pr, "id");
  if (out.recording && spid !== undefined && ids.length) out.spids.set(spid, ids);
  return ids.length > 0;
}

function place(b: Box, tf: GroupTf): Box {
  const r = tf(b);
  return { x: round(r.x), y: round(r.y), w: round(Math.max(1, r.w)), h: round(Math.max(1, r.h)) };
}

async function doSp(sp: XEl, part: Part, sc: SlideCtx, out: Collected, tf: GroupTf, fromMaster: boolean) {
  const nv = child(sp, "nvSpPr");
  const cNvPr = child(nv, "cNvPr");
  const name = attr(cNvPr, "name") || "";
  const ph = phOf(nv);
  const spPr = child(sp, "spPr");
  const txBody = child(sp, "txBody");

  // Our own exporter's markers.
  if (name.startsWith("syn-bar")) return;
  const ownTitle = name.startsWith("syn-title");
  const ownBody = name === "syn-body";

  if (ph && fromMaster) {
    // master/layout placeholders are prompts, not content; a layout's extra ones are its slots
    const slot = slotOf(part, sp);
    const xf0 = slot ? readXfrm(child(spPr, "xfrm")) || readXfrm(path(findPh(sc.master, ph, false), "spPr", "xfrm")) : undefined;
    if (slot && xf0) {
      const prompt = kids(txBody, "p").map((p) => descendants(p, "t").map((t) => t.text).join("")).join(" ").trim();
      out.els.push({ id: slot.id, z: out.els.length + 1, type: "text", html: prompt ? `<p>${escapeHtml(prompt)}</p>` : "", slot: slot.kind, ...place(xf0, tf) });
    }
    return;
  }
  // a slide placeholder that fills one of its layout's slots is an object of its own
  const filling = ph && !name.startsWith("syn-") ? slideSlot(sc, ph) : undefined;

  let xf = readXfrm(child(spPr, "xfrm"));
  const lPh = ph ? findPh(sc.layout, ph, true) : undefined;
  const mPh = ph ? findPh(sc.master, ph, false) : undefined;
  if (ph && !xf) xf = readXfrm(path(lPh, "spPr", "xfrm")) || readXfrm(path(mPh, "spPr", "xfrm"));
  if (!xf) return;
  const fam = ownTitle ? "title" : ownBody ? "body" : ph && !filling && !/^syn-(el|slot)-/.test(name) ? phFamily(ph.type) : "other";
  if (ph && ["dt", "ftr", "sldNum", "hdr"].includes(ph.type)) {
    if (!sc.own) {
      const text = kids(txBody, "p")
        .map((p) => p.children.map((r) => (r.local === "r" || r.local === "fld" ? child(r, "t")?.text ?? "" : "")).join(""))
        .join(" ")
        .trim();
      const isNum = ph.type === "sldNum" || descendants(txBody, "fld").some((f) => attr(f, "type") === "slidenum");
      if (isNum) sc.deck.hf.num = true;
      else if (ph.type === "ftr" && text) sc.deck.hf.footer ??= text;
      else if (ph.type === "dt" && text) sc.deck.hf.date ??= text;
      // a date field updates by itself
      const dt = ph.type === "dt" ? descendants(txBody, "fld").find((f) => /^datetime\d*$/.test(attr(f, "type") || "")) : undefined;
      if (dt) sc.deck.hf.dateAuto ??= DATE_FORMATS.some((f) => f.id === attr(dt, "type")) ? attr(dt, "type") : "datetime1";
      // where the master (or the slide) puts them
      const k = ph.type === "dt" ? "date" : ph.type === "ftr" ? "footer" : isNum ? "num" : undefined;
      if (k) (sc.deck.hf.boxes ??= {})[k] ??= { x: xf.x, y: xf.y, w: xf.w, h: xf.h };
    }
    return;
  }

  const bodyPr = child(txBody, "bodyPr");
  const lBodyPr = path(lPh, "txBody", "bodyPr");
  const mBodyPr = path(mPh, "txBody", "bodyPr");
  const valign = anchorOf(bodyPr) || anchorOf(lBodyPr) || anchorOf(mBodyPr);
  const fit = autofitOf(bodyPr, lBodyPr, mBodyPr);
  const autofit = fit === "shrink" || fit === "resize" ? { autofit: fit } : {};

  const sources: (XEl | undefined)[] = [child(txBody, "lstStyle")];
  if (ph) sources.push(path(lPh, "txBody", "lstStyle"), path(mPh, "txBody", "lstStyle"), txStyleFor(sc.master, fam));
  else sources.push(txStyleFor(sc.master, "other"), sc.defaultTextStyle);
  // shape style fontRef colour is the base text colour for shapes
  const fontRefColor = colorOf(path(sp, "style", "fontRef"), sc.colors);
  const chain = makeChain(sources, sc, fontRefColor ? { color: fontRefColor } : {});
  const box = place(xf, tf);
  // our own files shrink overflowing text live, so they keep the nominal sizes (fontScale is for other applications)
  const scale = sc.own ? 1 : fontScale(bodyPr);

  // an equation (Office Math): one equation element from the shape's paragraphs
  if (txBody && descendants(txBody, "oMath").length && !ownTitle && !ownBody) {
    const lines = kids(txBody, "p")
      .map((p) =>
        p.children
          .map((c) => {
            if (c.local === "m") {
              const para = child(c, "oMathPara") || child(c, "oMath");
              return para ? ommlToLatex(para) : "";
            }
            const t = c.local === "r" ? child(c, "t")?.text || "" : "";
            return t.trim() ? `\\text{${t.replace(/[{}\\]/g, "")}}` : "";
          })
          .join(""),
      )
      .filter(Boolean);
    const mr = descendants(txBody, "oMath")[0];
    const firstRun = descendants(mr, "r").find((r) => child(r, "rPr") && r.children.some((x) => x.local === "rPr" && x.name.startsWith("a:"))) || descendants(mr, "r")[0];
    const aRpr = firstRun?.children.find((x) => x.local === "rPr" && !x.name.startsWith("m:"));
    const st = { ...chain(0), ...strip(readRun(aRpr, sc)) };
    const color = st.color && st.color !== sc.textColor ? st.color : undefined;
    out.els.push({ id: genId("e"), z: out.els.length + 1, type: "math", latex: lines.join(" \\\\ "), ...(st.sz ? { size: round(st.sz * scale) } : {}), ...(color ? { color } : {}), ...box, ...(xf.rot ? { rot: xf.rot } : {}) });
    return;
  }

  if (fam === "title" && (ph || ownTitle) && !out.title) {
    out.hasTitlePh = true;
    out.phAt ??= out.els.length;
    if (ph?.type === "ctrTitle") out.hasCtrTitle = true;
    const paras = txBody ? paragraphs(txBody, { chain, scale }, sc) : [];
    const text = paras.map((p) => p.text).join("\n");
    if (!text && !ownTitle) return;
    const f = paras[0]?.first || chain(0);
    const style: TitleStyle = strip({
      size: f.sz ? round(f.sz * scale) : undefined,
      color: f.color,
      bold: f.b,
      font: f.font,
      align: paras[0]?.align === "center" || paras[0]?.align === "right" ? (paras[0].align as "center" | "right") : undefined,
    });
    const hint = ownTitle ? (name.slice(10) as SlideLayout) || undefined : undefined;
    if (out.recording && num(cNvPr, "id") !== undefined) out.spids.set(num(cNvPr, "id") as number, ["title"]);
    const html = titleRunsHtml(paras, { ...style, size: f.sz ? round(f.sz * scale) : undefined, bold: f.b });
    out.title = { text, box, style, layoutHint: hint, ...(html ? { html } : {}) };
    return;
  }
  if (fam === "body" && (ph || ownBody) && !out.body) {
    out.hasBodyPh = true;
    out.phAt ??= out.els.length;
    // our own body text spells out what the layout/master body style gives it
    const bs: BodyStyle = sc.own ? applyMaster({ id: "", title: "", body: "", notes: "", layout: out.title?.layoutHint || "content", bg: "", bgImg: "", elements: [] }, sc.deck.masters).bstyle || {} : {};
    const paras = txBody
      ? paragraphs(txBody, { chain, scale, defaultPt: sc.own ? bs.size ?? 18 : undefined, defaultFont: (sc.own && bs.font) || sc.deck.font, defaultColor: (sc.own && bs.color) || sc.textColor }, sc)
      : [];
    if (!paras.length && !ownBody) return;
    out.body = { html: parasToHtml(paras), box, valign, fit };
    if (out.recording && num(cNvPr, "id") !== undefined) out.spids.set(num(cNvPr, "id") as number, ["body"]);
    return;
  }

  // An ordinary shape / text box (or an extra placeholder).
  const geom = child(spPr, "prstGeom");
  const cust = child(spPr, "custGeom");
  const box0 = place(xf, tf);
  const free = cust ? readCustGeom(cust, box0.w, box0.h) : null;
  if (cust && !free) sc.deck.warnings.add("Some freeform shapes could not be read and were simplified to rectangles.");
  const prst = free ? "freeform" : attr(geom, "prst") || "rect";
  const blip = path(spPr, "blipFill", "blip");
  let fill = fillOf(spPr, sc.colors);
  if (fill === undefined && !ph) {
    const ref = path(sp, "style", "fillRef");
    if (ref && (num(ref, "idx") ?? 0) > 0) fill = colorOf(ref, sc.colors) ?? null;
  }
  const ln = child(spPr, "ln");
  let line: string | null | undefined = ln ? fillOf(ln, sc.colors) : undefined;
  if (line === undefined && !ph) {
    const ref = path(sp, "style", "lnRef");
    if (ref && (num(ref, "idx") ?? 0) > 0) line = colorOf(ref, sc.colors) ?? null;
  }
  const lineW = ln && num(ln, "w") !== undefined ? round((num(ln, "w") as number) / EMU_PER_PX) : line ? 1.33 : undefined;
  const lnAlpha = num(descendants(child(ln, "solidFill"), "alpha")[0], "val");
  const lineA = line && lnAlpha !== undefined && lnAlpha < 100000 ? round(lnAlpha / 100000) : undefined;
  // fill transparency: the alpha of the solid colour, or of the gradient's first stop
  const fillEl = child(spPr, "solidFill") || path(spPr, "gradFill", "gsLst");
  const fAlpha = num(descendants(fillEl, "alpha")[0], "val");
  const fillA = fill && fAlpha !== undefined && fAlpha < 100000 ? round(Math.max(0, fAlpha) / 100000) : undefined;
  const grad = gradientOf(spPr, sc.colors);
  const shadow = shadowOf(spPr, sc.colors);

  const paras = txBody ? paragraphs(txBody, { chain, scale, defaultPt: sc.own ? 18 : undefined, defaultFont: sc.deck.font, defaultColor: sc.textColor }, sc) : [];
  const html = paras.length ? parasToHtml(paras) : "";
  const tfx = html ? textFxOf(txBody, sc.colors) : {};
  const common = { id: genId("e"), z: out.els.length + 1, ...box, ...(xf.rot ? { rot: round(xf.rot) } : {}), ...(xf.flipH ? { flipH: true } : {}), ...(xf.flipV ? { flipV: true } : {}) };

  if (blip) {
    const rid = attr(blip, "embed");
    const rel = rid ? part.rels[rid] : undefined;
    const src = rel && !rel.external ? await mediaDataUrl(sc.deck, rel.target) : null;
    const crop = cropOf(child(spPr, "blipFill"));
    if (src) out.els.push({ ...common, type: "image", src, ...(crop ? { crop } : {}), ...(shadow ? { shadow } : {}) });
    if (!html) return;
  }

  if (!fill && !line) {
    if (!html) return;
    out.els.push({ ...common, ...tfx, type: "text", html, ...(valign ? { valign } : {}), ...autofit });
    return;
  }
  if (!html && !fill && !line) return;
  out.els.push({
    ...common,
    ...tfx,
    type: "shape",
    shape: prst,
    ...(free ? { geom: free } : {}),
    fill: fill ?? null,
    line: line ?? null,
    ...(lineW ? { lineW } : {}),
    ...(lineA !== undefined ? { lineA } : {}),
    ...(fillA !== undefined ? { fillA } : {}),
    ...(grad ? { grad } : {}),
    ...(shadow ? { shadow } : {}),
    ...(html ? { html } : {}),
    ...(valign ? { valign } : {}),
    ...(html ? autofit : {}),
  });
}

/** A picture's blipFill, also when wrapped in mc:AlternateContent (the fallback, in a widely read format, first). */
function blipFillOf(pic: XEl): XEl | undefined {
  const own = child(pic, "blipFill");
  if (own) return own;
  const ac = child(pic, "AlternateContent");
  return path(ac, "Fallback", "blipFill") || path(ac, "Choice", "blipFill");
}

async function doPic(pic: XEl, part: Part, sc: SlideCtx, out: Collected, tf: GroupTf, xfOverride?: Xform) {
  const nv = child(pic, "nvPicPr");
  let xf = xfOverride || readXfrm(path(pic, "spPr", "xfrm"));
  const ph = phOf(nv);
  if (!xf && ph) xf = readXfrm(path(findPh(sc.layout, ph, true), "spPr", "xfrm")) || readXfrm(path(findPh(sc.master, ph, false), "spPr", "xfrm"));
  if (!xf) return;
  const blip = child(blipFillOf(pic), "blip");
  const rid = attr(blip, "embed");
  const rel = rid ? part.rels[rid] : undefined;
  const src = rel && !rel.external ? await mediaDataUrl(sc.deck, rel.target) : null;
  const box = place(xf, tf);
  const vf = path(nv, "nvPr", "videoFile") || path(nv, "nvPr", "audioFile");
  if (vf) {
    const media = await mediaOf(vf, nv, part, sc);
    if (media) {
      out.els.push({
        id: genId("e"),
        z: out.els.length + 1,
        type: "media",
        kind: vf.local === "audioFile" ? "audio" : "video",
        ...media,
        ...(src ? { poster: src } : {}),
        ...box,
        ...(attr(child(nv, "cNvPr"), "descr") ? { name: attr(child(nv, "cNvPr"), "descr") } : {}),
      });
      return;
    }
    sc.deck.warnings.add("Some audio or video could not be played here and was imported as its poster picture.");
  }
  if (!src) return;
  const alt = attr(child(nv, "cNvPr"), "descr");
  const crop = cropOf(blipFillOf(pic));
  const shadow = shadowOf(child(pic, "spPr"), sc.colors);
  // a picture that jumps to a slide: a zoom (PowerPoint's fallback for one, or ours)
  const hl = child(child(nv, "cNvPr"), "hlinkClick");
  const jump = /hlinksldjump/.test(attr(hl, "action") || "") ? part.rels[attr(hl, "r:id") ?? attr(hl, "id") ?? ""] : undefined;
  out.els.push({
    id: genId("e"),
    z: out.els.length + 1,
    type: "image",
    src,
    ...(sc.deck.metaOrig?.get(src) ? { orig: sc.deck.metaOrig.get(src) } : {}),
    ...box,
    ...(alt ? { alt } : {}),
    ...(crop ? { crop } : {}),
    ...(shadow ? { shadow } : {}),
    ...(xf.rot ? { rot: round(xf.rot) } : {}),
    ...(xf.flipH ? { flipH: true } : {}),
    ...(xf.flipV ? { flipV: true } : {}),
  });
  if (jump && !jump.external) (sc.deck.jumps ??= new Map()).set(out.els[out.els.length - 1], { target: jump.target, zoom: out.zoom });
}

/** The file behind a videoFile/audioFile: the embedded copy (p14:media) or the linked one. */
async function mediaOf(vf: XEl, nv: XEl | undefined, part: Part, sc: SlideCtx): Promise<{ src: string; mime: string } | null> {
  const p14 = descendants(path(nv, "nvPr", "extLst"), "media")[0];
  const embed = p14 ? part.rels[nsAttr(p14, "embed") || ""] : undefined;
  const link = part.rels[nsAttr(vf, "link") || ""];
  const rel = embed && !embed.external ? embed : link;
  if (!rel) return null;
  const ext = (rel.target.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
  const mime = mimeForExt(ext) || (vf.local === "audioFile" ? "audio/mpeg" : "video/mp4");
  if (!/^(video\/(mp4|webm|ogg|quicktime|x-ms-wmv|x-msvideo)|audio\/(mpeg|mp4|aac|wav|ogg|flac|x-ms-wma))$/.test(mime)) return null;
  // Windows Media and AVI: kept for PowerPoint, shown here as the poster
  if (NOT_WEB.test(mime)) sc.deck.warnings.add("Some video or audio is Windows Media or AVI, which browsers can't play: it shows its picture here and still plays in PowerPoint.");
  if (rel.external) return /^https:\/\//i.test(rel.target) ? { src: rel.target, mime } : null;
  const f = sc.deck.zip.file(rel.target);
  if (!f) return null;
  return { src: `data:${mime};base64,${await f.async("base64")}`, mime };
}

function doCxn(cx: XEl, sc: SlideCtx, out: Collected, tf: GroupTf) {
  const spPr = child(cx, "spPr");
  const xf = readXfrm(child(spPr, "xfrm"));
  if (!xf) return;
  const ln = child(spPr, "ln");
  let line = ln ? fillOf(ln, sc.colors) : undefined;
  if (line === undefined) line = colorOf(path(cx, "style", "lnRef"), sc.colors) ?? "000000";
  if (line === null) return;
  const box = place(xf, tf);
  const head = child(ln, "tailEnd") || child(ln, "headEnd");
  const arrow = head && attr(head, "type") && attr(head, "type") !== "none";
  out.els.push({
    id: genId("e"),
    z: out.els.length + 1,
    type: "shape",
    shape: arrow ? "lineArrow" : "line",
    fill: null,
    line,
    lineW: ln && num(ln, "w") !== undefined ? round((num(ln, "w") as number) / EMU_PER_PX) : 1.33,
    ...box,
    ...(xf.rot ? { rot: round(xf.rot) } : {}),
    ...(xf.flipH ? { flipH: true } : {}),
    ...(xf.flipV ? { flipV: true } : {}),
  });
}

function chartPoints(el: XEl | undefined): string[] {
  if (!el) return [];
  const points = descendants(el, "pt");
  const values: string[] = [];
  for (const point of points) {
    const index = num(point, "idx");
    if (index === undefined || index < 0 || index > 1000) continue;
    values[index] = child(point, "v")?.text || "";
  }
  return values;
}

const PLOT_TYPES: Record<string, ChartEl["chartType"]> = {
  barChart: "bar", bar3DChart: "bar", lineChart: "line", line3DChart: "line", stockChart: "line",
  areaChart: "area", area3DChart: "area", pieChart: "pie", pie3DChart: "pie", ofPieChart: "pie",
  doughnutChart: "doughnut", scatterChart: "scatter", bubbleChart: "scatter", radarChart: "line",
};
type ReadChart = Pick<ChartEl, "type" | "chartType" | "title" | "categories" | "series" | "showLegend" | "barDir" | "stacked" | "dataLabels" | "legendPos" | "valAx" | "catAx">;

function readChart(root: XEl, sc: SlideCtx): ReadChart | null {
  const chart = child(root, "chart");
  const plot = child(chart, "plotArea");
  const plots = kids(plot).filter((node) => PLOT_TYPES[node.local]);
  const plotType = plots[0];
  if (!plotType) return null;
  const chartType = PLOT_TYPES[plotType.local];
  // combo charts: every bar, line and area group's series, each with its type and axis
  const axisOf = (pl: XEl) => attr(kids(pl, "axId")[1], "val") || attr(kids(pl, "axId")[0], "val") || "";
  const mixable = (t: string) => t === "bar" || t === "line" || t === "area";
  const usable = plots.filter((pl, i) => i === 0 || (mixable(chartType) && mixable(PLOT_TYPES[pl.local])));
  if (usable.length < plots.length) sc.deck.warnings.add("Combination charts mixing pie, doughnut or scatter groups were imported with their first chart type only.");
  const firstAxis = axisOf(plotType);
  const sourceOf: { ser: XEl; type?: "bar" | "line" | "area"; y2?: boolean }[] = usable.flatMap((pl) => {
    const t = PLOT_TYPES[pl.local] as "bar" | "line" | "area";
    const y2 = pl !== plotType && axisOf(pl) !== firstAxis;
    return kids(pl, "ser").map((ser) => ({ ser, ...(t !== chartType ? { type: t } : {}), ...(y2 ? { y2: true } : {}) }));
  });
  // in the order the series are numbered (c:order)
  sourceOf.sort((a, b) => (Number(attr(child(a.ser, "order"), "val")) || 0) - (Number(attr(child(b.ser, "order"), "val")) || 0));
  const source = sourceOf.map((x) => x.ser);
  if (!source.length) return null;
  const scatter = chartType === "scatter";
  const round = chartType === "pie" || chartType === "doughnut";
  const firstCategories = source.map((s) => chartPoints(child(s, scatter ? "xVal" : "cat"))).find((v) => v.length) || [];
  const series = source.slice(0, 20).map((s, i) => {
    const raw = chartPoints(child(s, scatter ? "yVal" : "val"));
    const tx = child(s, "tx");
    const name = child(tx, "v")?.text || chartPoints(tx)[0] || `Series ${i + 1}`;
    const spPr = child(s, "spPr");
    // lines and scatter markers carry their colour on the outline / marker
    const fill = fillOf(spPr, sc.colors) || fillOf(child(spPr, "ln"), sc.colors) || fillOf(path(s, "marker", "spPr"), sc.colors);
    const trend = readTrend(s);
    const meta = sourceOf[i];
    return { name, values: raw.map((v) => Number.isFinite(Number(v)) ? Number(v) : 0), ...(fill ? { color: fill } : {}), ...(trend ? { trend } : {}), ...(meta?.type ? { type: meta.type } : {}), ...(meta?.y2 ? { y2: true } : {}) };
  });
  const count = Math.min(100, Math.max(firstCategories.length, ...series.map((s) => s.values.length)));
  if (!count) return null;
  const categories = Array.from({ length: count }, (_, i) => firstCategories[i] || (scatter ? String(i + 1) : `Category ${i + 1}`));
  const titleEl = child(chart, "title");
  const title = descendants(titleEl, "t").map((t) => t.text).join("") || chartPoints(titleEl)[0] || undefined;
  const legend = child(chart, "legend");
  const pos = attr(child(legend, "legendPos"), "val") || "r";
  const grouping = attr(child(plotType, "grouping"), "val") || "";
  const showVal = [plotType, ...source].some((n) => attr(path(n, "dLbls", "showVal"), "val") === "1");
  return {
    type: "chart",
    chartType,
    title,
    categories,
    series: series.map((s) => ({ ...s, values: categories.map((_, i) => s.values[i] ?? 0) })),
    showLegend: !!legend,
    ...(legend ? { legendPos: (pos === "tr" ? "r" : ["b", "t", "r", "l"].includes(pos) ? pos : "r") as ChartEl["legendPos"] } : {}),
    ...(chartType === "bar" && attr(child(plotType, "barDir"), "val") === "bar" ? { barDir: "bar" as const } : {}),
    ...(/stacked/i.test(grouping) ? { stacked: true } : {}),
    ...(grouping === "percentStacked" ? { percent: true } : {}),
    ...(showVal ? { dataLabels: true } : {}),
    ...(round ? {} : readAxes(plot, scatter)),
  };
}

/** SmartArt layout family from its layout definition id (".../layout/process1", "cycle2", "orgChart1"...). */
function smartArtKind(uniqueId: string): DiagramKind {
  const id = uniqueId.toLowerCase().split("/").pop() || "";
  if (/cycle|radial|gear|circle/.test(id)) return "cycle";
  if (/hierarchy|orgchart|tree/.test(id)) return "hierarchy";
  if (/pyramid|funnel/.test(id)) return "pyramid";
  if (/process|chevron|arrow|timeline|step/.test(id)) return "process";
  return "list";
}

/** The outline and the model id of each of its items. */
function smartArtOutlineIds(dm: XEl): { items: OutlineItem[]; ids: string[] } {
  const ids: string[] = [];
  const items = smartArtOutline(dm, ids);
  return { items, ids };
}

/** The data model's nodes as an outline: children follow their parent (parOf connections, in order). */
function smartArtOutline(dm: XEl, ids: string[] = []): OutlineItem[] {
  const pts = descendants(dm, "pt");
  const text = new Map<string, string>();
  let doc: string | undefined;
  for (const p of pts) {
    const id = attr(p, "modelId") || "";
    const type = attr(p, "type") || "node";
    if (type === "doc") doc = id;
    if (type !== "node" && type !== "doc") continue;
    const t = kids(child(p, "t"), "p").map((pp) => descendants(pp, "t").map((x) => x.text).join("")).filter(Boolean).join(" ");
    text.set(id, t);
  }
  const kidsOf = new Map<string, { id: string; ord: number }[]>();
  for (const c of descendants(dm, "cxn")) {
    const type = attr(c, "type") || "parOf";
    if (type !== "parOf") continue;
    const src = attr(c, "srcId") || "", dst = attr(c, "destId") || "";
    if (!text.has(dst)) continue;
    kidsOf.set(src, [...(kidsOf.get(src) || []), { id: dst, ord: Number(attr(c, "srcOrd")) || 0 }]);
  }
  const out: OutlineItem[] = [];
  const seen = new Set<string>();
  const walk = (id: string, level: number) => {
    for (const k of (kidsOf.get(id) || []).sort((a, b) => a.ord - b.ord)) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const t = text.get(k.id) || "";
      if (t) {
        out.push({ text: t, level });
        ids.push(k.id);
      }
      walk(k.id, t ? level + 1 : level);
    }
  };
  if (doc) walk(doc, 0);
  return out;
}

/**
 * A table's style: the flags its tblPr turns on and the style it names, with
 * the look resolved from the deck's tableStyles.xml (or PowerPoint's built-in
 * look when the deck leaves the definition out).
 */
function tableStyleOf(tblPr: XEl | undefined, sc: SlideCtx): TableStyle | undefined {
  const flag = (k: string) => attr(tblPr, k) === "1" || attr(tblPr, k) === "true";
  const flags = { first: flag("firstRow"), last: flag("lastRow"), firstCol: flag("firstCol"), lastCol: flag("lastCol"), bandRow: flag("bandRow"), bandCol: flag("bandCol") };
  const named = (child(tblPr, "tableStyleId")?.text || "").trim().toUpperCase();
  const on = Object.values(flags).some(Boolean);
  // no style named: PowerPoint shows the deck's default only when a part is on
  const id = named || (on ? (sc.deck.tableStyles?.def || DEFAULT_TABLE_STYLE).toUpperCase() : "");
  if (!/^\{[0-9A-F-]{36}\}$/.test(id)) return undefined;
  const ts: TableStyle = { id };
  for (const [k, v] of Object.entries(flags)) if (v) (ts as Record<string, unknown>)[k] = true;
  const builtin = BUILTIN_STYLES.some((b) => b.id === id);
  // our own decks' built-in styles follow the theme, as they did before export
  const def = sc.own && builtin ? undefined : sc.deck.tableStyles?.byId.get(id);
  const accent = sc.colors.scheme.accent1 || "4472C4", text = sc.colors.scheme[sc.colors.map.tx1 || "dk1"] || "000000", bg = sc.colors.scheme[sc.colors.map.bg1 || "lt1"] || "FFFFFF";
  if (def) {
    const look: TableLook = {};
    for (const p of TABLE_PARTS) {
      const el = child(def, PART_TAG[p]);
      if (!el) continue;
      const part: TableLookPart = {};
      const tx = child(el, "tcTxStyle"), st = child(el, "tcStyle");
      if (attr(tx, "b") === "on") part.bold = true;
      const color = colorOf(tx, sc.colors);
      if (color) part.color = color;
      const fill = fillOf(child(st, "fill"), sc.colors) ?? colorOf(child(st, "fillRef"), sc.colors);
      if (fill) part.fill = fill;
      const bdr = child(st, "tcBdr");
      const side = ["insideH", "top", "left", "bottom", "right", "insideV"].map((k) => child(bdr, k)).find(Boolean);
      const ln = child(side, "ln");
      const line = ln ? fillOf(ln, sc.colors) : colorOf(child(side, "lnRef"), sc.colors);
      if (line) part.line = line;
      if (Object.keys(part).length) look[p] = part;
    }
    ts.look = look;
    const name = attr(def, "styleName");
    if (name) ts.name = name;
  } else if (!builtin) {
    // a style PowerPoint has built in that we don't: its usual look
    ts.look = builtinLook(DEFAULT_TABLE_STYLE, accent, text, bg);
  }
  return ts;
}

async function doFrame(fr: XEl, part: Part, sc: SlideCtx, out: Collected, tf: GroupTf) {
  const xf = readXfrm(child(fr, "xfrm"));
  if (!xf) return;
  const gd = path(fr, "graphic", "graphicData");
  const uri = attr(gd, "uri") || "";
  if (uri.endsWith("/table")) {
    const tbl = child(gd, "tbl");
    const tblPr = child(tbl, "tblPr");
    const tstyle = tableStyleOf(tblPr, sc);
    const rows: TableCell[][] = [];
    const chain = makeChain([txStyleFor(sc.master, "other"), sc.defaultTextStyle], sc);
    // the table's text size: the first sized run (cells using it stay plain text)
    const sized = descendants(tbl, "rPr").map((r) => num(r, "sz")).find((v) => v !== undefined);
    const fontSize = sized ? round(sized / 100) : chain(0).sz;
    const tableText = sc.textColor;
    const tableFont = descendants(tbl, "rPr").map((r) => readRun(r, sc).font).find(Boolean);
    const side = (ln: XEl | undefined): CellBorder | undefined => {
      if (!ln) return undefined;
      if (child(ln, "noFill")) return { c: "000000", w: 0 };
      const c = fillOf(ln, sc.colors);
      const w = num(ln, "w");
      if (!c) return w === 0 ? { c: "000000", w: 0 } : undefined;
      return { c, w: w !== undefined ? round(w / EMU_PER_PX) : 1 };
    };
    kids(tbl, "tr").forEach((tr, ri) => {
      const row: TableCell[] = [];
      for (const tc of kids(tr, "tc")) {
        const tcPr = child(tc, "tcPr");
        if (attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1") {
          row.push({ text: "", merged: true });
          continue;
        }
        const tcFill = fillOf(tcPr, sc.colors);
        const paras = paragraphs(child(tc, "txBody") || tc, { chain, scale: 1, defaultColor: tableText, defaultPt: fontSize, defaultFont: tableFont }, sc);
        const cell: TableCell = { text: paras.map((p) => p.text).join("\n") };
        const runs = descendants(tc, "r").filter((r) => child(r, "t")?.text);
        const runStyles = runs.map((r) => ({ ...chain(0), ...strip(readRun(child(r, "rPr"), sc)) }));
        if (tcFill) cell.fill = tcFill;
        if (runStyles.length && runStyles.every((st) => st.b)) cell.bold = true;
        const own = runs.map((r) => readRun(child(r, "rPr"), sc).color);
        const c0 = own[0];
        if (c0 && c0 !== tableText && own.every((c) => c === c0)) cell.color = c0;
        // keep the formatting as rich text when it is more than the cell-wide bold/colour
        let html = parasToHtml(paras.map((p) => ({ ...p, align: undefined })));
        if (cell.bold) html = html.replace(/<\/?strong>/g, "");
        if (cell.color) html = html.replace(new RegExp(`color: #${cell.color.toLowerCase()};? ?`, "g"), "");
        html = html.replace(/ style="\s*"/g, "").replace(/<span>([\s\S]*?)<\/span>/g, "$1");
        const plain = paras.map((p) => `<p>${escapeHtml(p.text)}</p>`).join("");
        if (html && html !== plain) cell.html = html;
        const al = paras[0]?.align;
        if (al === "center" || al === "right") cell.align = al;
        const anchor = attr(tcPr, "anchor");
        if (anchor === "t") cell.valign = "top";
        else if (anchor === "b") cell.valign = "bottom";
        const gs = num(tc, "gridSpan"), rs = num(tc, "rowSpan");
        if (gs && gs > 1) cell.cs = gs;
        if (rs && rs > 1) cell.rs = rs;
        const bd: NonNullable<TableCell["bd"]> = {};
        const sides = [["t", "lnT"], ["r", "lnR"], ["b", "lnB"], ["l", "lnL"]] as const;
        for (const [k, n] of sides) {
          const b = side(child(tcPr, n));
          if (b) bd[k] = b;
        }
        if (Object.keys(bd).length) cell.bd = bd;
        row.push(cell);
      }
      rows.push(row);
    });
    // the most common 1px line becomes the table's border; cell sides equal to it are left implicit
    const tally = new Map<string, number>();
    for (const r of rows) for (const c of r) for (const b of Object.values(c.bd || {})) if (b && b.w === 1) tally.set(b.c, (tally.get(b.c) || 0) + 1);
    const border = tstyle ? undefined : [...tally].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (border)
      for (const r of rows)
        for (const c of r) {
          if (!c.bd) continue;
          for (const k of ["t", "r", "b", "l"] as const) if (c.bd[k]?.w === 1 && c.bd[k]?.c === border) delete c.bd[k];
          if (!Object.keys(c.bd).length) delete c.bd;
        }
    const colW = kids(child(tbl, "tblGrid"), "gridCol").map((g) => round((num(g, "w") ?? 0) / EMU_PER_PX));
    const rowH = kids(tbl, "tr").map((tr) => round((num(tr, "h") ?? 0) / EMU_PER_PX));
    const even = (v: number[]) => v.every((x) => Math.abs(x - v[0]) < 1);
    if (rows.length)
      out.els.push({
        id: genId("e"),
        z: out.els.length + 1,
        type: "table",
        rows: normalizeTable(rows),
        ...(fontSize ? { fontSize } : {}),
        ...(border && border !== "BFBFBF" ? { border } : {}),
        ...(colW.length && colW.every((v) => v > 0) && !even(colW) ? { colW } : {}),
        ...(rowH.length === rows.length && rowH.every((v) => v > 0) && !even(rowH) ? { rowH } : {}),
        ...(tstyle ? { tstyle } : {}),
        ...place(xf, tf),
      });
    return;
  }
  if (uri.endsWith("/diagram")) {
    // SmartArt: import PowerPoint's saved drawing as one group of editable shapes;
    // without a drawing, lay the data model's text out as a similar diagram.
    const relIds = child(gd, "relIds");
    const relOf = (k: string) => {
      const id = relIds ? nsAttr(relIds, k) : undefined;
      const r = id ? part.rels[id] : undefined;
      return r && !r.external ? r.target : undefined;
    };
    const dataPath = relOf("dm");
    const dataPart = dataPath ? await loadPart(sc.deck, dataPath) : null;
    // the data part names its drawing (a relationship of the slide) in dsp:dataModelExt
    const extRel = attr(descendants(dataPart?.xml, "dataModelExt")[0], "relId");
    const dPath = (extRel && part.rels[extRel] && !part.rels[extRel].external ? part.rels[extRel].target : undefined) || (!dataPart ? relOfType(part, "/diagramDrawing") : undefined);
    const dPart = dPath ? await loadPart(sc.deck, dPath) : null;
    const tree = path(dPart?.xml, "spTree");
    const before = out.els.length;
    // the data model: its outline, and (from other applications) the parts to write back
    const lo = relOf("lo");
    const loPart = lo ? await loadPart(sc.deck, lo) : null;
    const loId = attr(loPart?.xml, "uniqueId") || "";
    const kind = kindOfLayout(loId) || smartArtKind(loId);
    const outline = dataPart ? smartArtOutlineIds(dataPart.xml) : { items: [], ids: [] };
    const raw = async (k: string) => {
      const t = relOf(k);
      return t ? await sc.deck.zip.file(t)?.async("string") : undefined;
    };
    const keepSrc = !sc.own && outline.items.length && dataPath && lo ? { data: (await raw("dm"))!, layout: (await raw("lo"))!, ...(await raw("qs") ? { qs: (await raw("qs"))! } : {}), ...(await raw("cs") ? { cs: (await raw("cs"))! } : {}), ids: outline.ids, items: outline.items } : undefined;
    const src = keepSrc?.data && keepSrc.layout && keepSrc.data.length + keepSrc.layout.length < 400_000 ? keepSrc : undefined;
    const accent = sc.colors.scheme.accent1 || "4472C4";
    if (dPart && tree) {
      const inner: GroupTf = (b) => tf({ x: b.x + xf.x, y: b.y + xf.y, w: b.w, h: b.h });
      await walkTree(tree, dPart, sc, out, inner, false);
      if (outline.items.length && out.els.length > before) {
        // live: the first shape carries the data model; each text shape names the items it shows
        const lead = out.els[before];
        if (lead.type === "shape") lead.dgm = { kind, items: outline.items, accent, ...(src ? { src } : {}) };
        const taken = new Set<number>();
        for (let k = before; k < out.els.length; k++) {
          const e = out.els[k];
          if (e.type !== "shape" || !e.html) continue;
          const dpt: number[] = [];
          for (const t of paragraphTexts(e.html)) {
            const ix = outline.items.findIndex((it, j) => !taken.has(j) && it.text.trim() === t);
            if (ix < 0) continue;
            taken.add(ix);
            dpt.push(ix);
          }
          if (dpt.length) e.dpt = dpt;
        }
      }
    } else if (dataPart) {
      if (outline.items.length) {
        const g = genId("g");
        for (const e of buildDiagram(kind, outline.items, place(xf, tf), accent, g, src)) out.els.push({ ...e, id: genId("e"), z: out.els.length + 1 } as SlideElement);
        sc.deck.warnings.add("A SmartArt graphic without a saved drawing was rebuilt from its text.");
      }
    } else sc.deck.warnings.add("A SmartArt graphic had no saved drawing and was skipped.");
    // one group for the whole graphic (nested groups inside it flatten); a one-shape graphic too,
    // so that inside a group of the slide's it is still told apart from its neighbours
    if (out.els.length - before >= 1) {
      const g = genId("g");
      for (let k = before; k < out.els.length; k++) out.els[k].group = g;
    }
    return;
  }
  if (uri.endsWith("/chart") || uri.includes("chart")) {
    const chartRef = child(gd, "chart") || descendants(gd, "chart")[0];
    const rel = part.rels[attr(chartRef, "id") || ""];
    const chartPart = rel && !rel.external && rel.type.endsWith("/chart") ? await loadPart(sc.deck, rel.target) : null;
    const chart = chartPart ? readChart(chartPart.xml, sc) : null;
    if (chart) out.els.push({ id: genId("e"), z: out.els.length + 1, ...chart, ...place(xf, tf) });
    else {
      sc.deck.warnings.add("An unsupported chart or a chart without saved data was shown as a placeholder.");
      out.els.push({ id: genId("e"), z: out.els.length + 1, type: "shape", shape: "rect", fill: "F1F5F9", line: "CBD5E1", lineW: 1, html: `<p style="text-align: center">Chart</p>`, valign: "middle", ...place(xf, tf) });
    }
    return;
  }
  // OLE objects etc.: use the fallback picture when there is one.
  const p = descendants(fr, "pic")[0];
  if (p) await doPic(p, part, sc, out, tf, xf);
  else sc.deck.warnings.add("Some embedded objects could not be shown and were skipped.");
}

// --------------------------------------------------------------- background

async function backgroundOf(part: Part | undefined, sc: SlideCtx): Promise<{ bg?: string; bgImg?: string; bgGrad?: Gradient } | undefined> {
  const bg = path(part?.xml, "cSld", "bg");
  if (!bg || !part) return undefined;
  const bgPr = child(bg, "bgPr");
  if (bgPr) {
    const blip = path(bgPr, "blipFill", "blip");
    if (blip) {
      const rel = part.rels[attr(blip, "embed") || ""];
      const src = rel && !rel.external ? await mediaDataUrl(sc.deck, rel.target) : null;
      if (src) return { bgImg: src };
    }
    const f = fillOf(bgPr, sc.colors);
    const g = gradientOf(bgPr, sc.colors);
    return f ? { bg: f, ...(g ? { bgGrad: g } : {}) } : { bg: "FFFFFF" };
  }
  const ref = child(bg, "bgRef");
  if (ref) {
    const c = colorOf(ref, sc.colors);
    // bgRef idx points into the theme's background fill list; resolve it when it's a plain fill
    const idx = num(ref, "idx") ?? 0;
    if (idx >= 1001) {
      const themePath = relOfType(sc.master, "/theme");
      const theme = themePath ? await loadPart(sc.deck, themePath) : null;
      const lst = kids(path(theme?.xml, "themeElements", "fmtScheme", "bgFillStyleLst"));
      const item = lst[idx - 1001];
      if (item) {
        const wrap: XEl = { name: "w", local: "w", attrs: {}, text: "", children: [item] };
        const f = fillOf(wrap, sc.colors, c);
        const g = gradientOf(wrap, sc.colors, c);
        if (f) return { bg: f, ...(g ? { bgGrad: g } : {}) };
      }
    }
    if (c) return { bg: c };
  }
  return undefined;
}

/** Title/body placeholder boxes and the title/body text look a master or layout gives its slides. */
function placeholderLook(part: Part, sc: SlideCtx, W: number, H: number): Partial<Slide> {
  const out: Partial<Slide> = {};
  const tree = path(part.xml, "cSld", "spTree");
  const sps = descendants(tree, "sp");
  const find = (fam: string) => sps.find((x) => { const p = phOf(child(x, "nvSpPr")); return p && phFamily(p.type) === fam; });
  const t = find("title"), b = find("body");
  const tx = readXfrm(path(t, "spPr", "xfrm")), bx = readXfrm(path(b, "spPr", "xfrm"));
  const ok = (x: Xform | undefined) => x && x.w > 1 && x.h > 1 && x.x < W && x.y < H;
  if (ok(tx)) out.tbox = { x: round(tx!.x), y: round(tx!.y), w: round(tx!.w), h: round(tx!.h) };
  if (ok(bx)) out.bbox = { x: round(bx!.x), y: round(bx!.y), w: round(bx!.w), h: round(bx!.h) };
  const isMaster = part.xml.local === "sldMaster";
  const lvl = (ph: XEl | undefined, fam: string) => makeChain([path(ph, "txBody", "lstStyle"), ...(isMaster ? [txStyleFor(part, fam)] : [])], sc)(0);
  const ts = lvl(t, "title");
  const tstyle: TitleStyle = strip({ size: ts.sz, color: ts.color, bold: ts.b, font: ts.font });
  if (Object.keys(tstyle).length) out.tstyle = tstyle;
  const bchain = makeChain([path(b, "txBody", "lstStyle"), ...(isMaster ? [txStyleFor(part, "body")] : [])], sc);
  const bs = bchain(0);
  const bstyle: BodyStyle = strip({ size: bs.sz, color: bs.color, font: bs.font });
  // deeper levels, where they differ from the level above
  const lv: (LevelLook | null)[] = [];
  let prev = bs;
  for (let k = 1; k < BODY_LEVELS; k++) {
    const l = bchain(k);
    const d: LevelLook = strip({ size: l.sz !== prev.sz ? l.sz : undefined, color: l.color !== prev.color ? l.color : undefined, font: l.font !== prev.font ? l.font : undefined });
    lv.push(Object.keys(d).length ? d : null);
    prev = l;
  }
  const lvs = mergeLevels({ lv });
  if (lvs) bstyle.lv = lvs;
  if (Object.keys(bstyle).length) out.bstyle = bstyle;
  return out;
}

// ---------------------------------------------------------------- notes

async function notesOf(slide: Part, deck: DeckCtx): Promise<string> {
  const np = relOfType(slide, "/notesSlide");
  const notes = np ? await loadPart(deck, np) : null;
  if (!notes) return "";
  for (const sp of descendants(path(notes.xml, "cSld", "spTree"), "sp")) {
    const ph = phOf(child(sp, "nvSpPr"));
    if (ph?.type !== "body") continue;
    return kids(child(sp, "txBody"), "p")
      .map((p) => p.children.map((r) => (r.local === "br" ? "\n" : r.local === "r" || r.local === "fld" ? child(r, "t")?.text ?? "" : "")).join(""))
      .join("\n")
      .trim();
  }
  return "";
}

// ------------------------------------------------------------ animations

/** An animation's sound from the package: a built-in of ours by its file name, else the file as a data URL. */
async function animSound(part: Part, deck: DeckCtx, ref: { rid: string; name: string }): Promise<AnimSound | undefined> {
  const rel = part.rels[ref.rid];
  if (!rel || rel.external) return undefined;
  const file = rel.target.split("/").pop() || "";
  const own = /^syn-sound-([a-z]+)\.wav$/.exec(file);
  if (own && BUILTIN_SOUNDS.some((b) => b.id === own[1])) return { src: `${BUILTIN_PREFIX}${own[1]}`, name: ref.name.replace(/\.wav$/i, "") };
  const f = deck.zip.file(rel.target);
  if (!f) return undefined;
  const ext = (file.split(".").pop() || "wav").toLowerCase();
  const mime = mimeForExt(ext) || "audio/wav";
  if (!mime.startsWith("audio/")) return undefined;
  return { src: `data:${mime};base64,${await f.async("base64")}`, name: (ref.name || file).replace(/\.\w+$/, "") };
}

async function applyTiming(s: Slide, part: Part, spids: Map<number, string[]>, deck: DeckCtx) {
  const sld = part.xml;
  const mt = readMediaTiming(sld);
  for (const [set, flag] of [[mt.autoplay, "autoplay"], [mt.loop, "loop"]] as const)
    for (const spid of set)
      for (const key of spids.get(spid) || []) {
        const el = s.elements.find((e) => e.id === key);
        if (el?.type === "media") el[flag] = true;
      }
  const { anims, skipped } = readTiming(sld);
  if (skipped) deck.warnings.add("Some emphasis effects were imported as a pulse.");
  const sounds = new Map<string, AnimSound>();
  for (const r of anims)
    if (r.sound && !sounds.has(r.sound.rid)) {
      const snd = await animSound(part, deck, r.sound);
      if (snd) sounds.set(r.sound.rid, snd);
    }
  let order = 0;
  const lists = new Map<string, Anim[]>();
  const builds = new Set<string>(); // paragraph builds collapse into one "by paragraph" effect
  for (const r of anims) {
    const keys = spids.get(r.spid);
    if (!keys?.length) continue;
    keys.forEach((key, k) => {
      if (r.para !== undefined) {
        const b = `${key}|${r.anim.kind || "entr"}|${r.anim.effect}`;
        if (builds.has(b)) return;
        builds.add(b);
      }
      const a: Anim = { ...r.anim, order: ++order, ...(k > 0 ? { start: "with" as const, delay: r.anim.delay } : {}) };
      const tg = r.trigger !== undefined ? spids.get(r.trigger)?.[0] : undefined;
      if (tg) a.trigger = tg.startsWith("body#") ? "body" : tg;
      const snd = r.sound && k === 0 ? sounds.get(r.sound.rid) : undefined;
      if (snd) a.sound = snd;
      if (key === "body" && r.para !== undefined) a.byPara = true;
      lists.set(key, [...(lists.get(key) || []), a]);
    });
  }
  for (const [key, list] of lists) {
    const [first, ...more] = list;
    if (key === "title") {
      s.tanim = first;
      if (more.length) s.tfx = more;
    } else if (key === "body") {
      s.banim = first;
      if (more.length) s.bfx = more;
    } else {
      const el = s.elements.find((e) => e.id === key);
      if (!el) continue;
      el.anim = first;
      if (more.length) el.fx = more;
    }
  }
}

// ---------------------------------------------------------------- entry

function json(v: string | undefined): unknown {
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

const isBox = (b: unknown): b is Box => !!b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => Number.isFinite((b as Record<string, unknown>)[k]));
const HEX6 = /^[0-9A-F]{6}$/i;

/** The SynergyMasters property: placeholder boxes, text styles and backgrounds (objects come from the layout parts). */
export function readMasters(v: unknown): Masters {
  const out: Masters = {};
  if (!v || typeof v !== "object") return out;
  const keys: MasterKey[] = [...MASTER_KEYS.map((k) => k.id), ...Object.keys(v).filter(isCustomKey), ...Object.keys(v).filter(isAddedMaster)];
  for (const id of keys) {
    const o = (v as Record<string, Record<string, unknown>>)[id];
    if (!o || typeof o !== "object") continue;
    const base = isCustomKey(id) && LAYOUTS.some((l) => l.id === o.layout) ? (o.layout as SlideLayout) : masterLayout(id);
    const m: Slide = { id: "", title: "", body: "", notes: "", layout: base, bg: "", bgImg: "", elements: [] };
    if (isCustomKey(id)) m.lname = typeof o.lname === "string" && o.lname ? o.lname.slice(0, 80) : "Custom layout";
    if (isAddedMaster(id)) m.lname = typeof o.lname === "string" && o.lname ? o.lname.slice(0, 80) : "Slide master";
    if (isCustomKey(id) && typeof o.pm === "string" && /^[\w-]{1,40}$/.test(o.pm)) m.pm = o.pm;
    if (o.hideUnder === true) m.hideUnder = true;
    if (isBox(o.tbox)) m.tbox = o.tbox;
    if (isBox(o.bbox)) m.bbox = o.bbox;
    const style = (x: unknown) => {
      if (!x || typeof x !== "object") return undefined;
      const r = x as Record<string, unknown>;
      const st: TitleStyle = {};
      if (typeof r.size === "number" && r.size > 0 && r.size < 400) st.size = r.size;
      if (typeof r.color === "string" && HEX6.test(r.color)) st.color = r.color;
      if (typeof r.font === "string" && r.font.length < 80) st.font = r.font;
      if (typeof r.bold === "boolean") st.bold = r.bold;
      if (r.align === "left" || r.align === "center" || r.align === "right") st.align = r.align;
      return Object.keys(st).length ? st : undefined;
    };
    const ts = style(o.tstyle);
    if (ts) m.tstyle = ts;
    const bs = style(o.bstyle);
    const lv = cleanLevels((o.bstyle as { lv?: unknown } | undefined)?.lv);
    if (bs || lv) m.bstyle = Object.fromEntries(Object.entries({ size: bs?.size, color: bs?.color, font: bs?.font, lv }).filter(([, x]) => x !== undefined));
    if (typeof o.bg === "string" && HEX6.test(o.bg)) m.bg = o.bg;
    const g = o.bgGrad as Gradient | undefined;
    if (g && (g.kind === "linear" || g.kind === "radial") && Number.isFinite(g.angle) && Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.every((st) => HEX6.test(st?.color) && Number.isFinite(st?.pos)))
      m.bgGrad = { kind: g.kind, angle: g.angle, stops: g.stops.map((st) => ({ pos: st.pos, color: st.color })) };
    out[id] = m;
  }
  return out;
}

/** Another writer's footers: positions only where they differ from the usual ones, and only with something to show. */
function foreignHf(hf: DeckCtx["hf"], w: number, h: number): HeaderFooter | undefined {
  const out: HeaderFooter = { ...hf };
  delete out.boxes;
  const def = footerBoxes(w, h);
  const near = (a: Box, b: Box) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) < 4;
  const boxes: FooterBoxes = {};
  for (const k of ["date", "footer", "num"] as const) {
    const b = hf.boxes?.[k];
    if (b && !near(b, def[k])) boxes[k] = { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
  }
  if (Object.keys(boxes).length) out.boxes = boxes;
  return out.num || out.footer || out.date || out.dateAuto ? out : undefined;
}

function hfOf(v: unknown): HeaderFooter | undefined {
  return cleanHf(v);
}

/** Comment authors: legacy p:cmAuthor (numeric ids) and modern p188:author (GUIDs). */
async function commentAuthors(deck: DeckCtx, pres: Part): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of Object.values(pres.rels)) {
    if (r.external || !(r.type.endsWith("/commentAuthors") || r.type.endsWith("/authors"))) continue;
    const part = await loadPart(deck, r.target);
    for (const a of kids(part?.xml, "cmAuthor").concat(kids(part?.xml, "author"))) {
      const id = attr(a, "id");
      if (id !== undefined) out.set(id, attr(a, "name") || "Author");
    }
  }
  return out;
}

const textOf = (body: XEl | undefined) =>
  kids(body, "p")
    .map((p) => descendants(p, "t").map((t) => t.text).join(""))
    .join("\n")
    .trim();

/** A slide's comments: legacy p:cmLst (replies via p15:threadingInfo) and modern p188:cmLst (with replyLst). */
async function readComments(deck: DeckCtx, slide: Part, index: number, authors: Map<string, string>, out: ImportedComment[]) {
  for (const r of Object.values(slide.rels)) {
    if (r.external || !r.type.endsWith("/comments")) continue;
    const part = await loadPart(deck, r.target);
    const legacy = new Map<string, ImportedComment>(); // "authorId:idx" -> thread
    for (const cm of kids(part?.xml, "cm")) {
      const pos = child(cm, "pos");
      const when = Date.parse(attr(cm, "dt") || attr(cm, "created") || "") || 0;
      const author = authors.get(attr(cm, "authorId") || "") || "Author";
      const legacyText = child(cm, "text");
      if (legacyText) {
        const x = (num(pos, "x") ?? 0) / 6, y = (num(pos, "y") ?? 0) / 6; // 1/8 pt -> px
        const msg = { author, text: legacyText.text.trim(), ms: when };
        const parent = descendants(cm, "parentCm")[0];
        const into = parent ? legacy.get(`${attr(parent, "authorId")}:${attr(parent, "idx")}`) : undefined;
        if (into) into.messages.push(msg);
        else {
          const t: ImportedComment = { slide: index, x: round(x), y: round(y), messages: [msg] };
          out.push(t);
          legacy.set(`${attr(cm, "authorId")}:${attr(cm, "idx")}`, t);
        }
        continue;
      }
      // modern comment: position in EMU when present
      const px = (v: number | undefined) => (v === undefined ? 12 : round(v > 20000 ? v / EMU_PER_PX : v));
      const t: ImportedComment = { slide: index, x: px(num(pos, "x")), y: px(num(pos, "y")), messages: [{ author, text: textOf(child(cm, "txBody")), ms: when }] };
      for (const rep of kids(child(cm, "replyLst"), "reply"))
        t.messages.push({ author: authors.get(attr(rep, "authorId") || "") || "Author", text: textOf(child(rep, "txBody")), ms: Date.parse(attr(rep, "created") || "") || 0 });
      t.messages = t.messages.filter((m) => m.text);
      if (t.messages.length) out.push(t);
    }
  }
}

/**
 * Pictures that jump to a slide become zooms when they stand for one: inside
 * a PowerPoint zoom's fallback, or listed in our SynergyZooms property.
 */
function readZooms(deck: DeckCtx, slides: Slide[], paths: string[], own: unknown) {
  if (!deck.jumps?.size) return;
  const ours = own && typeof own === "object" ? (own as Record<string, { kind?: string; ret?: boolean; border?: boolean }>) : {};
  const idOf = new Map(paths.map((p, i) => [p, slides[i].id]));
  for (const s of slides)
    s.elements = s.elements.map((e) => {
      const j = deck.jumps!.get(e);
      const target = j && idOf.get(j.target);
      if (!j || !target || e.type !== "image") return e;
      const mine = Object.prototype.hasOwnProperty.call(ours, e.id) ? ours[e.id] : undefined;
      const kind = mine ? (mine.kind === "section" ? "section" : "slide") : j.zoom?.kind;
      if (!kind) return e;
      const ret = mine ? mine.ret === true : !!j.zoom?.ret;
      const z: ZoomEl = { id: e.id, z: e.z, type: "zoom", kind, target, x: e.x, y: e.y, w: e.w, h: e.h, ...(ret ? { ret: true } : {}), ...(mine?.border === false ? { border: false } : {}), ...(e.group ? { group: e.group } : {}), ...(e.anim ? { anim: e.anim } : {}) };
      return z;
    });
}

/** A picture standing for a 3D model, as the model (turned as `rot`, PowerPoint's am3d:rot). */
function model3dOf(img: SlideElement & { type: "image" }, src: string, rot?: XEl | { rx?: number; ry?: number; rz?: number }, name?: string): Model3dEl {
  const deg = (v: string | undefined) => fromAngle60k(v === undefined ? undefined : Number(v));
  const t = rot && "attrs" in rot ? { rx: deg(attr(rot, "ax")), ry: deg(attr(rot, "ay")), rz: deg(attr(rot, "az")) } : { rx: rot?.rx || 0, ry: rot?.ry || 0, rz: rot?.rz || 0 };
  const { src: poster, crop: _crop, shadow: _shadow, ...rest } = img;
  return { ...rest, type: "model3d", src, poster, ...(t.rx ? { rx: t.rx } : {}), ...(t.ry ? { ry: t.ry } : {}), ...(t.rz ? { rz: t.rz } : {}), ...(name || img.alt ? { name: (name || img.alt)!.slice(0, 120) } : {}) } as Model3dEl;
}

/** Our own 3D models: pictures listed in the SynergyModels property, with the model file in the package. */
async function readModels(deck: DeckCtx, slides: Slide[], own: unknown) {
  if (!own || typeof own !== "object") return;
  const list = own as Record<string, { part?: string; rx?: number; ry?: number; rz?: number; name?: string }>;
  for (const s of slides)
    for (const [k, e] of s.elements.entries()) {
      // already a model (read from its am3d frame): our own name and exact turn win
      const own = Object.prototype.hasOwnProperty.call(list, e.id) ? list[e.id] : undefined;
      if (e.type === "model3d" && own) {
        const t = { rx: normDeg(Number(own.rx) || 0), ry: normDeg(Number(own.ry) || 0), rz: normDeg(Number(own.rz) || 0) };
        const { rx: _x, ry: _y, rz: _z, ...rest } = e;
        s.elements[k] = { ...rest, ...(t.rx ? { rx: t.rx } : {}), ...(t.ry ? { ry: t.ry } : {}), ...(t.rz ? { rz: t.rz } : {}), ...(typeof own.name === "string" ? { name: own.name.slice(0, 120) } : {}) };
        continue;
      }
      const m = e.type === "image" && own ? own : undefined;
      if (!m || e.type !== "image" || typeof m.part !== "string" || !/^ppt\/media\/[\w.-]+\.glb$/.test(m.part)) continue;
      const src = await mediaDataUrl(deck, m.part);
      if (src) s.elements[k] = model3dOf(e, src, { rx: Number(m.rx) || 0, ry: Number(m.ry) || 0, rz: Number(m.rz) || 0 }, typeof m.name === "string" ? m.name : undefined);
    }
}

/** PowerPoint 2010 sections: the first slide of each section carries its name. */
function readSections(pres: XEl, ids: string[], slides: Slide[]) {
  const lst = descendants(child(pres, "extLst"), "sectionLst")[0];
  if (!lst) return;
  for (const sec of kids(lst, "section")) {
    const first = kids(child(sec, "sldIdLst"), "sldId")
      .map((x) => ids.indexOf(attr(x, "id") || ""))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    if (first !== undefined && slides[first].sec === undefined) slides[first].sec = (attr(sec, "name") || "Untitled Section").slice(0, 200);
  }
}

/** Set Up Slide Show (loop, timings, which custom show) and the custom shows. */
async function readShow(deck: DeckCtx, pres: Part, rids: string[], slides: Slide[]): Promise<{ show?: ShowSettings; shows?: CustomShow[] }> {
  const shows: CustomShow[] = [];
  kids(child(pres.xml, "custShowLst"), "custShow").forEach((cs, k) => {
    const ids = kids(child(cs, "sldLst"), "sld")
      .map((x) => rids.indexOf(nsAttr(x, "id") || ""))
      .filter((i) => i >= 0)
      .map((i) => slides[i].id);
    shows.push({ id: `cs${attr(cs, "id") ?? k}`, name: (attr(cs, "name") || `Custom show ${k + 1}`).slice(0, 200), slides: ids });
  });
  const ppPath = relOfType(pres, "/presProps");
  const pp = ppPath ? await loadPart(deck, ppPath) : null;
  const showPr = child(pp?.xml, "showPr");
  const show: ShowSettings = {};
  if (attr(showPr, "loop") === "1" || attr(showPr, "loop") === "true") show.loop = true;
  if (attr(showPr, "useTimings") === "0" || attr(showPr, "useTimings") === "false") show.useTimings = false;
  const cs = child(showPr, "custShow");
  if (cs && shows.some((x) => x.id === `cs${attr(cs, "id")}`)) show.show = `cs${attr(cs, "id")}`;
  return { ...(Object.keys(show).length ? { show } : {}), ...(shows.length ? { shows } : {}) };
}

const sameBox = (a: Box | undefined, b: Box | undefined) =>
  !!a && !!b && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2;

export async function importPptx(data: ArrayBuffer | Uint8Array | Blob): Promise<ImportedDeck> {
  const zip = await JSZip.loadAsync(data);
  const deck: DeckCtx = { zip, parts: new Map(), media: new Map(), warnings: new Set(), hf: {} };
  const pres = await loadPart(deck, "ppt/presentation.xml");
  if (!pres) throw new Error("This file is not a PowerPoint presentation (ppt/presentation.xml is missing).");
  const sz = child(pres.xml, "sldSz");
  const w = round((num(sz, "cx") ?? 12192000) / EMU_PER_PX);
  const h = round((num(sz, "cy") ?? 6858000) / EMU_PER_PX);
  const defaultTextStyle = child(pres.xml, "defaultTextStyle");
  const tsXml = await readText(zip, "ppt/tableStyles.xml");
  if (tsXml) {
    const lst = parseXml(tsXml);
    deck.tableStyles = { byId: new Map(kids(lst, "tblStyle").map((t) => [(attr(t, "styleId") || "").toUpperCase(), t])), def: attr(lst, "def") || undefined };
  }

  // Decks written by our exporter carry their theme as a custom document property.
  const props: Record<string, string> = {};
  const custom = await readText(zip, "docProps/custom.xml");
  if (custom)
    for (const p of kids(parseXml(custom), "property")) {
      const v = p.children[0];
      if (attr(p, "name") && v) props[attr(p, "name") as string] = v.text;
    }
  const ownTheme = props.SynergyTheme;
  const own = !!ownTheme;
  const colors = own ? themeColors(json(props.SynergyColors)) : undefined;
  const ownLook = effectiveTheme(ownTheme, colors);
  const textColor = own ? ownLook.text : "000000";
  const headFont = own ? props.SynergyHeadFont || undefined : undefined;
  // foreign decks: their slide master and layouts become editable masters and custom layouts
  const masters: Masters = own ? readMasters(json(props.SynergyMasters)) : {};
  deck.masters = masters;
  let firstMaster: string | undefined;
  const masterIds = new Map<string, string>(); // master part -> "" (the first) or its added master id
  const masterObjs = new Map<string, { els: SlideElement[]; bg?: Awaited<ReturnType<typeof backgroundOf>> }>();
  const layoutIds = new Map<string, string>();
  const seenLayouts = new Set<string>();

  const sldIds = kids(child(pres.xml, "sldIdLst"), "sldId");
  const slidePaths = sldIds.map((s) => pres.rels[nsAttr(s, "id") || ""]?.target);
  const slideIdOf: string[] = []; // presentation sldId of each imported slide (for sections)
  const slideRidOf: string[] = []; // its relationship id (custom shows list slides by it)
  const slidePathOf: string[] = []; // its part (zooms jump to it)
  const authors = await commentAuthors(deck, pres);
  const comments: ImportedComment[] = [];

  const slides: Slide[] = [];
  let deckFont: string | undefined = own ? props.SynergyFont || undefined : undefined;

  /** A master's theme colours, colour map and fonts. */
  const themeOf = async (master: Part | undefined) => {
    const themePath = relOfType(master, "/theme");
    const theme = themePath ? await loadPart(deck, themePath) : null;
      const scheme: Record<string, string> = {};
      for (const c of kids(path(theme?.xml, "themeElements", "clrScheme"))) {
        const v = colorOf(c, { scheme: {}, map: {} });
        if (v) scheme[c.local] = v;
      }
      const map: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
      const clrMap = child(master?.xml, "clrMap");
      if (clrMap) for (const [k, v] of Object.entries(clrMap.attrs)) if (!k.includes(":")) map[k] = v;
      const fontScheme = path(theme?.xml, "themeElements", "fontScheme");
      const fonts = {
        major: attr(path(fontScheme, "majorFont", "latin"), "typeface") || undefined,
        minor: attr(path(fontScheme, "minorFont", "latin"), "typeface") || undefined,
      };
    return { scheme, map, fonts };
  };
  /** Another application's slide master and layout, as an editable master and custom layout (once each). */
  const registerForeign = async (master: Part, layout: Part, sc0: (part: Part) => SlideCtx) => {
    const sm = sc0(master);
    if (!masterObjs.has(master.path)) {
      const mc: Collected = { els: [], hasTitlePh: false, hasCtrTitle: false, hasBodyPh: false, spids: new Map() };
      await walkTree(path(master.xml, "cSld", "spTree"), master, { ...sm, layout: undefined }, mc, identity, true);
      mc.els.forEach((e, k) => (e.z = k + 1));
      masterObjs.set(master.path, { els: mc.els, bg: await backgroundOf(master, sm) });
    }
    if (!masterIds.has(master.path)) {
      // the first slide master is "master"; each further one an added master
      const mid = firstMaster ? `M${masterIds.size + 1}` : "";
      if (!firstMaster) firstMaster = master.path;
      masterIds.set(master.path, mid);
      const mo = masterObjs.get(master.path)!;
      const m: Slide = { id: "", title: "", body: "", notes: "", layout: "content", bg: mo.bg?.bg || "", bgImg: mo.bg?.bgImg || "", ...(mo.bg?.bgGrad ? { bgGrad: mo.bg.bgGrad } : {}), elements: mid ? mo.els.map((e) => ({ ...e, id: genId("e") })) : mo.els };
      Object.assign(m, placeholderLook(master, sm, w, h));
      if (mid) {
        m.lname = (attr(child(master.xml, "cSld"), "name") || `Slide Master ${masterIds.size}`).slice(0, 80);
        masters[`m:${mid}`] = m;
      } else masters.master = m;
    }
    if (!layoutIds.has(layout.path)) {
      const id = `L${layoutIds.size + 1}`;
      layoutIds.set(layout.path, id);
      const sl = sc0(layout);
      const lc: Collected = { els: [], hasTitlePh: false, hasCtrTitle: false, hasBodyPh: false, spids: new Map() };
      await walkTree(path(layout.xml, "cSld", "spTree"), layout, sl, lc, identity, true);
      const pm = masterIds.get(master.path) || ""; // a layout of an added master
      const hide = attr(layout.xml, "showMasterSp") === "0";
      const els = [...lc.els];
      els.forEach((e, k) => (e.z = k + 1));
      const lbg = await backgroundOf(layout, sl);
      const types = descendants(path(layout.xml, "cSld", "spTree"), "sp").map((x) => phOf(child(x, "nvSpPr"))?.type).filter(Boolean) as string[];
      const hasT = types.some((t) => t === "title" || t === "ctrTitle");
      const hasB = types.some((t) => t === "body" || t === "obj" || t === "subTitle");
      const base: SlideLayout = types.includes("ctrTitle") ? "title" : hasT && hasB ? "content" : hasT ? "titleOnly" : "blank";
      const L: Slide = {
        id: "", title: "", body: "", notes: "", layout: base,
        lname: (attr(child(layout.xml, "cSld"), "name") || `Layout ${layoutIds.size}`).slice(0, 80),
        bg: lbg?.bg || "", bgImg: lbg?.bgImg || "", ...(lbg?.bgGrad ? { bgGrad: lbg.bgGrad } : {}),
        elements: els,
        ...(hide ? { hideUnder: true } : {}),
        ...(pm ? { pm } : {}),
      };
      Object.assign(L, placeholderLook(layout, sl, w, h));
      masters[`c:${id}`] = L;
    }
  };

  for (const [si, sp] of slidePaths.entries()) {
    const slide = sp ? await loadPart(deck, sp) : null;
    if (!slide) continue;
    const layoutPath = relOfType(slide, "/slideLayout");
    const layout = layoutPath ? (await loadPart(deck, layoutPath)) ?? undefined : undefined;
    const masterPath = relOfType(layout, "/slideMaster");
    const master = masterPath ? (await loadPart(deck, masterPath)) ?? undefined : undefined;
    const { scheme, map, fonts } = await themeOf(master);
    if (!own && !deckFont && fonts.minor) deckFont = fonts.minor;
    // runs in the deck's own font are left implicit; our exporter spells the theme font out on every run
    deck.font = deckFont ?? (own ? themeById(ownTheme).font.split(",")[0].trim().replace(/^['"]|['"]$/g, "") : undefined);

    const sc: SlideCtx = { deck, colors: { scheme, map }, fonts, slide, layout, master, defaultTextStyle, own, textColor };
    const sc0 = (part: Part): SlideCtx => ({ ...sc, slide: part });

    // our own layouts carry the master's and the layout's objects
    if (own && masters && layout && !seenLayouts.has(layout.path)) {
      seenLayouts.add(layout.path);
      const lname = attr(child(layout.xml, "cSld"), "name") || "";
      const raw = lname.startsWith("syn-layout-") ? lname.slice(11) : "";
      const key = (raw.startsWith("c-") ? `c:${raw.slice(2)}` : raw) as MasterKey;
      if (raw && (MASTER_KEYS.some((k) => k.id === key) || (isCustomKey(key) && masters[key]))) {
        const lc: Collected = { els: [], hasTitlePh: false, hasCtrTitle: false, hasBodyPh: false, spids: new Map(), recording: true };
        await walkTree(path(layout.xml, "cSld", "spTree"), layout, { ...sc0(layout), slide: layout }, lc, identity, false);
        for (const e of lc.els) {
          const kind = lc.kinds?.get(e.id);
          if (!kind) continue;
          const k: MasterKey = kind === "mel" ? masterKeyOf(key, masters) : key;
          const m = (masters[k] ??= { id: "", title: "", body: "", notes: "", layout: masterLayout(k, masters), bg: "", bgImg: "", elements: [] });
          if (!m.elements.some((x) => x.id === e.id)) m.elements.push({ ...e, z: m.elements.length + 1 });
        }
      }
    }

    if (!own && master && layout) await registerForeign(master, layout, sc0);
    const col: Collected = { els: [], hasTitlePh: false, hasCtrTitle: false, hasBodyPh: false, spids: new Map() };
    // master/layout decoration sits behind the placeholders (z < 0)
    const inherited = col.els.length;
    col.recording = true;
    await walkTree(path(slide.xml, "cSld", "spTree"), slide, sc, col, identity, false);
    col.recording = false;
    // and so does anything drawn before the slide's title/body placeholders
    const before = Math.max(inherited, col.phAt ?? inherited);
    col.els.forEach((e, k) => (e.z = k < inherited ? k + 1 - 10000 : k < before ? k + 1 - 5000 : k + 1 - before));

    const bgr = await backgroundOf(slide, sc);

    // Pick the closest of our layouts and keep the source geometry as overrides.
    let lay: SlideLayout;
    if (col.title?.layoutHint && ["content", "title", "titleOnly", "blank"].includes(col.title.layoutHint)) lay = col.title.layoutHint;
    else if (col.hasCtrTitle) lay = "title";
    else if (col.title && col.body) lay = "content";
    else if (col.title) lay = "titleOnly";
    else if (col.body) lay = "content";
    else lay = "blank";

    const s: Slide = {
      id: genId(),
      title: col.title?.text || "",
      ...(col.title?.html ? { thtml: col.title.html } : {}),
      body: col.body?.html || "",
      notes: await notesOf(slide, deck),
      layout: lay,
      bg: bgr?.bg || "",
      bgImg: bgr?.bgImg || "",
      ...(bgr?.bgGrad ? { bgGrad: bgr.bgGrad } : {}),
      elements: col.els,
    };
    if (!own && layout && layoutIds.has(layout.path)) s.clayout = layoutIds.get(layout.path);
    if (own && layout) {
      const ln = attr(child(layout.xml, "cSld"), "name") || "";
      if (ln.startsWith("syn-layout-c-") && masters[`c:${ln.slice(13)}`]) s.clayout = ln.slice(13);
    }
    if (attr(slide.xml, "showMasterSp") === "0") s.hideUnder = true;
    if (attr(slide.xml, "show") === "0") s.hidden = true;
    // PowerPoint's default is no autofit; ours is shrink-on-overflow for the body
    if (col.body && col.body.fit !== "shrink") s.bodyFit = "none";
    // our own decks: keep only what differs from the slide's layout and master
    const fromMaster = applyMaster({ ...s, elements: [] }, masters);
    const lb = layoutBoxes(lay, w, h);
    const def = { title: fromMaster?.tbox || lb.title, body: fromMaster?.bbox || lb.body };
    if (col.title) {
      if (!sameBox(col.title.box, def.title)) s.tbox = col.title.box;
      const st = { ...col.title.style };
      if (own) {
        const it = fromMaster?.tstyle || {};
        if (st.size === titlePt(fromMaster || s)) delete st.size;
        if ((st.bold ?? false) === (it.bold ?? true)) delete st.bold;
        if (st.font === (it.font || headFont || deck.font)) delete st.font;
        if (!st.color || st.color === (it.color || ownLook.title)) delete st.color;
        if ((st.align || (lay === "title" ? "center" : "left")) === (it.align || (lay === "title" ? "center" : "left"))) delete st.align;
      } else {
        // what the master and layout already give the title
        const it = fromMaster.tstyle || {};
        for (const k of ["size", "color", "font", "bold", "align"] as const) if (st[k] !== undefined && st[k] === it[k]) delete st[k];
        if (st.font === deckFont) delete st.font;
      }
      if (Object.keys(st).length) s.tstyle = st;
    }
    if (col.body) {
      if (!sameBox(col.body.box, def.body)) s.bbox = col.body.box;
      if (col.body.valign && col.body.valign !== "top") s.bodyValign = col.body.valign;
    }
    if (!own && s.bg === "" && !s.bgImg && !fromMaster.bg && !fromMaster.bgImg && !fromMaster.bgGrad) s.bg = "FFFFFF";
    // older exports wrote the theme background onto every slide
    if (own && props.SynergyVersion !== "2" && (s.bg === "FFFFFF" || s.bg === ownLook.bg)) s.bg = "";

    const tr = readTransition(slide.xml);
    if (tr) s.trans = tr;
    await applyTiming(s, slide, col.spids, deck);
    await readComments(deck, slide, slides.length, authors, comments);
    slides.push(s);
    slideIdOf.push(attr(sldIds[si], "id") || "");
    slidePathOf.push(sp || "");
    slideRidOf.push(nsAttr(sldIds[si], "id") || "");
  }
  // layouts no slide uses (and templates with no slides): kept as custom layouts, as PowerPoint keeps them
  if (!own)
    for (const mid of kids(child(pres.xml, "sldMasterIdLst"), "sldMasterId")) {
      const mt = pres.rels[nsAttr(mid, "id") || ""]?.target;
      const master = mt ? await loadPart(deck, mt) : null;
      if (!master) continue;
      const { scheme, map, fonts } = await themeOf(master);
      if (!deckFont && fonts.minor) deck.font = deckFont = fonts.minor;
      for (const r of Object.values(master.rels)) {
        if (!r.type.endsWith("/slideLayout") || r.external) continue;
        const layout = await loadPart(deck, r.target);
        if (!layout || layoutIds.has(layout.path)) continue;
        const sc: SlideCtx = { deck, colors: { scheme, map }, fonts, slide: layout, layout, master, defaultTextStyle, own, textColor };
        await registerForeign(master, layout, (part) => ({ ...sc, slide: part }));
      }
    }
  readSections(pres.xml, slideIdOf, slides);
  readZooms(deck, slides, slidePathOf, own ? json(props.SynergyZooms) : undefined);
  if (own) await readModels(deck, slides, json(props.SynergyModels));
  const showInfo = await readShow(deck, pres, slideRidOf, slides);

  if (!slides.length) {
    // a template: one blank slide on its first layout
    const first = Object.entries(masters).find(([k, m]) => isCustomKey(k) && m && !m.pm);
    slides.push({ id: genId(), title: "", body: "", notes: "", layout: first?.[1]?.layout || "content", bg: "", bgImg: "", elements: [], ...(first ? { clayout: first[0].slice(2) } : {}) });
    deck.warnings.add("The presentation had no slides; a blank one was added.");
  }
  return {
    w,
    h,
    theme: own ? themeById(ownTheme).id : "plain",
    ...(deckFont ? { font: deckFont } : {}),
    ...(headFont ? { headFont } : {}),
    ...(colors ? { colors } : {}),
    ...(hfOf(own ? json(props.SynergyHF) : foreignHf(deck.hf, w, h)) ? { hf: hfOf(own ? json(props.SynergyHF) : foreignHf(deck.hf, w, h)) } : {}),
    ...(Object.keys(masters).length ? { masters } : {}),
    ...(comments.length ? { comments } : {}),
    ...showInfo,
    slides,
    warnings: [...deck.warnings],
  };
}
