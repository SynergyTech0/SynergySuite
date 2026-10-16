// Our own .docx reader (JSZip + a small XML tree), the counterpart of
// docx-export.ts. It turns WordprocessingML into the editor's JSON plus the
// document's styles, sections (page setup, columns, headers and footers),
// settings and comment threads. Runs in the browser and in Node (tests).
import JSZip from "jszip";
import { metafilePlaceholder, metafileToSvg } from "../slides/metafile";
import { parseMergeInstr } from "./mail-merge";
import { readPBdr, readTabs } from "./para-format";
import { matchTheme } from "./design";
import { TABLE_STYLES, readTblLook } from "./tables";
import { fieldKind } from "./doc-fields";
import { readWatermark, readPgBorders, readLnNum, type Watermark } from "./page-design";
import { readSdtPr, readProtection, readBlockSdtPr } from "./protection";
import { parseXml, child, kids, attr, num, descendants, type XEl } from "../slides/xml";
import { parseFieldInstr } from "./fields";
import { ommlToLatex } from "../slides/math";
import { readPlacement, drawingColor, SHAPES } from "./drawing";
import { parseXE, parseIndexInstr } from "./word-index";
import { readChartSpace, readDiagram, CHART_NS, DIAGRAM_NS } from "./word-graphics";
import { parseCitationInstr, parseSources } from "./citations";
import {
  type DocSettings,
  type DocStyle,
  type PMNode,
  type ParaProps,
  type RunProps,
  type Section,
  BUILTIN_STYLES,
  BUILTIN_PROPERTIES,
  HIGHLIGHTS,
  WORD_NAMES,
  cleanStyleId,
  cssFont,
  defaultSection,
  parseSection,
  round,
} from "./model";

export type ImportedComment = {
  key: string;
  resolved: boolean;
  quote: string;
  messages: { author: string; initials?: string; date?: number; body: string }[];
};

export type ImportedDocx = {
  doc: PMNode;
  styles: DocStyle[];
  body: Section;
  settings: DocSettings;
  comments: ImportedComment[];
  /** what was simplified on the way in */
  warnings?: string[];
};

/** Prefix of the placeholder thread ids imported comments carry until they are stored. */
export const IMPORTED_THREAD = "docx-";

type Rels = Record<string, { target: string; type: string; external: boolean }>;
type NumLevel = { fmt: string; text: string; start: number; indent: number };
type Ctx = {
  zip: JSZip;
  dir: string; // folder of the part, e.g. "word/"
  rels: Rels;
  fieldsAsNodes: boolean;
};
type Item = { node: PMNode; list?: { numId: string; ilvl: number } };
type RunOut = RunProps & { rStyle?: string; vertAlign?: "superscript" | "subscript" };

const onOff = (el: XEl | undefined): boolean | undefined => {
  if (!el) return undefined;
  const v = attr(el, "val");
  return !(v === "0" || v === "false" || v === "off");
};
const twPt = (v: number | undefined) => (v === undefined ? undefined : round(v / 20));

function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

async function readXml(zip: JSZip, path: string): Promise<XEl | undefined> {
  const f = zip.file(path);
  if (!f) return undefined;
  return parseXml(await f.async("string"));
}

