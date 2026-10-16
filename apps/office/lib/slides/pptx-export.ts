// .pptx export via PptxGenJS (MIT). Runs in the browser: rich text is walked
// with the DOM into styled PptxGenJS runs (bold/italic/underline/strike/colour/
// size/font/bullets/alignment) so the file matches what is on screen.
//
// Shapes we write carry names (syn-title-<layout>, syn-body, syn-bar) and the
// package carries the deck theme as a custom document property, so our own
// importer can read an exported deck back without loss.
import JSZip from "jszip";
import type PptxGenJS from "pptxgenjs";
import { type Anim, cleanHf, BODY_PT, CHART_COLORS, PX_PER_IN, levelLook, masterFor, masterKeyOf, type BodyStyle, isAddedMaster, isCustomKey, layoutKeyOf, applyMaster, bodyBox, bodyPt, footerBoxes, footerFor, sectionsOf, titleBox, titlePt, toHtml, type CellBorder, type HeaderFooter, type MasterKey, type Masters, type ChartEl, type MathEl, type MediaEl, type Model3dEl, type ShapeEl, type Diagram, type Slide, type SlideElement, type TableEl, type TableLook, type SlideLayout, type ZoomEl, isCombo, titleText, richTitle, htmlText, SLOT_KINDS, type SlotKind } from "./model";
import { BAR_H, effectiveTheme, type Theme, type ThemeColors } from "./themes";
import { patchSlideXml, timingXml, transitionXml, type SoundRef } from "./pptx-anim";
import { BUILTIN_PREFIX, BUILTIN_SOUNDS, soundAsWav } from "./anim-sound";
import { wrapGroups } from "./pptx-group";
import { groupPath, groupTree } from "./selection";
import { cssPt, lineMultiple, safeHref } from "./text";
import { extForMime } from "./media-client";
import { hasCrop, patchBackgroundGradient, patchPartEffects, validGradient, type ShapeFx } from "./effects";
import { PX_TO_CM_POS, initials, type PptxComment } from "./comments";
import { latexPlain } from "./math";
import { wrapMath } from "./pptx-math";
import { custShowLstXml, showPrXml, type CustomShow, type ShowSettings } from "./show";
import { DEFAULT_BORDER, fractions, gridCols, normalizeTable } from "./table";
import { BUILTIN_STYLES, DEFAULT_TABLE_STYLE, lookOf, tblPrXml, tblStyleXml, validTableStyle } from "./table-style";
import { axisOptions, comboGroups, patchSlideCharts } from "./pptx-chart";
import { am3dFraming, glbBounds, type Bounds } from "./model3d";
import { INK_CT, INK_REL, inkContentXml, inkmlXml, strokePoints } from "./pptx-ink";
import { narrationForPowerPoint, playsInPowerPoint } from "./narration";
import { colorsDefXml, dataModelXml, diagramFrameXml, drawingXml, layoutDefXml, modelId, patchDataTexts, sameShape, styleDefXml } from "./pptx-smartart";

type PptxRun = { text: string; options: Record<string, unknown> };

export function cssColorToHex(c: string): string | undefined {
  if (!c) return undefined;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  if (c[0] === "#") {
    const h = c.slice(1);
    return (h.length === 3 ? h.split("").map((x) => x + x).join("") : h).toUpperCase();
  }
  return undefined;
}

/** CSS font-size -> points (pt is stored as-is; px legacy content is converted). */
export function cssSizeToPt(fs: string): number | undefined {
  const n = parseFloat(fs);
  if (!Number.isFinite(n)) return undefined;
  return /pt\s*$/.test(fs) ? n : Math.round(n * 0.75 * 10) / 10;
}

const firstFont = (ff: string) => ff.split(",")[0].trim().replace(/^['"]|['"]$/g, "") || undefined;

type Inline = { text: string; opts: Record<string, unknown> };
function collectInlines(node: Node, active: Record<string, unknown>): Inline[] {
  const out: Inline[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      const text = child.textContent || "";
      if (text) out.push({ text, opts: { ...active } });
    } else if (child.nodeType === 1) {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") {
        out.push({ text: "", opts: { ...active, softBreakBefore: true } });
        return;
      }
      if (tag === "ul" || tag === "ol") return; // nested lists are walked as blocks
      const next = { ...active };
      if (tag === "strong" || tag === "b") next.bold = true;
      if (tag === "em" || tag === "i") next.italic = true;
      if (tag === "u") next.underline = { style: "sng" };
      if (tag === "s" || tag === "strike" || tag === "del") next.strike = "sngStrike";
      const color = cssColorToHex(el.style.color);
      if (color) next.color = color;
      const fs = el.style.fontSize;
      if (fs) {
        const pt = cssSizeToPt(fs);
        if (pt) next.fontSize = pt;
      }
      if (el.style.fontFamily) next.fontFace = firstFont(el.style.fontFamily);
      if (tag === "sub") next.subscript = true;
      if (tag === "sup") next.superscript = true;
      if (tag === "sub" || tag === "sup") delete next[tag === "sub" ? "superscript" : "subscript"];
      const hl = cssColorToHex(el.style.backgroundColor) || (tag === "mark" ? cssColorToHex(el.getAttribute("data-color") || "") || "FFFF00" : undefined);
      if (hl) next.highlight = hl;
      if (tag === "a") {
        const url = safeHref(el.getAttribute("href"));
        if (url) next.hyperlink = { url };
      }
      out.push(...collectInlines(el, next));
    }
  });
  return out;
}

/** `lvl`: default run options of an outline level (0-based), under the run's own formatting. */
export function htmlToPptxRuns(html: string, lvl?: (indent: number) => Record<string, unknown>): PptxRun[] {
  if (!html) return [];
  const container = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!container) return [];
  container.innerHTML = html;
  const runs: PptxRun[] = [];
  const pushBlock = (el: HTMLElement, bullet: false | "bullet" | "number", indent = 0) => {
    const align = (el.style.textAlign as string) || undefined;
    // paragraph spacing rides on every run of the paragraph, like align
    const lh = el.style.lineHeight;
    const para: Record<string, unknown> = {};
    const mult = lineMultiple(lh);
    if (mult) para.lineSpacingMultiple = mult;
    else if (cssPt(lh)) para.lineSpacing = cssPt(lh);
    if (cssPt(el.style.marginTop)) para.paraSpaceBefore = cssPt(el.style.marginTop);
    if (cssPt(el.style.marginBottom)) para.paraSpaceAfter = cssPt(el.style.marginBottom);
    // a <br> becomes a soft line break before the next run
    const merged: Inline[] = [];
    let pendingBr = false;
    for (const r of collectInlines(el, {})) {
      if (r.opts.softBreakBefore && !r.text) {
        pendingBr = merged.length > 0;
        continue;
      }
      const o = { ...r.opts };
      delete o.softBreakBefore;
      merged.push({ text: r.text, opts: pendingBr ? { ...o, softBreakBefore: true } : o });
      pendingBr = false;
    }
    if (!merged.length || merged.every((r) => !r.text)) {
      runs.push({ text: "", options: { breakLine: true, ...para, ...(align ? { align } : {}) } });
      return;
    }
    const base = lvl?.(indent) || {};
    merged.forEach((r, i) => {
      runs.push({
        text: r.text,
        options: {
          ...base,
          ...r.opts,
          ...para,
          ...(align ? { align } : {}),
          ...(bullet && i === 0 ? { bullet: bullet === "number" ? { type: "number" } : true, indentLevel: indent } : {}),
          ...(i === merged.length - 1 ? { breakLine: true } : {}),
        },
      });
    });
  };
  const walk = (nodes: NodeListOf<ChildNode> | ChildNode[], indent = 0) => {
    Array.from(nodes).forEach((node) => {
      if (node.nodeType !== 1) return;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        Array.from(el.children).forEach((li) => {
          // a list item may hold a <p> plus a nested list
          const liEl = li as HTMLElement;
          const para = liEl.querySelector(":scope > p") || liEl;
          const hasText = (para.textContent || "").length > 0 || para !== liEl;
          if (hasText && !(para.textContent === "" && liEl.querySelector(":scope > ul, :scope > ol")))
            pushBlock(para as HTMLElement, tag === "ol" ? "number" : "bullet", indent);
          liEl.querySelectorAll(":scope > ul, :scope > ol").forEach((nested) => walk([nested], indent + 1));
        });
      } else {
        pushBlock(el, false, indent);
      }
    });
  };
  walk(container.childNodes);
  // the last paragraph must not add an empty line after it
  if (runs.length) delete runs[runs.length - 1].options.breakLine;
  return runs;
}

export type DeckInfo = {
  name: string;
  w: number;
  h: number;
  theme: string;
  font?: string;
  headFont?: string;
  colors?: ThemeColors;
  hf?: HeaderFooter;
  masters?: Masters;
  /** open comment threads, written as PowerPoint comments */
  comments?: PptxComment[];
  /** Set Up Slide Show settings and custom shows */
  show?: ShowSettings;
  shows?: CustomShow[];
  /** shrink-on-overflow scales as laid out (slide id -> element id or "body" -> 0..1), written as autofit font scales */
  fitScales?: Record<string, Record<string, number>>;
  /** pictures of the slides zooms point at (zoom element id -> PNG/JPEG data URL), drawn before export */
  zoomThumbs?: Record<string, string>;
};

/** A light grey picture for a zoom whose slide could not be drawn. */
export const ZOOM_PLACEHOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGN4+vw1SYhhVMOg0AAAy8GHAPpxx6IAAAAASUVORK5CYII=";

/** What a zoom picture needs: the slide number of each slide id and the zoom thumbnails. */
type ZoomCtx = { slideNo: Map<string, number>; thumbs: Record<string, string> };

/** The SynergyZooms property: zoom element id -> its settings (the target travels as the picture's slide link). */
export function zoomsProp(slides: Slide[]): string | undefined {
  const out: Record<string, { kind: ZoomEl["kind"]; ret?: boolean; border?: boolean }> = {};
  for (const s of slides) for (const e of s.elements) if (e.type === "zoom") out[e.id] = { kind: e.kind, ...(e.ret ? { ret: true } : {}), ...(e.border === false ? { border: false } : {}) };
  return Object.keys(out).length ? JSON.stringify(out) : undefined;
}

/**
 * Writes the scale our layout shrank each overflowing text box to as
 * PowerPoint's autofit font scale, so other applications open it at the size
 * shown here instead of overflowing until the text is edited.
 */
export function patchAutofit(xml: string, scales: Record<string, number> | undefined): string {
  if (!scales) return xml;
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    const nm = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(sp)?.[1];
    const key = nm === "syn-body" ? "body" : nm?.startsWith("syn-el-") ? nm.slice(7) : undefined;
    const v = key ? scales[key] : undefined;
    if (!v || v >= 1) return sp;
    const pct = Math.max(1000, Math.min(100000, Math.round(v * 100) * 1000));
    return sp.replace(/<a:normAutofit\/>|<a:normAutofit [^>]*\/>/, `<a:normAutofit fontScale="${pct}"/>`);
  });
}

