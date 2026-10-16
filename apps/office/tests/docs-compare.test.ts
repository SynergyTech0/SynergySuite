// Compare documents: differences become tracked insertions and deletions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDocs } from "../lib/docs/compare";
import type { PMNode } from "../lib/docs/model";

const p = (...parts: (string | PMNode)[]): PMNode => ({ type: "paragraph", content: parts.map((x) => (typeof x === "string" ? { type: "text", text: x } : x)) });
const runs = (n: PMNode) => (n.content || []).map((c) => [c.text, (c.marks || []).map((m) => m.type).join(",")]);

test("unchanged documents have no changes", () => {
  const doc = [p("One."), p("Two.")];
  const r = compareDocs(doc, doc, "A");
  assert.deepEqual(r.content, doc);
  assert.deepEqual(r.stats, { insertions: 0, deletions: 0 });
});

test("a changed paragraph is compared word by word", () => {
  const r = compareDocs([p("The quick brown fox jumps.")], [p("The quick red fox leaps high.")], "Reviewer", "2026-01-01T00:00:00Z");
  assert.deepEqual(runs(r.content[0]), [
    ["The quick ", ""],
    ["brown", "deletion"],
    ["red", "insertion"],
    [" fox ", ""],
    ["jumps", "deletion"],
    ["leaps high", "insertion"],
    [".", ""],
  ]);
  const m = r.content[0].content![1].marks![0];
  assert.equal(m.attrs!.author, "Reviewer");
  assert.equal(m.attrs!.date, "2026-01-01T00:00:00Z");
  assert.deepEqual(r.stats, { insertions: 2, deletions: 2 });
});

test("added and removed paragraphs are marked whole; unchanged ones stay", () => {
  const r = compareDocs([p("Intro."), p("Old section entirely gone."), p("Ending.")], [p("Intro."), p("Ending."), p("A new closing note.")], "A");
  assert.equal(r.content.length, 4);
  assert.deepEqual(runs(r.content[0]), [["Intro.", ""]]);
  assert.deepEqual(runs(r.content[1]), [["Old section entirely gone.", "deletion"]]);
  assert.deepEqual(runs(r.content[2]), [["Ending.", ""]]);
  assert.deepEqual(runs(r.content[3]), [["A new closing note.", "insertion"]]);
});

test("bold text, lists and tables are compared inside", () => {
  const bold = { type: "text", text: "Important", marks: [{ type: "bold" }] };
  const list = (...items: string[]): PMNode => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
  const r = compareDocs([p(bold, " note."), list("apples", "pears")], [p(bold, " notes."), list("apples", "plums", "pears")], "A");
  assert.deepEqual(runs(r.content[0]), [["Important", "bold"], [" ", ""], ["note", "deletion"], ["notes", "insertion"], [".", ""]]);
  const items = r.content[1].content!.map((li) => runs(li.content![0]));
  assert.deepEqual(items, [[["apples", ""]], [["plums", "insertion"]], [["pears", ""]]]);
});

test("existing tracked changes are settled before comparing", () => {
  const old = [p({ type: "text", text: "gone ", marks: [{ type: "deletion" }] }, { type: "text", text: "kept", marks: [{ type: "insertion" }] })];
  const r = compareDocs(old, [p("kept")], "A");
  assert.deepEqual(runs(r.content[0]), [["kept", ""]]);
});