async function readRels(zip: JSZip, partPath: string): Promise<Rels> {
  const i = partPath.lastIndexOf("/");
  const relsPath = `${partPath.slice(0, i + 1)}_rels/${partPath.slice(i + 1)}.rels`;
  const x = await readXml(zip, relsPath);
  const out: Rels = {};
  for (const r of kids(x, "Relationship")) {
    const id = attr(r, "Id");
    if (id) out[id] = { target: attr(r, "Target") || "", type: attr(r, "Type") || "", external: attr(r, "TargetMode") === "External" };
  }
  return out;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

function toBase64(b: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(b).toString("base64");
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const BORDER_CSS: Record<string, string> = { single: "solid", thick: "solid", dashed: "dashed", dashSmallGap: "dashed", dotDash: "dashed", dotted: "dotted", double: "double", triple: "double" };
function borderCss(b: XEl | undefined): string | undefined {
  if (!b) return undefined;
  const v = attr(b, "val") || "single";
  if (v === "nil" || v === "none") return "none";
  const sz = num(b, "sz") ?? 4;
  const px = Math.max(1, Math.round(((sz / 8) * 4) / 3));
  const c = attr(b, "color");
  return `${px}px ${BORDER_CSS[v] || "solid"} ${c && c !== "auto" ? `#${c.toLowerCase()}` : "#000000"}`;
}

class Reader {
  styles: DocStyle[] = [];
  styleIdMap = new Map<string, string>(); // word id -> our id
  tableStyleBorders = new Map<string, XEl>();
  knownTableStyles = new Map<string, string>(); // Word style id -> built-in table style
  watermark: Watermark | null = null;
  /** open w:permStart ranges (editable exceptions) */
  perms = new Set<string>();
  numbering = new Map<string, { abs: string; overrides: Record<number, number> }>();
  abstract = new Map<string, NumLevel[]>();
  counters = new Map<string, number[]>();
  theme = { major: "Calibri Light", minor: "Calibri" };
  scheme: Record<string, string> = { dk1: "#000000", lt1: "#ffffff", dk2: "#44546a", lt2: "#e7e6e6", accent1: "#4472c4", accent2: "#ed7d31", accent3: "#a5a5a5", accent4: "#ffc000", accent5: "#5b9bd5", accent6: "#70ad47" };
  fieldStack: { instr: string; result: boolean; node?: PMNode; ff?: XEl; para?: number }[] = [];
  paraSerial = 0;
  activeComments: string[] = [];
  /** comments that have a range (the others are anchored at their reference) */
  rangedComments = new Set<string>();
  tableDepth = 0;
  commentRoot = new Map<string, string>(); // word id -> root word id
  commentQuotes = new Map<string, string>();
  tocEmitted = false;
  openBookmarks = new Map<string, PMNode>();
  hiddenSeen = false;
  /** footnotes and endnotes by id, already read into small documents */
  noteDocs: Record<"footnote" | "endnote", Map<string, PMNode>> = { footnote: new Map(), endnote: new Map() };
  async loadNotes(dir: string, rels: Rels) {
    for (const kind of ["footnote", "endnote"] as const) {
      const t = Object.values(rels).find((r) => r.type.endsWith(`/${kind}s`));
      if (!t) continue;
      const path = resolvePath(dir, t.target);
      const x = await readXml(this.zip, path);
      if (!x) continue;
      const ctx: Ctx = { zip: this.zip, dir: path.slice(0, path.lastIndexOf("/") + 1), rels: await readRels(this.zip, path), fieldsAsNodes: false };
      for (const n of kids(x, kind)) {
        const type = attr(n, "type");
        if (type && type !== "normal") continue;
        const saved = { f: this.fieldStack, c: this.activeComments };
        this.fieldStack = [];
        this.activeComments = [];
        const content = this.blocks(n, ctx).map((b) => (b.type === "paragraph" && /^(Footnote|Endnote)Text$/.test(String(b.attrs?.styleId)) ? { ...b, attrs: { ...b.attrs, styleId: null } } : b));
        this.fieldStack = saved.f;
        this.activeComments = saved.c;
        // the space Word puts after the note's own number
        const first = content[0]?.content?.[0];
        if (first?.type === "text" && first.text) {
          first.text = first.text.replace(/^\s+/, "");
          if (!first.text) content[0].content!.shift();
        }
        const doc: PMNode = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
        await this.inlineImages(doc);
        this.noteDocs[kind].set(attr(n, "id") || "", doc);
      }
    }
  }
  /** the tracked change (w:ins / w:del) the runs being read belong to */
  change: { kind: "insertion" | "deletion"; author: string; date: string | null; id: string | null } | null = null;
  /** the letter of a drop-cap frame paragraph, waiting for the paragraph it starts */
  pendingDrop: { kind: string; content: PMNode[] } | null = null;
  warnings = new Set<string>();
  constructor(public zip: JSZip) {}

  // ---- properties ----
  runProps(rPr: XEl | undefined): RunOut {
    const r: RunOut = {};
    if (!rPr) return r;
    for (const c of rPr.children) {
      switch (c.local) {
        case "rStyle": {
          const v = attr(c, "val");
          if (v) r.rStyle = this.styleIdMap.get(v) || cleanStyleId(v);
          break;
        }
        case "rFonts": {
          const f = attr(c, "ascii") || attr(c, "hAnsi");
          const th = attr(c, "asciiTheme") || attr(c, "hAnsiTheme");
          if (f) r.font = f;
          else if (th) r.font = th.startsWith("major") ? this.theme.major : this.theme.minor;
          break;
        }
        case "b":
          r.bold = onOff(c);
          break;
        case "i":
          r.italic = onOff(c);
          break;
        case "strike":
        case "dstrike":
          r.strike = onOff(c);
          break;
        case "caps":
          if (onOff(c)) r.caps = true;
          break;
        case "smallCaps":
          if (onOff(c)) r.smallCaps = true;
          break;
        case "spacing": {
          const v = num(c, "val");
          if (v) r.charSpacing = round(v / 20);
          break;
        }
        case "u": {
          const v = attr(c, "val");
          r.underline = !!v && v !== "none";
          break;
        }
        case "color": {
          const v = attr(c, "val");
          if (v && v !== "auto" && /^[0-9a-fA-F]{6}$/.test(v)) r.color = `#${v.toLowerCase()}`;
          break;
        }
        case "sz": {
          const v = num(c, "val");
          if (v) r.size = v / 2;
          break;
        }
        case "highlight": {
          const v = attr(c, "val");
          if (v && HIGHLIGHTS[v]) r.highlight = HIGHLIGHTS[v];
          break;
        }
        case "shd": {
          const f = attr(c, "fill");
          if (f && f !== "auto" && /^[0-9a-fA-F]{6}$/.test(f) && !r.highlight) r.highlight = `#${f.toLowerCase()}`;
          break;
        }
        case "vertAlign": {
          const v = attr(c, "val");
          if (v === "superscript" || v === "subscript") r.vertAlign = v;
          break;
        }
      }
    }
    return r;
  }

  paraProps(pPr: XEl | undefined): ParaProps & { style?: string; numPr?: { numId?: string; ilvl?: number }; sectPr?: XEl; hr?: boolean; outline?: number; dropCap?: string } {
    const p: ReturnType<Reader["paraProps"]> = {};
    if (!pPr) return p;
    for (const c of pPr.children) {
      switch (c.local) {
        case "pStyle": {
          const v = attr(c, "val");
          if (v) p.style = this.styleIdMap.get(v) || cleanStyleId(v);
          break;
        }
        case "keepNext":
          if (onOff(c)) p.keepNext = true;
          break;
        case "keepLines":
          if (onOff(c)) p.keepLines = true;
          break;
        case "pageBreakBefore":
          if (onOff(c)) p.pageBreakBefore = true;
          break;
        case "numPr": {
          const id = attr(child(c, "numId"), "val");
          const lvl = num(child(c, "ilvl"), "val");
          p.numPr = { numId: id, ilvl: lvl };
          break;
        }
        case "pBdr": {
          const b = child(c, "bottom");
          if (b && attr(b, "val") !== "nil" && attr(b, "val") !== "none") p.hr = true;
          const borders = readPBdr(c as never);
          if (borders) p.borders = borders;
          break;
        }
        case "shd": {
          const f = attr(c, "fill");
          if (f && f !== "auto" && /^[0-9a-fA-F]{6}$/.test(f)) p.shading = `#${f.toLowerCase()}`;
          break;
        }
        case "tabs": {
          const t = readTabs(c as never);
          if (t) p.tabs = t;
          break;
        }
        case "widowControl":
          if (onOff(c) === false) p.widowControl = false;
          break;
        case "framePr": {
          const d = attr(c, "dropCap");
          if (d === "drop" || d === "margin") p.dropCap = `${d}:${num(c, "lines") || 3}`;
          break;
        }
        case "spacing": {
          const before = num(c, "before");
          const after = num(c, "after");
          if (before !== undefined) p.spaceBefore = twPt(before);
          if (after !== undefined) p.spaceAfter = twPt(after);
          const line = num(c, "line");
          if (line) {
            const rule = attr(c, "lineRule") || "auto";
            p.lineHeight = rule === "auto" ? String(round(line / 240, 2)) : rule === "exact" ? `${round(line / 20)}pt` : `min${round(line / 20)}pt`;
          }
          break;
        }
        case "ind": {
          const left = num(c, "left") ?? num(c, "start");
          const right = num(c, "right") ?? num(c, "end");
          const first = num(c, "firstLine");
          const hanging = num(c, "hanging");
          if (left !== undefined) p.indentLeft = twPt(left);
          if (right !== undefined) p.indentRight = twPt(right);
          if (hanging) p.indentFirst = -twPt(hanging)!;
          else if (first !== undefined) p.indentFirst = twPt(first);
          break;
        }
        case "jc": {
          const v = attr(c, "val");
          p.align = v === "center" ? "center" : v === "right" || v === "end" ? "right" : v === "both" || v === "distribute" ? "justify" : "left";
          break;
        }
        case "outlineLvl":
          p.outline = num(c, "val");
          break;
        case "sectPr":
          p.sectPr = c;
          break;
      }
    }
    return p;
  }

  // ---- parts ----
  async loadTheme(dir: string, rels: Rels) {
    const t = Object.values(rels).find((r) => r.type.endsWith("/theme"));
    if (!t) return;
    const x = await readXml(this.zip, resolvePath(dir, t.target));
    const major = attr(child(descendants(x, "majorFont")[0], "latin"), "typeface");
    const minor = attr(child(descendants(x, "minorFont")[0], "latin"), "typeface");
    if (major) this.theme.major = major;
    if (minor) this.theme.minor = minor;
    for (const c of descendants(x, "clrScheme")[0]?.children || []) {
      const v = attr(child(c, "srgbClr"), "val") || attr(child(c, "sysClr"), "lastClr");
      if (v) this.scheme[c.local] = `#${v.toLowerCase()}`;
    }
    Object.assign(this.scheme, { tx1: this.scheme.dk1, bg1: this.scheme.lt1, tx2: this.scheme.dk2, bg2: this.scheme.lt2 });
  }

  /** A shape or text box (wps:wsp) with its placement, look and text. */
  shape(drawing: XEl, ctx: Ctx): PMNode | null {
    const wsp = descendants(drawing, "wsp")[0];
    if (!wsp) return null;
    const spPr = child(wsp, "spPr");
    const style = child(wsp, "style");
    const prst = attr(child(spPr, "prstGeom"), "prst") || "rect";
    const kind = SHAPES.some((s) => s.id === prst) ? prst : prst === "straightConnector1" ? "line" : prst === "ellipse" || prst === "flowChartConnector" ? "ellipse" : prst.startsWith("round") ? "roundRect" : "rect";
    const extent = descendants(drawing, "extent")[0];
    const cx = num(extent, "cx") || 0;
    const cy = num(extent, "cy") || 0;
    const textBox = attr(child(wsp, "cNvSpPr"), "txBox") === "1";
    const refColor = (name: string) => {
      const r = child(style, name);
      const sc = child(r, "schemeClr");
      return r && attr(r, "idx") !== "0" && sc ? this.scheme[attr(sc, "val") || ""] : undefined;
    };
    const ln = child(spPr, "ln");
    const fill = drawingColor(spPr, this.scheme) ?? refColor("fillRef") ?? (textBox ? "#ffffff" : "none");
    const stroke = drawingColor(ln, this.scheme) ?? (ln && !child(ln, "noFill") && !style ? "#000000" : refColor("lnRef")) ?? "none";
    const font = child(style, "fontRef");
    const color = font && child(font, "schemeClr") ? this.scheme[attr(child(font, "schemeClr"), "val") || ""] : undefined;
    const anchor = attr(child(wsp, "bodyPr"), "anchor");
    const tx = descendants(wsp, "txbxContent")[0];
    // the text box's paragraphs are read on their own: keep the outer paragraph's field and visibility state
    const saved = { f: this.fieldStack, h: this.hiddenSeen };
    this.fieldStack = [];
    const content = tx ? this.blocks(tx, ctx) : [];
    this.fieldStack = saved.f;
    this.hiddenSeen = saved.h;
    // one colour on all the text (how shapes are saved): make it the shape's text colour
    let lifted: string | undefined;
    const texts: PMNode[] = [];
    const walk = (n: PMNode) => (n.type === "text" ? texts.push(n) : n.content?.forEach(walk));
    content.forEach(walk);
    const colorOf = (n: PMNode) => n.marks?.find((m) => m.type === "textStyle")?.attrs?.color as string | undefined;
    if (texts.length && texts.every((t) => colorOf(t) && colorOf(t) === colorOf(texts[0]))) {
      lifted = colorOf(texts[0]);
      for (const t of texts)
        t.marks = t.marks!.flatMap((m) => {
          if (m.type !== "textStyle") return [m];
          const { color: _c, ...rest } = m.attrs || {};
          return Object.keys(rest).length ? [{ ...m, attrs: rest }] : [];
        });
    }
    return {
      type: "shape",
      attrs: {
        kind,
        width: Math.round(cx / 9525) || 192,
        height: Math.round(cy / 9525),
        fill,
        stroke,
        strokeWidth: ln && num(ln, "w") ? Math.round((num(ln, "w")! / 12700) * 100) / 100 : 0.75,
        color: lifted || (color && color !== "#000000" ? color : null),
        valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
        textBox,
        wrap: "inline",
        ...readPlacement(drawing),
      },
      content: content.length ? content : [{ type: "paragraph" }],
    };
  }

  /**
   * The text of a VML text box or of a group of shapes, as one borderless text
   * box the size of the drawing (shapes inside a group are not kept apart).
   */
  textFrame(el: XEl, ctx: Ctx): PMNode | null {
    const boxes = descendants(el, "txbxContent");
    if (!boxes.length) return null;
    const saved = { f: this.fieldStack, h: this.hiddenSeen };
    this.fieldStack = [];
    const content = boxes.flatMap((b) => this.blocks(b, ctx));
    this.fieldStack = saved.f;
    this.hiddenSeen = saved.h;
    if (!content.some((n) => JSON.stringify(n).includes('"text"'))) return null;
    const extent = descendants(el, "extent")[0];
    let w = Math.round((num(extent, "cx") || 0) / 9525);
    let h = Math.round((num(extent, "cy") || 0) / 9525);
    if (!w) {
      const vml = [...descendants(el, "group"), ...descendants(el, "shape"), ...descendants(el, "rect"), ...descendants(el, "roundrect")][0];
      const style = attr(vml, "style") || "";
      const pt = (k: string) => {
        const m = new RegExp(`(?:^|;)\\s*${k}:\\s*([\\d.]+)(pt|in|px)?`).exec(style);
        return m ? Math.round(Number(m[1]) * (m[2] === "in" ? 96 : m[2] === "px" ? 1 : 4 / 3)) : 0;
      };
      w = pt("width");
      h = pt("height");
    }
    if (descendants(el, "wgp").length + descendants(el, "group").length) this.warnings.add("Grouped shapes with text were turned into one text box.");
    return {
      type: "shape",
      attrs: { kind: "rect", width: w || 192, height: h, fill: "none", stroke: "none", strokeWidth: 0.75, color: null, valign: "top", textBox: true, wrap: "inline", ...readPlacement(el) },
      content,
    };
  }

  async loadStyles(dir: string, rels: Rels) {
    const t = Object.values(rels).find((r) => r.type.endsWith("/styles"));
    const x = t ? await readXml(this.zip, resolvePath(dir, t.target)) : undefined;
    if (!x) return;
    // map Word's ids to ours: built-ins by (Word) name
    const byName = new Map<string, string>();
    for (const s of BUILTIN_STYLES) byName.set((WORD_NAMES[s.id] || s.name).toLowerCase(), s.id);
    const all = kids(x, "style");
    const used = new Set<string>();
    for (const s of all) {
      const wid = attr(s, "styleId");
      if (!wid) continue;
      const name = (attr(child(s, "name"), "val") || wid).toLowerCase();
      const type = attr(s, "type");
      if (type === "table") {
        const known = TABLE_STYLES.find((t) => t.id.toLowerCase() === wid.toLowerCase() || t.name.toLowerCase() === name);
        if (known) this.knownTableStyles.set(wid, known.id);
        const b = descendants(child(s, "tblPr"), "tblBorders")[0];
        if (b) this.tableStyleBorders.set(wid, b);
        continue;
      }
      if (type !== "paragraph" && type !== "character") continue;
      if (attr(s, "default") === "1" && type === "character") continue; // Default Paragraph Font
      const h = /^heading ([1-6])$/.exec(name);
      let id = h ? `Heading${h[1]}` : type === "paragraph" ? byName.get(name) : byName.get(name);
      if (id && BUILTIN_STYLES.find((b) => b.id === id)?.type !== type) id = undefined;
      if (!id) {
        id = cleanStyleId(wid);
        while (used.has(id)) id += "_";
      }
      used.add(id);
      this.styleIdMap.set(wid, id);
    }
    const dd = child(x, "docDefaults");
    const defRun = this.runProps(child(child(dd, "rPrDefault"), "rPr"));
    const defPara = this.paraProps(child(child(dd, "pPrDefault"), "pPr"));
    delete defRun.rStyle;
    for (const s of all) {
      const wid = attr(s, "styleId");
      const type = attr(s, "type");
      if (!wid || (type !== "paragraph" && type !== "character") || !this.styleIdMap.has(wid)) continue;
      const id = this.styleIdMap.get(wid)!;
      const builtin = BUILTIN_STYLES.find((b) => b.id === id);
      const run = this.runProps(child(s, "rPr"));
      delete run.rStyle;
      const pp = type === "paragraph" ? this.paraProps(child(s, "pPr")) : {};
      const { style: _s, numPr: _n, sectPr: _x, hr: _h, outline: _o, ...para } = pp;
      void _s, _n, _x, _h, _o;
      const basedOnW = attr(child(s, "basedOn"), "val");
      const nextW = attr(child(s, "next"), "val");
      const style: DocStyle = {
        id,
        name: builtin?.name || attr(child(s, "name"), "val") || wid,
        type,
        run,
        ...(type === "paragraph" ? { para } : {}),
      };
      if (basedOnW && this.styleIdMap.has(basedOnW)) style.basedOn = this.styleIdMap.get(basedOnW);
      if (nextW && this.styleIdMap.has(nextW)) style.next = this.styleIdMap.get(nextW);
      if (child(s, "qFormat")) style.gallery = true;
      if (child(s, "semiHidden") || child(s, "hidden") || (type === "character" && child(s, "link"))) style.hidden = true;
      if (builtin) style.builtin = true;
      if (type === "paragraph" && !style.basedOn) {
        style.run = { ...defRun, ...run };
        style.para = { ...defPara, ...para };
        delete (style.para as Record<string, unknown>).style;
      }
      this.styles.push(style);
    }
    if (!this.styles.some((s) => s.id === "Normal")) this.styles.push({ id: "Normal", name: "Normal", type: "paragraph", builtin: true, gallery: true, run: { ...defRun }, para: { ...defPara } });
  }

  async loadNumbering(dir: string, rels: Rels) {
    const t = Object.values(rels).find((r) => r.type.endsWith("/numbering"));
    const x = t ? await readXml(this.zip, resolvePath(dir, t.target)) : undefined;
    if (!x) return;
    for (const a of kids(x, "abstractNum")) {
      const levels: NumLevel[] = [];
      for (const l of kids(a, "lvl")) {
        const i = num(l, "ilvl") ?? 0;
        const ind = child(child(l, "pPr"), "ind");
        levels[i] = { fmt: attr(child(l, "numFmt"), "val") || "decimal", text: attr(child(l, "lvlText"), "val") ?? "", start: num(child(l, "start"), "val") ?? 1, indent: num(ind, "left") ?? num(ind, "start") ?? (i + 1) * 720 };
      }
      this.abstract.set(attr(a, "abstractNumId") || "", levels);
    }
    for (const n of kids(x, "num")) {
      const overrides: Record<number, number> = {};
      for (const o of kids(n, "lvlOverride")) {
        const s = num(child(o, "startOverride"), "val");
        if (s !== undefined) overrides[num(o, "ilvl") ?? 0] = s;
      }
      this.numbering.set(attr(n, "numId") || "", { abs: attr(child(n, "abstractNumId"), "val") || "", overrides });
    }
  }

  level(numId: string, ilvl: number): NumLevel | undefined {
    const n = this.numbering.get(numId);
    if (!n) return undefined;
    const l = this.abstract.get(n.abs)?.[ilvl];
    if (!l) return undefined;
    return n.overrides[ilvl] !== undefined ? { ...l, start: n.overrides[ilvl] } : l;
  }

  /** numPr of a paragraph, from its own pPr or its style chain. */
  styleNumPr(styleId: string | undefined, seen = new Set<string>()): { numId?: string; ilvl?: number } | undefined {
    if (!styleId || seen.has(styleId)) return undefined;
    seen.add(styleId);
    const s = this.styleNumPrs.get(styleId);
    if (s) return s;
    const st = this.styles.find((x) => x.id === styleId);
    return st?.basedOn ? this.styleNumPr(st.basedOn, seen) : undefined;
  }
  styleNumPrs = new Map<string, { numId?: string; ilvl?: number }>();
  async loadStyleNumPrs(dir: string, rels: Rels) {
    const t = Object.values(rels).find((r) => r.type.endsWith("/styles"));
    const x = t ? await readXml(this.zip, resolvePath(dir, t.target)) : undefined;
    for (const s of kids(x, "style")) {
      const np = child(child(s, "pPr"), "numPr");
      const wid = attr(s, "styleId");
      if (np && wid) this.styleNumPrs.set(this.styleIdMap.get(wid) || wid, { numId: attr(child(np, "numId"), "val"), ilvl: num(child(np, "ilvl"), "val") });
    }
  }

  // ---- charts and SmartArt ----
  /** A chart or SmartArt drawing (resolved from its parts later, in inlineImages), else null. */
  graphic(drawing: XEl, ctx: Ctx): PMNode | null {
    const gd = descendants(drawing, "graphicData")[0];
    const uri = attr(gd, "uri") || "";
    if (uri !== CHART_NS && uri !== DIAGRAM_NS) return null;
    const extent = descendants(drawing, "extent")[0];
    const cx = num(extent, "cx");
    const cy = num(extent, "cy");
    const size = cx && cy ? { width: Math.round(cx / 9525), height: Math.round(cy / 9525) } : {};
    const alt = attr(descendants(drawing, "docPr")[0], "descr") || null;
    const target = (rid: string | undefined) => {
      const rel = rid ? ctx.rels[rid] : undefined;
      return rel && !rel.external ? resolvePath(ctx.dir, rel.target) : "";
    };
    if (uri === CHART_NS) {
      const path = target(attr(descendants(gd, "chart")[0], "id"));
      return path && this.zip.file(path) ? { type: "wordChart", attrs: { chart: `@zip:${path}`, alt, ...size } } : null;
    }
    const ids = descendants(gd, "relIds")[0];
    const dm = target(attr(ids, "dm"));
    const lo = target(attr(ids, "lo"));
    return dm && this.zip.file(dm) ? { type: "smartArt", attrs: { diagram: `@zip:${dm}|${lo}`, alt, ...size } } : null;
  }

  // ---- inline content ----
  image(drawing: XEl, ctx: Ctx): PMNode | null {
    const blip = descendants(drawing, "blip")[0];
    // an SVG beside the raster picture (Word 2016+) is the better source
    const svgRid = attr(descendants(blip, "svgBlip")[0], "embed");
    const svgOk = svgRid && ctx.rels[svgRid] && !ctx.rels[svgRid].external && this.zip.file(resolvePath(ctx.dir, ctx.rels[svgRid].target));
    const rid = (svgOk ? svgRid : undefined) || attr(blip, "embed") || attr(blip, "link") || attr(descendants(drawing, "imagedata")[0], "id");
    const rel = rid ? ctx.rels[rid] : undefined;
    if (!rel) return null;
    const path = rel.external ? "" : resolvePath(ctx.dir, rel.target);
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const mime = MIME[ext];
    const src = rel.external ? rel.target : "";
    const extent = descendants(drawing, "extent")[0];
    const docPr = descendants(drawing, "docPr")[0];
    const attrs: Record<string, unknown> = { src, alt: attr(docPr, "descr") || null, title: null, ...readPlacement(drawing) };
    const cx = num(extent, "cx");
    const cy = num(extent, "cy");
    if (cx && cy) {
      attrs.width = Math.round(cx / 9525);
      attrs.height = Math.round(cy / 9525);
    } else {
      // VML: style="width:100pt;height:50pt"
      const style = attr(descendants(drawing, "shape")[0], "style") || "";
      const w = /width:([\d.]+)pt/.exec(style);
      const h = /height:([\d.]+)pt/.exec(style);
      if (w && h) {
        attrs.width = Math.round((Number(w[1]) * 4) / 3);
        attrs.height = Math.round((Number(h[1]) * 4) / 3);
      }
    }
    if (!rel.external) {
      if ((!mime && ext !== "emf" && ext !== "wmf") || !this.zip.file(path)) {
        if (this.zip.file(path)) this.warnings.add(`Some pictures use a format browsers can't show (.${ext}) and were skipped.`);
        return null;
      }
      return { type: "image", attrs: { ...attrs, src: `@zip:${path}` } };
    }
    return { type: "image", attrs };
  }

  /** Resolve @zip: image placeholders into data: URLs. */
  async inlineImages(n: PMNode) {
    if (n.type === "image" && typeof n.attrs?.src === "string" && n.attrs.src.startsWith("@zip:")) {
      const path = n.attrs.src.slice(5);
      const bytes = await this.zip.file(path)!.async("uint8array");
      const ext = path.split(".").pop()!.toLowerCase();
      if (ext === "emf" || ext === "wmf") {
        // drawn as SVG here; the original goes back into exported files
        const svg = metafileToSvg(bytes) || metafilePlaceholder(ext);
        n.attrs.src = `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
        n.attrs.orig = `data:image/x-${ext};base64,${toBase64(bytes)}`;
      } else n.attrs.src = `data:${MIME[ext]};base64,${toBase64(bytes)}`;
    }
    if (n.type === "wordChart" && typeof n.attrs?.chart === "string" && n.attrs.chart.startsWith("@zip:")) {
      const xml = await this.zip.file(n.attrs.chart.slice(5))?.async("string");
      const data = xml ? readChartSpace(xml, this.warnings) : null;
      if (data) n.attrs.chart = JSON.stringify(data);
      else {
        this.warnings.add("A chart type that cannot be shown here was replaced by a placeholder.");
        n.attrs.chart = JSON.stringify({ chartType: "bar", title: "Chart", categories: [], series: [] });
      }
    }
    if (n.type === "smartArt" && typeof n.attrs?.diagram === "string" && n.attrs.diagram.startsWith("@zip:")) {
      const [dm, lo] = n.attrs.diagram.slice(5).split("|");
      const data = await this.zip.file(dm)?.async("string");
      const layout = lo ? await this.zip.file(lo)?.async("string") : undefined;
      const d = data ? readDiagram(data, layout) : null;
      n.attrs.diagram = JSON.stringify(d && d.items.length ? d : { kind: "list", items: [{ text: "SmartArt", level: 0 }], accent: "4472C4" });
    }
    for (const c of n.content || []) await this.inlineImages(c);
  }

  fieldKind(): string {
    for (let i = this.fieldStack.length - 1; i >= 0; i--) {
      const k = this.fieldStack[i].instr.trim().split(/\s+/)[0]?.toUpperCase();
      if (k) return k;
    }
    return "";
  }

  /** Whether result text is shown: not inside an instruction, not a TOC, not a page number turned into a node. */
  showing(ctx: Ctx): boolean {
    for (const f of this.fieldStack) {
      if (!f.result) return false;
      const k = f.instr.trim().split(/\s+/)[0]?.toUpperCase();
      if (k === "TOC" || k === "BIBLIOGRAPHY" || k === "INDEX") return false;
      // an evaluated field keeps its result on its node; a result running on into later paragraphs stays as text there
      if (fieldNode(f.instr, ctx.fieldsAsNodes) && (f.para === undefined || f.para === this.paraSerial)) return false;
      // a form field's result goes into its control, within its own paragraph (some run on across a table)
      if ((k === "FORMTEXT" || k === "FORMCHECKBOX" || k === "FORMDROPDOWN") && f.para === this.paraSerial) return false;
      if (ctx.fieldsAsNodes && (k === "PAGE" || k === "NUMPAGES" || k === "SECTIONPAGES")) return false;
    }
    return true;
  }
  fieldLink(): string | null {
    for (let i = this.fieldStack.length - 1; i >= 0; i--) {
      const m = /^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(this.fieldStack[i].instr);
      if (m) return /\\l/.test(this.fieldStack[i].instr) ? `#${m[1]}` : m[1];
    }
    return null;
  }

  /** Inline items of a paragraph: text and inline nodes, plus page breaks, images and TOC markers. */
  inlines(el: XEl, ctx: Ctx, out: PMNode[], link: string | null) {
    for (const c of el.children) {
      switch (c.local) {
        case "r":
          this.run(c, ctx, out, link);
          break;
        case "hyperlink": {
          const rid = attr(c, "id");
          const anchor = attr(c, "anchor");
          const href = rid && ctx.rels[rid] ? ctx.rels[rid].target : anchor ? `#${anchor}` : null;
          this.inlines(c, ctx, out, href);
          break;
        }
        case "fldSimple": {
          const instr = attr(c, "instr") || "";
          const kind = instr.trim().split(/\s+/)[0]?.toUpperCase();
          const host = this.fieldStack[this.fieldStack.length - 1];
          if (host && !host.result) {
            // nested in another field's instruction
            host.instr += `{ ${instr.trim()} }`;
            break;
          }
          if (ctx.fieldsAsNodes && (kind === "PAGE" || kind === "NUMPAGES" || kind === "SECTIONPAGES")) {
            const first = descendants(c, "rPr")[0];
            out.push({ type: "pageField", attrs: { kind: kind === "PAGE" ? "page" : kind === "NUMPAGES" ? "pages" : "sectionPages" }, marks: this.marks(this.runProps(first), null) });
          } else if (kind === "TOC" || kind === "BIBLIOGRAPHY" || kind === "INDEX") out.push({ type: "_toc", attrs: { instr } });
          else if (fieldNode(instr, ctx.fieldsAsNodes) && this.showing(ctx)) {
            const fn = fieldNode(instr, ctx.fieldsAsNodes)!;
            if (fn.type === "docField") fn.attrs!.result = descendants(c, "t").map((t) => t.text).join("");
            out.push({ ...fn, marks: this.marks(this.runProps(descendants(c, "rPr")[0]), null) });
          }
          else {
            const m = /^\s*HYPERLINK\s+"([^"]+)"/i.exec(instr);
            this.inlines(c, ctx, out, m ? m[1] : link);
          }
          break;
        }
        case "ins":
        case "moveTo":
        case "del":
        case "moveFrom": {
          const saved = this.change;
          this.change = { kind: c.local === "ins" || c.local === "moveTo" ? "insertion" : "deletion", author: attr(c, "author") || "Unknown", date: attr(c, "date") || null, id: attr(c, "id") || null };
          this.inlines(c, ctx, out, link);
          this.change = saved;
          break;
        }
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          this.inlines(c, ctx, out, link);
          break;
        case "sdt": {
          const pr = readSdtPr(child(c, "sdtPr") as never);
          if (!pr) {
            this.inlines(child(c, "sdtContent") || c, ctx, out, link);
            break;
          }
          const inner: PMNode[] = [];
          this.inlines(child(c, "sdtContent") || c, ctx, inner, link);
          // a control inside a control keeps its text in the outer one
          const flat = inner.flatMap((n) => (n.type === "contentControl" ? (n.content?.length ? n.content : n.attrs?.placeholder ? [{ type: "text", text: String(n.attrs.placeholder) }] : []) : [n]));
          if (flat.some((n) => n.type !== "text")) {
            // pictures, fields and the like can't sit in a text control: keep them and drop the control
            out.push(...flat);
            this.warnings.add("Content controls holding more than text were removed (their content is kept).");
            break;
          }
          inner.splice(0, inner.length, ...flat);
          const { showingPlaceholder, ...attrs } = pr;
          const text = mergeText(inner.filter((n) => n.type === "text"));
          if (showingPlaceholder) (attrs as Record<string, unknown>).placeholder = text.map((t) => t.text).join("") || null;
          out.push({ type: "contentControl", attrs: attrs as Record<string, unknown>, ...(!showingPlaceholder && text.length ? { content: text } : {}) });
          break;
        }
        case "permStart":
          this.perms.add(attr(c, "id") || "");
          break;
        case "permEnd":
          this.perms.delete(attr(c, "id") || "");
          break;
        case "oMathPara":
        case "oMath": {
          const maths = c.local === "oMath" ? [c] : c.children.filter((k) => k.local === "oMath");
          for (const m of maths) {
            const latex = ommlToLatex(m).trim();
            if (latex) out.push({ type: "equation", attrs: { latex, display: c.local === "oMathPara" } });
          }
          break;
        }
        case "bookmarkStart": {
          const name = attr(c, "name") || "";
          // Word's own: the last edit position and TOC targets (the TOC is rebuilt on save)
          if (!name || name === "_GoBack" || name.startsWith("_Toc")) break;
          const node: PMNode = { type: "bookmark", attrs: { name, span: "para" } };
          this.openBookmarks.set(attr(c, "id") || name, node);
          out.push(node);
          break;
        }
        case "bookmarkEnd": {
          const id = attr(c, "id") || "";
          const node = this.openBookmarks.get(id);
          if (node) {
            // a caption's bookmark ends right after its number ("Figure 1")
            if (out[out.length - 1]?.type === "seqField" && out.includes(node)) node.attrs = { ...node.attrs, span: "label" };
            this.openBookmarks.delete(id);
          }
          break;
        }
        case "commentRangeStart": {
          const id = attr(c, "id") || "";
          if (this.commentRoot.get(id) === id) this.activeComments.push(id);
          this.rangedComments.add(id);
          break;
        }
        case "commentRangeEnd": {
          const id = attr(c, "id") || "";
          this.activeComments = this.activeComments.filter((x) => x !== id);
          break;
        }
      }
    }
  }

  marks(r: RunOut, link: string | null): NonNullable<PMNode["marks"]> {
    const m: NonNullable<PMNode["marks"]> = [];
    if (r.bold) m.push({ type: "bold" });
    if (r.italic) m.push({ type: "italic" });
    if (r.underline && !link) m.push({ type: "underline" });
    if (r.strike) m.push({ type: "strike" });
    if (r.vertAlign) m.push({ type: r.vertAlign });
    if (r.highlight) m.push({ type: "highlight", attrs: { color: r.highlight } });
    const ts: Record<string, unknown> = {};
    if (r.font) ts.fontFamily = cssFont(r.font);
    if (r.size) ts.fontSize = `${r.size}pt`;
    if (r.color && !(link && r.color === "#0563c1")) ts.color = r.color;
    if (r.rStyle && !(link && r.rStyle === "Hyperlink")) ts.charStyle = r.rStyle;
    if (r.caps) ts.caps = true;
    if (r.smallCaps) ts.smallCaps = true;
    if (r.charSpacing) ts.charSpacing = r.charSpacing;
    if (Object.keys(ts).length) m.push({ type: "textStyle", attrs: ts });
    if (link) m.push({ type: "link", attrs: { href: link } });
    const c = this.activeComments[this.activeComments.length - 1];
    if (c) m.push({ type: "comment", attrs: { threadId: IMPORTED_THREAD + c } });
    if (this.change) m.push({ type: this.change.kind, attrs: { id: this.change.id, author: this.change.author, date: this.change.date } });
    if (this.perms.size) m.push({ type: "editableRange", attrs: { group: "everyone" } });
    return m;
  }

  run(r: XEl, ctx: Ctx, out: PMNode[], link: string | null) {
    const props = this.runProps(child(r, "rPr"));
    for (const c of r.children) {
      if (c.local === "fldChar") {
        const t = attr(c, "fldCharType");
        if (t === "begin") this.fieldStack.push({ instr: "", result: false, ff: child(c, "ffData") });
        else if (t === "separate" || t === "end") {
          const top = this.fieldStack[this.fieldStack.length - 1];
          if (top && !top.result) {
            top.result = true;
            const kind = top.instr.trim().split(/\s+/)[0]?.toUpperCase();
            const outer = this.fieldStack.slice(0, -1).every((f) => f.result);
            if (outer && ctx.fieldsAsNodes && (kind === "PAGE" || kind === "NUMPAGES" || kind === "SECTIONPAGES"))
              out.push({ type: "pageField", attrs: { kind: kind === "PAGE" ? "page" : kind === "NUMPAGES" ? "pages" : "sectionPages" }, marks: this.marks(props, null) });
            if (kind === "TOC" || kind === "BIBLIOGRAPHY" || kind === "INDEX") out.push({ type: "_toc", attrs: { instr: top.instr } });
            const fnode = outer && this.fieldStack.slice(0, -1).every((f) => !/^\s*TOC\b/i.test(f.instr)) ? fieldNode(top.instr, ctx.fieldsAsNodes) : null;
            const form = outer && (kind === "FORMTEXT" || kind === "FORMCHECKBOX" || kind === "FORMDROPDOWN") ? legacyFormField(kind, top.ff) : null;
            if (form) {
              // a legacy form field becomes a content control (its result text is collected below)
              out.push(form);
              top.node = form;
              top.para = this.paraSerial;
            }
            if (fnode) {
              const placed = { ...fnode, marks: this.marks(props, null) };
              out.push(placed);
              if (fnode.type === "docField") {
                top.node = placed;
                top.para = this.paraSerial;
              }
            }
          }
          if (t === "end") {
            const done = this.fieldStack.pop();
            // a field nested in another's instruction (IF { MERGEFIELD x } = ...) is kept there as { ... }
            const parent = this.fieldStack[this.fieldStack.length - 1];
            if (done && parent && !parent.result) parent.instr += `{${done.instr.trim() ? ` ${done.instr.trim()} ` : ""}}`;
          }
        }
        continue;
      }
      if (c.local === "instrText" || c.local === "delInstrText") {
        const top = this.fieldStack[this.fieldStack.length - 1];
        if (top && !top.result) top.instr += c.text;
        continue;
      }
      if (!this.showing(ctx)) {
        // the cached result of a document field (DATE, NUMPAGES...) is kept on its node
        const df = this.fieldStack[this.fieldStack.length - 1]?.result ? this.fieldStack[this.fieldStack.length - 1].node : undefined;
        if (df?.type === "contentControl") {
          // a legacy text field's result: its text, unless it is only the blank placeholder
          if (c.local === "t" && c.text && df.attrs!.kind === "text") {
            const text = (df.content?.[0]?.text || "") + c.text;
            if (text.replace(/[\u2002\s]/g, "")) df.content = [{ type: "text", text }];
          }
        } else if (df && (c.local === "t" || c.local === "tab")) df.attrs!.result = String(df.attrs!.result || "") + (c.local === "t" ? c.text : "\t");
        if (c.local === "t" || c.local === "delText" || c.local === "tab") this.hiddenSeen = true;
        continue;
      }
      const lk = this.fieldLink() || link;
      switch (c.local) {
        case "t":
        case "delText":
          if (c.text) out.push({ type: "text", text: c.text, marks: this.marks(props, lk) });
          break;
        case "tab":
        case "ptab":
          out.push({ type: "text", text: "\t", marks: this.marks(props, lk) });
          break;
        case "ruby": {
          // phonetic guides: the base text stays, the guide above it is dropped
          const base = child(c, "rubyBase");
          if (base) for (const r of kids(base, "r")) this.run(r, ctx, out, lk);
          this.warnings.add("Phonetic guides (ruby text) were removed; the base text is kept.");
          break;
        }
        case "noBreakHyphen":
          out.push({ type: "text", text: "‑", marks: this.marks(props, lk) });
          break;
        case "softHyphen":
          out.push({ type: "text", text: "­", marks: this.marks(props, lk) });
          break;
        case "sym": {
          const ch = parseInt(attr(c, "char") || "", 16);
          if (Number.isFinite(ch)) out.push({ type: "text", text: String.fromCharCode(ch >= 0xf000 ? ch - 0xf000 : ch), marks: this.marks(props, lk) });
          break;
        }
        case "commentReference": {
          // a comment on a point, not a range: anchor it on the text just before
          const id = attr(c, "id") || "";
          if (this.commentRoot.get(id) !== id || this.rangedComments.has(id)) break;
          const last = [...out].reverse().find((n) => n.type === "text" && n.text?.trim());
          if (!last || last.marks?.some((m) => m.type === "comment")) break;
          const mark = { type: "comment", attrs: { threadId: IMPORTED_THREAD + id } };
          const at = /\S+\s*$/.exec(last.text!)!.index;
          if (at > 0) out.splice(out.lastIndexOf(last), 1, { ...last, text: last.text!.slice(0, at) }, { ...last, text: last.text!.slice(at), marks: [...(last.marks || []), mark] });
          else last.marks = [...(last.marks || []), mark];
          break;
        }
        case "footnoteReference":
        case "endnoteReference": {
          const kind = c.local === "endnoteReference" ? "endnote" : "footnote";
          const content = this.noteDocs[kind].get(attr(c, "id") || "");
          if (content) out.push({ type: "noteRef", attrs: { kind, content: JSON.stringify(content) } });
          break;
        }
        case "br":
          if (attr(c, "type") === "page") out.push({ type: "pageBreak" });
          else out.push({ type: "hardBreak" });
          break;
        case "cr":
          out.push({ type: "hardBreak" });
          break;
        case "object": {
          // an embedded (OLE) object: its preview picture
          const pic = descendants(c, "imagedata").length ? this.image(c, ctx) : null;
          if (pic) out.push(pic);
          this.warnings.add("Embedded objects were replaced by their preview picture.");
          break;
        }
        case "drawing":
        case "pict": {
          if (c.local === "pict" && readWatermark(c as never)) break; // the header's watermark (read with the header)
          const group = descendants(c, "wsp").length > 1 || (c.local === "pict" && !descendants(c, "imagedata").length);
          const obj = this.graphic(c, ctx) || (group ? this.textFrame(c, ctx) : null) || (descendants(c, "wsp").length ? this.shape(c, ctx) : this.image(c, ctx));
          if (obj) out.push(obj);
          break;
        }
        case "AlternateContent": {
          const choice = child(c, "Choice");
          const g = choice ? this.graphic(choice, ctx) : null;
          if (g) {
            out.push(g);
            break;
          }
          if (choice && descendants(choice, "wsp").length) {
            const sh = (descendants(choice, "wsp").length > 1 ? this.textFrame(choice, ctx) : null) || this.shape(choice, ctx);
            if (sh) out.push(sh);
            break;
          }
          if (choice && descendants(choice, "blip").length) {
            const pic = this.image(choice, ctx);
            if (pic) out.push(pic);
            break;
          }
          const fb = child(c, "Fallback");
          if (fb && readWatermark(fb as never)) break;
          const pic = fb && descendants(fb, "imagedata")[0] ? this.image(fb, ctx) : fb ? this.textFrame(fb, ctx) : null;
          if (pic) out.push(pic);
          break;
        }
      }
    }
  }

  // ---- blocks ----
  paragraph(p: XEl, ctx: Ctx): Item[] {
    const pp = this.paraProps(child(p, "pPr"));
    this.paraSerial++;
    const inl: PMNode[] = [];
    this.hiddenSeen = this.fieldStack.length > 0 && !this.showing(ctx);
    this.inlines(p, ctx, inl, null);
    const items: Item[] = [];
    // TOC fields become one table-of-contents block
    const toc = inl.find((n) => n.type === "_toc");
    const figLabel = toc ? /\\c\s+"([^"]+)"/.exec(String(toc.attrs?.instr || ""))?.[1] : undefined;
    if (toc && /^\s*BIBLIOGRAPHY/i.test(String(toc.attrs?.instr || ""))) items.push({ node: { type: "bibliography", attrs: { title: null } } });
    else if (toc && /^\s*INDEX\b/i.test(String(toc.attrs?.instr || ""))) items.push({ node: { type: "wordIndex", attrs: parseIndexInstr(String(toc.attrs?.instr || "")) } });
    else if (toc && figLabel) items.push({ node: { type: "tableOfContents", attrs: { levels: 1, title: null, caption: figLabel } } });
    else if (toc && !this.tocEmitted) {
      this.tocEmitted = true;
      items.push({ node: { type: "tableOfContents", attrs: { levels: tocLevels(String(toc.attrs?.instr || "")), title: null } } });
    }
    const style = pp.style;
    const h = style ? /^Heading([1-6])$/.exec(style) : null;
    const outline = pp.outline !== undefined && pp.outline < 6 ? pp.outline : undefined;
    const numPr = pp.numPr?.numId !== undefined ? pp.numPr : this.styleNumPr(style);
    const listed = !!numPr?.numId && numPr.numId !== "0" && !!this.level(numPr.numId, numPr.ilvl ?? 0);
    const attrs: Record<string, unknown> = {};
    if (pp.align && pp.align !== "left") attrs.textAlign = pp.align;
    if (pp.spaceBefore !== undefined) attrs.spaceBefore = pp.spaceBefore;
    if (pp.spaceAfter !== undefined) attrs.spaceAfter = pp.spaceAfter;
    if (pp.lineHeight) attrs.lineHeight = pp.lineHeight;
    if (!listed) {
      if (pp.indentLeft !== undefined) attrs.indLeft = pp.indentLeft;
      if (pp.indentFirst !== undefined) attrs.indFirst = pp.indentFirst;
    }
    if (pp.indentRight !== undefined) attrs.indRight = pp.indentRight;
    if (pp.keepNext) attrs.keepNext = true;
    if (pp.keepLines) attrs.keepLines = true;
    if (pp.widowControl === false) attrs.widowControl = false;
    if (pp.shading) attrs.shading = pp.shading;
    if (pp.tabs) attrs.tabs = pp.tabs;
    // a bottom border alone on an empty paragraph is a horizontal line (below); otherwise keep the borders
    if (pp.borders && !(pp.hr && Object.keys(pp.borders).length === 1 && !inl.some((n) => n.type === "text" && n.text?.trim()))) attrs.borders = pp.borders;
    // a drop cap: its framed paragraph's letter starts this one
    const drop = this.pendingDrop;
    if (drop && !pp.dropCap) {
      this.pendingDrop = null;
      attrs.dropCap = drop.kind;
      inl.unshift(...drop.content);
    }
    if (pp.dropCap) {
      this.pendingDrop = { kind: pp.dropCap, content: inl.filter((n) => n.type === "text") };
      return [];
    }
    const make = (content: PMNode[]): PMNode => {
      const level = h ? Number(h[1]) : outline !== undefined && !style ? outline + 1 : 0;
      if (level) return { type: "heading", attrs: { ...attrs, level }, ...(content.length ? { content } : {}) };
      const a = { ...attrs };
      if (style && style !== "Normal" && !(listed && style === "ListParagraph")) a.styleId = style;
      return { type: "paragraph", attrs: a, ...(content.length ? { content } : {}) };
    };
    if (pp.pageBreakBefore) items.push({ node: { type: "pageBreak" } });
    // code blocks: Code-styled paragraphs
    if (style === "Code" && !inl.some((n) => n.type === "image")) {
      const text = inl.map((n) => (n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : "")).join("");
      items.push({ node: { type: "codeBlock", attrs: { language: null }, ...(text ? { content: [{ type: "text", text }] } : {}) } });
    } else if (pp.hr && !inl.some((n) => n.type === "text" || n.type === "image")) {
      items.push({ node: { type: "horizontalRule" } });
    } else {
      // split at page breaks and images (block nodes in the editor)
      let cur: PMNode[] = [];
      let first = true;
      const flush = (force: boolean) => {
        if (!cur.length && !force) return;
        const node = make(mergeText(cur));
        items.push(first && listed ? { node, list: { numId: numPr!.numId!, ilvl: Math.min(8, numPr!.ilvl ?? 0) } } : { node });
        first = false;
        cur = [];
      };
      const onlyImages = inl.every((n) => n.type === "image" || n.type === "shape" || (n.type === "text" && !n.text?.trim()) || n.type === "_toc");
      let produced = false;
      for (const n of inl) {
        if (n.type === "_toc") continue;
        if (n.type === "pageBreak") {
          flush(false);
          items.push({ node: { type: "pageBreak" } });
          produced = true;
        } else if (n.type === "image" || n.type === "shape") {
          flush(false);
          const floating = n.attrs?.wrap && n.attrs.wrap !== "inline";
          items.push({ node: floating ? n : { ...n, attrs: { ...n.attrs, ...(pp.align && pp.align !== "left" ? { align: pp.align } : {}) } } });
          produced = true;
        } else if (!(onlyImages && n.type === "text")) cur.push(n);
      }
      const suppressed = !!toc || (this.hiddenSeen && !cur.length);
      if (cur.length || (!produced && !pp.sectPr && !suppressed)) flush(true);
    }
    if (pp.sectPr) items.push({ node: { type: "sectionBreak", attrs: { section: "@sect" } }, _sect: pp.sectPr } as Item & { _sect: XEl });
    return items;
  }

  table(tbl: XEl, ctx: Ctx): PMNode {
    const tblPr = child(tbl, "tblPr");
    const grid = kids(child(tbl, "tblGrid"), "gridCol").map((g) => num(g, "w") || 0);
    const styleId = attr(child(tblPr, "tblStyle"), "val");
    const known = styleId ? this.knownTableStyles.get(styleId) : undefined;
    // a built-in style draws its own borders; only explicit table borders become cell borders
    const tb = child(tblPr, "tblBorders") || (styleId && !known ? this.tableStyleBorders.get(styleId) : undefined);
    // rows can sit inside content controls or custom XML
    const rowsOf = (el: XEl): XEl[] => el.children.flatMap((c) => (c.local === "tr" ? [c] : c.local === "sdt" || c.local === "customXml" ? rowsOf(child(c, "sdtContent") || c) : []));
    const rowsX = rowsOf(tbl);
    type Cell = { node: PMNode; col: number; span: number; rowspan: number; row: number; tcBorders?: XEl };
    const rows: Cell[][] = [];
    const header: boolean[] = [];
    const origin = new Map<number, Cell>(); // grid col -> cell that a vMerge continues
    rowsX.forEach((tr, ri) => {
      const cells: Cell[] = [];
      let col = num(child(child(tr, "trPr"), "gridBefore"), "val") || 0;
      header.push(!!child(child(tr, "trPr"), "tblHeader") && onOff(child(child(tr, "trPr"), "tblHeader")) !== false);
      const tcs = descendantsCells(tr);
      for (const tc of tcs) {
        const tcPr = child(tc, "tcPr");
        const span = num(child(tcPr, "gridSpan"), "val") || 1;
        const vm = child(tcPr, "vMerge");
        if (vm && attr(vm, "val") !== "restart") {
          const o = origin.get(col);
          if (o) o.rowspan++;
          col += span;
          continue;
        }
        const content = this.blocks(tc, ctx);
        const attrs: Record<string, unknown> = { colspan: span, rowspan: 1 };
        const widths = grid.slice(col, col + span).map((w) => Math.round(w / 15));
        if (widths.length === span && widths.every((w) => w > 0)) attrs.colwidth = widths;
        const fill = attr(child(tcPr, "shd"), "fill");
        if (fill && fill !== "auto" && /^[0-9a-fA-F]{6}$/.test(fill)) attrs.background = `#${fill.toLowerCase()}`;
        const va = attr(child(tcPr, "vAlign"), "val");
        if (va === "center" || va === "bottom") attrs.valign = va === "center" ? "middle" : "bottom";
        const cell: Cell = { node: { type: "tableCell", attrs, content: content.length ? content : [{ type: "paragraph" }] }, col, span, rowspan: 1, row: ri, tcBorders: child(tcPr, "tcBorders") };
        cells.push(cell);
        for (let k = 0; k < span; k++) origin.delete(col + k);
        if (vm) origin.set(col, cell);
        col += span;
      }
      rows.push(cells);
    });
    const ncols = Math.max(grid.length, ...rows.map((r) => r.reduce((s, c) => Math.max(s, c.col + c.span), 0)));
    // borders per cell edge: the cell's own, else the table's (outer or inside)
    for (const r of rows)
      for (const c of r) {
        c.node.attrs!.rowspan = c.rowspan;
        const last = c.row + c.rowspan >= rows.length;
        const side = (name: string, alt: string, outer: string, inner: string, isOuter: boolean) =>
          borderCss(child(c.tcBorders, name) || child(c.tcBorders, alt)) ?? (tb ? borderCss(child(tb, isOuter ? outer : inner) || (isOuter && outer === "left" ? child(tb, "start") : isOuter && outer === "right" ? child(tb, "end") : undefined)) : undefined) ?? "none";
        if (known && !tb) {
          // styled table: keep only the cell's own borders
          const own: Record<string, string> = {};
          for (const [k, a, b2] of [["top", "top", "top"], ["right", "right", "end"], ["bottom", "bottom", "bottom"], ["left", "left", "start"]] as const) {
            const css = borderCss(child(c.tcBorders, a) || child(c.tcBorders, b2));
            if (css) own[k] = css;
          }
          if (Object.keys(own).length) c.node.attrs!.borders = JSON.stringify(own);
          continue;
        }
        const b = {
          top: side("top", "top", "top", "insideH", c.row === 0),
          right: side("right", "end", "right", "insideV", c.col + c.span >= ncols),
          bottom: side("bottom", "bottom", "bottom", "insideH", last),
          left: side("left", "start", "left", "insideV", c.col === 0),
        };
        c.node.attrs!.borders = JSON.stringify(b);
      }
    const jc = attr(child(tblPr, "jc"), "val");
    const tattrs: Record<string, unknown> = {};
    if (known) {
      tattrs.tableStyle = known;
      const lk = child(tblPr, "tblLook");
      tattrs.look = JSON.stringify(readTblLook(lk ? (lk.attrs as Record<string, string>) : undefined));
    }
    if (jc === "center" || jc === "right" || jc === "end") tattrs.align = jc === "center" ? "center" : "right";
    return {
      type: "table",
      ...(Object.keys(tattrs).length ? { attrs: tattrs } : {}),
      content: rows
        .filter((r) => r.length)
        .map((r) => ({ type: "tableRow", content: r.map((c) => (header[c.row] ? { ...c.node, type: "tableHeader" } : c.node)) })),
    };
  }

  /** Block content of a container (body, cell, header, sdtContent). */
  blocks(el: XEl, ctx: Ctx, sects?: XEl[]): PMNode[] {
    const items: (Item & { _sect?: XEl })[] = [];
    const walk = (container: XEl) => {
      for (const c of container.children) {
        switch (c.local) {
          case "p":
            items.push(...this.paragraph(c, ctx));
            break;
          case "tbl": {
            if (this.tableDepth >= 24) {
              // tables nested deeper than anyone reads: keep their paragraphs (in order, without recursion)
              this.warnings.add("Tables nested more than 24 deep were flattened to their text.");
              const stack: XEl[] = [c];
              while (stack.length) {
                const e = stack.pop()!;
                if (e.local === "p") items.push(...this.paragraph(e, ctx));
                else stack.push(...[...e.children].reverse());
              }
              break;
            }
            this.tableDepth++;
            try {
              items.push({ node: this.table(c, ctx) });
            } finally {
              this.tableDepth--;
            }
            break;
          }
          case "sdt": {
            const gallery = attr(descendants(child(c, "sdtPr"), "docPartGallery")[0], "val");
            if (gallery === "Bibliographies") {
              const hp = kids(child(c, "sdtContent"), "p")[0];
              const isTitle = hp && !descendants(hp, "instrText").length && !descendants(hp, "fldSimple").length;
              const title = isTitle ? descendants(hp, "t").map((t) => t.text).join("") : null;
              items.push({ node: { type: "bibliography", attrs: { title: title || null } } });
            } else if (gallery === "Table of Contents") {
              const instr = descendants(c, "instrText").map((t) => t.text).join("") || kids(descendants(c, "fldSimple")[0])?.[0]?.text || "";
              const titleP = kids(child(c, "sdtContent"), "p").find((p) => /TOC ?Heading/i.test(attr(descendants(p, "pStyle")[0], "val") || ""));
              const title = titleP ? descendants(titleP, "t").map((t) => t.text).join("") : null;
              if (!this.tocEmitted) items.push({ node: { type: "tableOfContents", attrs: { levels: tocLevels(instr), title } } });
              this.tocEmitted = true;
            } else {
              const body = child(c, "sdtContent") || c;
              // a block control stays a block, unless it holds a section or page break (the page layout breaks between top-level blocks) or sits in a header
              const breaks = descendants(body, "sectPr").length || descendants(body, "br").some((b) => attr(b, "type") === "page") || descendants(body, "pageBreakBefore").length;
              const inner = ctx.fieldsAsNodes || breaks ? null : this.blocks(body, ctx);
              if (inner?.length) items.push({ node: { type: "blockControl", attrs: readBlockSdtPr(child(c, "sdtPr") as never) as Record<string, unknown>, content: inner } });
              else walk(body);
            }
            break;
          }
          case "customXml":
          case "ins":
          case "moveTo":
            walk(c);
            break;
          case "permStart":
            this.perms.add(attr(c, "id") || "");
            break;
          case "permEnd":
            this.perms.delete(attr(c, "id") || "");
            break;
        }
      }
    };
    walk(el);
    if (sects) for (const it of items) if (it._sect) sects.push(it._sect);
    return this.lists(tasks(items));
  }

  /** Group numbered paragraphs into (nested) list nodes. */
  lists(items: Item[]): PMNode[] {
    const out: PMNode[] = [];
    type Open = { node: PMNode; level: number; numId: string; ordered: boolean; indent: number };
    let stack: Open[] = [];
    const make = (numId: string, ilvl: number): Open => {
      const l = this.level(numId, ilvl)!;
      const ordered = l.fmt !== "bullet" && l.fmt !== "none";
      const counts = this.counters.get(numId) || [];
      const attrs: Record<string, unknown> = {};
      if (ordered) {
        attrs.start = l.start + (counts[ilvl] || 0);
        if (["lowerLetter", "upperLetter", "lowerRoman", "upperRoman"].includes(l.fmt)) attrs.numFmt = l.fmt;
        else attrs.numFmt = "decimal";
        if (l.text && l.text !== `%${ilvl + 1}.`) attrs.lvlText = l.text;
      } else {
        const ch = l.text;
        attrs.bullet = ch === "o" || ch === "◦" ? "circle" : ch === "\uf0a7" || ch === "▪" || ch === "■" || ch === "§" ? "square" : ch === "\uf0b7" || ch === "•" || ch === "·" || !ch ? "disc" : ch;
      }
      return { node: { type: ordered ? "orderedList" : "bulletList", attrs, content: [] }, level: ilvl, numId, ordered, indent: l.indent };
    };
    // Nesting follows the levels' indents, so separate lists that Word shows
    // indented under each other (List Number, List Number 2) nest here too.
    for (const it of items) {
      if (!it.list) {
        stack = [];
        out.push(it.node);
        continue;
      }
      const { numId, ilvl } = it.list;
      const lvl = this.level(numId, ilvl)!;
      const ordered = lvl.fmt !== "bullet" && lvl.fmt !== "none";
      const indent = lvl.indent;
      while (stack.length && stack[stack.length - 1].indent > indent + 10) stack.pop();
      const top = stack[stack.length - 1];
      if (top && Math.abs(top.indent - indent) <= 10 && (top.numId !== numId || top.ordered !== ordered || top.level !== ilvl)) stack.pop();
      if (!stack.length) {
        const o = make(numId, ilvl);
        out.push(o.node);
        stack.push(o);
      } else if (stack[stack.length - 1].indent < indent - 10) {
        const parent = stack[stack.length - 1].node;
        let li = parent.content![parent.content!.length - 1];
        if (!li) parent.content!.push((li = { type: "listItem", content: [{ type: "paragraph" }] }));
        const o = make(numId, ilvl);
        li.content!.push(o.node);
        stack.push(o);
      }
      const counts = this.counters.get(numId) || [];
      counts[ilvl] = (counts[ilvl] || 0) + 1;
      for (let k = ilvl + 1; k < 9; k++) counts[k] = 0;
      this.counters.set(numId, counts);
      stack[stack.length - 1].node.content!.push({ type: "listItem", content: [it.node] });
    }
    return out;
  }

  async headerFooter(dir: string, rels: Rels, rid: string): Promise<PMNode | undefined> {
    const rel = rels[rid];
    if (!rel) return undefined;
    const path = resolvePath(dir, rel.target);
    const x = await readXml(this.zip, path);
    if (!x) return undefined;
    const ctx: Ctx = { zip: this.zip, dir: path.slice(0, path.lastIndexOf("/") + 1), rels: await readRels(this.zip, path), fieldsAsNodes: true };
    if (!this.watermark) {
      const wm = readWatermark(x as never);
      if (wm?.kind === "picture") {
        const r = wm.rid ? ctx.rels[wm.rid] : undefined;
        const ip = r ? resolvePath(ctx.dir, r.target) : "";
        const f = ip ? this.zip.file(ip) : null;
        const ext = ip.split(".").pop()!.toLowerCase();
        if (f && MIME[ext]) this.watermark = { kind: "picture", image: `data:${MIME[ext]};base64,${toBase64(await f.async("uint8array"))}`, washout: wm.washout, scale: 0 };
      } else if (wm?.text) {
        const { rid: _r, ...rest } = wm;
        this.watermark = rest;
      }
    }
    const saved = this.fieldStack;
    const savedComments = this.activeComments;
    this.fieldStack = [];
    this.activeComments = [];
    const content = this.blocks(x, ctx).map((n) => (n.type === "paragraph" && n.attrs?.styleId && /^(Header|Footer)$/.test(String(n.attrs.styleId)) ? { ...n, attrs: { ...n.attrs, styleId: null } } : n));
    this.fieldStack = saved;
    this.activeComments = savedComments;
    const doc: PMNode = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
    await this.inlineImages(doc);
    return doc;
  }

  async section(sp: XEl | undefined, dir: string, rels: Rels): Promise<Section> {
    const s = defaultSection();
    if (!sp) return s;
    const type = attr(child(sp, "type"), "val");
    if (type === "continuous" || type === "evenPage" || type === "oddPage" || type === "nextPage") s.type = type;
    const sz = child(sp, "pgSz");
    if (sz) {
      s.pageWidth = twPt(num(sz, "w")) || s.pageWidth;
      s.pageHeight = twPt(num(sz, "h")) || s.pageHeight;
      s.orientation = attr(sz, "orient") === "landscape" || s.pageWidth > s.pageHeight ? "landscape" : "portrait";
    }
    const mar = child(sp, "pgMar");
    if (mar) {
      const g = (k: string, d: number) => Math.abs(twPt(num(mar, k)) ?? d);
      s.margins = { top: g("top", 72), right: g("right", 72), bottom: g("bottom", 72), left: g("left", 72), header: g("header", 36), footer: g("footer", 36) };
      const gutter = twPt(num(mar, "gutter"));
      if (gutter) s.margins.gutter = gutter;
    }
    const cols = child(sp, "cols");
    const n = num(cols, "num") || 1;
    if (n > 1) s.columns = { count: n, space: twPt(num(cols, "space")) ?? 36, ...(onOff(child(cols, "sep")) || attr(cols, "sep") === "1" || attr(cols, "sep") === "true" ? { separator: true } : {}) };
    if (onOff(child(sp, "titlePg"))) s.titlePage = true;
    const pb = readPgBorders(child(sp, "pgBorders") as never);
    if (pb) s.pageBorders = pb;
    const ln = readLnNum(child(sp, "lnNumType") as never);
    if (ln) s.lineNumbers = ln;
    const va = attr(child(sp, "vAlign"), "val");
    if (va === "center" || va === "bottom" || va === "both") s.vAlign = va;
    const pn = child(sp, "pgNumType");
    if (pn) {
      const start = num(pn, "start");
      if (start !== undefined) s.pageNumberStart = start;
      const fmt = attr(pn, "fmt");
      if (fmt === "lowerRoman" || fmt === "upperRoman" || fmt === "lowerLetter" || fmt === "upperLetter") s.pageNumberFormat = fmt;
    }
    for (const kind of ["header", "footer"] as const) {
      for (const ref of kids(sp, `${kind}Reference`)) {
        // some writers say "odd" for the default
        const raw = attr(ref, "type");
        const t: "default" | "first" | "even" = raw === "first" || raw === "even" ? raw : "default";
        const d = await this.headerFooter(dir, rels, attr(ref, "id") || "");
        if (!d) continue;
        const key = kind === "header" ? "headers" : "footers";
        s[key] = { ...(s[key] || {}), [t]: d };
      }
    }
    return s;
  }

  async comments(dir: string, rels: Rels): Promise<{ comments: ImportedComment[]; byId: Map<string, ImportedComment> }> {
    const out: ImportedComment[] = [];
    const byId = new Map<string, ImportedComment>();
    const t = Object.values(rels).find((r) => r.type.endsWith("/comments"));
    const x = t ? await readXml(this.zip, resolvePath(dir, t.target)) : undefined;
    if (!x) return { comments: out, byId };
    const te = Object.values(rels).find((r) => r.type.endsWith("/commentsExtended"));
    const ext = te ? await readXml(this.zip, resolvePath(dir, te.target)) : undefined;
    const exMap = new Map<string, { parent?: string; done: boolean }>();
    for (const e of kids(ext, "commentEx")) exMap.set(attr(e, "paraId") || "", { parent: attr(e, "paraIdParent"), done: attr(e, "done") === "1" });
    const paraOf = new Map<string, string>(); // paraId -> comment id
    const list = kids(x, "comment").map((c) => {
      const ps = kids(c, "p");
      const pid = attr(ps[ps.length - 1], "paraId") || "";
      const id = attr(c, "id") || "";
      paraOf.set(pid, id);
      const date = Date.parse(attr(c, "date") || "");
      return {
        id,
        pid,
        author: attr(c, "author") || "Unknown",
        initials: attr(c, "initials"),
        date: Number.isFinite(date) ? date : undefined,
        body: ps.map((p) => descendants(p, "t").map((t) => t.text).join("")).join("\n"),
      };
    });
    for (const c of list) {
      const e = exMap.get(c.pid);
      const parentId = e?.parent ? paraOf.get(e.parent) : undefined;
      if (parentId !== undefined && byId.has(parentId)) {
        const root = byId.get(parentId)!;
        root.messages.push({ author: c.author, initials: c.initials, date: c.date, body: c.body });
        byId.set(c.id, root);
        this.commentRoot.set(c.id, root.key);
        continue;
      }
      const thread: ImportedComment = { key: c.id, resolved: !!e?.done, quote: "", messages: [{ author: c.author, initials: c.initials, date: c.date, body: c.body }] };
      out.push(thread);
      byId.set(c.id, thread);
      this.commentRoot.set(c.id, c.id);
    }
    return { comments: out, byId };
  }
}

