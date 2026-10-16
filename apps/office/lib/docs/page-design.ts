// Page design: watermarks (text or picture, drawn behind every page and
// written as Word's VML watermark shape in the headers), page colour, page
// borders (w:pgBorders), line numbers (w:lnNumType) and the vertical
// alignment of a page (w:vAlign).
import { readPBdr, type BorderLine } from "./para-format";

export type Watermark = {
  kind: "text" | "picture";
  text?: string;
  font?: string;
  color?: string;
  /** pt, or 0 for "auto" (fits the page width) */
  size?: number;
  layout?: "diagonal" | "horizontal";
  semitransparent?: boolean;
  /** picture watermark: a data: URL */
  image?: string;
  /** picture scale, 1 = 100%; 0 = auto */
  scale?: number;
  washout?: boolean;
};
export type PageBorders = {
  top?: BorderLine;
  left?: BorderLine;
  bottom?: BorderLine;
  right?: BorderLine;
  /** measure the border's distance from the page edge or from the text */
  offsetFrom?: "page" | "text";
  display?: "allPages" | "firstPage" | "notFirstPage";
};
export type LineNumbers = { countBy: number; start: number; restart: "newPage" | "newSection" | "continuous"; distance: number };

export const WATERMARK_PRESETS = ["CONFIDENTIAL", "DO NOT COPY", "DRAFT", "SAMPLE", "URGENT", "ASAP"];
export const PAGE_COLORS = ["#ffffff", "#f2f2f2", "#fff2cc", "#e2efda", "#ddebf7", "#fce4d6", "#ededed", "#d9e1f2", "#000000"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = (c: string | undefined, d = "C0C0C0") => (c && /^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toUpperCase() : d);
const tw = (pt: number) => Math.round(pt * 20);

// ---- watermark ----

/** The watermark's text box on a page (pt): width and height Word gives it in the margins. */
export function watermarkBox(w: Watermark, contentWidth: number): { width: number; height: number; fontSize: number } {
  const text = w.text || "";
  const auto = !w.size;
  const len = Math.max(1, text.length);
  const width = w.layout === "horizontal" ? contentWidth : contentWidth * 0.95;
  const fontSize = auto ? Math.min(200, (width / len) * 1.6) : w.size!;
  return { width: auto ? width : Math.min(contentWidth * 1.4, fontSize * len * 0.62), height: fontSize * 1.1, fontSize };
}

/** Word's VML watermark shape (goes in a run in a header paragraph). `rid` is the picture's relationship. */
export function watermarkVml(w: Watermark, contentWidth: number, rid?: string, idx = 1): string {
  if (w.kind === "picture") {
    if (!rid) return "";
    const width = contentWidth * (w.scale || 1) * (w.scale ? 0.6 : 1);
    return (
      `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>` +
      `<v:shape id="WordPictureWatermark${idx}" o:spid="_x0000_s${2049 + idx}" type="#_x0000_t75" style="position:absolute;left:0;text-align:left;margin-left:0;margin-top:0;width:${width.toFixed(1)}pt;height:${(width * 0.75).toFixed(1)}pt;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">` +
      `<v:imagedata r:id="${rid}" o:title=""${w.washout !== false ? ' gain="19661f" blacklevel="22938f"' : ""}/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`
    );
  }
  const box = watermarkBox(w, contentWidth);
  const font = w.font || "Calibri";
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>` +
    `<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>` +
    `<v:shape id="PowerPlusWaterMarkObject${idx}" o:spid="_x0000_s${2049 + idx}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${box.width.toFixed(1)}pt;height:${box.height.toFixed(1)}pt;${w.layout === "horizontal" ? "" : "rotation:315;"}z-index:-251655168;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#${hex(w.color)}" stroked="f">` +
    `${w.semitransparent !== false ? '<v:fill opacity=".5"/>' : ""}<v:textpath style="font-family:&quot;${esc(font)}&quot;;font-size:${w.size ? `${w.size}pt` : "1pt"}" string="${esc(w.text || "")}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`
  );
}

