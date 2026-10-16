// Design: document themes (heading and body fonts, colours) and style sets
// (Word's Design tab). A theme changes the fonts and colours the styles use
// and is written to the .docx as word/theme/theme1.xml; a style set restyles
// Normal, Title and the headings.
import type { DocStyle, ParaProps, RunProps } from "./model";

export type Theme = {
  id: string;
  name: string;
  major: string; // headings
  minor: string; // body
  dk2: string;
  lt2: string;
  accents: [string, string, string, string, string, string];
  hlink: string;
  folHlink: string;
};

export const THEMES: Theme[] = [
  { id: "office", name: "Office", major: "Calibri Light", minor: "Calibri", dk2: "#44546a", lt2: "#e7e6e6", accents: ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"], hlink: "#0563c1", folHlink: "#954f72" },
  { id: "office2023", name: "Office 2023", major: "Aptos Display", minor: "Aptos", dk2: "#0e2841", lt2: "#e8e8e8", accents: ["#156082", "#e97132", "#196b24", "#0f9ed5", "#a02b93", "#4ea72e"], hlink: "#467886", folHlink: "#96607d" },
  { id: "georgia", name: "Classic", major: "Georgia", minor: "Georgia", dk2: "#3b3b3b", lt2: "#f2efe9", accents: ["#8c3b2e", "#b8860b", "#556b2f", "#2f4f6f", "#7b5c99", "#a0522d"], hlink: "#8c3b2e", folHlink: "#7b5c99" },
  { id: "modern", name: "Modern", major: "Trebuchet MS", minor: "Verdana", dk2: "#1d3557", lt2: "#f1faee", accents: ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#6d597a", "#264653"], hlink: "#457b9d", folHlink: "#6d597a" },
  { id: "serif", name: "Times", major: "Cambria", minor: "Times New Roman", dk2: "#1f2a44", lt2: "#eeece1", accents: ["#1f497d", "#c0504d", "#9bbb59", "#8064a2", "#4bacc6", "#f79646"], hlink: "#1f497d", folHlink: "#8064a2" },
  { id: "plain", name: "Plain", major: "Arial", minor: "Arial", dk2: "#262626", lt2: "#f2f2f2", accents: ["#595959", "#7f7f7f", "#a5a5a5", "#262626", "#404040", "#bfbfbf"], hlink: "#0563c1", folHlink: "#954f72" },
];

export const themeOf = (id: string | undefined): Theme => THEMES.find((t) => t.id === id) || THEMES[0];

/** Word's heading colour: the first accent at 75% luminance ("accent1, darker 25%"). */
export function darker(hex: string, f = 0.75): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const HEADINGS = ["Title", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6", "TOCHeading"];

/**
 * The styles to save so the document takes `next` instead of `prev`: fonts and
 * colours that came from the old theme follow the new one; anything a person
 * set by hand stays.
 */
export function restyleForTheme(styles: DocStyle[], prev: Theme, next: Theme): DocStyle[] {
  const out: DocStyle[] = [];
  const colorMap = new Map<string, string>([
    [prev.accents[0], next.accents[0]],
    [darker(prev.accents[0]), darker(next.accents[0])],
    [darker(prev.accents[0], 0.5), darker(next.accents[0], 0.5)],
    [prev.dk2, next.dk2],
    // the built-in heading colours of the default theme
    ["#2f5496", darker(next.accents[0])],
    ["#1f3763", darker(next.accents[0], 0.5)],
  ]);
  for (const s of styles) {
    const run: RunProps = { ...s.run };
    let changed = false;
    if (run.font && (run.font === prev.major || (HEADINGS.includes(s.id) && run.font === "Calibri Light"))) {
      run.font = next.major;
      changed = true;
    } else if (run.font && run.font === prev.minor) {
      run.font = next.minor;
      changed = true;
    } else if (!run.font && s.id === "Normal") {
      run.font = next.minor;
      changed = true;
    }
    const c = run.color?.toLowerCase();
    if (c && colorMap.has(c) && colorMap.get(c) !== c) {
      run.color = colorMap.get(c);
      changed = true;
    }
    if (changed) out.push({ ...s, run });
  }
  return out;
}

export type StyleSet = { id: string; name: string; styles: Record<string, { run?: RunProps; para?: ParaProps }> };

/** Style sets: Normal, Title and headings 1-3 (colours use the theme's first accent). */
export function styleSets(t: Theme): StyleSet[] {
  const a = t.accents[0];
  const dark = darker(a);
  return [
    {
      id: "default",
      name: "Default",
      styles: {
        Normal: { run: { font: t.minor, size: 11 }, para: { spaceAfter: 8, lineHeight: "1.08" } },
        Title: { run: { font: t.major, size: 28, color: undefined, bold: false }, para: { spaceAfter: 0, lineHeight: "1", align: undefined, borders: undefined, shading: undefined } },
        Heading1: { run: { font: t.major, size: 16, color: dark, bold: false, caps: false }, para: { spaceBefore: 12, spaceAfter: 0, align: undefined, borders: undefined, shading: undefined } },
        Heading2: { run: { font: t.major, size: 13, color: dark, bold: false, caps: false }, para: { spaceBefore: 2, spaceAfter: 0, align: undefined, borders: undefined, shading: undefined } },
        Heading3: { run: { font: t.major, size: 12, color: darker(a, 0.5), bold: false, caps: false }, para: { spaceBefore: 2, spaceAfter: 0, align: undefined } },
      },
    },
    {
      id: "basic",
      name: "Basic (Simple)",
      styles: {
        Normal: { run: { font: t.minor, size: 10.5 }, para: { spaceAfter: 10, lineHeight: "1.15" } },
        Title: { run: { font: t.major, size: 26, color: "#000000", bold: false }, para: { spaceAfter: 6, lineHeight: "1", align: undefined, borders: undefined, shading: undefined } },
        Heading1: { run: { font: t.major, size: 14, color: "#000000", bold: true, caps: false }, para: { spaceBefore: 18, spaceAfter: 4, align: undefined, borders: undefined, shading: undefined } },
        Heading2: { run: { font: t.major, size: 12, color: "#000000", bold: true, caps: false }, para: { spaceBefore: 10, spaceAfter: 2, align: undefined, borders: undefined, shading: undefined } },
        Heading3: { run: { font: t.major, size: 11, color: "#404040", bold: true, caps: false }, para: { spaceBefore: 8, spaceAfter: 2, align: undefined } },
      },
    },
    {
      id: "lines",
      name: "Lines (Distinctive)",
      styles: {
        Normal: { run: { font: t.minor, size: 11 }, para: { spaceAfter: 8, lineHeight: "1.08" } },
        Title: { run: { font: t.major, size: 30, color: dark, bold: false }, para: { spaceAfter: 8, lineHeight: "1", align: undefined, borders: { bottom: { style: "single", size: 1.5, color: a, space: 4 } }, shading: undefined } },
        Heading1: { run: { font: t.major, size: 16, color: dark, bold: false, caps: false }, para: { spaceBefore: 18, spaceAfter: 4, align: undefined, borders: { bottom: { style: "single", size: 0.75, color: a, space: 1 } }, shading: undefined } },
        Heading2: { run: { font: t.major, size: 13, color: dark, bold: true, caps: false }, para: { spaceBefore: 10, spaceAfter: 2, align: undefined, borders: undefined, shading: undefined } },
        Heading3: { run: { font: t.major, size: 12, color: dark, bold: false, caps: false }, para: { spaceBefore: 6, spaceAfter: 0, align: undefined } },
      },
    },
    {
      id: "shaded",
      name: "Shaded",
      styles: {
        Normal: { run: { font: t.minor, size: 11 }, para: { spaceAfter: 8, lineHeight: "1.15" } },
        Title: { run: { font: t.major, size: 28, color: dark, bold: true }, para: { spaceAfter: 10, lineHeight: "1", align: undefined, borders: undefined, shading: undefined } },
        Heading1: { run: { font: t.major, size: 14, color: "#ffffff", bold: true, caps: true }, para: { spaceBefore: 14, spaceAfter: 6, align: undefined, borders: undefined, shading: a } },
        Heading2: { run: { font: t.major, size: 12, color: dark, bold: true, caps: false }, para: { spaceBefore: 10, spaceAfter: 2, align: undefined, borders: undefined, shading: "#e8eef8" } },
        Heading3: { run: { font: t.major, size: 11, color: dark, bold: true, caps: false }, para: { spaceBefore: 6, spaceAfter: 0, align: undefined } },
      },
    },
    {
      id: "centered",
      name: "Centered",
      styles: {
        Normal: { run: { font: t.minor, size: 11 }, para: { spaceAfter: 8, lineHeight: "1.15" } },
        Title: { run: { font: t.major, size: 30, color: dark, bold: false }, para: { spaceAfter: 12, lineHeight: "1", align: "center", borders: undefined, shading: undefined } },
        Heading1: { run: { font: t.major, size: 15, color: dark, bold: false, caps: true }, para: { spaceBefore: 18, spaceAfter: 6, align: "center", borders: undefined, shading: undefined } },
        Heading2: { run: { font: t.major, size: 12, color: dark, bold: false, caps: true }, para: { spaceBefore: 10, spaceAfter: 4, align: "center", borders: undefined, shading: undefined } },
        Heading3: { run: { font: t.major, size: 11, color: dark, bold: true, caps: false }, para: { spaceBefore: 6, spaceAfter: 2, align: "center" } },
      },
    },
  ];
}

/** The styles to save for a style set. */
export function applyStyleSet(styles: DocStyle[], set: StyleSet): DocStyle[] {
  const out: DocStyle[] = [];
  for (const [id, o] of Object.entries(set.styles)) {
    const s = styles.find((x) => x.id === id);
    if (!s) continue;
    const clean = <T extends object>(v: T) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as T;
    const run = clean({ ...s.run, ...(o.run || {}) });
    for (const [k, v] of Object.entries(o.run || {})) if (v === undefined || v === false) delete (run as Record<string, unknown>)[k];
    const para = clean({ ...(s.para || {}), ...(o.para || {}) });
    for (const [k, v] of Object.entries(o.para || {})) if (v === undefined) delete (para as Record<string, unknown>)[k];
    out.push({ ...s, run, para });
  }
  return out;
}

const hx = (c: string) => c.replace("#", "").toUpperCase();

/** word/theme/theme1.xml for a theme. */
export function themeXml(t: Theme): string {
  const clr = (name: string, v: string) => `<a:${name}><a:srgbClr val="${hx(v)}"/></a:${name}>`;
  const font = (name: string, f: string) => `<a:${name}><a:latin typeface="${f.replace(/[<>&"]/g, "")}" panose=""/><a:ea typeface=""/><a:cs typeface=""/></a:${name}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${t.name}"><a:themeElements>` +
    `<a:clrScheme name="${t.name}"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    clr("dk2", t.dk2) +
    clr("lt2", t.lt2) +
    t.accents.map((a, i) => clr(`accent${i + 1}`, a)).join("") +
    clr("hlink", t.hlink) +
    clr("folHlink", t.folHlink) +
    `</a:clrScheme><a:fontScheme name="${t.name}">${font("majorFont", t.major)}${font("minorFont", t.minor)}</a:fontScheme>` +
    `<a:fmtScheme name="${t.name}"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>` +
    "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
  );
}

/** The theme a .docx uses, matched by its fonts and first accent, else a custom one. */
export function matchTheme(major: string | undefined, minor: string | undefined, accent1: string | undefined): Theme | null {
  if (!major && !minor) return null;
  return THEMES.find((t) => t.major === major && t.minor === minor && (!accent1 || t.accents[0] === accent1)) || null;
}