/** Paragraphs starting with a task checkbox (see TASK_TAG) become task lists again. */
function tasks(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    const first = it.node.type === "paragraph" ? it.node.content?.[0] : undefined;
    if (it.list || first?.type !== "contentControl" || first.attrs?.tag !== "synergy:task") {
      out.push(it);
      continue;
    }
    const rest = it.node.content!.slice(1);
    if (rest[0]?.type === "text" && rest[0].text?.startsWith(" ")) rest[0] = { ...rest[0], text: rest[0].text.slice(1) };
    const { indLeft: _i, ...attrs } = it.node.attrs || {};
    const para: PMNode = { ...it.node, attrs, content: rest.filter((n) => n.type !== "text" || n.text) };
    if (!para.content!.length) delete para.content;
    const item: PMNode = { type: "taskItem", attrs: { checked: !!first.attrs?.checked }, content: [para] };
    const prev = out[out.length - 1];
    if (prev?.node.type === "taskList") prev.node.content!.push(item);
    else out.push({ node: { type: "taskList", content: [item] } });
  }
  return out;
}

/** A legacy form field (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN with its w:ffData) as a content control. */
function legacyFormField(kind: string, ff: XEl | undefined): PMNode {
  const name = attr(child(ff, "name"), "val");
  const title = name ? { title: name } : {};
  if (kind === "FORMCHECKBOX") {
    const cb = child(ff, "checkBox");
    const v = attr(child(cb, "checked"), "val") ?? (child(cb, "checked") ? "1" : attr(child(cb, "default"), "val"));
    const checked = v === "1" || v === "true";
    return { type: "contentControl", attrs: { kind: "checkbox", checked, ...title }, content: [{ type: "text", text: checked ? "☒" : "☐" }] };
  }
  if (kind === "FORMDROPDOWN") {
    const dd = child(ff, "ddList");
    const items = kids(dd, "listEntry").map((e) => attr(e, "val") || "");
    const at = Number(attr(child(dd, "result"), "val") ?? attr(child(dd, "default"), "val") ?? 0) || 0;
    const chosen = items[at];
    return { type: "contentControl", attrs: { kind: "dropdown", items: JSON.stringify(items.map((t) => ({ text: t, value: t }))), ...title }, ...(chosen ? { content: [{ type: "text", text: chosen }] } : {}) };
  }
  return { type: "contentControl", attrs: { kind: "text", ...title } };
}

