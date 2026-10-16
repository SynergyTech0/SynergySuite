// Track changes and suggestions. Insertions and deletions are marks on the
// text (Word's w:ins and w:del): while tracking is on, typed or pasted text
// gets an insertion mark and deleted text stays in place with a deletion mark
// instead of being removed. Each change can then be accepted or rejected.
import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Fragment, Slice, type Mark as PMMark, type MarkType, type Node as PMNodeT } from "@tiptap/pm/model";

export type ChangeKind = "insertion" | "deletion";
export type TrackedChange = { kind: ChangeKind; author: string; date: string | null; from: number; to: number; text: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChanges: {
      /** accept the changes that touch [from, to] (the selection when omitted) */
      acceptChanges: (range?: { from: number; to: number }) => ReturnType;
      /** reject the changes that touch [from, to] (the selection when omitted) */
      rejectChanges: (range?: { from: number; to: number }) => ReturnType;
      acceptAllChanges: () => ReturnType;
      rejectAllChanges: () => ReturnType;
    };
  }
}

export const trackKey = new PluginKey("wordTrackChanges");
/** Meta that makes a transaction bypass tracking (imports, accept/reject, remote edits). */
export const TRACK_SKIP = "trackSkip";

const PALETTE = ["#b42318", "#1d4ed8", "#047857", "#7c3aed", "#b45309", "#be185d", "#0e7490"];
export function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const changeAttrs = () => ({
  id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-id"), renderHTML: (a: Record<string, unknown>) => (a.id ? { "data-id": a.id } : {}) },
  author: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-author") || "",
    renderHTML: (a: Record<string, unknown>) => ({ "data-author": a.author || "", style: `--tc-color: ${authorColor(String(a.author || ""))}` }),
  },
  date: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-date"), renderHTML: (a: Record<string, unknown>) => (a.date ? { "data-date": a.date } : {}) },
});

export const Insertion = Mark.create({
  name: "insertion",
  inclusive: false,
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: ({ HTMLAttributes }) => ["ins", mergeAttributes(HTMLAttributes, { class: "tc-ins" }), 0],
});

export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: "del" }],
  renderHTML: ({ HTMLAttributes }) => ["del", mergeAttributes(HTMLAttributes, { class: "tc-del" }), 0],
});

let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Every tracked change in the document: runs of text with the same kind and author. */
export function trackedChanges(doc: PMNodeT): TrackedChange[] {
  const out: TrackedChange[] = [];
  let last: TrackedChange | null = null;
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    for (const kind of ["deletion", "insertion"] as const) {
      const m = n.marks.find((x) => x.type.name === kind);
      if (!m) continue;
      const author = String(m.attrs.author || "");
      if (last && last.kind === kind && last.author === author && last.to === pos) {
        last.to = pos + n.nodeSize;
        last.text += n.text;
      } else {
        last = { kind, author, date: (m.attrs.date as string) || null, from: pos, to: pos + n.nodeSize, text: n.text || "" };
        out.push(last);
      }
      break;
    }
    return false;
  });
  return out;
}

/** Add the deletion mark to the text of a slice, dropping text the same author had only just inserted. */
function markDeleted(frag: Fragment, del: PMMark, ins: MarkType, author: string): Fragment {
  const nodes: PMNodeT[] = [];
  frag.forEach((n) => {
    if (n.isText) {
      const own = n.marks.find((m) => m.type === ins && m.attrs.author === author);
      if (own) return;
      if (n.marks.some((m) => m.type === del.type)) nodes.push(n);
      else nodes.push(n.mark(del.addToSet(n.marks)));
    } else if (n.isLeaf) nodes.push(n); // atoms (breaks, fields, pictures) are kept untracked
    else nodes.push(n.copy(markDeleted(n.content, del, ins, author)));
  });
  return Fragment.fromArray(nodes);
}

