// Paragraph and character formatting beyond the basics: paragraph borders
// and shading, tab stops, drop caps, widow/orphan control, character
// spacing, and changing case. Plain data with the CSS and WordprocessingML
// for each, shared by the editor, the .docx reader/writer and the tests.

export type BorderLine = { style: "single" | "double" | "dotted" | "dashed" | "thick"; size: number; color: string; space: number };
export type ParaBorders = Partial<Record<"top" | "bottom" | "left" | "right" | "between", BorderLine>>;
export type TabStop = { pos: number; align: "left" | "center" | "right" | "decimal"; leader?: "dot" | "hyphen" | "underscore" };

export const BORDER_SIDES = ["top", "bottom", "left", "right", "between"] as const;
export const DEFAULT_TAB = 36; // pt, Word's default tab stops every half inch

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex6 = (c: string) => (/^#?[0-9a-f]{6}$/i.test(c) ? c.replace("#", "").toUpperCase() : "auto");
const tw = (pt: number) => Math.round(pt * 20);

/** Parse a JSON attribute value safely. */
export function parseJson<T>(v: unknown): T | null {
  if (v && typeof v === "object") return v as T;
  if (typeof v !== "string" || !v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

// ---- borders and shading ----

const CSS_BORDER: Record<BorderLine["style"], string> = { single: "solid", double: "double", dotted: "dotted", dashed: "dashed", thick: "solid" };

export function bordersCss(b: ParaBorders | null, shading?: string | null): string {
  const out: string[] = [];
  if (b) {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const l = b[side];
      if (!l) continue;
      const w = l.style === "double" ? Math.max(2.25, l.size * 3) : l.style === "thick" ? Math.max(1.5, l.size) : l.size;
      out.push(`border-${side}: ${w}pt ${CSS_BORDER[l.style] || "solid"} ${l.color || "#000000"}`);
      // Word's border spacing pushes the border away from the text
      out.push(`margin-${side}: ${l.space}pt`);
    }
  }
  if (shading) out.push(`background-color: ${shading}`);
  return out.join("; ");
}

export function pBdrXml(b: ParaBorders | null): string {
  if (!b) return "";
  const parts = BORDER_SIDES.filter((s) => b[s]).map((s) => {
    const l = b[s]!;
    const val = l.style === "thick" ? "thick" : l.style;
    return `<w:${s} w:val="${val}" w:sz="${Math.max(2, Math.round(l.size * 8))}" w:space="${Math.round(l.space)}" w:color="${hex6(l.color)}"/>`;
  });
  return parts.length ? `<w:pBdr>${parts.join("")}</w:pBdr>` : "";
}

export function shdXml(fill: string | null | undefined): string {
  return fill && /^#[0-9a-f]{6}$/i.test(fill) ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(fill)}"/>` : "";
}

type El = { local: string; attrs: Record<string, string>; children: El[] };
const at = (e: El, k: string) => e.attrs[k] ?? e.attrs[`w:${k}`];

/** w:pBdr to borders (null when only "nil"/"none"). */
export function readPBdr(pBdr: El | undefined, color: (v: string | undefined) => string = (v) => (v && v !== "auto" ? `#${v.toLowerCase()}` : "#000000")): ParaBorders | null {
  if (!pBdr) return null;
  const out: ParaBorders = {};
  for (const c of pBdr.children) {
    if (!(BORDER_SIDES as readonly string[]).includes(c.local)) continue;
    const v = at(c, "val");
    if (!v || v === "nil" || v === "none") continue;
    const style: BorderLine["style"] = v === "double" ? "double" : v === "dotted" ? "dotted" : /dash/i.test(v) ? "dashed" : v === "thick" ? "thick" : "single";
    out[c.local as keyof ParaBorders] = { style, size: Math.round((Number(at(c, "sz")) || 4) / 8 * 100) / 100, color: color(at(c, "color")), space: Number(at(c, "space")) || 0 };
  }
  return Object.keys(out).length ? out : null;
}

// ---- tab stops ----

export function tabsXml(tabs: TabStop[] | null): string {
  if (!tabs?.length) return "";
  return `<w:tabs>${[...tabs]
    .sort((a, b) => a.pos - b.pos)
    .map((t) => `<w:tab w:val="${t.align}"${t.leader ? ` w:leader="${t.leader}"` : ""} w:pos="${tw(t.pos)}"/>`)
    .join("")}</w:tabs>`;
}

export function readTabs(tabs: El | undefined): TabStop[] | null {
  if (!tabs) return null;
  const out: TabStop[] = [];
  for (const c of tabs.children) {
    if (c.local !== "tab") continue;
    const v = at(c, "val") || "left";
    if (v === "clear" || v === "bar") continue;
    const align: TabStop["align"] = v === "center" ? "center" : v === "right" || v === "end" ? "right" : v === "decimal" ? "decimal" : "left";
    const l = at(c, "leader");
    const leader = l === "dot" || l === "middleDot" ? "dot" : l === "hyphen" ? "hyphen" : l === "underscore" || l === "heavy" ? "underscore" : undefined;
    out.push({ pos: Math.round((Number(at(c, "pos")) || 0) / 20 * 100) / 100, align, ...(leader ? { leader } : {}) });
  }
  return out.length ? out.sort((a, b) => a.pos - b.pos) : null;
}

/**
 * Width of a tab character: from `x` (pt from the paragraph's left text edge)
 * to the next stop. `after` is the width of the text after the tab up to the
 * next tab or the line end, for right, centre and decimal stops (`beforeDot`:
 * the part before the decimal point).
 */
export function tabWidth(x: number, stops: TabStop[] | null, after: number, beforeDot = after): { width: number; leader?: TabStop["leader"] } {
  const list = (stops || []).filter((s) => s.pos > x + 0.5).sort((a, b) => a.pos - b.pos);
  for (const s of list) {
    const w = s.align === "left" ? s.pos - x : s.align === "right" ? s.pos - x - after : s.align === "center" ? s.pos - x - after / 2 : s.pos - x - beforeDot;
    if (w > 0.5) return { width: w, leader: s.leader };
  }
  // default stops every half inch after the last custom one
  const next = (Math.floor(x / DEFAULT_TAB) + 1) * DEFAULT_TAB;
  return { width: Math.max(1, next - x) };
}

// ---- drop caps ----

/** w:framePr for a drop-cap paragraph. */
export function dropCapFrameXml(lines: number, margin: boolean): string {
  return `<w:framePr w:dropCap="${margin ? "margin" : "drop"}" w:lines="${Math.max(2, Math.min(10, lines))}" w:wrap="around" w:vAnchor="text" w:hAnchor="${margin ? "page" : "text"}"/>`;
}

// ---- change case ----

export type CaseMode = "upper" | "lower" | "sentence" | "title" | "toggle";
export const CASE_MODES: { id: CaseMode; label: string }[] = [
  { id: "sentence", label: "Sentence case." },
  { id: "lower", label: "lowercase" },
  { id: "upper", label: "UPPERCASE" },
  { id: "title", label: "Capitalize Each Word" },
  { id: "toggle", label: "tOGGLE cASE" },
];

/** Text in another case. `atStart`: the text starts a sentence (for sentence case). */
export function changeCase(text: string, mode: CaseMode, atStart = true): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "toggle":
      return [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
    case "title":
      return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
    case "sentence": {
      let start = atStart;
      let out = "";
      for (const c of text.toLowerCase()) {
        if (/\p{L}/u.test(c)) {
          out += start ? c.toUpperCase() : c;
          start = false;
        } else {
          out += c;
          if (/[.!?]/.test(c)) start = true;
        }
      }
      // the pronoun "I"
      return out.replace(/(^|\s)i(?=['’\s.,!?;:]|$)/g, "$1I");
    }
  }
}

/** Shift+F3 cycles: lowercase → UPPERCASE → Capitalize Each Word → lowercase. */
export function nextCase(text: string): CaseMode {
  if (text === text.toLowerCase()) return "upper";
  if (text === text.toUpperCase()) return "title";
  return "lower";
}

export { esc as escXml };
