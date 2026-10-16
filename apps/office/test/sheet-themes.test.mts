// Workbook themes and cell styles: the gallery's looks, recoloring for a new
// theme, and the theme part of an .xlsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { CELL_STYLES, fontMap, patchThemeXml, readThemeXml, recolorMap, restyle, THEME_RESOURCE, THEMES } from "../lib/sheet-themes.ts";
import { univerToXlsx, xlsxToUniver, type UniverWorkbook } from "../lib/xlsx.ts";

const office = THEMES[0];
const ocean = THEMES.find((t) => t.name === "Ocean")!;
const style = (name: string, t = office) => CELL_STYLES.find((s) => s.name === name)!.style(t);

test("the gallery's styles take the theme's colors and fonts", () => {
  assert.deepEqual(style("Good"), { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } });
  assert.deepEqual(style("Accent1"), { bg: { rgb: "#4472C4" }, cl: { rgb: "#FFFFFF" } });
  assert.deepEqual(style("20% - Accent1").bg, { rgb: "#DAE3F3" });
  assert.deepEqual(style("Accent1", ocean).bg, { rgb: "#0F6FC6" });
  assert.equal(style("Title", ocean).ff, "Calibri Light");
  assert.equal(style("Heading 1").bd?.b?.s, 13);
  assert.equal(style("Normal").bg, null, "Normal clears the fill");
  assert.equal(CELL_STYLES.length, 47);
});

test("a new theme recolors what used the old one, tints included, and swaps fonts", () => {
  const map = recolorMap(office, ocean);
  const fonts = fontMap(office, THEMES.find((t) => t.name === "Forest")!);
  const s = { ...style("40% - Accent1"), bd: { b: { s: 1, cl: { rgb: "#4472C4" } } }, ff: "Calibri Light" };
  const out = restyle(s, map, fonts)!;
  assert.deepEqual(out.bg, style("40% - Accent1", ocean).bg);
  assert.deepEqual(out.bd?.b?.cl, { rgb: "#0F6FC6" });
  assert.equal(out.ff, "Georgia");
  const plain = { bg: { rgb: "#123456" } };
  assert.equal(restyle(plain, map, fonts), plain, "other colors stay");
});

test("the theme part of an .xlsx: read, written, and round-tripped", async () => {
  const book: UniverWorkbook = {
    id: "wb",
    name: "Themed",
    appVersion: "",
    locale: "enUS",
    sheetOrder: ["s"],
    styles: {},
    sheets: { s: { id: "s", name: "S", cellData: { 0: { 0: { v: "x", t: 1 } } } } as any },
    resources: [{ name: THEME_RESOURCE, data: JSON.stringify(ocean) }],
  };
  const bytes = await univerToXlsx(book);
  const xml = await (await JSZip.loadAsync(bytes)).file("xl/theme/theme1.xml")!.async("string");
  assert.match(xml, /<a:accent1><a:srgbClr val="0F6FC6"\/><\/a:accent1>/);
  assert.deepEqual(readThemeXml(xml, "Ocean"), ocean);
  const back = await xlsxToUniver(bytes, "Themed");
  assert.deepEqual(JSON.parse(back.resources!.find((r) => r.name === THEME_RESOURCE)!.data).colors, ocean.colors);
  // The default theme is not recorded on import.
  const plain = await xlsxToUniver(await univerToXlsx({ ...book, resources: [] }), "Plain");
  assert.equal(plain.resources!.find((r) => r.name === THEME_RESOURCE), undefined);
  assert.equal(patchThemeXml('<a:theme name="Office Theme"><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1></a:clrScheme></a:theme>', ocean), '<a:theme name="Ocean"><a:clrScheme name="Ocean"><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme></a:theme>');
});