function descendantsCells(tr: XEl): XEl[] {
  const out: XEl[] = [];
  for (const c of tr.children) {
    if (c.local === "tc") out.push(c);
    else if (c.local === "sdt" || c.local === "customXml") out.push(...descendantsCells(child(c, "sdtContent") || c));
  }
  return out;
}

/** SEQ, REF and PAGEREF fields become caption-number and cross-reference nodes. */
function fieldNode(instr: string, pageAsNodes = false): PMNode | null {
  const xe = parseXE(instr);
  if (xe) return { type: "indexEntry", attrs: { entry: xe.entry, bold: !!xe.bold, italic: !!xe.italic, see: xe.see || null } };
  const kind = fieldKind(instr);
  if (kind && !(pageAsNodes && (kind === "PAGE" || kind === "NUMPAGES" || kind === "SECTIONPAGES"))) return { type: "docField", attrs: { instr: instr.trim().replace(/\s+/g, " "), result: "" } };
  const merge = parseMergeInstr(instr);
  if (merge) return { type: "mergeField", attrs: { name: merge } };
  const cite = parseCitationInstr(instr);
  if (cite) return { type: "citation", attrs: { tags: cite.tags.join(","), pages: cite.pages || null } };
  const f = parseFieldInstr(instr);
  if (!f || f.kind === "NOTEREF") return null;
  if (f.kind === "SEQ") return { type: "seqField", attrs: { name: f.name, format: f.format && f.format !== "ARABIC" ? f.format : null } };
  return { type: "crossRef", attrs: { target: f.name, show: f.show, link: f.link, ...(f.switches ? { switches: f.switches } : {}) } };
}

