// Spelling and grammar as you type: after a short pause the document's
// paragraphs are checked (each distinct paragraph text once, then cached),
// misspellings get a red wavy underline and grammar issues a blue double one.
// Right-click an underlined word for suggestions; the Spelling and grammar
// pane lists them all. The dictionary is Hunspell English (nspell) from
// /api/spell; added words stay in this browser.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNodeT } from "@tiptap/pm/model";
import { spellingIssues, grammarIssues, suggestions, type Issue } from "@/lib/docs/proofing";
import type { Speller } from "@/lib/slides/spell";

export type Found = Issue & { pos: number; end: number; id: string };
export type ProofState = { deco: DecorationSet; found: Found[]; ready: boolean };
export type ProofMenu = { x: number; y: number; found: Found };

export const proofKey = new PluginKey<ProofState>("wordProofing");

type Opts = { enabled: () => boolean; onMenu: (m: ProofMenu) => void; onPane: () => void };

const IGNORED_WORDS = new Set<string>();
const IGNORED_GRAMMAR = new Set<string>();
let speller: Speller | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, Issue[]>();

/** Text of a textblock with one character per position (inline nodes become U+FFFC; deleted tracked text is blanked). */
function blockText(node: PMNodeT): string {
  let s = "";
  node.forEach((c) => {
    if (c.isText) s += c.marks.some((m) => m.type.name === "deletion") ? " ".repeat(c.text!.length) : c.text!;
    else s += "￼".repeat(c.nodeSize);
  });
  return s;
}

function issuesOf(text: string): Issue[] {
  let v = cache.get(text);
  if (!v) {
    const sp = speller;
    v = [
      // suggestions are slow (nspell): worked out only when a word's menu or the pane shows them
      ...(sp ? spellingIssues(text, (w) => sp.correct(w), () => [], (w) => IGNORED_WORDS.has(w)) : []),
      ...grammarIssues(text, (k) => IGNORED_GRAMMAR.has(k)),
    ].sort((a, b) => a.from - b.from);
    if (cache.size > 4000) cache.clear();
    cache.set(text, v);
  }
  return v;
}

function check(doc: PMNodeT): ProofState {
  const found: Found[] = [];
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock" || node.content.size === 0) return false;
    const text = blockText(node);
    if (!text.trim()) return false;
    for (const i of issuesOf(text)) {
      const from = pos + 1 + i.from;
      const to = pos + 1 + i.to;
      const id = `${from}:${i.kind}`;
      found.push({ ...i, pos: from, end: to, id });
      decos.push(Decoration.inline(from, to, { class: i.kind === "spelling" ? "sp-err" : "gr-err", "data-proof": id, ...(i.kind === "grammar" ? { title: i.message } : {}) }));
    }
    return false;
  });
  return { deco: DecorationSet.create(doc, decos), found, ready: !!speller };
}

/** Re-check everything (after the dictionary loads, a word is added or an issue ignored). */
export function refreshProofing(view: EditorView) {
  cache.clear();
  view.dispatch(view.state.tr.setMeta(proofKey, { recheck: true }));
}

export function ignoreIssue(view: EditorView, f: Found) {
  if (f.kind === "spelling") IGNORED_WORDS.add(f.word);
  else IGNORED_GRAMMAR.add(`${f.word}\u0000${f.message}`);
  refreshProofing(view);
}

export function addToDictionary(view: EditorView, word: string) {
  speller?.add(word);
  refreshProofing(view);
}

const suggested = new Map<string, string[]>();
/** Replacements for an issue: the grammar rule's, or the dictionary's suggestions for a misspelling (cached per word). */
export function replacementsFor(f: Found): string[] {
  if (f.kind !== "spelling" || f.replacements.length || !speller) return f.replacements;
  let v = suggested.get(f.word);
  if (!v) {
    const sp = speller;
    v = suggestions(f.word, (x) => sp.correct(x), (x) => sp.suggest(x));
    if (suggested.size > 2000) suggested.clear();
    suggested.set(f.word, v);
  }
  return v;
}

export const proofingOf = (state: EditorState): ProofState | undefined => proofKey.getState(state);

export const Proofing = Extension.create<Opts>({
  name: "proofing",
  addOptions() {
    return { enabled: () => true, onMenu: () => {}, onPane: () => {} };
  },
  addKeyboardShortcuts() {
    return { F7: () => (this.options.onPane(), true) };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    const empty: ProofState = { deco: DecorationSet.empty, found: [], ready: false };
    return [
      new Plugin<ProofState>({
        key: proofKey,
        state: {
          init: () => empty,
          apply(tr: Transaction, old: ProofState, _o, next: EditorState): ProofState {
            const meta = tr.getMeta(proofKey) as { recheck?: boolean; off?: boolean } | undefined;
            if (meta?.off) return empty;
            if (meta?.recheck) return check(next.doc);
            if (!tr.docChanged) return old;
            // keep the marks in place while typing; the pause re-check refreshes them
            const found = old.found
              .map((f) => {
                const a = tr.mapping.mapResult(f.pos, 1);
                const b = tr.mapping.mapResult(f.end, -1);
                return a.deleted || b.deleted || b.pos <= a.pos ? null : { ...f, pos: a.pos, end: b.pos };
              })
              .filter((f): f is Found => !!f);
            return { deco: old.deco.map(tr.mapping, tr.doc), found, ready: old.ready };
          },
        },
        props: {
          decorations: (state) => (opts.enabled() ? proofKey.getState(state)?.deco : null),
          handleDOMEvents: {
            contextmenu: (view, event) => {
              if (!opts.enabled()) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!at) return false;
              const f = proofKey.getState(view.state)?.found.find((x) => at.pos >= x.pos && at.pos <= x.end);
              if (!f) return false;
              event.preventDefault();
              opts.onMenu({ x: event.clientX, y: event.clientY, found: f });
              return true;
            },
          },
        },
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let last: PMNodeT | null = null;
          let wasOn = false;
          const run = () => {
            timer = null;
            if (!opts.enabled()) return;
            last = view.state.doc;
            view.dispatch(view.state.tr.setMeta(proofKey, { recheck: true }).setMeta("addToHistory", false));
          };
          const schedule = (delay: number) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(run, delay);
          };
          const start = () => {
            if (!loading)
              loading = import("@/lib/slides/spell")
                .then((m) => m.loadSpeller())
                .then((s) => {
                  speller = s;
                  cache.clear();
                })
                .catch(() => {
                  /* grammar still works without the dictionary */
                });
            loading.then(() => {
              if (!view.isDestroyed) schedule(0);
            });
          };
          if (opts.enabled()) start();
          schedule(300);
          return {
            update: (v) => {
              const on = opts.enabled();
              if (on && !wasOn) start();
              if (!on && wasOn) v.dispatch(v.state.tr.setMeta(proofKey, { off: true }));
              wasOn = on;
              if (on && v.state.doc !== last) schedule(500);
            },
            destroy: () => {
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
