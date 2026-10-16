// Thesaurus lookups on the WordNet-derived word list (public/thesaurus-en.json,
// built by scripts/build-thesaurus.mjs): base forms of inflected words, and
// replacements that keep the original's capitalisation and inflection.
export type Sense = { pos: string; meaning: string; synonyms: string[]; antonyms: string[] };
export type ThesaurusData = Record<string, [string, string, string[], string[]?][]>;

/** Candidate base forms of a word (plural, past, -ing, comparative...). */
export function baseForms(word: string): string[] {
  const w = word.toLowerCase().replace(/[’']s$/, "");
  const out = [w];
  const add = (x: string) => x.length > 1 && !out.includes(x) && out.push(x);
  const rules: [RegExp, string][] = [
    [/ies$/, "y"],
    [/ied$/, "y"],
    [/ier$/, "y"],
    [/iest$/, "y"],
    [/(ss|sh|ch|x|z|o)es$/, "$1"],
    [/s$/, ""],
    [/([^aeiou])\1(ed|ing|er|est)$/, "$1"],
    [/(ed|ing|er|est)$/, ""],
    [/(ed|ing|er|est)$/, "e"],
    [/d$/, ""],
    [/ly$/, ""],
    [/ily$/, "y"],
  ];
  for (const [re, r] of rules) if (re.test(w)) add(w.replace(re, r));
  return out;
}

/** The senses for a word: its own entry, else its base form's. */
export function lookup(data: ThesaurusData, word: string): { word: string; senses: Sense[] } | null {
  for (const w of baseForms(word.trim())) {
    const e = data[w];
    if (e && Array.isArray(e)) return { word: w, senses: e.map(([pos, meaning, synonyms, antonyms]) => ({ pos, meaning, synonyms, antonyms: antonyms || [] })) };
  }
  return null;
}

/** A synonym made to fit where the original word stood: same capitalisation, and the plural/past/-ing ending when it was a simple one. */
export function fitReplacement(original: string, base: string, synonym: string): string {
  let s = synonym;
  const o = original;
  const low = o.toLowerCase();
  if (low !== base && !s.includes(" ")) {
    if (low === `${base}s` || low === `${base}es` || (base.endsWith("y") && low === `${base.slice(0, -1)}ies`)) s = /(s|sh|ch|x|z)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`;
    else if (low.endsWith("ing") && !s.endsWith("ing")) s = s.endsWith("e") && !s.endsWith("ee") ? `${s.slice(0, -1)}ing` : `${s}ing`;
    else if (low.endsWith("ed") && !s.endsWith("ed")) s = s.endsWith("e") ? `${s}d` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ied` : `${s}ed`;
  }
  if (o.length > 1 && o === o.toUpperCase()) return s.toUpperCase();
  if (o[0] && o[0] === o[0].toUpperCase() && o[0] !== o[0].toLowerCase()) return s[0].toUpperCase() + s.slice(1);
  return s;
}