/**
 * The slide master's body text levels in the deck's look (what PowerPoint
 * gives new text and shows in its Slide Master view): every level at the
 * body size unless its own is set, in its colour.
 */
export function patchBodyStyle(xml: string, bs: BodyStyle | undefined): string {
  return xml.replace(/<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/, (body) =>
    body.replace(/<a:lvl(\d)pPr\b([^>]*)>([\s\S]*?)<\/a:lvl\1pPr>/g, (_m, n: string, at: string, inner: string) => {
      // levels 6 to 9 look like level 5
      const l = { size: bs?.size, color: bs?.color, ...levelLook(bs, Number(n)) };
      let x = inner.replace(/(<a:defRPr\b[^>]*?)\ssz="\d+"/, `$1 sz="${Math.round((l.size || BODY_PT) * 100)}"`);
      if (l.color) x = x.replace(/(<a:defRPr\b[^>]*>)<a:solidFill>[\s\S]*?<\/a:solidFill>/, `$1<a:solidFill><a:srgbClr val="${l.color}"/></a:solidFill>`);
      return `<a:lvl${n}pPr${at}>${x}</a:lvl${n}pPr>`;
    }),
  );
}

/** Split runs whose text holds line breaks into one paragraph per line. */
export function notesParagraphs(xml: string): string {
  return xml.replace(/<a:r>(<a:rPr[^>]*\/>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>)?<a:t>([^<]*)<\/a:t><\/a:r>/g, (m, rPr: string | undefined, text: string) => {
    if (!/\r?\n/.test(text)) return m;
    return text
      .split(/\r?\n/)
      .map((line) => `<a:r>${rPr || ""}<a:t>${line}</a:t></a:r>`)
      .join(`<a:endParaRPr lang="en-US" dirty="0"/></a:p><a:p>`);
  });
}

/** What our importer needs back from the masters: everything but their objects (those are shapes in the layout parts). */
export function mastersProp(m: Masters | undefined): string | undefined {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (!v) continue;
    const o: Record<string, unknown> = {};
    if (v.tbox) o.tbox = v.tbox;
    if (v.bbox) o.bbox = v.bbox;
    if (v.tstyle && Object.keys(v.tstyle).length) o.tstyle = v.tstyle;
    if (v.bstyle && Object.keys(v.bstyle).length) o.bstyle = v.bstyle;
    if (v.bg) o.bg = v.bg;
    if (v.bgGrad) o.bgGrad = v.bgGrad;
    if (v.hideUnder) o.hideUnder = true;
    if (isCustomKey(k)) Object.assign(o, { layout: v.layout, lname: v.lname || "", ...(v.pm ? { pm: v.pm } : {}) });
    if (isAddedMaster(k)) o.lname = v.lname || "";
    if (Object.keys(o).length) out[k] = o;
  }
  return Object.keys(out).length ? JSON.stringify(out) : undefined;
}

const inch = (px: number) => Math.round((px / PX_PER_IN) * 10000) / 10000;
const box = (b: { x: number; y: number; w: number; h: number }) => ({ x: inch(b.x), y: inch(b.y), w: inch(b.w), h: inch(b.h) });
const stripData = (src: string) => src.replace(/^data:/, "");

/** Build the .pptx and return its bytes. */
export async function buildPptx(slides: Slide[], deck: DeckInfo): Promise<ArrayBuffer> {
  const PptxGen = (await import("pptxgenjs")).default;
  const pptx = new PptxGen();
  const theme = effectiveTheme(deck.theme, deck.colors);
  const font = deck.font || firstFont(theme.font);
  const headFont = deck.headFont || font;
  pptx.defineLayout({ name: "SYNDECK", width: inch(deck.w), height: inch(deck.h) });
  pptx.layout = "SYNDECK";
  pptx.title = deck.name;
  (pptx as unknown as { theme: unknown }).theme = { headFontFace: headFont, bodyFontFace: font };

  // One PowerPoint layout per layout in use, carrying the master's and the
  // layout's background and objects (named syn-mel-/syn-lel-<id>).
  const masters = deck.masters || {};
  // PowerPoint layout names: syn-layout-<layout> or syn-layout-c-<custom id>
  const partName = (k: MasterKey) => `syn-layout-${k.replace(":", "-")}`;
  // every layout a slide uses, and every custom layout (so added masters and their objects come back)
  const used = [...new Set([...slides.map((s) => layoutKeyOf(s, masters)), ...(Object.keys(masters) as MasterKey[]).filter((k) => isCustomKey(k) && masters[k])])];
  for (const lay of used) {
    const M = masterFor(lay, masters), L = masters[lay];
    const src = L?.bg || L?.bgImg || L?.bgGrad ? L : M;
    pptx.defineSlideMaster({
      title: partName(lay),
      background: src?.bgImg ? { data: stripData(src.bgImg) } : { color: src?.bg || theme.bg },
    } as never);
  }
  /** Draw the master/layout objects into the layouts with the Slide methods (a master's own objects only take plain text). */
  const fillLayouts = (proto: Record<string | symbol, unknown>) => {
    const layouts = (pptx as unknown as { slideLayouts: { _name: string }[] }).slideLayouts;
    for (const lay of used) {
      const M = masterFor(lay, masters), L = masters[lay];
      const objs = [...(L?.hideUnder ? [] : M?.elements || []).map((e) => ({ e, kind: "mel" })), ...(L?.elements || []).map((e) => ({ e, kind: "lel" }))];
      const target = layouts.find((l) => l._name === partName(lay));
      if (!objs.length || !target) continue;
      const asSlide = new Proxy(target, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : proto[k]) }) as unknown as PSlide;
      for (const { e, kind } of objs) if (e.type !== "table" && e.type !== "media" && e.type !== "zoom" && !e.slot) addElement(asSlide, e, { color: theme.text, font, size: 18 }, `syn-${kind}-${e.id}`);
    }
  };

  const media = await loadMedia([...slides.flatMap((x) => x.elements), ...Object.values(masters).flatMap((m) => m?.elements || [])]);
  const hf = deck.hf;
  const fb = footerBoxes(deck.w, deck.h, hf);
  const zc: ZoomCtx = { slideNo: new Map(slides.map((x, k) => [x.id, k + 1])), thumbs: deck.zoomThumbs || {} };
  for (const [i, raw] of slides.entries()) {
    const s = applyMaster(raw, masters, i + 1);
    const slide = pptx.addSlide({ masterName: partName(layoutKeyOf(s, masters)) });
    if (i === 0) fillLayouts(Object.getPrototypeOf(slide));
    // the slide's own background only; an inherited one comes from its layout
    if (raw.bgImg) slide.background = { data: stripData(raw.bgImg) };
    else if (raw.bg) slide.background = { color: raw.bg };
    if (s.hidden) slide.hidden = true;
    if (theme.bar) slide.addShape("rect", { x: 0, y: 0, w: inch(deck.w), h: inch(BAR_H), fill: { color: theme.accent }, objectName: `syn-bar-${theme.id}` } as never);
    const bs = s.bstyle || {};
    const body = { color: bs.color || theme.text, font: bs.font || font, size: bodyPt(s) };
    const text = { color: theme.text, font, size: 18 };
    // objects with z < 0 sit behind the placeholders
    for (const e of s.elements) if (e.z < 0) addElement(slide, e, text, undefined, media, zc);
    const tb = titleBox(s, deck.w, deck.h);
    if (tb) {
      const ts = s.tstyle || {};
      // a title with formatted runs (a bold word, a coloured word, a link) keeps them
      const th = s.thtml && titleText(s.thtml) === s.title && richTitle(s.thtml) ? htmlToPptxRuns(s.thtml) : [];
      slide.addText((th.length ? th : s.title || "") as never, {
        ...box(tb),
        fontSize: titlePt(s),
        bold: ts.bold ?? true,
        color: ts.color || theme.title,
        fontFace: ts.font || headFont,
        align: ts.align || (s.layout === "title" ? "center" : "left"),
        valign: s.layout === "title" ? "bottom" : "middle",
        objectName: `syn-title-${s.layout}`,
      } as never);
    }
    const bb = bodyBox(s, deck.w, deck.h);
    // deeper outline levels in their master/layout look
    const runs = htmlToPptxRuns(toHtml(s.body), (k) => {
      if (k < 1) return {};
      const l = levelLook(s.bstyle, k + 1);
      return { ...(l.size ? { fontSize: l.size } : {}), ...(l.color ? { color: l.color } : {}), ...(l.font ? { fontFace: l.font } : {}) };
    });
    if (bb && runs.length)
      slide.addText(runs as never, {
        ...box(bb),
        fontSize: body.size,
        color: body.color,
        fontFace: body.font,
        valign: s.bodyValign || (s.layout === "title" ? "top" : "top"),
        align: s.layout === "title" ? "center" : undefined,
        fit: s.bodyFit === "none" ? "none" : "shrink",
        objectName: "syn-body",
      } as never);

    for (const e of s.elements) if (e.z >= 0) addElement(slide, e, text, undefined, media, zc);
    const f = footerFor(s, hf);
    const small = { fontSize: 12, color: theme.text, fontFace: font, valign: "middle" };
    if (f?.date) slide.addText(f.date, { ...box(fb.date), ...small, align: "left", objectName: "syn-dt" } as never);
    if (f?.footer) slide.addText(f.footer, { ...box(fb.footer), ...small, align: "center", objectName: "syn-ftr" } as never);
    if (f?.num) slide.slideNumber = { ...box(fb.num), fontSize: 12, color: theme.text, fontFace: font, align: "right", valign: "middle" } as never;
    if (s.notes.trim()) slide.addNotes(s.notes);
  }
  const models = await loadModels(slides);
  const raw = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const ms = mastersProp(deck.masters);
  return finishPackage(raw, slides, {
    SynergyTheme: theme.id,
    // 2: a slide part has a background only when the slide sets its own
    SynergyVersion: "2",
    ...(deck.font ? { SynergyFont: deck.font } : {}),
    ...(deck.headFont ? { SynergyHeadFont: deck.headFont } : {}),
    ...(deck.colors ? { SynergyColors: JSON.stringify(deck.colors) } : {}),
    ...(deck.hf ? { SynergyHF: JSON.stringify(deck.hf) } : {}),
    ...(ms ? { SynergyMasters: ms } : {}),
    ...(zoomsProp(slides) ? { SynergyZooms: zoomsProp(slides)! } : {}),
    ...(models.size ? { SynergyModels: modelsProp(slides, models) } : {}),
  }, theme, deck.comments || [], deck.masters || {}, { show: deck.show || {}, shows: deck.shows || [] }, deck.fitScales || {}, models);
}

