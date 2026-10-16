// Fields beyond dates and counts: DOCPROPERTY and the summary fields, IF and
// COMPARE, formulas with bookmarks, STYLEREF, SET/REF, nested fields read and
// written as nested fields, document properties through .docx, and REF/PAGEREF
// switch variants.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { fieldKind, fieldValue, fieldResult, type FieldContext } from "../lib/docs/doc-fields";
import { parseFieldInstr, refText, type FieldIndex, type BookmarkInfo } from "../lib/docs/fields";
import { importDocx } from "../lib/docs/docx-import";
import { buildDocx, instrRuns } from "../lib/docs/docx-export";
import type { PMNode } from "../lib/docs/model";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const find = (n: PMNode, type: string): PMNode[] => [...(n.type === type ? [n] : []), ...(n.content || []).flatMap((c) => find(c, type))];

async function pkg(body: string, files: Record<string, string> = {}, rootRels = ""): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>${rootRels}</Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return zip.generateAsync({ type: "uint8array" });
}

const ctx: FieldContext = {
  now: new Date(2026, 9, 16),
  author: "Ann",
  section: 2,
  properties: { Company: "Synergy", Client: "Acme", Keywords: "alpha, beta" },
  bookmark: (n) => ({ total: "42", name: "Bob" })[n] ?? null,
  styleRef: (style, last) => (style === "Heading 1" ? (last ? "Last chapter" : "Chapter 2") : null),
  noteRef: () => "3",
  sets: { rate: "7" },
};

test("document properties and summary fields", () => {
  assert.equal(fieldValue("DOCPROPERTY Company", ctx), "Synergy");
  assert.equal(fieldValue('DOCPROPERTY "Client" \\* Upper', ctx), "ACME");
  assert.equal(fieldValue("DOCPROPERTY Nope", ctx), "Error! Unknown document property name.");
  assert.equal(fieldValue("KEYWORDS", ctx), "alpha, beta");
  assert.equal(fieldValue("INFO Author", ctx), "Ann");
  assert.equal(fieldValue("SECTION", ctx), "2");
  assert.equal(fieldValue("SYMBOL 169", ctx), "©");
  assert.equal(fieldValue('QUOTE "as is"', ctx), "as is");
});

test("IF, COMPARE and formulas with bookmarks and nested fields", () => {
  assert.equal(fieldValue('IF 5 > 3 "yes" "no"', ctx), "yes");
  assert.equal(fieldValue('IF name = "B*" "B-name" "other"', ctx), "B-name");
  assert.equal(fieldValue('IF total>=40 "big" "small"', ctx), "big");
  assert.equal(fieldValue('IF { REF total } < 40 "big" "small"', ctx), "small");
  assert.equal(fieldValue('IF { = 2 + 2 } = 4 "four" "not"', ctx), "four");
  assert.equal(fieldValue('IF { DOCPROPERTY Client } = "Acme" "Dear { DOCPROPERTY Client }" "Hi"', ctx), "Dear Acme");
  assert.equal(fieldValue("COMPARE rate = 7", ctx), "1");
  assert.equal(fieldValue('= total * 2 \\# "0.00"', ctx), "84.00");
  assert.equal(fieldValue("= 2 + 3 * 4", ctx), "14");
});

test("STYLEREF, NOTEREF, SET, ASK, FILLIN and unknown fields", () => {
  assert.equal(fieldValue('STYLEREF "Heading 1"', ctx), "Chapter 2");
  assert.equal(fieldValue('STYLEREF "Heading 1" \\l', ctx), "Last chapter");
  assert.equal(fieldValue('STYLEREF "Heading 9"', ctx), "Error! No text of specified style in document.");
  assert.equal(fieldValue("NOTEREF _Ref1 \\h", ctx), "3");
  assert.equal(fieldValue('SET rate "8"', ctx), "");
  assert.equal(fieldValue('ASK q "Question?"', ctx), "");
  assert.equal(fieldValue('FILLIN "Name?" \\d "Jo"', ctx), "Jo");
  // a field we don't evaluate keeps the result Word saved
  assert.equal(fieldValue("USERINITIALS", ctx), null);
  assert.equal(fieldResult("USERINITIALS", ctx, "AB"), "AB");
  // fields whose result is more than text stay as their content
  assert.equal(fieldKind("INCLUDEPICTURE x.png"), null);
  assert.equal(fieldKind("REF x"), null);
  assert.equal(fieldKind("DOCPROPERTY x"), "DOCPROPERTY");
});

