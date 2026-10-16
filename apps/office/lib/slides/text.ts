// Slide text helpers shared by the editor, renderer, importer and exporter.

/** CSS line-height of single spacing; a PowerPoint multiple m is stored as m × LINE_UNIT. */
export const LINE_UNIT = 1.2;

/** PowerPoint line-spacing multiple of a CSS line-height ("1.8" → 1.5); undefined when unset or exact (pt). */
export function lineMultiple(lh: string | undefined | null): number | undefined {
  if (!lh || /[a-z%]/i.test(lh)) return undefined;
  const n = Number(lh);
  return Number.isFinite(n) && n > 0 ? Math.round((n / LINE_UNIT) * 100) / 100 : undefined;
}

/** Points of a CSS length written in pt (or px), else undefined. */
export function cssPt(v: string | undefined | null): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  if (/pt\s*$/.test(v)) return n;
  if (/px\s*$/.test(v)) return Math.round(n * 0.75 * 10) / 10;
  return undefined;
}

/** Links that are safe to follow from slide text. */
export function safeHref(href: string | null | undefined): string {
  const h = (href || "").trim();
  return /^(https?:|mailto:|tel:)/i.test(h) ? h : "";
}