type PSlide = PptxGenJS.Slide;

/** A 3D model's file in the package: ppt/media/model3d<n>.glb. */
type ModelPart = { part: string; bytes: Uint8Array };
const MODEL3D_REL = "http://schemas.microsoft.com/office/2017/06/relationships/model3d";

/** The GLB of every 3D model on the slides, keyed by src (unreachable ones are left as their pictures). */
async function loadModels(slides: Slide[]): Promise<Map<string, ModelPart>> {
  const out = new Map<string, ModelPart>();
  for (const e of slides.flatMap((s) => s.elements)) {
    if (e.type !== "model3d" || out.has(e.src)) continue;
    try {
      const r = await fetch(e.src, { credentials: "same-origin" });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) out.set(e.src, { part: `ppt/media/model3d${out.size + 1}.glb`, bytes });
    } catch {
      // kept as its picture
    }
  }
  return out;
}

/** The SynergyModels property: model element id -> its file in the package and its turn. */
export function modelsProp(slides: Slide[], models: Map<string, ModelPart>): string {
  const out: Record<string, { part: string; rx?: number; ry?: number; rz?: number; name?: string }> = {};
  for (const s of slides)
    for (const e of s.elements) {
      const m = e.type === "model3d" ? models.get(e.src) : undefined;
      if (e.type !== "model3d" || !m) continue;
      out[e.id] = { part: m.part, ...(e.rx ? { rx: e.rx } : {}), ...(e.ry ? { ry: e.ry } : {}), ...(e.rz ? { rz: e.rz } : {}), ...(e.name ? { name: e.name } : {}) };
    }
  return JSON.stringify(out);
}

/** The model files, related from each slide that shows them (as PowerPoint relates its own 3D models). */
async function writeModels(zip: JSZip, slides: Slide[], models: Map<string, ModelPart>) {
  if (!models.size) return;
  for (const m of models.values()) zip.file(m.part, m.bytes);
  const ct = (await zip.file("[Content_Types].xml")?.async("string")) || "";
  if (!/Extension="glb"/i.test(ct)) zip.file("[Content_Types].xml", ct.replace("<Default ", '<Default Extension="glb" ContentType="model/gltf.binary"/><Default '));
  for (const [i, s] of slides.entries()) {
    const used = [...new Set(s.elements.flatMap((e) => (e.type === "model3d" && models.get(e.src) ? [models.get(e.src)!.part] : [])))];
    for (const [k, part] of used.entries()) await addRel(zip, `ppt/slides/_rels/slide${i + 1}.xml.rels`, `rIdSynM3d${k + 1}`, MODEL3D_REL, `../media/${part.split("/").pop()}`);
  }
}

const AM3D = "http://schemas.microsoft.com/office/drawing/2017/model3d";
/** PowerPoint's default 3D lighting (one ambient light and three point lights), as it writes it. */
const AM3D_LIGHTS =
  '<am3d:ambientLight><am3d:clr><a:scrgbClr r="50000" g="50000" b="50000"/></am3d:clr><am3d:illuminance n="500000" d="1000000"/></am3d:ambientLight>' +
  '<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="100000" g="75000" b="50000"/></am3d:clr><am3d:intensity n="9765625" d="1000000"/><am3d:pos x="21959998" y="70920001" z="16344003"/></am3d:ptLight>' +
  '<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="40000" g="60000" b="95000"/></am3d:clr><am3d:intensity n="12250000" d="1000000"/><am3d:pos x="-37964106" y="51130435" z="57631972"/></am3d:ptLight>' +
  '<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="86837" g="72700" b="100000"/></am3d:clr><am3d:intensity n="3125000" d="1000000"/><am3d:pos x="-37739122" y="58056624" z="-34769649"/></am3d:ptLight>';

/** A positive ratio as PowerPoint writes it: n/d with d = 1000000. */
const ratio = (v: number) => `n="${Math.max(1, Math.round(v * 1_000_000))}" d="1000000"`;

/**
 * A 3D model as PowerPoint's own am3d:model3d graphic frame, with the
 * picture kept as the mc:Fallback for applications without 3D (and as the
 * raster PowerPoint shows until it has drawn the model).
 */
export function nativeModelXml(pic: string, e: Model3dEl, modelRid: string, bounds: Bounds | null): string {
  const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
  const nv = /<p:cNvPr [^>]*?(\/>|>[\s\S]*?<\/p:cNvPr>)/.exec(pic)?.[0];
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic), ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
  if (!embed || !nv || !off || !ext) return pic;
  const rot = /<a:xfrm\b[^>]*\brot="(-?\d+)"/.exec(pic)?.[1];
  const flip = (/<a:xfrm\b[^>]*\bflipH="1"/.test(pic) ? ' flipH="1"' : "") + (/<a:xfrm\b[^>]*\bflipV="1"/.test(pic) ? ' flipV="1"' : "");
  const f = am3dFraming(bounds);
  const a60k = (d: number | undefined) => {
    const v = Math.round((((d || 0) % 360) + 360) % 360 * 60000);
    return v >= 21600000 ? 0 : v;
  };
  const cx = Number(ext[1]), cy = Number(ext[2]);
  const model =
    `<am3d:model3d r:embed="${modelRid}">` +
    `<am3d:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></am3d:spPr>` +
    `<am3d:camera><am3d:pos x="0" y="0" z="${f.camZ}"/><am3d:up dx="0" dy="36000000" dz="0"/><am3d:lookAt x="0" y="0" z="0"/><am3d:perspective fov="2700000"/></am3d:camera>` +
    `<am3d:trans><am3d:meterPerModelUnit ${ratio(f.mpu)}/><am3d:preTrans dx="${f.pre[0]}" dy="${f.pre[1]}" dz="${f.pre[2]}"/>` +
    `<am3d:scale><am3d:sx n="1000000" d="1000000"/><am3d:sy n="1000000" d="1000000"/><am3d:sz n="1000000" d="1000000"/></am3d:scale>` +
    `<am3d:rot ax="${a60k(e.rx)}" ay="${a60k(e.ry)}" az="${a60k(e.rz)}"/><am3d:postTrans dx="0" dy="0" dz="0"/></am3d:trans>` +
    `<am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="${embed}"/></am3d:raster>` +
    `<am3d:objViewport viewportSz="${Math.round(Math.hypot(cx, cy))}"/>` +
    AM3D_LIGHTS +
    `</am3d:model3d>`;
  const frame =
    `<p:graphicFrame><p:nvGraphicFramePr>${nv}<p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm${rot ? ` rot="${rot}"` : ""}${flip}><a:off x="${off[1]}" y="${off[2]}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${AM3D}">${model}</a:graphicData></a:graphic></p:graphicFrame>`;
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:am3d="${AM3D}" Requires="am3d">${frame}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`;
}

const DIAGRAM_CT = {
  data: "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
  layout: "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml",
  quickStyle: "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml",
  colors: "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml",
  drawing: "application/vnd.ms-office.drawingml.diagramDrawing+xml",
};

/**
 * SmartArt: each diagram (a group whose first shape carries the data model)
 * becomes PowerPoint's own SmartArt graphic: a graphic frame with the data
 * model, layout, quick style and colour parts, and the group's shapes as its
 * drawing part. Diagrams whose shapes are animated one by one stay groups.
 */
async function writeDiagrams(zip: JSZip, slides: Slide[]) {
  let n = 0;
  for (const [i, s] of slides.entries()) {
    const leads = s.elements.filter((e): e is ShapeEl => e.type === "shape" && !!e.dgm && !!e.group && validDiagram(e.dgm));
    if (!leads.length) continue;
    const p = `ppt/slides/slide${i + 1}.xml`, relsP = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    let xml = await zip.file(p)?.async("string");
    if (!xml) continue;
    for (const lead of leads) {
      // the graphic is the innermost group around its first shape (it may sit inside a group of the slide's)
      const gid = groupPath(lead).at(-1)!;
      const members = s.elements.filter((e) => groupPath(e).includes(gid)).sort((a, b) => a.z - b.z);
      if (members.some((e) => e.anim || e.fx?.length) || members.some((e) => e.type !== "shape")) continue;
      const names = new Set(members.map((e) => `syn-el-${e.id}`));
      // the group's shapes (one shape, or the p:grpSp around them)
      let frag: string | undefined;
      if (members.length === 1) frag = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((x) => names.has(/<p:cNvPr id="\d+" name="([^"]*)"/.exec(x)?.[1] || ""));
      else
        frag = [...xml.matchAll(/<p:grpSp>(?:(?!<p:grpSp>)[\s\S])*?<\/p:grpSp>/g)].map((m) => m[0]).find((g) => {
          const inside = [...g.matchAll(/<p:cNvPr id="\d+" name="(syn-el-[^"]*)"/g)].map((m) => m[1]);
          return inside.length === names.size && inside.every((x) => names.has(x));
        });
      if (!frag) continue;
      const sps = [...frag.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
      if (sps.length !== members.length) continue;
      const box = members.length === 1 ? /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(frag) : /<p:grpSpPr>\s*<a:xfrm>\s*<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(frag);
      const spid = /<p:cNvPr id="(\d+)"/.exec(frag)?.[1];
      if (!box || !spid) continue;
      n++;
      const d = lead.dgm!;
      const seed = creationId(`${s.id}:${lead.id}`);
      const drawingRel = `rIdSynDgD${n}`;
      const keep = d.src && sameShape(d.src.items, d.items) && d.src.ids.length === d.items.length;
      const loId = d.src ? /\buniqueId="([^"]*)"/.exec(d.src.layout)?.[1] : undefined;
      const fresh = keep ? undefined : dataModelXml(d, seed, drawingRel, loId || undefined);
      const data = keep ? patchDataTexts(d.src!.data, d.src!.ids, d.items, drawingRel) : fresh!.xml;
      const ids = keep ? d.src!.ids : fresh!.ids;
      const byShape = members.map((e, k) => {
        const ix = e.type === "shape" ? e.dpt?.[0] : undefined;
        return ix !== undefined && ids[ix] ? ids[ix] : modelId(seed ^ 0x5a5a5a5a, 1000 + k);
      });
      const parts = {
        data: [`ppt/diagrams/data${n}.xml`, data],
        layout: [`ppt/diagrams/layout${n}.xml`, d.src?.layout || layoutDefXml(d.kind)],
        quickStyle: [`ppt/diagrams/quickStyle${n}.xml`, d.src?.qs || styleDefXml()],
        colors: [`ppt/diagrams/colors${n}.xml`, d.src?.cs || colorsDefXml()],
        drawing: [`ppt/diagrams/drawing${n}.xml`, drawingXml(sps.map((x, k) => ({ xml: x, modelId: byShape[k] })), { x: Number(box[1]), y: Number(box[2]) })],
      } as const;
      const rel: Record<string, string> = {};
      for (const [k, [part, body]] of Object.entries(parts)) {
        zip.file(part, body);
        await addOverride(zip, `/${part}`, DIAGRAM_CT[k as keyof typeof DIAGRAM_CT]);
        const id = k === "drawing" ? drawingRel : `rIdSynDg${k[0]}${n}`;
        const type = k === "drawing" ? "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" : `${REL}/${k === "data" ? "diagramData" : k === "layout" ? "diagramLayout" : k === "quickStyle" ? "diagramQuickStyle" : "diagramColors"}`;
        await addRel(zip, relsP, id, type, `../diagrams/${part.split("/").pop()}`);
        rel[k] = id;
      }
      const frame = diagramFrameXml(`<p:cNvPr id="${spid}" name="Diagram ${n}"/>`, { x: Number(box[1]), y: Number(box[2]) }, { cx: Number(box[3]), cy: Number(box[4]) }, { dm: rel.data, lo: rel.layout, qs: rel.quickStyle, cs: rel.colors });
      xml = xml.replace(frag, frame);
    }
    zip.file(p, xml);
  }
}

/** Pen and highlighter strokes as PowerPoint ink (InkML parts), the freeform kept as the fallback. */
/** Marks what a table's style decides (a colour no one picks: 01 02 03). */
const STYLE_MARK = "010203";

/**
 * Styled tables: the table's tblPr names its style and turns on its parts,
 * the marked cell colours and borders are taken out so the style decides
 * them, and every style used is defined in ppt/tableStyles.xml.
 */
async function writeTableStyles(zip: JSZip, slides: Slide[], theme: { accent: string; text: string; bg: string }) {
  const used = new Map<string, { name: string; look: TableLook }>();
  for (const [i, s] of slides.entries()) {
    const tables = new Map(s.elements.filter((e): e is TableEl => e.type === "table" && validTableStyle(e.tstyle)).map((e) => [`syn-el-${e.id}`, e]));
    if (!tables.size) continue;
    const p = `ppt/slides/slide${i + 1}.xml`;
    const xml = await zip.file(p)?.async("string");
    if (!xml) continue;
    const out = xml.replace(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g, (fr) => {
      const e = tables.get(/<p:cNvPr id="\d+" name="([^"]*)"/.exec(fr)?.[1] || "");
      if (!e || !e.tstyle) return fr;
      const ts = e.tstyle;
      const builtin = BUILTIN_STYLES.find((b) => b.id === ts.id);
      if (!used.has(ts.id)) used.set(ts.id, { name: ts.name || builtin?.name || "Table Style", look: lookOf(ts, theme.accent, theme.text, theme.bg) });
      return fr
        .replace(/<a:tblPr\/>|<a:tblPr\b[^>]*\/>|<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/, tblPrXml(ts))
        .replace(/<a:(ln[LRTB])\b[^>]*>((?:(?!<\/a:ln[LRTB]>)[\s\S])*)<\/a:\1>/g, (ln, _n, body) => (body.includes(`val="${STYLE_MARK}"`) ? "" : ln))
        .replace(new RegExp(`<a:solidFill><a:srgbClr val="${STYLE_MARK}"/></a:solidFill>`, "g"), "");
    });
    if (out !== xml) zip.file(p, out);
  }
  if (!used.size) return;
  const defs = [...used].map(([id, v]) => tblStyleXml(id, v.name, v.look)).join("");
  zip.file("ppt/tableStyles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${DEFAULT_TABLE_STYLE}">${defs}</a:tblStyleLst>`);
}

