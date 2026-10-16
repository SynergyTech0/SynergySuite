// Print pages (lib/sheet-print.ts) as an HTML document for the browser's
// print dialog: one fixed-size box per sheet of paper, everything placed in
// points, and @page rules so the printer uses the same paper and no margins
// of its own.
import type { BorderLine, CellBox, HeaderText, PageModel } from "./sheet-print.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;

const FONT_STACK: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  calibri: "Calibri, Carlito, Arial, sans-serif",
  "times new roman": "'Times New Roman', Times, serif",
  "courier new": "'Courier New', Courier, monospace",
};
const fontFamily = (f: string) => FONT_STACK[f.toLowerCase()] || `'${f.replace(/'/g, "")}', Arial, sans-serif`;

function borderCss(side: "top" | "right" | "bottom" | "left", b?: BorderLine) {
  if (!b) return "";
  const style = b.double ? "double" : b.dash ? (b.dash[0] < 1 ? "dotted" : "dashed") : "solid";
  return `border-${side}:${pt(b.double ? Math.max(b.width * 3, 1.5) : b.width)} ${style} ${b.color};`;
}

function cellHtml(c: CellBox): { fill: string; border: string; text: string } {
  const box = `left:${pt(c.x)};top:${pt(c.y)};width:${pt(c.w)};height:${pt(c.h)};`;
  const fill = c.fill ? `<div class="f" style="${box}background:${c.fill}"></div>` : "";
  const b = c.borders;
  const border = b.t || b.r || b.b || b.l ? `<div class="b" style="${box}${borderCss("top", b.t)}${borderCss("right", b.r)}${borderCss("bottom", b.b)}${borderCss("left", b.l)}"></div>` : "";
  if (!c.text) return { fill, border, text: "" };
  const s = c.style;
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
  const css = [
    `left:${pt(c.textX)};top:${pt(c.y)};width:${pt(c.textW)};height:${pt(c.h)}`,
    `font-family:${fontFamily(s.font)}`,
    `font-size:${pt(s.size)}`,
    s.bold ? "font-weight:bold" : "",
    s.italic ? "font-style:italic" : "",
    deco ? `text-decoration:${deco}` : "",
    `color:${s.color}`,
    `justify-content:${c.align === "left" ? "flex-start" : c.align === "right" ? "flex-end" : "center"}`,
    `align-items:${c.valign === "top" ? "flex-start" : c.valign === "middle" ? "center" : "flex-end"}`,
    `text-align:${c.align}`,
    c.wrap ? "white-space:pre-wrap;overflow-wrap:anywhere" : "white-space:pre",
  ]
    .filter(Boolean)
    .join(";");
  return { fill, border, text: `<div class="t" style="${css}"><span>${esc(c.text)}</span></div>` };
}

function hfHtml(t: HeaderText, y: number, page: PageModel, bottom: boolean) {
  const pos = bottom ? `bottom:${pt(page.height - y)}` : `top:${pt(y)}`;
  const part = (text: string, align: string) => (text ? `<div class="hf" style="${pos};left:${pt(page.margins.left)};width:${pt(page.margins.right - page.margins.left)};text-align:${align}">${esc(text)}</div>` : "");
  return part(t.left, "left") + part(t.center, "center") + part(t.right, "right");
}

export function pageHtml(p: PageModel): string {
  const parts = p.cells.map(cellHtml);
  const grid = p.grid
    .map((g) => (g.x1 === g.x2 ? `<div class="g" style="left:${pt(g.x1)};top:${pt(g.y1)};width:0.5pt;height:${pt(g.y2 - g.y1)}"></div>` : `<div class="g" style="left:${pt(g.x1)};top:${pt(g.y1)};width:${pt(g.x2 - g.x1)};height:0.5pt"></div>`))
    .join("");
  const images = p.images
    .map((im) => `<div class="clip" style="left:${pt(im.clip.x)};top:${pt(im.clip.y)};width:${pt(im.clip.w)};height:${pt(im.clip.h)}"><img src="${esc(im.src)}" alt="" style="left:${pt(im.x - im.clip.x)};top:${pt(im.y - im.clip.y)};width:${pt(im.w)};height:${pt(im.h)}"></div>`)
    .join("");
  return (
    parts.map((x) => x.fill).join("") +
    grid +
    parts.map((x) => x.border).join("") +
    parts.map((x) => x.text).join("") +
    images +
    (p.overlay || []).map((c) => cellHtml(c).text).join("") +
    hfHtml(p.header, p.headerY, p, false) +
    hfHtml(p.footer, p.footerY, p, true)
  );
}

export const PRINT_CSS = `
.sheet-page{position:relative;overflow:hidden;background:#fff;box-sizing:border-box}
.sheet-page>div{position:absolute;box-sizing:border-box}
.sheet-page .t{display:flex;overflow:hidden;padding:0 2pt;line-height:1.15}
.sheet-page .t span{max-width:100%}
.sheet-page .g{background:#c8c8c8}
.sheet-page .hf{font:9pt Arial,Helvetica,sans-serif;color:#000;white-space:pre}
.sheet-page .clip{overflow:hidden}
.sheet-page .clip img{position:absolute}
`;

/** A complete document for an iframe to print. */
export function pagesToHtml(pages: PageModel[], title: string): string {
  // Named pages let one job mix portrait and landscape sheets.
  const sizes = [...new Set(pages.map((p) => `${p.width}x${p.height}`))];
  const pageRules = sizes.map((s, i) => {
    const [w, h] = s.split("x").map(Number);
    return `@page p${i}{size:${pt(w)} ${pt(h)};margin:0}`;
  });
  const body = pages
    .map((p) => `<div class="sheet-page" style="width:${pt(p.width)};height:${pt(p.height)};page:p${sizes.indexOf(`${p.width}x${p.height}`)}">${pageHtml(p)}</div>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{margin:0}${pageRules.join("")}
html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet-page{break-after:page}
.sheet-page:last-child{break-after:auto}
${PRINT_CSS}
</style></head><body>${body}</body></html>`;
}
