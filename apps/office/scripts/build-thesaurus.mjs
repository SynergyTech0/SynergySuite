// Builds public/thesaurus-en.json, the Docs thesaurus, from the WordNet
// database files (Princeton WordNet 3.x, WordNet License: free to use, copy,
// modify and distribute with its copyright notice, which is kept in
// public/thesaurus-en.LICENSE). Get the files from the wordnet-db npm package:
//
//   npm pack wordnet-db@3.1.14 && tar xzf wordnet-db-3.1.14.tgz
//   node scripts/build-thesaurus.mjs package/dict public/thesaurus-en.json
//
// Output: { "word": [[pos, meaning, [synonyms...], [antonyms...]?], ...] } for
// common senses (WordNet tag counts) of single words and short phrases.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

const [dictDir, out] = process.argv.slice(2);
if (!dictDir || !out) {
  console.error("usage: node scripts/build-thesaurus.mjs <wordnet dict dir> <out.json>");
  process.exit(1);
}
const POS = { noun: "n", verb: "v", adj: "a", adv: "r" };
const POS_NAME = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
const lines = (f) => readFileSync(path.join(dictDir, f), "utf8").split("\n").filter((l) => l && !l.startsWith(" "));

// synsets: offset+pos -> { words, gloss, ptrs }
const synsets = new Map();
for (const [name, p] of Object.entries(POS)) {
  for (const l of lines(`data.${name}`)) {
    const [head, gloss = ""] = l.split(" | ");
    const t = head.trim().split(" ");
    const offset = t[0];
    const ss = t[2];
    const wc = parseInt(t[3], 16);
    const words = [];
    for (let i = 0; i < wc; i++) words.push(t[4 + i * 2].replace(/\(.*\)$/, "").replace(/_/g, " "));
    let k = 4 + wc * 2;
    const pc = parseInt(t[k++], 10);
    const ptrs = [];
    for (let i = 0; i < pc; i++, k += 4) ptrs.push({ sym: t[k], off: t[k + 1], pos: t[k + 2] === "s" ? "a" : t[k + 2], st: t[k + 3] });
    synsets.set(`${offset}${p}`, { words, gloss: gloss.split(";")[0].trim(), ptrs, ss });
  }
}
// sense tag counts: lemma%pos -> count per synset
const counts = new Map();
const posNum = { 1: "n", 2: "v", 3: "a", 4: "r", 5: "a" };
for (const l of lines("index.sense")) {
  const [key, off, , cnt] = l.split(" ");
  const lemma = key.split("%")[0].replace(/_/g, " ");
  const p = posNum[key.split("%")[1][0]];
  counts.set(`${lemma}|${off}${p}`, Number(cnt) || 0);
}
const ok = (w) => /^[a-z][a-z' -]*$/.test(w) && w.split(" ").length <= 3 && w.length <= 30;
const data = Object.create(null);
for (const [name, p] of Object.entries(POS)) {
  for (const l of lines(`index.${name}`)) {
    const t = l.trim().split(" ");
    const lemma = t[0].replace(/_/g, " ");
    if (!ok(lemma) || lemma.includes(" ")) continue;
    const pcnt = Number(t[3]);
    const offs = t.slice(t.length - Number(t[2]));
    void pcnt;
    const senses = [];
    // only words people use: at least one sense seen in WordNet's tagged corpus
    if (!offs.some((off) => (counts.get(`${lemma}|${off}${p}`) || 0) > 0)) continue;
    offs.forEach((off, i) => {
      const s = synsets.get(`${off}${p}`);
      if (!s) return;
      const c = counts.get(`${lemma}|${off}${p}`) || 0;
      if (i > 0 && c === 0) return; // rare senses are left out
      const syn = new Set(s.words.filter((w) => w.toLowerCase() !== lemma && ok(w.toLowerCase())));
      // similar adjectives and the general term give more choices
      for (const ptr of s.ptrs) {
        if ((ptr.sym === "&" || (ptr.sym === "@" && syn.size < 3)) && syn.size < 12) for (const w of synsets.get(`${ptr.off}${ptr.pos}`)?.words || []) if (w.toLowerCase() !== lemma && ok(w.toLowerCase())) syn.add(w);
      }
      const ant = new Set();
      for (const ptr of s.ptrs) if (ptr.sym === "!") for (const w of synsets.get(`${ptr.off}${ptr.pos}`)?.words || []) if (ok(w.toLowerCase())) ant.add(w);
      if (!syn.size) return;
      const entry = [POS_NAME[s.ss] || POS_NAME[p], s.gloss.slice(0, 60), [...syn].slice(0, 12)];
      if (ant.size) entry.push([...ant].slice(0, 4));
      senses.push(entry);
    });
    if (senses.length) (data[lemma] ||= []).push(...senses.slice(0, 6));
  }
}
for (const k of Object.keys(data)) data[k] = data[k].slice(0, 8);
writeFileSync(out, JSON.stringify(data));
const lic = path.join(dictDir, "..", "LICENSE");
try {
  copyFileSync(lic, out.replace(/\.json$/, ".LICENSE"));
} catch {
  /* keep the existing notice */
}
console.log(`${Object.keys(data).length} words, ${(JSON.stringify(data).length / 1e6).toFixed(1)} MB`);