const AUDIO_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio";

/** Every effect on a slide (title, body and objects). */
const slideAnims = (s: Slide): Anim[] => [s.tanim, ...(s.tfx || []), s.banim, ...(s.bfx || []), ...s.elements.flatMap((e) => [e.anim, ...(e.fx || [])])].filter((a): a is Anim => !!a);

/**
 * The animation sounds as WAV files in ppt/media (PowerPoint embeds
 * animation sounds as WAV): built-ins as syn-sound-<id>.wav, so they come
 * back as built-ins, others numbered. Keyed by the sound's src.
 */
async function writeSounds(zip: JSZip, slides: Slide[]): Promise<Map<string, { file: string; name: string }>> {
  const out = new Map<string, { file: string; name: string }>();
  let n = 0;
  for (const a of slides.flatMap(slideAnims)) {
    const src = a.sound?.src;
    if (!src || out.has(src)) continue;
    const wav = await soundAsWav(src);
    if (!wav) continue;
    const builtin = src.startsWith(BUILTIN_PREFIX) ? BUILTIN_SOUNDS.find((b) => `${BUILTIN_PREFIX}${b.id}` === src) : undefined;
    const file = builtin ? `syn-sound-${builtin.id}.wav` : `syn-sound${++n}.wav`;
    zip.file(`ppt/media/${file}`, wav);
    out.set(src, { file, name: `${(a.sound?.name || builtin?.name || "Sound").replace(/[\\/:*?"<>|]/g, "")}.wav` });
  }
  if (out.size) {
    const ct = (await zip.file("[Content_Types].xml")?.async("string")) || "";
    if (!/Extension="wav"/i.test(ct)) zip.file("[Content_Types].xml", ct.replace("<Default ", '<Default Extension="wav" ContentType="audio/wav"/><Default '));
  }
  return out;
}

async function writeInk(zip: JSZip, slides: Slide[]) {
  let n = 0;
  for (const [i, s] of slides.entries()) {
    const inks = new Map(s.elements.filter((e): e is ShapeEl => e.type === "shape" && !!e.ink && e.shape === "freeform" && !!e.geom && !!e.line).map((e) => [`syn-el-${e.id}`, e]));
    if (!inks.size) continue;
    const p = `ppt/slides/slide${i + 1}.xml`;
    const xml = await zip.file(p)?.async("string");
    if (!xml) continue;
    const parts: { k: number; body: string }[] = [];
    const out = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
      const head = /<p:cNvPr id="(\d+)" name="([^"]*)"/.exec(sp);
      const e = head ? inks.get(head[2]) : undefined;
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(sp), ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp);
      if (!e || !head || !off || !ext) return sp;
      const pts = strokePoints(e.geom!, e);
      if (pts.length < 2) return sp;
      const k = ++n;
      parts.push({ k, body: inkmlXml({ pts, color: e.line!, width: e.lineW ?? 4, hl: e.ink === "hl" }) });
      return inkContentXml(sp, `rIdSynInk${k}`, head[1], head[2], { x: Number(off[1]), y: Number(off[2]) }, { cx: Number(ext[1]), cy: Number(ext[2]) });
    });
    if (!parts.length) continue;
    for (const { k, body } of parts) {
      zip.file(`ppt/ink/ink${k}.xml`, body);
      await addOverride(zip, `/ppt/ink/ink${k}.xml`, INK_CT);
      await addRel(zip, `ppt/slides/_rels/slide${i + 1}.xml.rels`, `rIdSynInk${k}`, INK_REL, `../ink/ink${k}.xml`);
    }
    zip.file(p, out);
  }
}

/** A data model worth writing: a known kind and at least one item. */
function validDiagram(d: Diagram | undefined): boolean {
  return !!d && ["process", "cycle", "hierarchy", "list", "pyramid"].includes(d.kind) && Array.isArray(d.items) && d.items.length > 0 && d.items.every((it) => typeof it?.text === "string" && Number.isFinite(it.level));
}

/** Each model's picture becomes PowerPoint's native 3D model (picture as the fallback). */
async function writeNativeModels(zip: JSZip, slides: Slide[], models: Map<string, ModelPart>) {
  if (!models.size) return;
  const bounds = new Map([...models.values()].map((m) => [m.part, glbBounds(m.bytes)]));
  for (const [i, s] of slides.entries()) {
    const els = new Map(s.elements.filter((e): e is Model3dEl => e.type === "model3d" && models.has(e.src)).map((e) => [`syn-el-${e.id}`, e]));
    if (!els.size) continue;
    const p = `ppt/slides/slide${i + 1}.xml`;
    const xml = await zip.file(p)?.async("string");
    const rels = (await zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`)?.async("string")) || "";
    if (!xml) continue;
    const ridOf = (part: string) => new RegExp(`<Relationship Id="([^"]+)" Type="${MODEL3D_REL}" Target="\\.\\./media/${part.split("/").pop()!.replace(/\./g, "\\.")}"`).exec(rels)?.[1];
    const out = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (pic) => {
      const e = els.get(/<p:cNvPr id="\d+" name="([^"]*)"/.exec(pic)?.[1] || "");
      const m = e ? models.get(e.src) : undefined;
      const rid = m ? ridOf(m.part) : undefined;
      return e && m && rid ? nativeModelXml(pic, e, rid, bounds.get(m.part) ?? null) : pic;
    });
    if (out !== xml) zip.file(p, out);
  }
}

type TextDefaults = { color: string; font: string | undefined; size: number };

/** The bytes of every audio/video element, as PptxGenJS wants them ("<mime>;base64,..."), keyed by src. */
async function loadMedia(els: SlideElement[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of els) {
    if (e.type !== "media" || out.has(e.src)) continue;
    try {
      const r = await fetch(e.src, { credentials: "same-origin" });
      if (!r.ok) continue;
      const blob = await r.blob();
      // a narration recorded as WebM/Opus goes out as AAC in MP4 where the browser can encode it
      if (e.kind === "audio" && e.narration && !playsInPowerPoint(e.mime || blob.type)) {
        const m4a = await narrationForPowerPoint(new Blob([blob], { type: e.mime || blob.type }));
        if (m4a.type === "audio/mp4") {
          out.set(e.src, `audio/mp4;base64,${await toBase64(m4a)}`);
          continue;
        }
      }
      const mime = (e.mime || blob.type || (e.kind === "audio" ? "audio/mpeg" : "video/mp4")).split(";")[0];
      out.set(e.src, `${mime};base64,${await toBase64(blob)}`);
    } catch {
      // unreachable media is exported as its poster picture
    }
  }
  return out;
}

