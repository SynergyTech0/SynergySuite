// Compare documents (Review > Compare): the original and a revised version
// merged into one document where the differences are tracked changes, as
// Word's legal blackline does. Blocks are matched first (unchanged ones kept
// as they are); a changed paragraph is compared word by word; lists, tables
// and other containers are compared child by child. Formatting-only changes
// take the revised formatting without marking it.
import type { PMNode } from "./model";

type Mark = NonNullable<PMNode["marks"]>[number];
export type CompareStats = { insertions: number; deletions: number };

const CHANGE = new Set(["insertion", "deletion"]);
/** Without tracked-change marks (an existing deletion is dropped, an insertion kept as text). */
function clean(n: PMNode): PMNode | null {
  if (n.marks?.some((m) => m.type === "deletion")) return null;
  const marks = n.marks?.filter((m) => !CHANGE.has(m.type));
  const out: PMNode = { ...n };
  if (marks) {
    if (marks.length) out.marks = marks;
    else delete out.marks;
  }
  if (n.content) out.content = n.content.map(clean).filter((c): c is PMNode => !!c);
  return out;
}

const sig = (n: PMNode) => JSON.stringify(n);
const textOf = (n: PMNode): string => (n.type === "text" ? n.text || "" : (n.content || []).map(textOf).join(n.type === "paragraph" || n.type === "heading" ? "" : " "));
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function similarity(a: PMNode, b: PMNode): number {
  const A = words(textOf(a));
  const B = words(textOf(b));
  if (!A.size && !B.size) return a.type === b.type ? 1 : 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}

/** Longest common subsequence of two key lists: pairs of matching indexes. */
function lcs(a: string[], b: string[]): [number, number][] {
  // trim the common head and tail first: most edits are local
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  const n = A.length;
  const m = B.length;
  if (n && m) {
    if (n * m > 25_000_000) {
      // too big to align: everything in between counts as changed
    } else {
      const w = m + 1;
      const t = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = A[i] === B[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (A[i] === B[j]) pairs.push([head + i++, head + j++]);
        else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
        else j++;
      }
    }
  }
  for (let k = tail; k > 0; k--) pairs.push([a.length - k, b.length - k]);
  return pairs;
}

class Merger {
  seq = 0;
  stats: CompareStats = { insertions: 0, deletions: 0 };
  constructor(private author: string, private date: string) {}
  mark(kind: "insertion" | "deletion"): Mark {
    return { type: kind, attrs: { id: `cmp${(this.seq++).toString(36)}`, author: this.author, date: this.date } };
  }
  /** The whole node as inserted or deleted. */
  tag(n: PMNode, m: Mark): PMNode {
    if (n.type === "text") return { ...n, marks: [...(n.marks || []), m] };
    if (n.type === "codeBlock") return n; // no marks inside code
    return n.content ? { ...n, content: n.content.map((c) => this.tag(c, m)) } : n;
  }
  /** Blocks (or list items, rows, cells) of two versions merged. */
  blocks(a: PMNode[], b: PMNode[]): PMNode[] {
    const pairs = lcs(a.map(sig), b.map(sig));
    const out: PMNode[] = [];
    let i = 0;
    let j = 0;
    const gap = (i2: number, j2: number) => {
      // within a changed run: pair similar blocks of the same type, in order
      let jj = j;
      for (; i < i2; i++) {
        let k = -1;
        for (let x = jj; x < j2; x++)
          if (b[x].type === a[i].type && similarity(a[i], b[x]) >= 0.35) {
            k = x;
            break;
          }
        if (k < 0) {
          out.push(this.removed(a[i]));
          continue;
        }
        for (; jj < k; jj++) out.push(this.added(b[jj]));
        out.push(this.changed(a[i], b[k]));
        jj = k + 1;
      }
      for (; jj < j2; jj++) out.push(this.added(b[jj]));
      j = j2;
    };
    for (const [pi, pj] of pairs) {
      gap(pi, pj);
      out.push(b[pj]);
      i = pi + 1;
      j = pj + 1;
    }
    gap(a.length, b.length);
    return out;
  }
  added(n: PMNode): PMNode {
    if (textOf(n).trim()) this.stats.insertions++;
    return this.tag(n, this.mark("insertion"));
  }
  removed(n: PMNode): PMNode {
    if (textOf(n).trim()) this.stats.deletions++;
    return this.tag(n, this.mark("deletion"));
  }
  changed(a: PMNode, b: PMNode): PMNode {
    if (b.type === "codeBlock") return b;
    const inline = (b.content || []).every((c) => c.type === "text" || !c.content);
    if (b.content && inline && (a.content || []).every((c) => c.type === "text" || !c.content)) return { ...b, content: this.inline(a.content || [], b.content) };
    if (b.content) return { ...b, content: this.blocks(a.content || [], b.content) };
    return b;
  }
  /** Inline content compared word by word. */
  inline(a: PMNode[], b: PMNode[]): PMNode[] {
    const tokens = (ns: PMNode[]) => {
      const out: { key: string; node: PMNode }[] = [];
      for (const n of ns) {
        if (n.type !== "text") {
          out.push({ key: sig(n), node: n });
          continue;
        }
        const ms = JSON.stringify(n.marks || []);
        for (const t of (n.text || "").match(/\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu) || []) out.push({ key: `${t}\u0000${ms}`, node: { ...n, text: t } });
      }
      return out;
    };
    const A = tokens(a);
    const B = tokens(b);
    const pairs = lcs(A.map((t) => t.key), B.map((t) => t.key));
    const out: PMNode[] = [];
    let i = 0;
    let j = 0;
    const flush = (i2: number, j2: number) => {
      if (i < i2) {
        const m = this.mark("deletion");
        if (A.slice(i, i2).some((t) => (t.node.text || "x").trim())) this.stats.deletions++;
        for (; i < i2; i++) out.push(this.tag(A[i].node, m));
      }
      if (j < j2) {
        const m = this.mark("insertion");
        if (B.slice(j, j2).some((t) => (t.node.text || "x").trim())) this.stats.insertions++;
        for (; j < j2; j++) out.push(this.tag(B[j].node, m));
      }
    };
    for (const [pi, pj] of pairs) {
      flush(pi, pj);
      out.push(B[pj].node);
      i = pi + 1;
      j = pj + 1;
    }
    flush(A.length, B.length);
    // join neighbouring text with the same marks back into one node
    const merged: PMNode[] = [];
    for (const n of out) {
      const prev = merged[merged.length - 1];
      if (prev && prev.type === "text" && n.type === "text" && JSON.stringify(prev.marks || []) === JSON.stringify(n.marks || [])) prev.text += n.text || "";
      else merged.push(n.type === "text" ? { ...n } : n);
    }
    return merged;
  }
}

/** The original and revised documents' blocks merged, the differences as tracked changes by `author`. */
export function compareDocs(original: PMNode[], revised: PMNode[], author: string, date = new Date().toISOString().replace(/\.\d+Z$/, "Z")): { content: PMNode[]; stats: CompareStats } {
  const m = new Merger(author, date);
  const a = original.map(clean).filter((n): n is PMNode => !!n);
  const b = revised.map(clean).filter((n): n is PMNode => !!n);
  const content = m.blocks(a, b);
  return { content: content.length ? content : [{ type: "paragraph" }], stats: m.stats };
}
