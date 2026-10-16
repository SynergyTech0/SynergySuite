// Workbook themes and the cell style gallery.
//
// A theme is Excel's: twelve colors (two darks, two lights, six accents and
// the two link colors) and a heading and a body font. The cell styles of the
// gallery (Good, Bad, Heading 1, Accent 1, 20% - Accent 1, …) take their
// colors and fonts from the theme. Choosing another theme recolors the cells
// that use the old theme's colors (and its tints), and swaps its fonts, so a
// workbook keeps its look in the new colors.
import { applyTint, type UniverStyle } from "./xlsx";

export type ThemeColors = {
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
};
export type WorkbookTheme = { name: string; colors: ThemeColors; fonts: { major: string; minor: string } };

export const THEME_RESOURCE = "SHEET_SYNERGY_THEME";
export const COLOR_SLOTS: (keyof ThemeColors)[] = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

const theme = (name: string, c: string, major: string, minor: string): WorkbookTheme => {
  const v = c.split(" ");
  return { name, colors: Object.fromEntries(COLOR_SLOTS.map((k, i) => [k, v[i]])) as ThemeColors, fonts: { major, minor } };
};

/** The themes on offer. The first is the default (and what Excel 2013–2021 uses). */
export const THEMES: WorkbookTheme[] = [
  theme("Office", "000000 FFFFFF 44546A E7E6E6 4472C4 ED7D31 A5A5A5 FFC000 5B9BD5 70AD47 0563C1 954F72", "Calibri Light", "Calibri"),
  theme("Office 2023", "000000 FFFFFF 0E2841 E8E8E8 156082 E97132 196B24 0F9ED5 A02B93 4EA72E 467886 96607D", "Aptos Display", "Aptos"),
  theme("Grayscale", "000000 FFFFFF 000000 F8F8F8 DDDDDD B2B2B2 969696 808080 5F5F5F 4D4D4D 5F5F5F 919191", "Calibri Light", "Calibri"),
  theme("Ocean", "000000 FFFFFF 17406D DBEFF9 0F6FC6 009DD9 0BD0D9 10CF9B 7CCA62 A5C249 F49100 85DFD0", "Calibri Light", "Calibri"),
  theme("Forest", "000000 FFFFFF 2B3A1F E9EDE1 4E8542 7FA246 A3B640 C8A847 8F6C3E 6B7F86 3E7A9E 7E6B8F", "Georgia", "Calibri"),
  theme("Sunset", "000000 FFFFFF 4B2A1E F3E7E1 E84C22 FFBD47 B64926 FF8427 CC9900 B22600 CC9900 666699", "Gill Sans MT", "Gill Sans MT"),
  theme("Violet", "000000 FFFFFF 373545 DCD8DC 6F6F74 A7B789 BEAE98 92A9B9 9C8265 8D6974 67AABF B1B5AB", "Century Gothic", "Century Gothic"),
  theme("Paper", "000000 FFFFFF 444D26 FEFAC9 A5B592 F3A447 E7BC29 D092A7 9C85C0 809EC2 8E58B6 7F6F6F", "Constantia", "Constantia"),
];

export const DEFAULT_THEME = THEMES[0];

export function themeFrom(o: unknown): WorkbookTheme {
  const x = (o && typeof o === "object" ? o : {}) as Partial<WorkbookTheme>;
  const hex = (v: unknown, d: string) => (typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : d);
  const colors = Object.fromEntries(COLOR_SLOTS.map((k) => [k, hex((x.colors as any)?.[k], DEFAULT_THEME.colors[k])])) as ThemeColors;
  return {
    name: typeof x.name === "string" && x.name ? x.name.slice(0, 60) : "Custom",
    colors,
    fonts: { major: typeof x.fonts?.major === "string" ? x.fonts.major : DEFAULT_THEME.fonts.major, minor: typeof x.fonts?.minor === "string" ? x.fonts.minor : DEFAULT_THEME.fonts.minor },
  };
}

// ---- The cell style gallery ----

export type CellStyleDef = { name: string; group: "Good, Bad and Neutral" | "Data and Model" | "Titles and Headings" | "Themed Cell Styles" | "Number Format"; style: (t: WorkbookTheme) => UniverStyle };

const rgb = (hex: string) => ({ rgb: `#${hex.toUpperCase()}` });
const line = (s: number, hex: string) => ({ s, cl: rgb(hex) });
const box = (s: number, hex: string) => ({ t: line(s, hex), r: line(s, hex), b: line(s, hex), l: line(s, hex) });
const THIN = 1;
const DOUBLE = 7;
const MEDIUM = 8;
const THICK = 13;