async function toBase64(blob: Blob): Promise<string> {
  const g = globalThis as unknown as { Buffer?: { from(b: ArrayBuffer): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(await blob.arrayBuffer()).toString("base64");
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

function addElement(slide: PSlide, e: SlideElement, t: TextDefaults, name = `syn-el-${e.id}`, media?: Map<string, string>, zc?: ZoomCtx) {
  const textColor = t.color, font = t.font;
  // the element id rides in the shape name so animations (and our importer) can find it
  const geo = { ...box(e), ...(e.rot ? { rotate: e.rot } : {}), ...(e.flipH ? { flipH: true } : {}), ...(e.flipV ? { flipV: true } : {}), objectName: name };
  if (e.type === "image") {
    // a metafile picture goes back as the original EMF/WMF
    const meta = e.orig && /^data:image\/x-(emf|wmf);base64,/.exec(e.orig);
    const data = meta ? e.orig!.replace(/^data:image\/x-(emf|wmf);/, "image/$1;") : stripData(e.src);
    slide.addImage({ data, ...geo, ...(e.alt && !e.deco ? { altText: e.alt } : {}) } as never);
  } else if (e.type === "zoom") {
    // PowerPoint's own zoom fallback: a picture of the slide that jumps to it
    const n = zc?.slideNo.get(e.target);
    const pic = zc?.thumbs[e.id] && /^data:image\/(png|jpeg);base64,/.test(zc.thumbs[e.id]) ? zc.thumbs[e.id] : ZOOM_PLACEHOLDER;
    slide.addImage({ data: stripData(pic), ...geo, altText: e.alt || `${e.kind === "section" ? "Section" : "Slide"} zoom to slide ${n ?? "?"}`, ...(n ? { hyperlink: { slide: n, tooltip: `Slide ${n}` } } : {}) } as never);
  } else if (e.type === "model3d") {
    // the picture PowerPoint shows; the model itself goes into the package beside it (see writeModels)
    const pic = e.poster && /^data:image\/(png|jpeg);base64,/.test(e.poster) ? e.poster : ZOOM_PLACEHOLDER;
    slide.addImage({ data: stripData(pic), ...geo, ...(e.alt && !e.deco ? { altText: e.alt } : { altText: e.name || "3D model" }) } as never);
  } else if (e.type === "media") {
    const data = media?.get(e.src);
    const poster = e.poster && /^data:image\/[\w.+-]+;base64,/.test(e.poster) ? e.poster : undefined;
    if (data) {
      const mime = data.slice(0, data.indexOf(";"));
      slide.addMedia({ type: e.kind, data, extn: extForMime(mime), ...(poster ? { cover: poster } : {}), ...box(e), objectName: name } as never);
    } else if (poster) slide.addImage({ data: stripData(poster), ...geo, altText: e.name || e.kind } as never);
  } else if (e.type === "text") {
    const runs = htmlToPptxRuns(e.html);
    slide.addText((runs.length ? runs : "") as never, { ...geo, fontSize: t.size, color: textColor, fontFace: font, valign: e.valign || "top", ...(e.autofit ? { fit: e.autofit } : {}) } as never);
  } else if (e.type === "shape") {
    const isLine = e.shape === "line" || e.shape === "lineArrow";
    const line = e.line ? { color: e.line, width: Math.round((e.lineW ?? 1.33) * 0.75 * 100) / 100, ...(e.shape === "lineArrow" ? { endArrowType: "triangle" } : {}) } : undefined;
    const fill = e.fill && !isLine ? { color: e.fill } : undefined;
    const runs = e.html ? htmlToPptxRuns(e.html) : [];
    slide.addText((runs.length ? runs : "") as never, {
      ...geo,
      shape: isLine ? "line" : e.shape === "freeform" ? "rect" : e.shape,
      ...(fill ? { fill } : {}),
      ...(line ? { line } : {}),
      fontSize: t.size,
      color: textColor,
      fontFace: font,
      align: "center",
      valign: e.valign || "middle",
      ...(e.autofit ? { fit: e.autofit } : {}),
    } as never);
  } else if (e.type === "table") {
    const grid = normalizeTable(e.rows);
    const cols = gridCols(grid);
    const cw = fractions(e.colW, cols).map((f) => inch(e.w * f));
    const rh = fractions(e.rowH, grid.length).map((f) => inch(e.h * f));
    // with a table style, what the style decides is written as a marker colour and
    // taken out again (writeTableStyles), so the style shows through
    const styled = validTableStyle(e.tstyle);
    const side = (b: CellBorder | undefined) =>
      !b ? { type: "solid", pt: 0.75, color: styled ? STYLE_MARK : e.border || DEFAULT_BORDER } : b.w > 0 ? { type: "solid", pt: Math.round(b.w * 0.75 * 100) / 100, color: b.c } : { type: "none" };
    // covered cells are left out: PptxGenJS writes them back as hMerge/vMerge from the spans
    const rows = grid.map((r) =>
      r.filter((c) => !c.merged).map((c) => {
        const runs = c.html ? htmlToPptxRuns(c.html) : [];
        return {
          text: runs.length ? runs : c.text,
          options: {
            ...(c.bold ? { bold: true } : {}),
            ...(c.color ? { color: c.color } : { color: styled ? STYLE_MARK : textColor }),
            ...(c.fill ? { fill: { color: c.fill } } : {}),
            ...(c.align ? { align: c.align } : {}),
            valign: c.valign || "middle",
            ...(c.cs && c.cs > 1 ? { colspan: c.cs } : {}),
            ...(c.rs && c.rs > 1 ? { rowspan: c.rs } : {}),
            border: [side(c.bd?.t), side(c.bd?.r), side(c.bd?.b), side(c.bd?.l)],
          },
        };
      }),
    );
    slide.addTable(rows as never, {
      ...box(e),
      objectName: name,
      colW: cw,
      rowH: rh,
      fontSize: e.fontSize || 14,
      fontFace: font,
      valign: "middle",
    } as never);
  } else if (e.type === "math") {
    // written as Office Math by wrapMath after PptxGenJS; this text is the fallback
    slide.addText(latexPlain(e.latex) || " ", {
      ...geo,
      fontSize: e.size || 28,
      color: /^[0-9a-f]{6}$/i.test(e.color || "") ? e.color : textColor,
      fontFace: "Cambria Math",
      align: "center",
      valign: "middle",
    } as never);
  } else if (e.type === "chart") {
    const categories = e.categories.length ? e.categories : [""];
    const round = e.chartType === "pie" || e.chartType === "doughnut";
    const num = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);
    const series = (round ? e.series.slice(0, 1) : e.series).map((s) => ({ name: s.name, labels: categories, values: categories.map((_, i) => num(s.values[i])) }));
    if (!series.length) return;
    // scatter: PptxGenJS takes the X values as a leading series
    const data = e.chartType === "scatter" ? [{ name: "X", values: categories.map((c) => num(Number(c))) }, ...series.map(({ name, values }) => ({ name, values }))] : series;
    const colors = round ? CHART_COLORS : e.series.map((s, i) => (/^[0-9a-f]{6}$/i.test(s.color || "") ? s.color! : CHART_COLORS[i % CHART_COLORS.length]));
    const grouping = e.stacked ? (e.percent ? "percentStacked" : "stacked") : undefined;
    if (!round && e.chartType !== "scatter" && isCombo(e)) {
      // a combo chart: one chart group per type (and axis), the series in groups; the second value axis on the right
      const groups = comboGroups(e);
      const y2 = groups.some((g) => g.y2);
      const order = groups.flatMap((g) => g.idx);
      slide.addChart(
        groups.map((g) => ({
          type: g.type,
          data: g.idx.map((i) => series[i]),
          options: { ...(g.type === "bar" ? { barDir: e.barDir || "col", barGrouping: g.type === e.chartType && grouping ? grouping : "clustered" } : g.type === e.chartType && grouping ? { barGrouping: grouping } : {}), ...(g.y2 ? { secondaryValAxis: true, secondaryCatAxis: true } : {}) },
        })) as never,
        {
          ...box(e),
          chartColors: order.map((i) => colors[i]),
          showLegend: e.showLegend !== false,
          legendPos: e.legendPos || "b",
          showTitle: !!e.title,
          title: e.title,
          titleFontFace: font,
          titleColor: textColor,
          showValue: !!e.dataLabels,
          ...axisOptions(e, font),
          ...(y2 ? { valAxes: [{ ...axisOptions(e, font) }, { valGridLine: { style: "none" } }], catAxes: [{}, { catAxisHidden: true }] } : {}),
          altText: e.alt || e.title || "Combo chart",
          objectName: name,
        } as never,
      );
      return;
    }
    slide.addChart(e.chartType, data, {
      ...box(e),
      chartColors: colors,
      showLegend: e.showLegend !== false,
      legendPos: e.legendPos || "b",
      showTitle: !!e.title,
      title: e.title,
      titleFontFace: font,
      titleColor: textColor,
      showValue: !!e.dataLabels,
      ...(e.chartType === "bar" ? { barDir: e.barDir || "col", barGrouping: grouping || "clustered" } : {}),
      ...((e.chartType === "line" || e.chartType === "area") && grouping ? { barGrouping: grouping } : {}),
      ...(e.chartType === "doughnut" ? { holeSize: 50 } : {}),
      ...(e.chartType === "scatter" ? { lineSize: 0, lineDataSymbolSize: 7 } : {}),
      ...(round ? {} : axisOptions(e, font)),
      altText: e.alt || e.title || `${e.chartType} chart`,
      objectName: name,
    } as never);
  }
}

const DECO_EXT = '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';

/** Objects marked decorative: PowerPoint's adec:decorative on their cNvPr (screen readers skip them). */
export function patchDecorative(xml: string, els: SlideElement[]): string {
  const deco = new Set(els.filter((e) => e.deco).map((e) => `syn-el-${e.id}`));
  if (!deco.size) return xml;
  return xml.replace(/<p:cNvPr ([^>]*?)(\/>|>([\s\S]*?)<\/p:cNvPr>)/g, (m, attrs: string, _end: string, inner: string | undefined) => {
    const name = /name="([^"]*)"/.exec(attrs)?.[1];
    if (!name || !deco.has(name) || m.includes("adec:decorative")) return m;
    const a = attrs.replace(/\s*descr="[^"]*"/, "");
    return `<p:cNvPr ${a}>${inner ?? ""}${DECO_EXT}</p:cNvPr>`;
  });
}

/** Count the paragraphs PptxGenJS writes for a list of runs. */
function runParagraphs(runs: PptxRun[]): number {
  return runs.length ? runs.filter((r) => r.options.breakLine).length + 1 : 0;
}

/**
 * Post-process the PptxGenJS package: transitions and animations (which it
 * cannot write) go into each slide part, and our deck settings go into
 * custom document properties (docProps/custom.xml).
 */
