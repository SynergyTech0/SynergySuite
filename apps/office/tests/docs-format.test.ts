// Paragraph and character formatting: borders and shading, tab stops, drop
// caps, widow/orphan control, caps, small caps and character spacing, and
// changing case, through .docx and back.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { changeCase, nextCase, tabWidth, bordersCss, type ParaBorders, type TabStop } from "../lib/docs/para-format";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

test("change case", () => {
  assert.equal(changeCase("hello world. this is i.", "sentence"), "Hello world. This is I.");
  assert.equal(changeCase("the QUICK brown fox's tail", "title"), "The Quick Brown Fox's Tail");
  assert.equal(changeCase("Hello", "toggle"), "hELLO");
  assert.equal(changeCase("Hello", "upper"), "HELLO");
  assert.equal(nextCase("abc"), "upper");
  assert.equal(nextCase("ABC"), "title");
  assert.equal(nextCase("Abc Def"), "lower");
});

test("tab widths reach the next stop", () => {
  const stops: TabStop[] = [{ pos: 100, align: "left" }, { pos: 300, align: "right", leader: "dot" }, { pos: 400, align: "center" }, { pos: 500, align: "decimal" }];
  assert.deepEqual(tabWidth(20, stops, 50), { width: 80, leader: undefined });
  assert.deepEqual(tabWidth(120, stops, 50), { width: 130, leader: "dot" }); // right: ends at 300
  assert.equal(tabWidth(310, stops, 40).width, 70); // centre on 400
  assert.equal(tabWidth(410, stops, 40, 25).width, 65); // decimal point on 500
  assert.equal(tabWidth(10, null, 0).width, 26); // default stops every 36pt
  assert.equal(tabWidth(510, stops, 0).width, 30);
});

test("border CSS", () => {
  const b: ParaBorders = { top: { style: "single", size: 1, color: "#ff0000", space: 1 }, bottom: { style: "double", size: 0.5, color: "#000000", space: 2 } };
  assert.match(bordersCss(b, "#eeeeee"), /border-top: 1pt solid #ff0000/);
  assert.match(bordersCss(b, "#eeeeee"), /border-bottom: 2.25pt double/);
  assert.match(bordersCss(b, "#eeeeee"), /background-color: #eeeeee/);
});

test("formatting round-trips through .docx", async () => {
  const borders: ParaBorders = { top: { style: "single", size: 1, color: "#ff0000", space: 1 }, left: { style: "dashed", size: 0.5, color: "#0000ff", space: 4 } };
  const tabs: TabStop[] = [{ pos: 72, align: "left" }, { pos: 432, align: "right", leader: "dot" }];
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { borders, shading: "#fff2cc", tabs, widowControl: false }, content: [{ type: "text", text: "Name\tPage 4" }] },
      { type: "paragraph", attrs: { dropCap: "drop:3" }, content: [{ type: "text", text: "Once upon a time." }] },
      { type: "paragraph", content: [{ type: "text", text: "Small", marks: [{ type: "textStyle", attrs: { smallCaps: true, charSpacing: 1.5 } }] }, { type: "text", text: " caps", marks: [{ type: "textStyle", attrs: { caps: true } }] }] },
      { type: "paragraph", attrs: { pageBreakBefore: true }, content: [{ type: "text", text: "New page" }] },
    ],
  };
  const bytes = await buildDocx({ doc, styles: [] });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:pBdr><w:top w:val="single" w:sz="8" w:space="1" w:color="FF0000"\/><w:left w:val="dashed"/);
  assert.match(xml, /<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"\/>/);
  assert.match(xml, /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="right" w:leader="dot" w:pos="8640"\/><\/w:tabs>/);
  assert.match(xml, /<w:widowControl w:val="0"\/>/);
  assert.match(xml, /<w:framePr w:dropCap="drop" w:lines="3"[^>]*\/>.*?<w:t>O<\/w:t>/);
  assert.match(xml, /<w:smallCaps\/>.*?<w:spacing w:val="30"\/>/);
  assert.match(xml, /<w:caps\/>/);
  assert.match(xml, /<w:pageBreakBefore\/>/);

  const back = (await importDocx(bytes)).doc.content!;
  const paras = back.filter((n) => n.type === "paragraph");
  assert.deepEqual(paras[0].attrs!.borders, borders);
  assert.equal(paras[0].attrs!.shading, "#fff2cc");
  assert.deepEqual(paras[0].attrs!.tabs, tabs);
  assert.equal(paras[0].attrs!.widowControl, false);
  assert.equal(paras[1].attrs!.dropCap, "drop:3");
  assert.equal(paras[1].content!.map((c) => c.text).join(""), "Once upon a time.");
  const ts = (n: PMNode) => n.marks!.find((m) => m.type === "textStyle")!.attrs!;
  assert.equal(ts(paras[2].content![0]).smallCaps, true);
  assert.equal(ts(paras[2].content![0]).charSpacing, 1.5);
  assert.equal(ts(paras[2].content![1]).caps, true);
  assert.ok(back.some((n) => n.type === "pageBreak"));
});