function tocLevels(instr: string): number {
  const m = /\\o\s+"(\d)-(\d)"/.exec(instr);
  return m ? Math.min(9, Math.max(1, Number(m[2]))) : 3;
}

/** Merge neighbouring text nodes with the same marks. */
function mergeText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === "text" && !n.marks?.length) delete n.marks;
    if (prev && prev.type === "text" && n.type === "text" && JSON.stringify(prev.marks || []) === JSON.stringify(n.marks || [])) prev.text = (prev.text || "") + (n.text || "");
    else out.push({ ...n });
  }
  return out;
}

function quoteFor(doc: PMNode, threadId: string): string {
  let s = "";
  const walk = (n: PMNode) => {
    if (n.type === "text" && n.marks?.some((m) => m.type === "comment" && m.attrs?.threadId === threadId)) s += n.text || "";
    n.content?.forEach(walk);
  };
  walk(doc);
  return s.slice(0, 300);
}

/** Read a .docx into the editor's JSON, styles, sections, settings and comments. */
export async function importDocx(data: ArrayBuffer | Uint8Array): Promise<ImportedDocx> {
  const head = new Uint8Array(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + 4) : data.slice(0, 4));
  // Word saves a password-encrypted .docx inside an OLE compound file
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) throw new Error("This document is encrypted with a password. Remove the password in Word (File › Info › Protect Document) and open it again.");
  const zip = await JSZip.loadAsync(data);
  const rootRels = await readRels(zip, "");
  const main = Object.values(rootRels).find((r) => r.type.endsWith("/officeDocument"));
  const docPath = main ? resolvePath("", main.target) : "word/document.xml";
  const dir = docPath.slice(0, docPath.lastIndexOf("/") + 1);
  const rels = await readRels(zip, docPath);
  const rd = new Reader(zip);
  await rd.loadTheme(dir, rels);
  await rd.loadStyles(dir, rels);
  await rd.loadStyleNumPrs(dir, rels);
  await rd.loadNumbering(dir, rels);
  const { comments } = await rd.comments(dir, rels);
  await rd.loadNotes(dir, rels);
  const x = await readXml(zip, docPath);
  const body = child(x, "body");
  if (!body) throw new Error("not a Word document");
  const ctx: Ctx = { zip, dir, rels, fieldsAsNodes: false };
  const sects: XEl[] = [];
  const content = rd.blocks(body, ctx, sects);
  // section breaks: fill in their properties in order
  let si = 0;
  const fill = async (nodes: PMNode[]) => {
    for (const n of nodes) {
      if (n.type === "sectionBreak" && n.attrs?.section === "@sect") n.attrs.section = JSON.stringify(await rd.section(sects[si++], dir, rels));
    }
  };
  await fill(content);
  const bodySect = await rd.section(child(body, "sectPr"), dir, rels);
  const doc: PMNode = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  await rd.inlineImages(doc);
  const settingsRel = Object.values(rels).find((r) => r.type.endsWith("/settings"));
  const settingsX = settingsRel ? await readXml(zip, resolvePath(dir, settingsRel.target)) : undefined;
  const settings: DocSettings = {};
  if (onOff(child(settingsX, "evenAndOddHeaders"))) settings.evenAndOddHeaders = true;
  if (onOff(child(settingsX, "trackRevisions"))) settings.trackRevisions = true;
  if (onOff(child(settingsX, "mirrorMargins"))) settings.mirrorMargins = true;
  const prot = readProtection(child(settingsX, "documentProtection") as never);
  if (prot) settings.protection = prot;
  if (onOff(child(settingsX, "autoHyphenation"))) settings.autoHyphenation = true;
  const bgc = attr(child(x, "background"), "color");
  if (bgc && /^[0-9a-fA-F]{6}$/.test(bgc) && bgc.toUpperCase() !== "FFFFFF") settings.pageColor = `#${bgc.toLowerCase()}`;
  if (rd.watermark) settings.watermark = rd.watermark;
  const theme = matchTheme(rd.theme.major, rd.theme.minor, rd.scheme.accent1);
  if (theme && theme.id !== "office") settings.theme = theme.id;
  // bibliography sources (customXml b:Sources)
  for (const f of Object.keys(zip.files).filter((f) => /^customXml\/item\d+\.xml$/.test(f))) {
    const x = await readXml(zip, f).catch(() => undefined);
    if (x?.local !== "Sources") continue;
    const { sources, style } = parseSources(x as never);
    if (sources.length) settings.sources = sources;
    if (style) settings.citationStyle = style;
    break;
  }
  for (const c of comments) c.quote = quoteFor(doc, IMPORTED_THREAD + c.key);
  await readProperties(zip, rootRels, settings);
  return { doc, styles: rd.styles, body: parseSection(bodySect), settings, comments, ...(rd.warnings.size ? { warnings: [...rd.warnings] } : {}) };
}