async function finishPackage(buf: ArrayBuffer, slides: Slide[], props: Record<string, string>, theme: Theme, comments: PptxComment[], masters: Masters = {}, showInfo: { show: ShowSettings; shows: CustomShow[] } = { show: {}, shows: [] }, fit: Record<string, Record<string, number>> = {}, models: Map<string, ModelPart> = new Map()): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  await writeModels(zip, slides, models);
  await writeShow(zip, slides, showInfo.show, showInfo.shows);
  await patchTheme(zip, theme);
  await patchLayouts(zip, masters, theme.text);
  // notes lines as paragraphs (PptxGenJS leaves the line breaks inside one run)
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))) {
    const x = await zip.file(f)!.async("string");
    const y = notesParagraphs(x);
    if (y !== x) zip.file(f, y);
  }
  const mp = "ppt/slideMasters/slideMaster1.xml";
  const mx = await zip.file(mp)?.async("string");
  if (mx) zip.file(mp, patchBodyStyle(mx, masters.master?.bstyle));
  await splitMasters(zip, masters);
  await writeSections(zip, slides);
  await writeComments(zip, comments, slides.length);
  const sounds = await writeSounds(zip, slides);
  const dateAuto = props.SynergyHF ? cleanHf(JSON.parse(props.SynergyHF))?.dateAuto : undefined;
  for (const [i, s] of slides.entries()) {
    const transition = transitionXml(s.trans);
    const mediaEls = s.elements.filter((e): e is MediaEl => e.type === "media");
    const hasAnim = !!(s.tanim || s.banim || s.elements.some((e) => e.anim) || mediaEls.some((e) => e.autoplay || e.loop));
    // this slide's animation sounds, related from its part
    const sndRefs = new Map<string, SoundRef>();
    for (const a of slideAnims(s))
      if (a.sound && sounds.has(a.sound.src) && !sndRefs.has(a.sound.src)) {
        const w = sounds.get(a.sound.src)!;
        const rid = `rIdSynSnd${sndRefs.size + 1}`;
        await addRel(zip, `ppt/slides/_rels/slide${i + 1}.xml.rels`, rid, AUDIO_REL, `../media/${w.file}`);
        sndRefs.set(a.sound.src, { rid, name: w.name });
      }
    // groups, innermost first, so groups inside groups nest
    const tree = singleGroupsOut(groupTree(s.elements));
    const gname = new Map(tree.map((g, k) => [g.id, `Group ${k + 1}`]));
    const groups = new Map(tree.map((g) => [g.id, g.members.map((m) => (m.startsWith("group:") ? `group:${gname.get(m.slice(6))}` : m))]));
    const p = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(p)?.async("string");
    if (!xml) continue;
    let withPh = footerPlaceholders(xml, dateAuto);
    if (mediaEls.length) withPh = fixMediaPics(withPh, mediaEls);
    if (s.hideUnder && !/<p:sld [^>]*showMasterSp=/.test(withPh)) withPh = withPh.replace(/<p:sld /, '<p:sld showMasterSp="0" ');
    withPh = patchPartEffects(withPh, effectsByName(s.elements, "el"));
    withPh = patchDecorative(withPh, s.elements);
    withPh = linkSlots(withPh, s, masters[layoutKeyOf(s, masters)]?.elements || []);
    withPh = patchAutofit(withPh, fit[s.id]);
    if (s.bgGrad && validGradient(s.bgGrad)) withPh = patchBackgroundGradient(withPh, s.bgGrad);
    const mathEls = s.elements.filter((e): e is MathEl => e.type === "math");
    await patchSlideCharts(zip, p, withPh, s.elements.filter((e): e is ChartEl => e.type === "chart"));
    if (!transition && !hasAnim && !groups.size) {
      if (mathEls.length) withPh = wrapMath(withPh, mathEls, theme.text);
      if (withPh !== xml) zip.file(p, withPh);
      continue;
    }
    xml = withPh;
    xml = wrapGroups(xml, [...groups].map(([g, ids]) => ({ name: gname.get(g)!, ids })));
    const ids = new Map<string, number>();
    for (const m of xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)) ids.set(m[2], Number(m[1]));
    const titleId = [...ids].find(([n]) => n.startsWith("syn-title"))?.[1];
    const bodyId = ids.get("syn-body");
    const bodyParas = runParagraphs(htmlToPptxRuns(toHtml(s.body)));
    const timing = hasAnim
      ? timingXml(s, (key) => {
          if (key === "title") return titleId ? { spid: titleId, text: true } : undefined;
          if (key === "body") return bodyId ? { spid: bodyId, text: true } : undefined;
          if (key.startsWith("body#")) {
            const k = Number(key.slice(5));
            return bodyId && k < bodyParas ? { spid: bodyId, para: k, text: true } : undefined;
          }
          const el = s.elements.find((e) => e.id === key);
          const spid = ids.get(`syn-el-${key}`);
          return spid && el ? { spid, text: el.type === "text" || (el.type === "shape" && !!el.html) } : undefined;
        }, mediaEls.flatMap((e) => {
          const spid = ids.get(`syn-el-${e.id}`);
          return spid ? [{ spid, audio: e.kind === "audio", autoplay: !!e.autoplay, loop: !!e.loop }] : [];
        }), (snd) => sndRefs.get(snd.src))
      : "";
    zip.file(p, wrapMath(patchSlideXml(xml, transition, timing), mathEls, theme.text));
  }
  await writeNativeZooms(zip, slides);
  await writeNativeModels(zip, slides, models);
  await writeDiagrams(zip, slides);
  await writeInk(zip, slides);
  await writeTableStyles(zip, slides, theme);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const body = Object.entries(props)
    .map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${esc(k)}"><vt:lpwstr>${esc(v)}</vt:lpwstr></property>`)
    .join("");
  zip.file(
    "docProps/custom.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${body}</Properties>`,
  );
  // PptxGenJS names media content types after the extension (audio/mp3, video/mov)
  const fixCt: Record<string, string> = { "image/emf": "image/x-emf", "image/wmf": "image/x-wmf", "audio/mp3": "audio/mpeg", "audio/m4a": "audio/mp4", "video/mov": "video/quicktime", "video/m4v": "video/mp4", "audio/oga": "audio/ogg", "video/ogv": "video/ogg" };
  const ct = ((await zip.file("[Content_Types].xml")?.async("string")) || "").replace(/ContentType="(audio|video|image)\/(\w+)"/g, (m, a, b) => (fixCt[`${a}/${b}`] ? `ContentType="${fixCt[`${a}/${b}`]}"` : m));
  zip.file("[Content_Types].xml", ct.includes("/docProps/custom.xml") ? ct : ct.replace("</Types>", `<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`));
  const rels = (await zip.file("_rels/.rels")?.async("string")) || "";
  if (!rels.includes("docProps/custom.xml"))
    zip.file("_rels/.rels", rels.replace("</Relationships>", `<Relationship Id="rIdSynCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/**
 * PptxGenJS writes every media object as a video and numbers it from its
 * relationship id (which can clash with other shapes): audio gets audioFile and
 * each media picture a fresh shape id.
 */
function fixMediaPics(xml: string, els: MediaEl[]): string {
  const byName = new Map(els.map((e) => [`syn-el-${e.id}`, e]));
  let next = Math.max(1, ...[...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  return xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (frag) => {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(frag)?.[1];
    const e = name ? byName.get(name) : undefined;
    if (!e) return frag;
    let out = frag.replace(/<p:cNvPr id="\d+"/, `<p:cNvPr id="${next++}"`);
    if (e.kind === "audio") out = out.replace("<a:videoFile ", "<a:audioFile ");
    if (e.name) out = out.replace(/(<p:cNvPr id="\d+" name="[^"]*")/, `$1 descr="${e.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"`);
    return out;
  });
}

/** Gradient fills, shadows and crops of the objects in a part, keyed by their shape names. */
function effectsByName(els: SlideElement[], kind: string): Map<string, ShapeFx> {
  const m = new Map<string, ShapeFx>();
  for (const e of els) {
    const fx: ShapeFx = {};
    if (e.type === "shape") {
      if (e.shape === "freeform" && e.geom) fx.geom = e.geom;
      if (e.lineA !== undefined && e.lineA < 1 && e.line) fx.lineA = e.lineA;
      if (e.grad && validGradient(e.grad)) fx.grad = e.grad;
      if (e.fillA !== undefined && e.fillA < 1 && (e.fill || e.grad)) fx.fillA = e.fillA;
      if (e.shadow) fx.shadow = e.shadow;
    } else if (e.type === "image") {
      if (e.shadow) fx.shadow = e.shadow;
      if (hasCrop(e.crop)) fx.crop = e.crop;
    }
    if (e.type === "text" || e.type === "shape") {
      if (e.cols && e.cols > 1) Object.assign(fx, { cols: e.cols, colGap: e.colGap });
      if (e.wa && Object.keys(e.wa).length) fx.wa = e.wa;
      if (e.warp) fx.warp = e.warp;
    }
    if (Object.keys(fx).length) m.set(`syn-${kind}-${e.id}`, fx);
  }
  return m;
}

/** Effects of the master/layout objects drawn into each syn-layout part, and gradient layout backgrounds. */
async function patchLayouts(zip: JSZip, masters: Masters, textColor = "000000") {
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    let xml = await zip.file(f)!.async("string");
    const name = /<p:cSld name="syn-layout-([\w-]+)"/.exec(xml)?.[1];
    if (!name) continue;
    const lay = (name.startsWith("c-") ? `c:${name.slice(2)}` : name) as MasterKey;
    const L = masters[lay], M = masterFor(lay, masters);
    const fx = new Map([...effectsByName(L?.hideUnder ? [] : M?.elements || [], "mel"), ...effectsByName(L?.elements || [], "lel")]);
    const before = xml;
    xml = patchPartEffects(xml, fx);
    const src = L?.bg || L?.bgImg || L?.bgGrad ? L : M;
    if (src?.bgGrad && validGradient(src.bgGrad)) xml = patchBackgroundGradient(xml, src.bgGrad);
    // equations on the master and the layout, as on slides: OMML with the plain text as fallback
    const maths = (els: SlideElement[] | undefined) => (els || []).filter((e): e is MathEl => e.type === "math");
    xml = wrapMath(xml, maths(L?.hideUnder ? [] : M?.elements), textColor, "mel");
    xml = wrapMath(xml, maths(L?.elements), textColor, "lel");
    xml = slotPlaceholders(xml, L?.elements || []);
    if (xml !== before) zip.file(f, xml);
  }
}

/** Groups of one object are not written as groups: whatever refers to one refers to its object. */
export function singleGroupsOut(tree: { id: string; depth: number; members: string[] }[]) {
  const byId = new Map(tree.map((g) => [g.id, g]));
  const resolve = (m: string, seen = 0): string => {
    const g = m.startsWith("group:") ? byId.get(m.slice(6)) : undefined;
    return g && g.members.length === 1 && seen < 20 ? resolve(g.members[0], seen + 1) : m;
  };
  return tree.filter((g) => g.members.length > 1).map((g) => ({ ...g, members: g.members.map((m) => resolve(m)) }));
}

/** PowerPoint's placeholder type for each slot kind. */
const SLOT_PH: Record<SlotKind, string> = { obj: "obj", text: "body", pic: "pic", chart: "chart", tbl: "tbl", media: "media", dgm: "dgm" };
/** The placeholder index of a layout slot (the slots in order, from 20, clear of PowerPoint's usual 1-19). */
export function slotIdx(layoutEls: SlideElement[], id: string): number | undefined {
  const k = layoutEls.filter((e) => e.slot).findIndex((e) => e.id === id);
  return k < 0 ? undefined : 20 + k;
}

/** A layout's placeholder slots (picture, chart, table, content...) as PowerPoint placeholders with their prompt. */
export function slotPlaceholders(xml: string, els: SlideElement[]): string {
  const slots = els.filter((e) => e.slot);
  if (!slots.length || !xml.includes("</p:spTree>")) return xml;
  let id = Math.max(1, ...[...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1])));
  const E = (n: number) => Math.round(n * 9525);
  const sps = slots.map((e, k) => {
    const prompt = (e.type === "text" ? htmlText(e.html).trim() : "") || SLOT_KINDS.find((x) => x.id === e.slot)!.prompt;
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${++id}" name="syn-slot-${xmlEsc(e.id)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${SLOT_PH[e.slot!]}" idx="${20 + k}"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${E(e.x)}" y="${E(e.y)}"/><a:ext cx="${E(e.w)}" cy="${E(e.h)}"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEsc(prompt)}</a:t></a:r></a:p></p:txBody></p:sp>`
    );
  });
  return xml.replace("</p:spTree>", `${sps.join("")}</p:spTree>`);
}

