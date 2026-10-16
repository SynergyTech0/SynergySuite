// Proofing: the words the spelling checker looks at, and the grammar rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordsAt, spellingIssues, grammarIssues, suggestions } from "../lib/docs/proofing";

test("words to check skip numbers, acronyms, mixed-case names, links and addresses", () => {
  assert.deepEqual(wordsAt("See NASA's site https://x.org/abc or mail a@b.com — it’s 42 well-known iPhone").map((w) => w.word), ["See", "site", "or", "mail", "it's", "well-known"]);
  assert.equal(wordsAt("Hello world")[1].index, 6);
});

test("spelling issues use the dictionary, possessives and hyphenated parts", () => {
  const dict = new Set(["the", "cat", "sat", "well", "known", "on", "mat"]);
  const correct = (w: string) => dict.has(w);
  const issues = spellingIssues("The cat's well-known sat on teh mat", correct, () => ["the"]);
  assert.deepEqual(issues.map((i) => [i.word, i.from, i.to, i.replacements]), [["teh", 28, 31, ["the"]]]);
  assert.equal(spellingIssues("teh", correct, () => [], (w) => w === "teh").length, 0);
});

test("grammar rules", () => {
  const g = (t: string) => grammarIssues(t).map((i) => [t.slice(i.from, i.to), i.replacements[0]]);
  assert.deepEqual(g("This is the the end."), [["the the", "the"]]);
  assert.deepEqual(g("We saw a apple and an banana and an hour and a university."), [["a", "an"], ["an", "a"]]);
  assert.deepEqual(g("It works. then it stops. See e.g. the guide."), [["then", "Then"]]);
  assert.deepEqual(g("Yesterday i went home and i'm tired."), [["i", "I"], ["i", "I"]]);
  assert.deepEqual(g("Two  spaces here , and there."), [["  ", " "], [" ,", ","]]);
  assert.deepEqual(g("You could of asked, it is better then nothing."), [["could of", "could have"], ["better then", "better than"]]);
  assert.deepEqual(g("Version 2.0 is out. Fig. 3 shows it."), []);
});

test("suggestions put swapped letters first and keep a capital", () => {
  const dict = new Set(["the", "ten", "tea"]);
  assert.deepEqual(suggestions("teh", (w) => dict.has(w), () => ["ten", "tea", "the"]), ["the", "ten", "tea"]);
  assert.deepEqual(suggestions("Teh", (w) => dict.has(w.toLowerCase()), () => ["ten"]), ["The", "Ten"]);
});
