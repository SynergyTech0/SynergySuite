// Find / replace across titles, rich text (text nodes only), tables and notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findAll, findRegex, replaceInElement, replaceInHtml } from "../lib/slides/find";
import type { Slide } from "../lib/slides/model";

const slides: Slide[] = [
  {
    id: "a", title: "Sales review", body: '<ul><li><p>Sales <strong>up</strong> &amp; sales&nbsp;flat</p></li></ul>', notes: "mention sales", layout: "content", bg: "", bgImg: "",
    elements: [
      { id: "t", type: "text", html: '<p style="color: #sales00">Wholesales</p>', x: 0, y: 0, w: 1, h: 1, z: 2 },
      { id: "tb", type: "table", rows: [[{ text: "Sales" }, { text: "Q1" }], [{ text: "x" }, { text: "sales" }]], x: 0, y: 0, w: 1, h: 1, z: 1 },
    ],
  },
  { id: "b", title: "Other", body: "", notes: "", layout: "content", bg: "", bgImg: "", elements: [] },
];

test("finds matches in deck order, case-insensitively, never inside tags", () => {
  const hits = findAll(slides, "sales");
  assert.deepEqual(hits.map((h) => [h.slide, h.key, h.count]), [
    [0, "title", 1], [0, "body", 2], [0, "tb:0:0", 1], [0, "tb:1:1", 1], [0, "t", 1], [0, "notes", 1],
  ]);
  assert.equal(findAll(slides, "Sales", { matchCase: true }).reduce((n, h) => n + h.count, 0), 3);
  assert.deepEqual(findAll(slides, "sales", { wholeWord: true }).map((h) => h.key), ["title", "body", "tb:0:0", "tb:1:1", "notes"]);
});

test("replaces in text nodes and keeps markup and entities", () => {
  const re = findRegex("sales")!;
  assert.equal(replaceInHtml(slides[0].body, re, "R&D <x>"), '<ul><li><p>R&amp;D &lt;x&gt; <strong>up</strong> &amp; R&amp;D &lt;x&gt;&nbsp;flat</p></li></ul>');
  const t = replaceInElement(slides[0].elements[0], re, "S")!;
  assert.equal(t.type === "text" && t.html, '<p style="color: #sales00">WholeS</p>');
  const cell = replaceInElement(slides[0].elements[1], re, "S", [1, 1])!;
  assert.deepEqual(cell.type === "table" && cell.rows.map((r) => r.map((c) => c.text)), [["Sales", "Q1"], ["x", "S"]]);
  assert.equal(replaceInElement(slides[0].elements[1], findRegex("zzz")!, "S"), null);
});