/**
 * Slide objects that fill a layout slot are that placeholder (p:ph with the
 * slot's index), so PowerPoint's Reset and layout changes keep them in place.
 */
export function linkSlots(xml: string, slide: Slide, layoutEls: SlideElement[]): string {
  const ph = new Map<string, string>();
  for (const e of slide.elements) {
    if (!e.ph) continue;
    const idx = slotIdx(layoutEls, e.ph);
    const slot = layoutEls.find((x) => x.id === e.ph);
    if (idx !== undefined && slot?.slot) ph.set(`syn-el-${e.id}`, `<p:ph type="${SLOT_PH[slot.slot]}" idx="${idx}"/>`);
  }
  if (!ph.size) return xml;
  // the nvPr after the object's cNvPr (sp, pic or graphicFrame)
  return xml.replace(/(<p:cNvPr [^>]*name="(syn-el-[^"]+)"(?:(?!<p:nvPr)[\s\S])*?)<p:nvPr(\s*\/>|>)/g, (m, head: string, name: string, end: string) => {
    const tag = ph.get(name);
    if (!tag) return m;
    ph.delete(name);
    return end.trim() === "/>" ? `${head}<p:nvPr>${tag}</p:nvPr>` : `${head}<p:nvPr>${tag}`;
  });
}

/**
 * Each added slide master as its own p:sldMaster part: PptxGenJS writes one
 * master for every layout, so the layouts of each added master move to a
 * copy of that master (its name, background and body text styles), related
 * from presentation.xml as PowerPoint relates its masters.
 */