type El = { local: string; attrs: Record<string, string>; children: El[] };
const attr = (e: El | undefined, k: string): string | undefined => (e ? e.attrs[k] ?? Object.entries(e.attrs).find(([n]) => n.endsWith(`:${k}`))?.[1] : undefined);
function find(e: El, test: (x: El) => boolean): El | undefined {
  if (test(e)) return e;
  for (const c of e.children) {
    const f = find(c, test);
    if (f) return f;
  }
  return undefined;
}

/** A watermark in a header's XML (text from v:textpath, or a picture shape's relationship id). */
export function readWatermark(root: El): (Watermark & { rid?: string }) | null {
  const shape = find(root, (x) => x.local === "shape" && /WaterMark|Watermark/i.test(attr(x, "id") || ""));
  if (!shape) return null;
  const style = attr(shape, "style") || "";
  const tp = shape.children.find((c) => c.local === "textpath");
  if (tp) {
    const fill = attr(shape, "fillcolor") || "silver";
    const named: Record<string, string> = { silver: "#c0c0c0", gray: "#808080", black: "#000000", red: "#ff0000", blue: "#0000ff" };
    const color = /^#[0-9a-f]{6}$/i.test(fill) ? fill.toLowerCase() : named[fill.replace(/\s.*$/, "").toLowerCase()] || "#c0c0c0";
    const ts = attr(tp, "style") || "";
    const font = /font-family:"?([^";]+)"?/.exec(ts.replace(/&quot;/g, '"'))?.[1];
    const size = Number(/font-size:([\d.]+)pt/.exec(ts)?.[1]) || 0;
    const opacity = shape.children.find((c) => c.local === "fill");
    return {
      kind: "text",
      text: attr(tp, "string") || "",
      font: font || "Calibri",
      color,
      size: size > 1 ? size : 0,
      layout: /rotation:\s*(315|-45)/.test(style) ? "diagonal" : "horizontal",
      semitransparent: !!opacity && Number(attr(opacity, "opacity")?.replace(/f$/, "") || 1) < 1,
    };
  }
  const img = shape.children.find((c) => c.local === "imagedata");
  if (img) return { kind: "picture", rid: attr(img, "id"), washout: !!attr(img, "gain"), scale: 0 };
  return null;
}

/** CSS for the watermark drawn on a page `width` × `height` px with content width `contentPx`. */
export function watermarkStyle(w: Watermark, contentPx: number): Record<string, string | number> {
  if (w.kind === "picture") return { width: contentPx * (w.scale || 1) * (w.scale ? 0.6 : 1), opacity: w.washout !== false ? 0.25 : 1 };
  const box = watermarkBox(w, contentPx * 0.75);
  return {
    fontFamily: w.font || "Calibri",
    fontSize: `${box.fontSize}pt`,
    color: w.color || "#c0c0c0",
    opacity: w.semitransparent !== false ? 0.5 : 1,
    transform: w.layout === "horizontal" ? "none" : "rotate(-45deg)",
  };
}

// ---- page borders ----

const STYLE_XML: Record<BorderLine["style"], string> = { single: "single", double: "double", dotted: "dotted", dashed: "dashed", thick: "thick" };
const CSS_STYLE: Record<BorderLine["style"], string> = { single: "solid", double: "double", dotted: "dotted", dashed: "dashed", thick: "solid" };

export function pgBordersXml(b: PageBorders | undefined): string {
  if (!b) return "";
  const sides = (["top", "left", "bottom", "right"] as const).filter((s) => b[s]);
  if (!sides.length) return "";
  const attrs = `${b.offsetFrom === "page" ? ' w:offsetFrom="page"' : ""}${b.display === "firstPage" ? ' w:display="firstPage"' : b.display === "notFirstPage" ? ' w:display="notFirstPage"' : ""}`;
  return `<w:pgBorders${attrs}>${sides
    .map((s) => {
      const l = b[s]!;
      return `<w:${s} w:val="${STYLE_XML[l.style]}" w:sz="${Math.max(2, Math.round(l.size * 8))}" w:space="${Math.min(31, Math.round(l.space))}" w:color="${hex(l.color, "auto")}"/>`;
    })
    .join("")}</w:pgBorders>`;
}

