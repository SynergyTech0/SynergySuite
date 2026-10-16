// Fonts for text the PDF's built-in fonts (Western European only) can't
// show: Noto Sans for each script, embedded as a subset of the glyphs used
// (jsPDF writes a ToUnicode map, so the text can be searched and copied).
// The editor fetches them from /api/fonts/<file>, which serves them from
// PDF_FONT_DIR or fetches and caches them from PDF_FONT_BASE (by default
// the Noto and Google Fonts repositories on GitHub).

/** Each font file and where it lives upstream (relative to PDF_FONT_BASE). */
export const FONT_SOURCES: Record<string, string> = {
  "NotoSans-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  "NotoSans-Bold.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf",
  "NotoSansArabic-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf",
  "NotoSansHebrew-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansHebrew/hinted/ttf/NotoSansHebrew-Regular.ttf",
  "NotoSansThai-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansThai/hinted/ttf/NotoSansThai-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  "NotoSansBengali-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf",
  "NotoSansTamil-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansTamil/hinted/ttf/NotoSansTamil-Regular.ttf",
  "NotoSansArmenian-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Regular.ttf",
  "NotoSansGeorgian-Regular.ttf": "notofonts/notofonts.github.io/main/fonts/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Regular.ttf",
  "NotoSansSC.ttf": "google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
  "NotoSansTC.ttf": "google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
  "NotoSansJP.ttf": "google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
  "NotoSansKR.ttf": "google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
};
export const DEFAULT_FONT_BASE = "https://raw.githubusercontent.com/";

/**
 * Scripts whose letters change shape or order with their neighbours (Arabic
 * joining, right-to-left, Indic conjuncts). jsPDF lays glyphs out one by one,
 * so these are drawn by the browser as a picture, with the same text laid
 * invisibly over it in the embedded font so it can still be found.
 */
export const COMPLEX = /[\u0590-\u08ff\u0900-\u0eff\ufb1d-\ufdff\ufe70-\ufeff]/;

const WIN_ANSI_CHAR = /[\x20-\x7e\xa0-\xff\u20ac\u2018\u2019\u201a\u201c\u201d\u201e\u2022\u2013\u2014\u2026\u2122\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2020\u2021\u2030\u2039\u203a\n\t]/;

/** The font file for one character, or null when the built-in fonts have it. `cjk` picks the CJK face for the whole text. */
export function fontFileFor(ch: string, cjk: "SC" | "TC" | "JP" | "KR", bold = false): string | null {
  if (WIN_ANSI_CHAR.test(ch)) return null;
  const c = ch.codePointAt(0)!;
  if (c >= 0x0590 && c <= 0x05ff) return "NotoSansHebrew-Regular.ttf";
  if ((c >= 0x0600 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return "NotoSansArabic-Regular.ttf";
  if (c >= 0xfb1d && c <= 0xfb4f) return "NotoSansHebrew-Regular.ttf";
  if (c >= 0x0900 && c <= 0x097f) return "NotoSansDevanagari-Regular.ttf";
  if (c >= 0x0980 && c <= 0x09ff) return "NotoSansBengali-Regular.ttf";
  if (c >= 0x0b80 && c <= 0x0bff) return "NotoSansTamil-Regular.ttf";
  if (c >= 0x0e00 && c <= 0x0e7f) return "NotoSansThai-Regular.ttf";
  if (c >= 0x0530 && c <= 0x058f) return "NotoSansArmenian-Regular.ttf";
  if ((c >= 0x10a0 && c <= 0x10ff) || (c >= 0x2d00 && c <= 0x2d2f)) return "NotoSansGeorgian-Regular.ttf";
  if (
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x2e80 && c <= 0x9fff) ||
    (c >= 0xa960 && c <= 0xa97f) ||
    (c >= 0xac00 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x20000 && c <= 0x3134f)
  )
    return `NotoSans${cjk}.ttf`;
  // Latin, Greek, Cyrillic and Vietnamese beyond Windows-1252, symbols, and anything else.
  return bold ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf";
}

/** Which CJK face suits a text: Japanese with kana, Korean with Hangul, otherwise Simplified Chinese. */
export function cjkOf(text: string): "SC" | "TC" | "JP" | "KR" {
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return "JP";
  if (/[\u1100-\u11ff\uac00-\ud7af]/.test(text)) return "KR";
  return "SC";
}

/** A text as runs of characters that share a font (null: the built-in font). */
export function fontRuns(text: string, bold = false): { text: string; font: string | null }[] {
  const cjk = cjkOf(text);
  const runs: { text: string; font: string | null }[] = [];
  for (const ch of text) {
    // Marks and joiners stay with the character before them (in Noto Sans after a built-in one).
    const mark = /[\u0300-\u036f\u200c\u200d\ufe00-\ufe0f]/.test(ch);
    const font = mark && runs.length ? runs[runs.length - 1].font || (bold ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf") : fontFileFor(ch, cjk, bold);
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch;
    else runs.push({ text: ch, font });
  }
  return runs;
}
