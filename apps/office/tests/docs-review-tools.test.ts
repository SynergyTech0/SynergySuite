// Thesaurus lookups and replacements, and the accessibility checker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseForms, lookup, fitReplacement, type ThesaurusData } from "../lib/docs/thesaurus";
import { checkAccessibility, contrast } from "../lib/docs/accessibility";
import type { PMNode } from "../lib/docs/model";

const data = JSON.parse(readFileSync(path.join(__dirname, "../public/thesaurus-en.json"), "utf8")) as ThesaurusData;

test("thesaurus finds base forms and fits replacements", () => {
  assert.ok(baseForms("happier").includes("happy"));
  assert.ok(baseForms("running").includes("run"));
  assert.ok(baseForms("boxes").includes("box"));
  const happy = lookup(data, "Happy")!;
  assert.equal(happy.word, "happy");
  assert.ok(happy.senses[0].synonyms.length > 2);
  assert.ok(happy.senses.some((s) => s.antonyms.includes("unhappy")));
  const big = lookup(data, "bigger");
  assert.ok(big && big.senses.length > 0);
  assert.equal(lookup(data, "quickest")?.word, "quick");
  assert.ok(lookup(data, "houses")!.senses.length > 0);
  assert.equal(lookup(data, "qwxzv"), null);
  assert.equal(lookup(data, "constructor"), null);
  assert.equal(fitReplacement("Happy", "happy", "glad"), "Glad");
  assert.equal(fitReplacement("HOUSES", "house", "home"), "HOMES");
  assert.equal(fitReplacement("walked", "walk", "stroll"), "strolled");
  assert.equal(fitReplacement("walking", "walk", "stroll"), "strolling");
  assert.equal(fitReplacement("parties", "party", "gathering"), "gatherings");
});

test("contrast ratios", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.ok(contrast("#777777", "#ffffff") < 4.5);
  assert.ok(contrast("#595959", "#ffffff") >= 4.5);
});

test("accessibility checker", () => {
  const p = (t: string, marks?: PMNode["marks"]): PMNode => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t, ...(marks ? { marks } : {}) }] } : {}) });
  const cell = (t: string, type = "tableCell", attrs: Record<string, unknown> = {}): PMNode => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [p(t)] });
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Report" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Detail" }] },
      { type: "image", attrs: { src: "x.png", alt: null } },
      { type: "image", attrs: { src: "y.png", alt: "A chart of sales", wrap: "square" } },
      { type: "table", content: [{ type: "tableRow", content: [cell("a"), cell("b", "tableCell", { colspan: 2 })] }] },
      p("Read more", [{ type: "link", attrs: { href: "https://example.com" } }]),
      p("pale", [{ type: "textStyle", attrs: { color: "#bbbbbb" } }]),
      p(""),
      p(""),
      p(""),
      p("name:      value"),
    ],
  };
  const kinds = checkAccessibility(doc, { title: "" }).map((i) => `${i.kind}@${i.path.join(".")}`);
  for (const k of ["noTitle@", "headingSkipped@1", "missingAltText@2", "floatingObject@3", "tableNoHeader@4", "mergedCells@4", "unclearLink@5.0", "lowContrast@6.0", "blankLines@9", "repeatedSpaces@10"]) assert.ok(kinds.includes(k), `${k} in ${kinds.join(", ")}`);
  assert.ok(!kinds.some((k) => k.startsWith("missingAltText@3")));
  // a clean document
  const clean: PMNode = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, p("Fine text", [{ type: "link", attrs: { href: "https://x.org" } }])] };
  assert.deepEqual(checkAccessibility(clean, { title: "Doc" }), []);
  // dark text on a dark page colour
  const dark = checkAccessibility({ type: "doc", content: [p("x", [{ type: "textStyle", attrs: { color: "#202020" } }])] }, { title: "t", pageColor: "#000000" });
  assert.equal(dark[0]?.kind, "lowContrast");
});
