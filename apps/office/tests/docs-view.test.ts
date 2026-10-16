// Ruler geometry and dragging, and the Navigation pane's search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { defaultSection } from "../lib/docs/model";
import { rulerMarks, rulerTicks, dragIndents, dragMargins, addTab, moveTab, pageMargins, snap } from "../lib/docs/ruler";
import { searchDocument } from "../lib/docs/navigation";

const s = defaultSection();

test("ruler marks follow margins, indents and tabs", () => {
  const m = rulerMarks(s, { left: 36, right: 18, first: -18 }, [{ pos: 72, align: "left" }]);
  assert.equal(m.textLeft, s.margins.left);
  assert.equal(m.textRight, s.pageWidth - s.margins.right);
  assert.equal(m.left, s.margins.left + 36);
  assert.equal(m.first, s.margins.left + 18);
  assert.equal(m.right, s.pageWidth - s.margins.right - 18);
  assert.equal(m.tabs[0].at, s.margins.left + 72);
  // mirrored even page with a gutter: the inside margin is on the right
  const g = { ...s, margins: { ...s.margins, left: 90, right: 54, gutter: 18 } };
  assert.deepEqual(pageMargins(g, false), { left: 108, right: 54 });
  assert.deepEqual(pageMargins(g, true), { left: 54, right: 108 });
});

test("ruler ticks count inches from the left margin", () => {
  const m = rulerMarks(s, { left: 0, right: 0, first: 0 }, []);
  const labels = rulerTicks(m).filter((t) => t.label);
  assert.equal(labels[0].label, "1"); // one inch into the left margin
  assert.equal(labels[0].at, m.textLeft - 72);
  assert.ok(labels.some((t) => t.label === "6" && t.at === m.textLeft + 432));
  assert.ok(!rulerTicks(m).some((t) => t.at === m.textLeft && t.label));
});

test("dragging indent markers", () => {
  const m = rulerMarks(s, { left: 0, right: 0, first: 0 }, []);
  const start = { left: 0, right: 0, first: 0 };
  assert.deepEqual(dragIndents(start, "first", 37, m), { left: 0, right: 0, first: 36 });
  assert.deepEqual(dragIndents({ left: 0, right: 0, first: 36 }, "hanging", 18, m), { left: 18, right: 0, first: 18 });
  assert.deepEqual(dragIndents({ left: 0, right: 0, first: 36 }, "leftBox", 18, m), { left: 18, right: 0, first: 36 });
  assert.deepEqual(dragIndents(start, "right", -36, m), { left: 0, right: 36, first: 0 });
  // never further left than the page edge
  assert.equal(dragIndents(start, "hanging", -500, m).left, -m.textLeft);
  assert.equal(snap(10), 9);
});

test("dragging margins", () => {
  assert.equal(dragMargins(s, "marginLeft", 36).left, s.margins.left + 36);
  assert.equal(dragMargins(s, "marginRight", 36).right, s.margins.right - 36);
  // the text keeps an inch
  const wide = dragMargins(s, "marginLeft", 1000);
  assert.equal(s.pageWidth - wide.left - wide.right, 72);
  assert.equal(dragMargins(s, "marginLeft", -1000).left, 0);
  // mirrored even page: the left edge on screen is the outside (right) margin
  assert.equal(dragMargins(s, "marginLeft", 36, true).right, s.margins.right + 36);
});

test("tab stops", () => {
  let t = addTab([], 100, "center");
  assert.deepEqual(t, [{ pos: 99, align: "center" }]);
  t = addTab(t, 40);
  assert.deepEqual(t.map((x) => x.pos), [40.5, 99]);
  assert.equal(addTab(t, 99.5), t, "no duplicate stop");
  assert.deepEqual(moveTab(t, 0, 200).map((x) => x.pos), [99, 198]);
  assert.deepEqual(moveTab(t, 1, null), [{ pos: 40.5, align: "left" }]);
});

test("navigation search with context and headings", () => {
  const schema = getSchema([StarterKit]);
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Intro about cats." }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Cats" }] },
      { type: "paragraph", content: [{ type: "text", text: "A " }, { type: "text", text: "cat", marks: [{ type: "bold" }] }, { type: "text", text: " sat. The concatenation of a very long sentence goes on and on about a cat." }] },
    ],
  });
  const all = searchDocument(doc, "cat");
  assert.equal(all.length, 5);
  assert.equal(all[0].heading, null);
  assert.equal(all[1].heading, null, "a heading's own match has no heading");
  assert.equal(all[2].heading, "Cats");
  assert.equal(doc.textBetween(all[2].from, all[2].to), "cat");
  assert.equal(all[2].before, "A ");
  assert.equal(all[2].after, " sat. The concatenation of a v…");
  assert.match(all[4].before, /^…/);
  assert.equal(searchDocument(doc, "cat", { wholeWord: true }).length, 2);
  assert.equal(searchDocument(doc, "Cat", { matchCase: true }).length, 1);
  assert.equal(searchDocument(doc, "a.b").length, 0, "the query is literal");
  assert.equal(searchDocument(doc, "  ").length, 0);
});