export function readPgBorders(el: El | undefined): PageBorders | undefined {
  if (!el) return undefined;
  const sides = readPBdr(el as never);
  if (!sides) return undefined;
  const out: PageBorders = {};
  for (const s of ["top", "left", "bottom", "right"] as const) if (sides[s]) out[s] = sides[s];
  const off = attr(el, "offsetFrom");
  if (off === "page") out.offsetFrom = "page";
  const d = attr(el, "display");
  if (d === "firstPage" || d === "notFirstPage") out.display = d;
  return out;
}

/** Where a page border is drawn on a page, in px from the page's edges, and its CSS. */
export function pageBorderBox(b: PageBorders, margins: { top: number; right: number; bottom: number; left: number }): { top: number; right: number; bottom: number; left: number; css: Record<string, string> } {
  const px = (pt: number) => (pt * 4) / 3;
  const pos = (side: "top" | "right" | "bottom" | "left") => {
    const l = b[side];
    const space = l?.space ?? (b.offsetFrom === "page" ? 24 : 4);
    return b.offsetFrom === "page" ? px(space) : Math.max(0, margins[side] - px(space));
  };
  const css: Record<string, string> = {};
  for (const s of ["top", "right", "bottom", "left"] as const) {
    const l = b[s];
    if (!l) continue;
    const w = l.style === "double" ? Math.max(2.25, l.size * 3) : l.size;
    css[`border${s[0].toUpperCase()}${s.slice(1)}`] = `${w}pt ${CSS_STYLE[l.style]} ${l.color || "#000000"}`;
  }
  return { top: pos("top"), right: pos("right"), bottom: pos("bottom"), left: pos("left"), css };
}

// ---- line numbers ----

export function lnNumXml(l: LineNumbers | undefined): string {
  if (!l) return "";
  return `<w:lnNumType w:countBy="${Math.max(1, Math.round(l.countBy))}"${l.start > 1 ? ` w:start="${l.start - 1}"` : ""}${l.distance ? ` w:distance="${tw(l.distance)}"` : ""} w:restart="${l.restart}"/>`;
}

export function readLnNum(el: El | undefined): LineNumbers | undefined {
  if (!el) return undefined;
  const countBy = Number(attr(el, "countBy")) || 0;
  if (countBy < 1) return undefined;
  const r = attr(el, "restart");
  return { countBy, start: (Number(attr(el, "start")) || 0) + 1, restart: r === "continuous" || r === "newSection" ? r : "newPage", distance: (Number(attr(el, "distance")) || 0) / 20 };
}

/** The numbers shown beside lines: `lines` lists each line's page and section, in order. */
export function lineNumberLabels(lines: { page: number; section: number; skip?: boolean }[], settingsFor: (section: number) => LineNumbers | undefined): (number | null)[] {
  const out: (number | null)[] = [];
  let n = 0;
  let prevPage = -1;
  let prevSection = -1;
  for (const l of lines) {
    const s = settingsFor(l.section);
    if (!s) {
      out.push(null);
      prevPage = l.page;
      prevSection = l.section;
      continue;
    }
    if ((s.restart === "newPage" && l.page !== prevPage) || (s.restart === "newSection" && l.section !== prevSection) || prevSection === -1) n = s.start - 1;
    prevPage = l.page;
    prevSection = l.section;
    if (l.skip) {
      out.push(null);
      continue;
    }
    n++;
    out.push(n % s.countBy === 0 ? n : null);
  }
  return out;
}
