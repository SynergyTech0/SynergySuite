// Accessibility checker: the issues Word's checker reports, found in the
// editor's JSON. Each issue names the block it is in (a top-level index and a
// path of child indexes) so the pane can go to it and offer a quick fix.
import type { PMNode } from "./model";

export type IssueKind =
  | "missingAltText"
  | "tableNoHeader"
  | "mergedCells"
  | "headingSkipped"
  | "emptyHeading"
  | "noHeadings"
  | "unclearLink"
  | "lowContrast"
  | "blankLines"
  | "repeatedSpaces"
  | "floatingObject"
  | "noTitle";
export type Issue = { kind: IssueKind; severity: "error" | "warning" | "tip"; message: string; fix: string; path: number[] };

export const ISSUE_INFO: Record<IssueKind, { title: string; why: string }> = {
  missingAltText: { title: "Missing alternative text", why: "Screen readers read alt text aloud so people who cannot see the picture know what it shows." },
  tableNoHeader: { title: "No header row in table", why: "A header row tells screen readers what each column holds." },
  mergedCells: { title: "Merged or split cells", why: "Screen readers keep track of a table by counting cells; merged cells confuse that." },
  headingSkipped: { title: "Skipped heading level", why: "Headings in order (1, 2, 3) let people navigate the document's structure." },
  emptyHeading: { title: "Empty heading", why: "An empty heading is read as a heading with no name." },
  noHeadings: { title: "No headings", why: "Headings let people skim and jump through a long document." },
  unclearLink: { title: "Unclear hyperlink text", why: "Link text such as \"click here\" or a bare address does not say where the link goes." },
  lowContrast: { title: "Hard-to-read text contrast", why: "Text needs a contrast ratio of at least 4.5:1 with its background." },
  blankLines: { title: "Repeated blank lines", why: "Empty paragraphs used for spacing are read out as \"blank\" again and again." },
  repeatedSpaces: { title: "Repeated blank characters", why: "Runs of spaces used for layout are read out and break up the text." },
  floatingObject: { title: "Object not inline", why: "Screen readers can lose floating pictures and shapes; inline ones stay in reading order." },
  noTitle: { title: "Document title missing", why: "The title is the first thing a screen reader announces." },
};

const UNCLEAR = /^(click here|here|link|this link|more|read more|this|learn more|go|details)$/i;

function lum(hex: string): number {
  const v = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const toHex = (c: unknown): string | null => {
  if (typeof c !== "string") return null;
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) return `#${m[1].toLowerCase()}`;
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c.trim());
  if (s) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  const r = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (r) return `#${[r[1], r[2], r[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return null;
};

const textOf = (n: PMNode): string => (n.type === "text" ? n.text || "" : (n.content || []).map(textOf).join(""));

export function checkAccessibility(doc: PMNode, opts: { title?: string; pageColor?: string } = {}): Issue[] {
  const out: Issue[] = [];
  const bg = toHex(opts.pageColor) || "#ffffff";
  if (!opts.title?.trim()) out.push({ kind: "noTitle", severity: "warning", message: "The document has no title.", fix: "Give the document a title.", path: [] });
  let lastLevel = 0;
  let headings = 0;
  let blankRun = 0;
  const walk = (n: PMNode, path: number[], cellBg: string | null) => {
    switch (n.type) {
      case "image":
      case "shape": {
        const alt = String(n.attrs?.alt || n.attrs?.title || "").trim();
        if (!alt && !n.attrs?.decorative) out.push({ kind: "missingAltText", severity: "error", message: n.type === "image" ? "Picture without alt text." : "Shape without alt text.", fix: "Add a description, or mark it as decorative.", path });
        if (n.attrs?.wrap && n.attrs.wrap !== "inline") out.push({ kind: "floatingObject", severity: "warning", message: "A floating object.", fix: "Set its text wrapping to In line with text.", path });
        break;
      }
      case "table": {
        const rows = n.content || [];
        const first = rows[0]?.content || [];
        if (!first.length || !first.every((c) => c.type === "tableHeader")) out.push({ kind: "tableNoHeader", severity: "error", message: "A table has no header row.", fix: "Make the first row a header row.", path });
        if (rows.some((r) => (r.content || []).some((c) => Number(c.attrs?.colspan) > 1 || Number(c.attrs?.rowspan) > 1))) out.push({ kind: "mergedCells", severity: "warning", message: "A table has merged cells.", fix: "Split the merged cells or simplify the table.", path });
        break;
      }
      case "heading": {
        const level = Number(n.attrs?.level) || 1;
        headings++;
        if (!textOf(n).trim()) out.push({ kind: "emptyHeading", severity: "warning", message: "An empty heading.", fix: "Type a heading or make it a normal paragraph.", path });
        if (lastLevel && level > lastLevel + 1) out.push({ kind: "headingSkipped", severity: "warning", message: `Heading ${level} follows heading ${lastLevel}.`, fix: `Use heading ${lastLevel + 1} here.`, path });
        lastLevel = level;
        break;
      }
      case "paragraph": {
        if (path.length === 1) {
          if (!textOf(n).trim() && !(n.content || []).some((c) => c.type !== "text" && c.type !== "hardBreak")) blankRun++;
          else blankRun = 0;
          if (blankRun === 3) out.push({ kind: "blankLines", severity: "tip", message: "Several empty paragraphs in a row.", fix: "Use paragraph spacing instead of empty lines.", path });
        }
        if (/ {4,}|\t{3,}/.test(textOf(n))) out.push({ kind: "repeatedSpaces", severity: "tip", message: "Spaces or tabs used for layout.", fix: "Use indents, tab stops or a table instead.", path });
        break;
      }
    }
    if (n.type === "text") {
      const link = n.marks?.find((m) => m.type === "link");
      const t = (n.text || "").trim();
      if (link && t && (UNCLEAR.test(t) || /^(https?:\/\/|www\.)\S+$/i.test(t))) out.push({ kind: "unclearLink", severity: "warning", message: `Link text "${t.length > 40 ? `${t.slice(0, 40)}…` : t}".`, fix: "Use text that says where the link goes.", path });
      const ts = n.marks?.find((m) => m.type === "textStyle");
      const hl = n.marks?.find((m) => m.type === "highlight");
      const fg = toHex(ts?.attrs?.color);
      const back = toHex(hl?.attrs?.color) || cellBg || bg;
      if (fg && t && contrast(fg, back) < 4.5) out.push({ kind: "lowContrast", severity: "warning", message: `Text colour ${fg} on ${back} (${contrast(fg, back).toFixed(1)}:1).`, fix: "Use a darker or lighter colour.", path });
      return;
    }
    const bgHere = (n.type === "tableCell" || n.type === "tableHeader") && toHex(n.attrs?.background) ? toHex(n.attrs?.background) : cellBg;
    (n.content || []).forEach((c, i) => walk(c, [...path, i], bgHere));
  };
  (doc.content || []).forEach((c, i) => walk(c, [i], null));
  const words = textOf(doc).split(/\s+/).filter(Boolean).length;
  if (!headings && words > 400) out.push({ kind: "noHeadings", severity: "tip", message: "A long document without headings.", fix: "Use heading styles for section titles.", path: [] });
  // one report per kind and block keeps the list short
  const seen = new Set<string>();
  return out.filter((i) => {
    const k = `${i.kind}|${i.path.slice(0, i.kind === "unclearLink" || i.kind === "lowContrast" ? 1 : undefined).join(",")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