export async function splitMasters(zip: JSZip, masters: Masters) {
  const added = (Object.keys(masters) as MasterKey[]).filter((k) => isAddedMaster(k) && masters[k]);
  const m1 = "ppt/slideMasters/slideMaster1.xml", m1rels = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
  let base = await zip.file(m1)?.async("string");
  let baseRels = await zip.file(m1rels)?.async("string");
  const presP = "ppt/presentation.xml", presRelsP = "ppt/_rels/presentation.xml.rels";
  let pres = await zip.file(presP)?.async("string");
  let presRels = await zip.file(presRelsP)?.async("string");
  if (!added.length || !base || !baseRels || !pres || !presRels) return;
  // layout part -> its master key, from the layout names (syn-layout-<key>)
  const layoutOf = new Map<string, MasterKey>();
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
    const name = /<p:cSld name="syn-layout-([\w-]+)"/.exec(await zip.file(f)!.async("string"))?.[1];
    if (!name) continue;
    const key = (name.startsWith("c-") ? `c:${name.slice(2)}` : name) as MasterKey;
    layoutOf.set(f.split("/").pop()!, masterKeyOf(key, masters));
  }
  // ids of masters and layouts share one space above 2^31
  let nextId = Math.max(2147483648, ...[...pres.matchAll(/<p:sldMasterId id="(\d+)"/g), ...base.matchAll(/<p:sldLayoutId id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const theme = /<Relationship [^>]*Type="[^"]*\/theme" Target="([^"]+)"/.exec(baseRels)?.[1];
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let n = 1;
  for (const k of added) {
    const mine = [...layoutOf].filter(([, mk]) => mk === k).map(([f]) => f);
    if (!mine.length || !theme) continue;
    n++;
    const M = masters[k]!;
    // the layouts leave master 1 ...
    const rid = (f: string) => new RegExp(`<Relationship Id="([^"]+)" Type="[^"]*/slideLayout" Target="\\.\\./slideLayouts/${f.replace(/\./g, "\\.")}"/>`).exec(baseRels!);
    const entries: string[] = [];
    const rels: string[] = [`<Relationship Id="rId${mine.length + 1}" Type="${REL}/theme" Target="${theme}"/>`];
    for (const [j, f] of mine.entries()) {
      const r = rid(f);
      if (r) {
        baseRels = baseRels!.replace(r[0], "");
        base = base!.replace(new RegExp(`<p:sldLayoutId id="\\d+" r:id="${r[1]}"/>`), "");
      }
      entries.push(`<p:sldLayoutId id="${nextId++}" r:id="rId${j + 1}"/>`);
      rels.push(`<Relationship Id="rId${j + 1}" Type="${REL}/slideLayout" Target="../slideLayouts/${f}"/>`);
      // ... and point at their own master
      const lr = `ppt/slideLayouts/_rels/${f}.rels`;
      const lx = await zip.file(lr)?.async("string");
      if (lx) zip.file(lr, lx.replace(/Target="\.\.\/slideMasters\/slideMaster1\.xml"/, `Target="../slideMasters/slideMaster${n}.xml"`));
    }
    let x = patchBodyStyle(base!, M.bstyle);
    x = x.replace(/<p:sldLayoutIdLst>[\s\S]*?<\/p:sldLayoutIdLst>/, `<p:sldLayoutIdLst>${entries.join("")}</p:sldLayoutIdLst>`);
    x = x.replace(/<p:cSld(?: name="[^"]*")?>/, `<p:cSld name="${esc(M.lname || "Slide Master")}">`);
    if (M.bg) {
      const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${M.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
      x = /<p:bg>/.test(x) ? x.replace(/<p:bg>[\s\S]*?<\/p:bg>/, bg) : x.replace(/(<p:cSld[^>]*>)/, `$1${bg}`);
    }
    zip.file(`ppt/slideMasters/slideMaster${n}.xml`, x);
    zip.file(`ppt/slideMasters/_rels/slideMaster${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
    await addOverride(zip, `/ppt/slideMasters/slideMaster${n}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml");
    presRels = presRels!.replace("</Relationships>", `<Relationship Id="rIdSynMaster${n}" Type="${REL}/slideMaster" Target="slideMasters/slideMaster${n}.xml"/></Relationships>`);
    pres = pres!.replace("</p:sldMasterIdLst>", `<p:sldMasterId id="${nextId++}" r:id="rIdSynMaster${n}"/></p:sldMasterIdLst>`);
  }
  if (n === 1) return;
  zip.file(m1, base!);
  zip.file(m1rels, baseRels!);
  zip.file(presP, pres!);
  zip.file(presRelsP, presRels!);
}

/** The date and footer text boxes become PowerPoint's date/footer placeholders (Insert > Header & Footer finds them). */
function footerPlaceholders(xml: string, dateAuto?: string): string {
  const kinds: Record<string, string> = { "syn-dt": '<p:ph type="dt" sz="half" idx="10"/>', "syn-ftr": '<p:ph type="ftr" sz="quarter" idx="11"/>' };
  let out = xml.replace(/(<p:nvSpPr>\s*<p:cNvPr [^>]*name="(syn-dt|syn-ftr)"[\s\S]*?)<p:nvPr\s*\/>|(<p:nvSpPr>\s*<p:cNvPr [^>]*name="(syn-dt|syn-ftr)"[\s\S]*?)<p:nvPr>\s*<\/p:nvPr>/g, (m, a, k1, b, k2) => {
    const head = a ?? b;
    const k = k1 ?? k2;
    if (head.includes("</p:nvSpPr>")) return m;
    return `${head}<p:nvPr>${kinds[k]}</p:nvPr>`;
  });
  // an updating date is a date field, which PowerPoint fills in when it shows the slide
  if (dateAuto)
    out = out.replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?name="syn-dt"[\s\S]*?<\/p:sp>/, (sp) =>
      sp.replace(/<a:r>(<a:rPr[^>]*\/>|<a:rPr[^>]*>[\s\S]*?<\/a:rPr>)?<a:t>([\s\S]*?)<\/a:t><\/a:r>/, (_m, rPr = "", t) => `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="${dateAuto}">${rPr}<a:t>${t}</a:t></a:fld>`),
    );
  return out;
}

/** The deck's theme colours and fonts in the package theme (what PowerPoint shows under Design > Variants). */
async function patchTheme(zip: JSZip, theme: Theme) {
  const p = "ppt/theme/theme1.xml";
  let xml = await zip.file(p)?.async("string");
  if (!xml) return;
  const slots: Record<string, string> = { dk1: theme.text, lt1: theme.bg, dk2: theme.title, accent1: theme.accent };
  for (const [slot, hex] of Object.entries(slots))
    xml = xml.replace(new RegExp(`<a:${slot}>[\\s\\S]*?</a:${slot}>`), `<a:${slot}><a:srgbClr val="${hex.toUpperCase()}"/></a:${slot}>`);
  zip.file(p, xml);
}

const xmlEsc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NS_P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function addRel(zip: JSZip, relsPath: string, id: string, type: string, target: string) {
  const rels = (await zip.file(relsPath)?.async("string")) || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  if (!rels.includes(`Target="${target}"`)) zip.file(relsPath, rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
}
async function addOverride(zip: JSZip, part: string, type: string) {
  const ct = (await zip.file("[Content_Types].xml")?.async("string")) || "";
  if (!ct.includes(`PartName="${part}"`)) zip.file("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`));
}

/** Open comment threads as PowerPoint comments (p:cmLst per slide + ppt/commentAuthors.xml). */
async function writeComments(zip: JSZip, list: PptxComment[], count: number) {
  const valid = list.filter((c) => c.slide >= 0 && c.slide < count && c.text);
  if (!valid.length) return;
  const authors = [...new Set(valid.map((c) => c.author || "Author"))];
  const lastIdx = new Map<number, number>();
  const iso = (ms: number) => new Date(ms || Date.now()).toISOString().replace("Z", "");
  const first = new Map<string, string>(); // thread -> its first comment's authorId/idx (replies point at it)
  for (let i = 0; i < count; i++) {
    const mine = valid.filter((c) => c.slide === i);
    if (!mine.length) continue;
    const cms = mine
      .map((c) => {
        const aid = authors.indexOf(c.author || "Author");
        const idx = (lastIdx.get(aid) || 0) + 1;
        lastIdx.set(aid, idx);
        const parent = c.thread ? first.get(c.thread) : undefined;
        if (c.thread && !parent) first.set(c.thread, `authorId="${aid}" idx="${idx}"`);
        const thread = parent
          ? `<p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}"><p15:threadingInfo xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main" timeZoneBias="0"><p15:parentCm ${parent}/></p15:threadingInfo></p:ext></p:extLst>`
          : "";
        return `<p:cm authorId="${aid}" dt="${iso(c.ms)}" idx="${idx}"><p:pos x="${Math.round(c.x * PX_TO_CM_POS)}" y="${Math.round(c.y * PX_TO_CM_POS)}"/><p:text>${xmlEsc(c.text)}</p:text>${thread}</p:cm>`;
      })
      .join("");
    zip.file(`ppt/comments/comment${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst ${NS_P}>${cms}</p:cmLst>`);
    await addOverride(zip, `/ppt/comments/comment${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.comments+xml");
    await addRel(zip, `ppt/slides/_rels/slide${i + 1}.xml.rels`, "rIdSynCm", `${REL}/comments`, `../comments/comment${i + 1}.xml`);
  }
  const list2 = authors
    .map((a, k) => `<p:cmAuthor id="${k}" name="${xmlEsc(a)}" initials="${xmlEsc(initials(a))}" lastIdx="${lastIdx.get(k) || 0}" clrIdx="${k % 8}"/>`)
    .join("");
  zip.file("ppt/commentAuthors.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst ${NS_P}>${list2}</p:cmAuthorLst>`);
  await addOverride(zip, "/ppt/commentAuthors.xml", "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml");
  await addRel(zip, "ppt/_rels/presentation.xml.rels", "rIdSynCmAuthors", `${REL}/commentAuthors`, "commentAuthors.xml");
}

/** A stable, non-zero 32-bit number for a slide (its p14:creationId, which slide zooms point at). */
export function creationId(slideId: string): number {
  let h = 2166136261;
  for (let i = 0; i < slideId.length; i++) h = Math.imul(h ^ slideId.charCodeAt(i), 16777619) >>> 0;
  return h || 1;
}
const hex8 = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");
/** The GUID of section k (1-based) in p14:sectionLst, which section zooms point at. */
export const sectionGuid = (k: number) => `{${hex8(0x5e000000 + k)}-0000-4000-8000-${hex8(k).padStart(12, "0")}}`;
const ZOOM_NS = {
  slide: { prefix: "pslz", uri: "http://schemas.microsoft.com/office/powerpoint/2016/slidezoom", root: "sldZm", obj: "sldZmObj" },
  section: { prefix: "psez", uri: "http://schemas.microsoft.com/office/powerpoint/2016/sectionzoom", root: "sectionZm", obj: "sectionZmObj" },
} as const;
const P166 = "http://schemas.microsoft.com/office/powerpoint/2016/6/main";

/**
 * PowerPoint's own slide and section zooms: each zoom picture (already a
 * picture that jumps to its slide) is wrapped as the fallback of an
 * mc:AlternateContent whose choice is the zoom object, so PowerPoint 2019 and
 * later show a real zoom and other applications the picture. Slides get the
 * p14:creationId that slide zooms refer to.
 */
export function nativeZoomXml(pic: string, z: ZoomEl, ref: { sldId?: string; cId?: number; sectionId?: string }, guid: string): string {
  const k = z.kind === "section" && ref.sectionId ? "section" : "slide";
  if (k === "slide" && (!ref.sldId || !ref.cId)) return pic;
  const ns = ZOOM_NS[k];
  const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
  const nv = /<p:cNvPr [^>]*?(\/>|>[\s\S]*?<\/p:cNvPr>)/.exec(pic)?.[0];
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(pic), ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
  if (!embed || !nv || !off || !ext) return pic;
  // the frame keeps the picture's id and name, without its slide link (the zoom is the link)
  const cNvPr = nv.replace(/<a:hlinkClick [^>]*\/>|<a:hlinkClick [\s\S]*?<\/a:hlinkClick>/g, "");
  const xfrm = `<a:off x="${off[1]}" y="${off[2]}"/><a:ext cx="${ext[1]}" cy="${ext[2]}"/>`;
  const ln = z.border === false ? "" : '<a:ln w="3175"><a:solidFill><a:prstClr val="ltGray"/></a:solidFill></a:ln>';
  const target = k === "section" ? `sectionId="${ref.sectionId}"` : `sldId="${ref.sldId}" cId="${ref.cId}"`;
  const ret = (k === "section" ? z.ret !== false : !!z.ret) ? "1" : "0";
  const zm = `<${ns.prefix}:zmPr id="${guid}" returnToParent="${ret}" transitionDur="1000"><p166:blipFill xmlns:p166="${P166}"><a:blip r:embed="${embed}"/><a:stretch><a:fillRect/></a:stretch></p166:blipFill><p166:spPr xmlns:p166="${P166}"><a:xfrm>${xfrm}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${ln}</p166:spPr></${ns.prefix}:zmPr>`;
  const frame = `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr}<p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm>${xfrm}</p:xfrm><a:graphic><a:graphicData uri="${ns.uri}"><${ns.prefix}:${ns.root}><${ns.prefix}:${ns.obj} ${target}>${zm}</${ns.prefix}:${ns.obj}></${ns.prefix}:${ns.root}></a:graphicData></a:graphic></p:graphicFrame>`;
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:${ns.prefix}="${ns.uri}" Requires="${ns.prefix}">${frame}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`;
}

async function writeNativeZooms(zip: JSZip, slides: Slide[]) {
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  const sldIds = [...(pres?.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] || "").matchAll(/<p:sldId [^>]*id="(\d+)"/g)].map((m) => m[1]);
  if (sldIds.length !== slides.length) return;
  const zoomed = slides.some((s) => s.elements.some((e) => e.type === "zoom"));
  if (!zoomed) return;
  const secs = sectionsOf(slides);
  const index = new Map(slides.map((s, i) => [s.id, i]));
  let n = 0;
  for (const [i, s] of slides.entries()) {
    const p = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(p)?.async("string");
    if (!xml) continue;
    // every slide gets its creation id (a zoom may point at any of them)
    if (!xml.includes("p14:creationId"))
      xml = xml.replace(/<\/p:sld>\s*$/, `<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="${creationId(s.id)}"/></p:ext></p:extLst></p:sld>`);
    const zooms = new Map(s.elements.filter((e): e is ZoomEl => e.type === "zoom").map((e) => [`syn-el-${e.id}`, e]));
    if (zooms.size)
      xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (pic) => {
        const z = zooms.get(/<p:cNvPr id="\d+" name="([^"]*)"/.exec(pic)?.[1] || "");
        const t = z ? index.get(z.target) : undefined;
        if (!z || t === undefined) return pic;
        const sec = secs.findIndex((x) => t >= x.start && t < x.end);
        return nativeZoomXml(pic, z, { sldId: sldIds[t], cId: creationId(slides[t].id), ...(sec >= 0 ? { sectionId: sectionGuid(sec + 1) } : {}) }, `{${hex8(0x2a000000 + ++n)}-0000-4000-8000-${hex8(i + 1).padStart(12, "0")}}`);
      });
    zip.file(p, xml);
  }
}

/** PowerPoint 2010 sections (p14:sectionLst) in presentation.xml. */
async function writeSections(zip: JSZip, slides: Slide[]) {
  const secs = sectionsOf(slides);
  if (!secs.length) return;
  const p = "ppt/presentation.xml";
  const xml = await zip.file(p)?.async("string");
  if (!xml) return;
  const ids = [...(xml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] || "").matchAll(/<p:sldId [^>]*id="(\d+)"/g)].map((m) => m[1]);
  if (ids.length !== slides.length) return;
  const guid = sectionGuid;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const list = secs
    .map((sec, k) => `<p14:section name="${esc(sec.name)}" id="${guid(k + 1)}"><p14:sldIdLst>${ids.slice(sec.start, sec.end).map((id) => `<p14:sldId id="${id}"/>`).join("")}</p14:sldIdLst></p14:section>`)
    .join("");
  const ext = `<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${list}</p14:sectionLst></p:ext>`;
  zip.file(p, xml.includes("<p:extLst>") ? xml.replace("<p:extLst>", `<p:extLst>${ext}`) : xml.replace("</p:presentation>", `<p:extLst>${ext}</p:extLst></p:presentation>`));
}

/** Loop/timings settings (presProps showPr) and custom shows (presentation.xml custShowLst). */
async function writeShow(zip: JSZip, slides: Slide[], show: ShowSettings, shows: CustomShow[]) {
  const live = shows.filter((sh) => sh.slides.some((id) => slides.some((x) => x.id === id)));
  if (!show.loop && show.useTimings !== false && !live.length) return;
  const pp = "ppt/presProps.xml";
  const props = await zip.file(pp)?.async("string");
  if (props) {
    const showPr = showPrXml({ ...show, show: live.some((x) => x.id === show.show) ? show.show : undefined }, live);
    zip.file(pp, /<p:presentationPr\b[^>]*\/>/.test(props) ? props.replace(/<p:presentationPr\b([^>]*)\/>/, `<p:presentationPr$1>${showPr}</p:presentationPr>`) : props.replace(/(<p:presentationPr\b[^>]*>)/, `$1${showPr}`));
  }
  if (!live.length) return;
  const p = "ppt/presentation.xml";
  const xml = await zip.file(p)?.async("string");
  if (!xml) return;
  const rids = [...(xml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] || "").matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  if (rids.length !== slides.length) return;
  const lst = custShowLstXml(live, (id) => rids[slides.findIndex((x) => x.id === id)]);
  // custShowLst comes after notesSz (and before defaultTextStyle)
  const at = xml.search(/<p:notesSz\b[^>]*\/>/);
  if (at < 0) return;
  const end = xml.indexOf(">", at) + 1;
  zip.file(p, xml.slice(0, end) + lst + xml.slice(end));
}

export async function downloadPptx(slides: Slide[], deck: DeckInfo) {
  const buf = await buildPptx(slides, deck);
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(deck.name || "presentation").replace(/[\\/:*?"<>|]+/g, "_")}.pptx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
