// Navigation pane search: every match of a phrase in the document, with a
// little text either side and the heading it falls under, the way Word's
// Navigation pane lists results.
import type { Node as PMNodeT } from "@tiptap/pm/model";

export type NavOptions = { matchCase?: boolean; wholeWord?: boolean };
export type NavResult = { from: number; to: number; before: string; match: string; after: string; heading: string | null };

const CONTEXT = 30;

/** Text of a textblock with a position for each character (leaf inline nodes count as one placeholder char). */
function blockText(block: PMNodeT, start: number): { text: string; pos: number[] } {
  let text = "";
  const pos: number[] = [];
  block.descendants((n, p) => {
    if (n.isText) {
      for (let i = 0; i < n.text!.length; i++) {
        text += n.text![i];
        pos.push(start + p + i);
      }
    } else if (n.isLeaf) {
      text += n.type.name === "hardBreak" ? " " : "￼";
      pos.push(start + p);
    }
    return true;
  });
  return { text, pos };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function searchDocument(doc: PMNodeT, query: string, opts: NavOptions = {}, limit = 1000): NavResult[] {
  const q = query.trim() ? query : "";
  if (!q) return [];
  const re = new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${escapeRe(q)}(?![\\p{L}\\p{N}_])` : escapeRe(q), opts.matchCase ? "gu" : "giu");
  const out: NavResult[] = [];
  let heading: string | null = null;
  doc.descendants((node, p) => {
    if (out.length >= limit) return false;
    if (!node.isTextblock) return true;
    const { text, pos } = blockText(node, p + 1);
    if (node.type.name === "heading") heading = node.textContent.trim() || null;
    for (const m of text.matchAll(re)) {
      if (out.length >= limit) break;
      const i = m.index!;
      const end = i + m[0].length;
      const clean = (s: string) => s.replace(/￼/g, "").replace(/\s+/g, " ");
      out.push({
        from: pos[i],
        to: pos[end - 1] + 1,
        before: clean((i > CONTEXT ? "…" : "") + text.slice(Math.max(0, i - CONTEXT), i)),
        match: m[0],
        after: clean(text.slice(end, end + CONTEXT) + (end + CONTEXT < text.length ? "…" : "")),
        heading: node.type.name === "heading" ? null : heading,
      });
    }
    return false;
  });
  return out;
}