function hasText(frag: Fragment): boolean {
  let found = false;
  frag.descendants((n) => {
    if (n.isText && n.text) found = true;
    return !found;
  });
  return found;
}

type TrackOptions = { isTracking: () => boolean; author: () => string };

/** Turn the user's own edits in `trs` into tracked insertions and deletions. */
export function trackTransaction(trs: readonly Transaction[], oldState: EditorState, newState: EditorState, author: string): Transaction | null {
  const schema = newState.schema;
  const insType = schema.marks.insertion;
  const delType = schema.marks.deletion;
  if (!insType || !delType) return null;
  type Del = { pos: number; slice: Slice; from: number; to: number };
  const inserted: { from: number; to: number }[] = [];
  const deleted: Del[] = [];
  trs.forEach((tr, ti) => {
    if (!tr.docChanged || tr.getMeta(TRACK_SKIP) || tr.getMeta("y-sync$") || tr.getMeta(trackKey)) return;
    const later = trs.slice(ti + 1);
    const toFinal = (pos: number, assoc: number, fromStep: number) => {
      let p = tr.mapping.slice(fromStep).map(pos, assoc);
      for (const t of later) p = t.mapping.map(p, assoc);
      return p;
    };
    tr.steps.forEach((step, si) => {
      if (!(step instanceof ReplaceStep)) return;
      const s = step as unknown as { from: number; to: number; slice: Slice };
      const before = tr.docs[si];
      if (s.to > s.from) {
        const slice = before.slice(s.from, s.to);
        deleted.push({ pos: toFinal(s.from, -1, si + 1), slice, from: s.from, to: s.to });
      }
      if (s.slice.size > 0) inserted.push({ from: toFinal(s.from, 1, si + 1), to: toFinal(s.from + s.slice.size, -1, si + 1) });
    });
  });
  if (!inserted.length && !deleted.length) return null;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const tr = newState.tr;
  tr.setMeta(trackKey, true);
  for (const r of inserted) {
    if (r.to <= r.from) continue;
    // continue an adjacent insertion of the same author (one change, one id)
    const $from = newState.doc.resolve(r.from);
    const prev = $from.nodeBefore?.marks.find((m) => m.type === insType && m.attrs.author === author);
    const attrs = prev ? prev.attrs : { id: newId(), author, date: now };
    newState.doc.nodesBetween(r.from, r.to, (n, pos) => {
      if (!n.isText) return true;
      if (n.marks.some((m) => m.type === insType)) return false;
      tr.addMark(Math.max(pos, r.from), Math.min(pos + n.nodeSize, r.to), insType.create(attrs));
      return false;
    });
  }
  const delMark = delType.create({ id: newId(), author, date: now });
  let cursor: number | null = null;
  const sel = oldState.selection;
  // put deleted text back (last first, so earlier positions stay put)
  const order = deleted.map((d, i) => ({ d, i })).sort((a, b) => b.d.pos - a.d.pos);
  for (const { d } of order) {
    if (!hasText(d.slice.content)) continue; // structure only (joining paragraphs): not tracked
    const content = markDeleted(d.slice.content, delMark, insType, author);
    if (!hasText(content) && d.slice.openStart === 0 && d.slice.openEnd === 0) continue;
    const slice = new Slice(content, d.slice.openStart, d.slice.openEnd);
    const at = tr.mapping.map(d.pos, -1);
    const sizeBefore = tr.doc.content.size;
    try {
      tr.replace(at, at, slice);
    } catch {
      continue;
    }
    const added = tr.doc.content.size - sizeBefore;
    if (deleted.length === 1 && !inserted.length && sel.empty) {
      // Backspace leaves the cursor before the struck text, Delete after it
      cursor = sel.from === d.to ? at : at + added;
    } else if (deleted.length === 1 && !inserted.length) cursor = at + added;
  }
  if (cursor !== null) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, Math.max(0, Math.min(cursor, tr.doc.content.size))));
    } catch {
      /* keep the mapped selection */
    }
  }
  return tr.docChanged ? tr : null;
}

