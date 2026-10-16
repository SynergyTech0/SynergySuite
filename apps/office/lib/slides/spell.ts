// Spelling: the words of a deck, checked against a Hunspell dictionary
// (dictionary-en through nspell, loaded in the browser from /api/spell).
import { htmlText } from "./model";
import type { Slide } from "./model";

export type Misspelling = { slide: number; key: string; word: string };

/** Words worth checking: letters (with inner apostrophes and hyphens), not acronyms, codes, addresses or links. */
export function wordsOf(text: string): string[] {
  const clean = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\S+@\S+\.\S+/g, " ");
  const out: string[] = [];
  for (const m of clean.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const w = m[0].replace(/['’-]+$/, "").replace(/’/g, "'");
    if (w.length < 2 || /\p{N}/u.test(w) || (w === w.toUpperCase() && w.length <= 6)) continue;
    out.push(w);
  }
  return out;
}

/** Each distinct unknown word in each place it occurs (title, body, objects by z, table cells, notes). */
export function spellIssues(slides: Slide[], correct: (w: string) => boolean): Misspelling[] {
  const out: Misspelling[] = [];
  const memo = new Map<string, boolean>();
  const ok = (w: string) => {
    let v = memo.get(w);
    if (v === undefined) memo.set(w, (v = correct(w) || (w.includes("-") && w.split("-").every((p) => !p || correct(p)))));
    return v;
  };
  slides.forEach((s, i) => {
    const add = (key: string, text: string) => {
      const seen = new Set<string>();
      for (const w of wordsOf(text)) if (!seen.has(w) && !ok(w)) {
        seen.add(w);
        out.push({ slide: i, key, word: w });
      }
    };
    add("title", s.title);
    add("body", htmlText(s.body.startsWith("<") ? s.body : s.body.replace(/\n/g, " ")));
    for (const e of [...s.elements].sort((a, b) => a.z - b.z)) {
      if (e.type === "text" || e.type === "shape") add(e.id, htmlText(e.html || ""));
      else if (e.type === "table") e.rows.forEach((r, ri) => r.forEach((c, ci) => add(`${e.id}:${ri}:${ci}`, c.text)));
    }
    add("notes", s.notes);
  });
  return out;
}

export type Speller = { correct(w: string): boolean; suggest(w: string): string[]; add(w: string): void };

let loading: Promise<Speller> | null = null;
const PERSONAL = "syn-spell-words";

/** The English speller, with the viewer's own added words (kept in this browser). */
export function loadSpeller(): Promise<Speller> {
  if (!loading) {
    loading = (async () => {
      const r = await fetch("/api/spell?lang=en");
      if (!r.ok) throw new Error(`the dictionary could not be loaded (${r.status})`);
      const { aff, dic } = (await r.json()) as { aff: string; dic: string };
      const nspell = (await import("nspell")).default;
      const sp = nspell(aff, dic);
      let mine: string[] = [];
      try {
        mine = JSON.parse(localStorage.getItem(PERSONAL) || "[]");
      } catch {
        mine = [];
      }
      for (const w of mine) if (typeof w === "string") sp.add(w);
      return {
        correct: (w: string) => sp.correct(w),
        suggest: (w: string) => sp.suggest(w).slice(0, 6),
        add: (w: string) => {
          sp.add(w);
          try {
            const list = JSON.parse(localStorage.getItem(PERSONAL) || "[]");
            if (!list.includes(w)) localStorage.setItem(PERSONAL, JSON.stringify([...list, w].slice(-2000)));
          } catch {
            // the word stays added for this visit
          }
        },
      };
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}
