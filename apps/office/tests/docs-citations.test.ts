// Citations and bibliography: the four styles' in-text citations and entries,
// IEEE numbering by first citation, and the .docx round trip (CITATION and
// BIBLIOGRAPHY fields, sources in customXml b:Sources).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { bibliography, citationText, makeTag, parseAuthors, parseCitationInstr, type Source } from "../lib/docs/citations";
import type { PMNode } from "../lib/docs/model";

const sources: Source[] = [
  { tag: "Smi20", type: "Book", authors: "Smith, Jane Ann", title: "Field Notes", year: "2020", publisher: "North Press", city: "Leeds" },
  { tag: "Doe19", type: "JournalArticle", authors: "Doe, John; Roe, Rita", title: "Soil and water", year: "2019", journal: "Earth Journal", volume: "12", issue: "3", pages: "40-52" },
  { tag: "Who21", type: "InternetSite", authors: "World Health Organization", title: "Clean water facts", year: "2021", site: "WHO", url: "https://example.org/water" },
];
const seg = (s: { text: string; italic?: boolean }[]) => s.map((x) => (x.italic ? `*${x.text}*` : x.text)).join("");

test("authors and tags", () => {
  assert.deepEqual(parseAuthors("Smith, Jane; Doe, John"), [{ last: "Smith", first: "Jane" }, { last: "Doe", first: "John" }]);
  assert.equal(parseAuthors("World Health Organization")[0].corporate, true);
  assert.equal(makeTag({ authors: "Smith, Jane", title: "x", year: "2020" }, ["Smi20"]), "Smi20a");
  assert.deepEqual(parseCitationInstr(' CITATION Smi20 \\l 1033 \\p "12-14" \\m Doe19'), { tags: ["Smi20", "Doe19"], pages: "12-14" });
});

test("in-text citations in APA, MLA, Chicago and IEEE", () => {
  assert.equal(citationText(sources, ["Smi20"], "APA"), "(Smith, 2020)");
  assert.equal(citationText(sources, ["Smi20"], "APA", "12"), "(Smith, 2020, p. 12)");
  assert.equal(citationText(sources, ["Doe19", "Smi20"], "APA"), "(Doe & Roe, 2019; Smith, 2020)");
  assert.equal(citationText(sources, ["Smi20"], "MLA", "12"), "(Smith 12)");
  assert.equal(citationText(sources, ["Doe19"], "Chicago", "41"), "(Doe and Roe 2019, 41)");
  assert.equal(citationText(sources, ["Who21"], "IEEE", undefined, new Map([["Who21", 1]])), "[1]");
});

test("bibliography entries and order", () => {
  const apa = bibliography(sources, "APA").map((e) => seg(e.segs));
  assert.deepEqual(apa, [
    "Doe, J., & Roe, R. (2019). Soil and water. *Earth Journal*, *12*(3), 40-52.",
    "Smith, J. A. (2020). *Field Notes.* North Press.",
    "World Health Organization. (2021). *Clean water facts.* WHO. https://example.org/water",
  ]);
  assert.equal(seg(bibliography(sources, "MLA")[1].segs), "Smith, Jane Ann. *Field Notes.* North Press, 2020.");
  assert.equal(seg(bibliography(sources, "Chicago")[0].segs), "Doe, John, and Rita Roe. 2019. “Soil and water.” *Earth Journal* 12 (3): 40-52.");
  // IEEE: numbered by first citation, then the uncited
  const ieee = bibliography(sources, "IEEE", ["Who21", "Smi20"]).map((e) => seg(e.segs));
  assert.match(ieee[0], /^\[1\]\tWorld Health Organization, “Clean water facts\.” \*WHO\*\. \[Online\]\. Available: https:\/\/example\.org\/water$/);
  assert.equal(ieee[1], "[2]\tJ. A. Smith, *Field Notes*. Leeds: North Press, 2020.");
  assert.match(ieee[2], /^\[3\]\tJ\. Doe and R\. Roe, “Soil and water,” \*Earth Journal\*, vol\. 12, no\. 3, pp\. 40-52, 2019\.$/);
});

test("citations, bibliography and sources round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Water matters " }, { type: "citation", attrs: { tags: "Who21", pages: null } }, { type: "text", text: " and soil " }, { type: "citation", attrs: { tags: "Doe19,Smi20", pages: "41" } }, { type: "text", text: "." }] },
      { type: "bibliography", attrs: { title: null } },
    ],
  };
  const bytes = await buildDocx({ doc, settings: { sources, citationStyle: "Chicago" } });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  assert.match(main, /<w:sdt><w:sdtPr><w:id w:val="\d+"\/><w:citation\/><\/w:sdtPr><w:sdtContent>.*? CITATION Who21 \\l 1033 <\/w:instrText>.*?\(World Health Organization 2021\)/);
  assert.match(main, / CITATION Doe19 \\l 1033 \\p 41 \\m Smi20 <\/w:instrText>.*?\(Doe and Roe 2019, 41; Smith 2020\)/);
  assert.match(main, /<w:docPartGallery w:val="Bibliographies"\/>.*?<w:t>Bibliography<\/w:t>.*? BIBLIOGRAPHY .*?<w:pStyle w:val="Bibliography"\/>/);
  const item = await zip.file("customXml/item1.xml")!.async("string");
  assert.match(item, /<b:Sources [^>]*StyleName="Chicago"><b:Source><b:Tag>Smi20<\/b:Tag><b:SourceType>Book<\/b:SourceType><b:Author><b:Author><b:NameList><b:Person><b:Last>Smith<\/b:Last><b:First>Jane Ann<\/b:First>/);
  assert.match(item, /<b:Corporate>World Health Organization<\/b:Corporate>/);
  assert.match(await zip.file("word/_rels/document.xml.rels")!.async("string"), /relationships\/customXml" Target="\.\.\/customXml\/item1\.xml"/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /customXmlProperties\+xml/);

  const back = await importDocx(bytes);
  assert.equal(back.settings.citationStyle, "Chicago");
  assert.deepEqual(back.settings.sources, sources.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined))));
  const p = back.doc.content![0];
  assert.deepEqual(p.content!.map((n) => (n.type === "citation" ? `[${n.attrs!.tags}|${n.attrs!.pages}]` : n.text)), ["Water matters ", "[Who21|null]", " and soil ", "[Doe19,Smi20|41]", "."]);
  assert.equal(back.doc.content![1].type, "bibliography");
  assert.equal(back.doc.content!.length, 2);
});