/** docProps core, app and custom: the properties DOCPROPERTY and INFO fields read. */
async function readProperties(zip: JSZip, rootRels: Rels, settings: DocSettings) {
  const part = async (suffix: string, fallback: string) => {
    const r = Object.values(rootRels).find((x) => x.type.endsWith(suffix));
    return readXml(zip, r ? resolvePath("", r.target) : fallback);
  };
  const core = await part("/core-properties", "docProps/core.xml");
  const app = await part("/extended-properties", "docProps/app.xml");
  const custom = await part("/custom-properties", "docProps/custom.xml");
  const props: Record<string, string> = {};
  for (const b of BUILTIN_PROPERTIES) {
    const root = b.part === "core" ? core : app;
    const local = b.tag.includes(":") ? b.tag.split(":")[1] : b.tag;
    const el = root ? descendants(root, local)[0] : undefined;
    const v = el?.text.trim();
    if (v) props[b.name] = v;
  }
  if (Object.keys(props).length) settings.properties = props;
  const cust: Record<string, string> = {};
  for (const p of custom ? descendants(custom, "property") : []) {
    const name = attr(p, "name");
    const v = p.children[0];
    if (name && v) cust[name] = v.local === "bool" ? (/^(true|1)$/i.test(v.text.trim()) ? "Y" : "N") : v.text;
  }
  if (Object.keys(cust).length) settings.customProperties = cust;
}