/** Excel's built-in cell styles, as they look in a theme. "Normal" clears the formatting. */
export const CELL_STYLES: CellStyleDef[] = [
  { name: "Normal", group: "Good, Bad and Neutral", style: (t) => ({ ff: t.fonts.minor, fs: 11, bl: 0, it: 0, cl: rgb(t.colors.dk1), bg: null, bd: null, n: null }) },
  { name: "Bad", group: "Good, Bad and Neutral", style: () => ({ bg: rgb("FFC7CE"), cl: rgb("9C0006") }) },
  { name: "Good", group: "Good, Bad and Neutral", style: () => ({ bg: rgb("C6EFCE"), cl: rgb("006100") }) },
  { name: "Neutral", group: "Good, Bad and Neutral", style: () => ({ bg: rgb("FFEB9C"), cl: rgb("9C5700") }) },
  { name: "Calculation", group: "Data and Model", style: () => ({ bg: rgb("F2F2F2"), cl: rgb("FA7D00"), bl: 1, bd: box(THIN, "7F7F7F") }) },
  { name: "Check Cell", group: "Data and Model", style: (t) => ({ bg: rgb("A5A5A5"), cl: rgb(t.colors.lt1), bl: 1, bd: box(DOUBLE, "3F3F3F") }) },
  { name: "Explanatory Text", group: "Data and Model", style: () => ({ cl: rgb("7F7F7F"), it: 1 }) },
  { name: "Input", group: "Data and Model", style: () => ({ bg: rgb("FFCC99"), cl: rgb("3F3F76"), bd: box(THIN, "7F7F7F") }) },
  { name: "Linked Cell", group: "Data and Model", style: () => ({ cl: rgb("FA7D00"), bd: { b: line(DOUBLE, "FF8001") } }) },
  { name: "Note", group: "Data and Model", style: () => ({ bg: rgb("FFFFCC"), bd: box(THIN, "B2B2B2") }) },
  { name: "Output", group: "Data and Model", style: () => ({ bg: rgb("F2F2F2"), cl: rgb("3F3F3F"), bl: 1, bd: box(THIN, "3F3F3F") }) },
  { name: "Warning Text", group: "Data and Model", style: () => ({ cl: rgb("FF0000") }) },
  { name: "Heading 1", group: "Titles and Headings", style: (t) => ({ fs: 15, bl: 1, cl: rgb(t.colors.dk2), bd: { b: line(THICK, t.colors.accent1) } }) },
  { name: "Heading 2", group: "Titles and Headings", style: (t) => ({ fs: 13, bl: 1, cl: rgb(t.colors.dk2), bd: { b: line(THICK, applyTint(t.colors.accent1, 0.5)) } }) },
  { name: "Heading 3", group: "Titles and Headings", style: (t) => ({ fs: 11, bl: 1, cl: rgb(t.colors.dk2), bd: { b: line(MEDIUM, applyTint(t.colors.accent1, 0.4)) } }) },
  { name: "Heading 4", group: "Titles and Headings", style: (t) => ({ fs: 11, bl: 1, cl: rgb(t.colors.dk2) }) },
  { name: "Title", group: "Titles and Headings", style: (t) => ({ ff: t.fonts.major, fs: 18, cl: rgb(t.colors.dk2) }) },
  { name: "Total", group: "Titles and Headings", style: (t) => ({ bl: 1, bd: { t: line(THIN, t.colors.accent1), b: line(DOUBLE, t.colors.accent1) } }) },
  ...([1, 2, 3, 4, 5, 6] as const).flatMap((n): CellStyleDef[] => {
    const slot = `accent${n}` as keyof ThemeColors;
    return [
      { name: `20% - Accent${n}`, group: "Themed Cell Styles", style: (t) => ({ bg: rgb(applyTint(t.colors[slot], 0.8)), cl: rgb(t.colors.dk1) }) },
      { name: `40% - Accent${n}`, group: "Themed Cell Styles", style: (t) => ({ bg: rgb(applyTint(t.colors[slot], 0.6)), cl: rgb(t.colors.dk1) }) },
      { name: `60% - Accent${n}`, group: "Themed Cell Styles", style: (t) => ({ bg: rgb(applyTint(t.colors[slot], 0.4)), cl: rgb(t.colors.lt1) }) },
      { name: `Accent${n}`, group: "Themed Cell Styles", style: (t) => ({ bg: rgb(t.colors[slot]), cl: rgb(t.colors.lt1) }) },
    ];
  }),
  { name: "Comma", group: "Number Format", style: () => ({ n: { pattern: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)' } }) },
  { name: "Comma [0]", group: "Number Format", style: () => ({ n: { pattern: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)' } }) },
  { name: "Currency", group: "Number Format", style: () => ({ n: { pattern: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)' } }) },
  { name: "Currency [0]", group: "Number Format", style: () => ({ n: { pattern: '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)' } }) },
  { name: "Percent", group: "Number Format", style: () => ({ n: { pattern: "0%" } }) },
];

// ---- Changing the theme ----

/** The tints Excel's color picker offers for each theme color. */
const TINTS = [0, 0.8, 0.6, 0.4, -0.25, -0.5, 0.5];

/** old color → new color, for every theme color and its tints. */
export function recolorMap(from: WorkbookTheme, to: WorkbookTheme): Map<string, string> {
  const map = new Map<string, string>();
  for (const k of COLOR_SLOTS) {
    if (from.colors[k] === to.colors[k]) continue;
    for (const t of TINTS) {
      const a = (t ? applyTint(from.colors[k], t) : from.colors[k]).toUpperCase();
      // A color two slots share (and their tints) follows the first slot.
      if (!map.has(a)) map.set(a, (t ? applyTint(to.colors[k], t) : to.colors[k]).toUpperCase());
    }
  }
  return map;
}

const fixColor = (c: any, map: Map<string, string>) => {
  if (!c || typeof c.rgb !== "string") return c;
  const hex = c.rgb.replace(/^#/, "").toUpperCase();
  const to = map.get(hex);
  return to ? { ...c, rgb: `#${to}` } : c;
};

/** A cell style in the new theme's colors and fonts (the same object when nothing changes). */
export function restyle(style: UniverStyle | null | undefined, map: Map<string, string>, fonts: Map<string, string>): UniverStyle | null | undefined {
  if (!style) return style;
  let out: any = style;
  const set = (k: string, v: unknown) => {
    if (out === style) out = { ...style };
    out[k] = v;
  };
  const cl = fixColor(style.cl, map);
  if (cl !== style.cl) set("cl", cl);
  const bg = fixColor(style.bg, map);
  if (bg !== style.bg) set("bg", bg);
  if (style.bd) {
    let bd: any = style.bd;
    for (const side of ["t", "r", "b", "l"] as const) {
      const b = (style.bd as any)[side];
      if (!b?.cl) continue;
      const c = fixColor(b.cl, map);
      if (c !== b.cl) {
        if (bd === style.bd) bd = { ...style.bd };
        bd[side] = { ...b, cl: c };
      }
    }
    if (bd !== style.bd) set("bd", bd);
  }
  if (typeof style.ff === "string" && fonts.has(style.ff)) set("ff", fonts.get(style.ff));
  return out;
}

export function fontMap(from: WorkbookTheme, to: WorkbookTheme): Map<string, string> {
  const m = new Map<string, string>();
  if (from.fonts.major !== to.fonts.major) m.set(from.fonts.major, to.fonts.major);
  if (from.fonts.minor !== to.fonts.minor) m.set(from.fonts.minor, to.fonts.minor);
  return m;
}

// ---- In .xlsx: xl/theme/theme1.xml ----

/** Reads a theme part's colors and fonts. */
export function readThemeXml(xml: string | undefined, name?: string): WorkbookTheme | null {
  if (!xml) return null;
  const scheme = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml);
  if (!scheme) return null;
  const colors: Partial<ThemeColors> = {};
  for (const k of COLOR_SLOTS) {
    const block = new RegExp(`<a:${k}>([\\s\\S]*?)</a:${k}>`).exec(scheme[1])?.[1] || "";
    const hex = (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(block) || /lastClr="([0-9A-Fa-f]{6})"/.exec(block))?.[1];
    if (hex) colors[k] = hex.toUpperCase();
  }
  const font = (tag: string) => new RegExp(`<a:${tag}>[\\s\\S]*?<a:latin typeface="([^"]*)"`).exec(xml)?.[1];
  const themeName = /<a:theme\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
  return themeFrom({ name: name || themeName || "Custom", colors, fonts: { major: font("majorFont"), minor: font("minorFont") } });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Puts a theme's colors, fonts and name into a theme part. */
export function patchThemeXml(xml: string, t: WorkbookTheme): string {
  let out = xml.replace(/(<a:theme\b[^>]*\bname=")[^"]*(")/, `$1${esc(t.name)}$2`);
  out = out.replace(/(<a:clrScheme\b[^>]*\bname=")[^"]*(")/, `$1${esc(t.name)}$2`);
  for (const k of COLOR_SLOTS) {
    out = out.replace(new RegExp(`(<a:${k}>)[\\s\\S]*?(</a:${k}>)`), `$1<a:srgbClr val="${t.colors[k]}"/>$2`);
  }
  out = out.replace(/(<a:majorFont>[\s\S]*?<a:latin typeface=")[^"]*(")/, `$1${esc(t.fonts.major)}$2`);
  out = out.replace(/(<a:minorFont>[\s\S]*?<a:latin typeface=")[^"]*(")/, `$1${esc(t.fonts.minor)}$2`);
  return out;
}