test("a nested field reads into its outer field's instruction and is written back nested", async () => {
  const r = (x: string) => `<w:r>${x}</w:r>`;
  const fc = (t: string) => r(`<w:fldChar w:fldCharType="${t}"/>`);
  const it = (t: string) => r(`<w:instrText xml:space="preserve">${t}</w:instrText>`);
  const body =
    `<w:p>${fc("begin")}${it(" IF ")}${fc("begin")}${it(" DOCPROPERTY Client ")}${fc("separate")}${r("<w:t>Acme</w:t>")}${fc("end")}${it(' = "Acme" "Dear client" "Hello" ')}${fc("separate")}${r("<w:t>Dear client</w:t>")}${fc("end")}</w:p>` +
    `<w:p>${fc("begin")}${it(" USERINITIALS ")}${fc("separate")}${r("<w:t>AB</w:t>")}${fc("end")}</w:p>`;
  const custom = `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>Acme</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Signed"><vt:bool>true</vt:bool></property></Properties>`;
  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject>Plans</dc:subject><cp:keywords>k1</cp:keywords><dc:description>Notes</dc:description></cp:coreProperties>`;
  const app = `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Synergy</Company></Properties>`;
  const d = await importDocx(
    await pkg(body, { "docProps/custom.xml": custom, "docProps/core.xml": core, "docProps/app.xml": app }, `<Relationship Id="rId9" Type="${REL}/custom-properties" Target="docProps/custom.xml"/>`),
  );
  const fields = find(d.doc, "docField");
  assert.equal(fields.length, 2);
  assert.equal(fields[0].attrs!.instr, 'IF { DOCPROPERTY Client } = "Acme" "Dear client" "Hello"');
  assert.equal(fields[0].attrs!.result, "Dear client");
  assert.equal(fields[1].attrs!.instr, "USERINITIALS");
  assert.equal(fields[1].attrs!.result, "AB");
  assert.deepEqual(d.settings.customProperties, { Client: "Acme", Signed: "Y" });
  assert.deepEqual(d.settings.properties, { Subject: "Plans", Keywords: "k1", Comments: "Notes", Company: "Synergy" });

  const bytes = await buildDocx({ doc: d.doc, settings: d.settings });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  // the inner field is a field of its own inside the outer instruction
  assert.equal((xml.match(/fldCharType="begin"/g) || []).length, 3);
  assert.match(xml, /<w:instrText xml:space="preserve"> IF <\/w:instrText>.*fldCharType="begin".*DOCPROPERTY Client.*fldCharType="end".*= &quot;Acme&quot;/);
  assert.match(await zip.file("docProps/custom.xml")!.async("string"), /name="Client"><vt:lpwstr>Acme</);
  assert.match(await zip.file("docProps/core.xml")!.async("string"), /<dc:subject>Plans<\/dc:subject>.*<cp:keywords>k1<\/cp:keywords>/);
  assert.match(await zip.file("docProps/app.xml")!.async("string"), /<Company>Synergy<\/Company>/);
  assert.match(await zip.file("_rels/.rels")!.async("string"), /custom-properties/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /custom-properties\+xml/);
  const again = await importDocx(bytes);
  assert.equal(find(again.doc, "docField")[0].attrs!.instr, 'IF { DOCPROPERTY Client } = "Acme" "Dear client" "Hello"');
  assert.equal(again.settings.customProperties?.Client, "Acme");
});

test("instruction runs nest braces as fields", () => {
  const x = instrRuns(" IF { = 1 + { REF a } } > 2 x y ", "");
  assert.equal((x.match(/begin/g) || []).length, 2);
  assert.equal((x.match(/end/g) || []).length, 2);
});

test("REF and PAGEREF switch variants", () => {
  const b: BookmarkInfo = { name: "_Ref1", span: "label", pos: 50, order: 0, text: "Figure 2", number: "2", label: "Figure", para: "Figure 2: Map", heading: 0 };
  const ix: FieldIndex = { bookmarks: new Map([["_Ref1", b]]), seq: new Map(), captions: [] };
  const page = () => "4";
  const p1 = parseFieldInstr("REF _Ref1 \\n \\p \\h")!;
  assert.equal(p1.switches, "\\n \\p");
  assert.equal(refText(ix, "_Ref1", p1.show, { switches: p1.switches, refPos: 10 }), "2 below");
  const p2 = parseFieldInstr("PAGEREF _Ref1 \\p \\h")!;
  assert.equal(p2.show, "page");
  assert.equal(refText(ix, "_Ref1", p2.show, { switches: p2.switches, page, refPage: "2" }), "on page 4");
  assert.equal(refText(ix, "_Ref1", p2.show, { switches: p2.switches, page, refPage: "4", refPos: 80 }), "above");
  const p3 = parseFieldInstr("REF _Ref1 \\h \\* Upper")!;
  assert.equal(refText(ix, "_Ref1", p3.show, { switches: p3.switches }), "FIGURE 2");
  const p4 = parseFieldInstr('PAGEREF _Ref1 \\# "00"')!;
  assert.equal(refText(ix, "_Ref1", p4.show, { switches: p4.switches, page }), "04");
  // the plain forms carry no switches
  assert.equal(parseFieldInstr("REF _Ref1 \\h")!.switches, undefined);
  assert.equal(parseFieldInstr("REF _Ref1 \\r \\h")!.switches, undefined);
  assert.equal(parseFieldInstr("PAGEREF _Ref1 \\h")!.switches, undefined);
});

test("cross-reference switches survive a .docx round trip", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "bookmark", attrs: { name: "_Ref1", span: "para" } }, { type: "text", text: "Target" }] },
      { type: "paragraph", content: [{ type: "crossRef", attrs: { target: "_Ref1", show: "text", link: true, switches: "\\p \\* Upper" } }] },
    ],
  };
  const bytes = await buildDocx({ doc });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.match(xml, /REF _Ref1 \\p \\\* Upper \\h/);
  const back = await importDocx(bytes);
  const x = find(back.doc, "crossRef")[0];
  assert.equal(x.attrs!.switches, "\\p \\* Upper");
});
