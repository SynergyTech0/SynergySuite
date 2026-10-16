// Design: themes restyle fonts and colours that came from the old theme and
// are written as theme1.xml; style sets restyle the headings.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { THEMES, themeOf, restyleForTheme, styleSets, applyStyleSet, darker } from "../lib/docs/design";
import { mergeStyles, resolveStyle } from "../lib/docs/model";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";

test("a theme changes theme fonts and colours, not hand-set ones", () => {
  const styles = mergeStyles([{ id: "Custom", name: "Custom", type: "paragraph", run: { font: "Courier New", color: "#123456" } }]);
  const next = themeOf("georgia");
  const changed = restyleForTheme(styles, themeOf("office"), next);
  const h1 = changed.find((s) => s.id === "Heading1")!;
  assert.equal(h1.run.font, "Georgia");
  assert.equal(h1.run.color, darker(next.accents[0]));
  assert.ok(changed.find((s) => s.id === "Normal")!.run.font === "Georgia");
  assert.ok(!changed.some((s) => s.id === "Custom"));
});

test("style sets restyle the headings", () => {
  const styles = mergeStyles([]);
  const lines = styleSets(themeOf("office")).find((s) => s.id === "lines")!;
  const out = applyStyleSet(styles, lines);
  const h1 = out.find((s) => s.id === "Heading1")!;
  assert.ok(h1.para?.borders?.bottom);
  const merged = mergeStyles(out);
  assert.ok(resolveStyle(merged, "Heading1").para.borders?.bottom);
  // back to default clears the border
  const back = applyStyleSet(merged, styleSets(themeOf("office")).find((s) => s.id === "default")!);
  assert.equal(back.find((s) => s.id === "Heading1")!.para?.borders, undefined);
});

test("the theme is saved as theme1.xml and recognised when opened", async () => {
  const t = THEMES.find((x) => x.id === "modern")!;
  const bytes = await buildDocx({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }, styles: [], settings: { theme: "modern" } });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/theme/theme1.xml")!.async("string");
  assert.match(xml, /<a:majorFont><a:latin typeface="Trebuchet MS"/);
  assert.match(xml, new RegExp(`<a:accent1><a:srgbClr val="${t.accents[0].slice(1).toUpperCase()}"/>`));
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /theme\/theme1.xml/);
  assert.equal((await importDocx(bytes)).settings.theme, "modern");
});
