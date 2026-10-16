// Deck-wide design themes. A theme supplies the default background, text and
// title colours, font, and an optional accent bar across the top of each slide.
// Per-slide backgrounds and per-run formatting always win over the theme.

export type Theme = {
  id: string;
  name: string;
  bg: string; // hex, no '#'
  title: string;
  text: string;
  accent: string;
  font: string; // CSS font-family list
  bar: boolean; // accent bar across the top
};

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

export const THEMES: Theme[] = [
  { id: "synergy", name: "Synergy", bg: "FFFFFF", title: "1F2430", text: "333333", accent: "4F46E5", font: SANS, bar: true },
  { id: "plain", name: "Office", bg: "FFFFFF", title: "000000", text: "000000", accent: "4472C4", font: "Calibri, Carlito, " + SANS, bar: false },
  { id: "midnight", name: "Midnight", bg: "111827", title: "F9FAFB", text: "D1D5DB", accent: "38BDF8", font: SANS, bar: true },
  { id: "ocean", name: "Ocean", bg: "ECFEFF", title: "0E7490", text: "164E63", accent: "06B6D4", font: SANS, bar: true },
  { id: "sunset", name: "Sunset", bg: "FFF7ED", title: "9A3412", text: "431407", accent: "F97316", font: SANS, bar: true },
  { id: "forest", name: "Forest", bg: "F0FDF4", title: "14532D", text: "1A2E05", accent: "16A34A", font: SANS, bar: true },
  { id: "editorial", name: "Editorial", bg: "FAFAF9", title: "1C1917", text: "292524", accent: "B91C1C", font: SERIF, bar: false },
];

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Deck-level edits to a theme's colours (Design > Customize theme). */
export type ThemeColors = { bg?: string; title?: string; text?: string; accent?: string; bar?: boolean };
const HEX = /^[0-9A-F]{6}$/i;
export function themeColors(v: unknown): ThemeColors | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: ThemeColors = {};
  for (const k of ["bg", "title", "text", "accent"] as const) if (typeof o[k] === "string" && HEX.test(o[k] as string)) out[k] = (o[k] as string).toUpperCase();
  if (typeof o.bar === "boolean") out.bar = o.bar;
  return Object.keys(out).length ? out : undefined;
}
/** A theme with the deck's colour edits applied. */
export function effectiveTheme(id: string | undefined, colors?: ThemeColors): Theme {
  const t = themeById(id);
  return colors ? { ...t, ...colors } : t;
}

/** Theme accent bar height in slide px. */
export const BAR_H = 12;

/** Colours offered in the fill / outline / text pickers (PowerPoint-like swatches). */
export const SWATCHES = [
  "000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47",
  "4F46E5", "0EA5E9", "10B981", "F59E0B", "EF4444", "8B5CF6", "EC4899", "14B8A6", "1F2430", "64748B",
];
