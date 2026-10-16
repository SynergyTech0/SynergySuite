// Mail merge: a Sheet's rows as recipients, merge fields filled per record,
// and MERGEFIELD round-tripping through .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { sheetTable, mergeRecord, mergeAll, mergeInstr, parseMergeInstr, fieldValue, mergeFieldsIn } from "../lib/docs/mail-merge";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { cellDisplayText, type UniverWorkbook } from "../lib/xlsx";
import type { PMNode } from "../lib/docs/model";

const book = {
  id: "wb",
  name: "People",
  appVersion: "",
  locale: "enUS",
  sheetOrder: ["s1", "s2"],
  styles: { money: { n: { pattern: "#,##0.00" } } },
  sheets: {
    s1: {
      id: "s1",
      name: "List",
      rowCount: 10,
      columnCount: 5,
      cellData: {
        0: { 0: { v: "First name" }, 1: { v: "City" }, 2: { v: "Owed" }, 3: { v: "City" } },
        1: { 0: { v: "Ada" }, 1: { v: "London" }, 2: { v: 1234.5, s: "money" } },
        2: {},
        3: { 0: { v: "Grace" }, 1: { v: "Arlington" }, 2: { v: 7, s: "money" } },
      },
    },
    s2: { id: "s2", name: "Other", rowCount: 5, columnCount: 5, cellData: { 0: { 0: { v: "Code" } }, 1: { 0: { v: "X1" } } } },
  },
} as unknown as UniverWorkbook;
const display = (c: unknown) => cellDisplayText(book, c as never);

test("a sheet's first row names the fields; blank rows are skipped", () => {
  const t = sheetTable(book, undefined, display);
  assert.deepEqual(t.fields, ["First name", "City", "Owed", "City (2)"]);
  assert.deepEqual(t.records, [
    { "First name": "Ada", City: "London", Owed: "1,234.50", "City (2)": "" },
    { "First name": "Grace", City: "Arlington", Owed: "7.00", "City (2)": "" },
  ]);
  assert.deepEqual(sheetTable(book, "s2", display), { fields: ["Code"], records: [{ Code: "X1" }] });
});

test("MERGEFIELD instructions", () => {
  assert.equal(mergeInstr("City"), "MERGEFIELD City \\* MERGEFORMAT");
  assert.equal(mergeInstr("First name"), 'MERGEFIELD "First name" \\* MERGEFORMAT');
  assert.equal(parseMergeInstr(' MERGEFIELD "First name" \\* MERGEFORMAT '), "First name");
  assert.equal(parseMergeInstr("MERGEFIELD First_Name"), "First_Name");
  assert.equal(parseMergeInstr("REF _Ref1"), null);
  assert.equal(fieldValue({ "First name": "Ada" }, "First_Name"), "Ada");
});

const letter: PMNode[] = [
  { type: "paragraph", content: [{ type: "text", text: "Dear " }, { type: "mergeField", attrs: { name: "First name" }, marks: [{ type: "bold" }] }, { type: "text", text: "," }] },
  { type: "paragraph", content: [{ type: "text", text: "You owe " }, { type: "mergeField", attrs: { name: "Owed" } }, { type: "text", text: "." }] },
];

test("fields are filled per record, one copy per page", () => {
  const one = mergeRecord(letter, { "First name": "Ada", Owed: "5" });
  assert.deepEqual(one[0].content, [{ type: "text", text: "Dear " }, { type: "text", text: "Ada", marks: [{ type: "bold" }] }, { type: "text", text: "," }]);
  assert.deepEqual(one[1].content, [{ type: "text", text: "You owe 5." }]);
  const all = mergeAll(letter, [{ "First name": "Ada", Owed: "5" }, { "First name": "Grace", Owed: "7" }]);
  assert.deepEqual(all.map((n) => n.type), ["paragraph", "paragraph", "pageBreak", "paragraph", "paragraph"]);
  assert.deepEqual(mergeFieldsIn(letter), ["First name", "Owed"]);
});

test("merge fields round-trip through .docx as MERGEFIELD", async () => {
  const bytes = await buildDocx({ doc: { type: "doc", content: letter }, styles: [], title: "Letter" });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:instrText xml:space="preserve"> MERGEFIELD &quot;First name&quot; \\\* MERGEFORMAT <\/w:instrText>/);
  assert.match(xml, /«First name»/);
  const back = await importDocx(bytes);
  const fields: PMNode[] = [];
  const walk = (n: PMNode) => (n.type === "mergeField" ? fields.push(n) : n.content?.forEach(walk));
  walk(back.doc);
  assert.deepEqual(fields.map((f) => f.attrs!.name), ["First name", "Owed"]);
  assert.deepEqual(fields[0].marks?.map((m) => m.type), ["bold"]);
});