/** Accept or reject the tracked changes overlapping [from, to]. */
export function resolveChanges(state: EditorState, from: number, to: number, accept: boolean): Transaction | null {
  const insType = state.schema.marks.insertion;
  const delType = state.schema.marks.deletion;
  const tr = state.tr;
  tr.setMeta(TRACK_SKIP, true);
  const removals: { from: number; to: number }[] = [];
  // widen a collapsed range to the change under the cursor
  if (from === to) {
    const c = trackedChanges(state.doc).find((x) => x.from <= from && x.to >= to);
    if (c) {
      from = c.from;
      to = c.to;
    }
  }
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (!n.isText) return true;
    const a = Math.max(pos, from);
    const b = Math.min(pos + n.nodeSize, to);
    if (b <= a) return false;
    const ins = n.marks.find((m) => m.type === insType);
    const del = n.marks.find((m) => m.type === delType);
    if (del) {
      if (accept) removals.push({ from: a, to: b });
      else tr.removeMark(a, b, delType);
    } else if (ins) {
      if (accept) tr.removeMark(a, b, insType);
      else removals.push({ from: a, to: b });
    }
    return false;
  });
  // paragraphs whose whole text was a removed change (an inserted or deleted paragraph) go too
  const emptied = new Set<number>();
  for (const r of removals) {
    const $a = state.doc.resolve(r.from);
    const block = $a.parent;
    if (!block.isTextblock || $a.depth < 1) continue;
    const start = $a.start();
    const covered = removals.filter((x) => x.from >= start && x.to <= start + block.content.size).reduce((n, x) => n + x.to - x.from, 0);
    if (covered === block.content.size && block.childCount && $a.node($a.depth - 1).childCount > 1) emptied.add($a.before());
  }
  removals.sort((x, y) => y.from - x.from).forEach((r) => tr.delete(tr.mapping.map(r.from), tr.mapping.map(r.to)));
  [...emptied]
    .sort((x, y) => y - x)
    .forEach((pos) => {
      const at = tr.mapping.map(pos);
      const n = tr.doc.nodeAt(at);
      if (n && n.isTextblock && n.content.size === 0 && tr.doc.resolve(at).parent.childCount > 1) tr.delete(at, at + n.nodeSize);
    });
  return tr.docChanged ? tr : null;
}

export const TrackChanges = Extension.create<TrackOptions>({
  name: "wordTrackChanges",
  addOptions() {
    return { isTracking: () => false, author: () => "" };
  },
  addCommands() {
    return {
      acceptChanges:
        (range) =>
        ({ state, dispatch }) => {
          const r = range ?? { from: state.selection.from, to: state.selection.to };
          const tr = resolveChanges(state, r.from, r.to, true);
          if (tr && dispatch) dispatch(tr);
          return !!tr;
        },
      rejectChanges:
        (range) =>
        ({ state, dispatch }) => {
          const r = range ?? { from: state.selection.from, to: state.selection.to };
          const tr = resolveChanges(state, r.from, r.to, false);
          if (tr && dispatch) dispatch(tr);
          return !!tr;
        },
      acceptAllChanges:
        () =>
        ({ state, dispatch }) => {
          const tr = resolveChanges(state, 0, state.doc.content.size, true);
          if (tr && dispatch) dispatch(tr);
          return !!tr;
        },
      rejectAllChanges:
        () =>
        ({ state, dispatch }) => {
          const tr = resolveChanges(state, 0, state.doc.content.size, false);
          if (tr && dispatch) dispatch(tr);
          return !!tr;
        },
    };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key: trackKey,
        appendTransaction(trs, oldState, newState) {
          if (!opts.isTracking()) return null;
          return trackTransaction(trs, oldState, newState, opts.author() || "Unknown");
        },
      }),
    ];
  },
});
