// Proofing: the words of a paragraph for the spelling checker, and a small
// set of grammar and style rules in the spirit of Word's editor (repeated
// words, capital letters, a/an, spacing, commonly confused words). Each issue
// is a range of the paragraph's text with a message and replacements.

export type Issue = { from: number; to: number; kind: "spelling" | "grammar"; word: string; message: string; replacements: string[] };

/** Words worth spell-checking, with their offsets: letters (with inner apostrophes and hyphens), not acronyms, numbers, links or e-mail addresses. */
export function wordsAt(text: string): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = [];
  const skip: [number, number][] = [];
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gi)) skip.push([m.index!, m.index! + m[0].length]);
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const i = m.index!;
    if (skip.some(([a, b]) => i >= a && i < b)) continue;
    const w = m[0].replace(/['’-]+$/, "");
    if (w.length < 2 || /\p{N}/u.test(w) || (w === w.toUpperCase() && w.length <= 6) || /\p{Lu}/u.test(w.slice(1))) continue;
    out.push({ word: w.replace(/’/g, "'"), index: i });
  }
  return out;
}

/** Spelling issues of a paragraph: each unknown word (possessive 's and hyphenated parts are checked as Word does). */
export function spellingIssues(text: string, correct: (w: string) => boolean, suggest: (w: string) => string[], ignored: (w: string) => boolean = () => false): Issue[] {
  const out: Issue[] = [];
  for (const { word, index } of wordsAt(text)) {
    if (ignored(word)) continue;
    const base = word.replace(/'s$/i, "");
    const ok = correct(word) || correct(base) || (word.includes("-") && word.split("-").every((p) => !p || correct(p))) || (/^\p{Lu}/u.test(word) && correct(word.toLowerCase()));
    if (ok) continue;
    out.push({ from: index, to: index + word.length, kind: "spelling", word, message: "Possible spelling mistake", replacements: suggest(word) });
  }
  return out;
}

const ABBREV = /(?:\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|St|No|Fig|Eq|approx|cf|al|Inc|Ltd|Jr|Sr|p|pp|vol|ed|ch|sec)|\b\p{Lu})\.$/u;
const AN_EXCEPT = /^(?:uni|use|usu|ure|uti|eu|ewe|one|once|ubiq|ufo)/i;
const A_EXCEPT = /^(?:hour|honest|honou?r|heir|herb\b)/i;
const CONFUSED: [RegExp, string, string][] = [
  [/\b(could|should|would|must|might) of\b/gi, "$1 have", "Use “have” after “could”, “should” and “would”."],
  [/\balot\b/gi, "a lot", "“A lot” is two words."],
  [/\b(more|less|better|worse|rather|other|greater|fewer|larger|smaller|higher|lower) then\b/gi, "$1 than", "Use “than” in comparisons."],
  [/\byour welcome\b/gi, "you're welcome", "Did you mean “you're” (you are)?"],
  [/\bits a\b(?= \w)/g, "it's a", "Did you mean “it's” (it is)?"],
  [/\bin regards to\b/gi, "in regard to", "Use “in regard to” or “regarding”."],
  [/\birregardless\b/gi, "regardless", "Use “regardless”."],
];

/** Grammar and style issues of a paragraph. */
export function grammarIssues(text: string, ignored: (key: string) => boolean = () => false): Issue[] {
  const out: Issue[] = [];
  const add = (from: number, to: number, message: string, replacements: string[]) => {
    const word = text.slice(from, to);
    if (!ignored(`${word}\u0000${message}`)) out.push({ from, to, kind: "grammar", word, message, replacements });
  };
  // repeated words: "the the"
  for (const m of text.matchAll(/\b(\p{L}+)(\s+)\1\b/giu)) {
    if (/^(?:that|had|is|bye|no|yeah|very|so|really|ha|bla|blah|can)$/i.test(m[1])) continue;
    add(m.index!, m.index! + m[0].length, "Repeated word", [m[1]]);
  }
  // a / an
  for (const m of text.matchAll(/\b([Aa]n?) ([\p{L}]+)/gu)) {
    const art = m[1];
    const next = m[2];
    const vowelSound = (/^[aeiou]/i.test(next) && !AN_EXCEPT.test(next)) || A_EXCEPT.test(next) || (/^[A-Z]{2,}$/.test(next) && /^[AEFHILMNORSX]/.test(next));
    const want = vowelSound ? "an" : "a";
    if (art.toLowerCase() !== want) {
      const fix = art[0] === "A" ? want[0].toUpperCase() + want.slice(1) : want;
      add(m.index!, m.index! + art.length, `Use “${want}” before ${vowelSound ? "a vowel sound" : "a consonant sound"}.`, [fix]);
    }
  }
  // a sentence starts with a capital letter
  for (const m of text.matchAll(/([.!?])(\s+)(\p{Ll})/gu)) {
    const before = text.slice(0, m.index! + 1);
    if (ABBREV.test(before) || /\.\.$/.test(before) || /\d\.$/.test(before)) continue;
    const at = m.index! + m[1].length + m[2].length;
    const w = /^\p{L}+/u.exec(text.slice(at))![0];
    add(at, at + w.length, "Start a sentence with a capital letter.", [w[0].toUpperCase() + w.slice(1)]);
  }
  const first = /^\s*(\p{Ll}\p{L}*)/u.exec(text);
  if (first && /[.!?]\s*$/.test(text) && text.trim().split(/\s+/).length > 2 && !/^(?:e\.g|i\.e|iPhone|iPad|eBay)/.test(first[1])) {
    const at = text.indexOf(first[1]);
    add(at, at + first[1].length, "Start a sentence with a capital letter.", [first[1][0].toUpperCase() + first[1].slice(1)]);
  }
  // "i" as a pronoun
  for (const m of text.matchAll(/(^|[\s(“"])(i)(?=['’]?(?:m|ve|ll|d)?\b(?![.-]))/g)) {
    const at = m.index! + m[1].length;
    add(at, at + 1, "The pronoun “I” is always a capital letter.", ["I"]);
  }
  // spacing
  for (const m of text.matchAll(/(\S)( {2,})(?=\S)/g)) add(m.index! + 1, m.index! + 1 + m[2].length, "Use a single space between words.", [" "]);
  for (const m of text.matchAll(/(\p{L}) +([,.;:!?])(?!\S*\p{L}\.)/gu)) add(m.index! + 1, m.index! + m[0].length, "Remove the space before the punctuation.", [m[2]]);
  // commonly confused words
  for (const [re, rep, msg] of CONFUSED)
    for (const m of text.matchAll(re)) {
      const fix = m[0].replace(new RegExp(re.source, re.flags.replace("g", "")), rep);
      add(m.index!, m.index! + m[0].length, msg, [/^\p{Lu}/u.test(m[0]) ? fix[0].toUpperCase() + fix.slice(1) : fix]);
    }
  return out.sort((a, b) => a.from - b.from);
}

/** Suggestions for a misspelling: swapped neighbouring letters first (the commonest slip), then the dictionary's own; in the word's case. */
export function suggestions(word: string, correct: (w: string) => boolean, dict: (w: string) => string[], max = 6): string[] {
  const out: string[] = [];
  const push = (w: string) => {
    if (w && w !== word && !out.includes(w)) out.push(w);
  };
  for (let i = 0; i + 1 < word.length; i++) {
    const t = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    if (correct(t)) push(t);
  }
  for (const w of dict(word)) push(w);
  const cap = /^\p{Lu}/u.test(word);
  return out.slice(0, max).map((w) => (cap ? w[0].toUpperCase() + w.slice(1) : w));
}
