// Comment threads written to .xlsx as Excel threaded comments, and read back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { xlsxToUniver, univerToXlsx, RESOURCE, type UniverWorkbook } from "../lib/xlsx.ts";
import { readThreadedComments, guidFrom, type SheetThread } from "../lib/xlsx-threads.ts";

const book = (): UniverWorkbook => ({
  id: "u",
  name: "T",
  appVersion: "",
  locale: "enUS",
  styles: {},
  sheetOrder: ["sheet-1", "sheet-2"],
  sheets: {
    "sheet-1": { id: "sheet-1", name: "Sales", cellData: { 0: { 0: { v: "Region" }, 1: { v: 5 } } } },
    "sheet-2": { id: "sheet-2", name: "Other", cellData: {} },
  },
  resources: [{ name: RESOURCE.note, data: JSON.stringify({ "sheet-1": { 4: { 4: { row: 4, col: 4, note: "plain note", width: 160, height: 72, show: false } }, 2: { 2: { row: 2, col: 2, note: "note under a thread", width: 160, height: 72, show: false } } } }) }],
});
const t0 = Date.UTC(2025, 2, 1, 9, 30);
const threads: SheetThread[] = [
  {
    id: "th1",
    sheetId: "sheet-1",
    ref: "B1",
    resolved: false,
    messages: [
      { author_name: "Shane", author_email: "shane@example.com", body: "Is 5 right? <check>", created_ms: t0 },
      { author_name: "Ana", author_email: "ana@example.com", body: "Yes & checked.", created_ms: t0 + 60_000 },
    ],
  },
  { id: "th2", sheetId: "sheet-2", ref: "D7", resolved: true, messages: [{ author_name: "Ana", author_email: "ana@example.com", body: "Done here", created_ms: t0 + 5 }] },
  { id: "th3", sheetId: "sheet-1", ref: "C3", resolved: false, messages: [{ author_name: "Bob", author_email: "bob@example.com", body: "On a noted cell", created_ms: t0 + 9 }] },
];

test("threads become Excel threaded comments with legacy copies, persons and relationships", async () => {
  const bytes = await univerToXlsx(book(), { threads });
  const zip = await JSZip.loadAsync(bytes);
  const read = (p: string) => zip.file(p)!.async("string");
  const ct = await read("[Content_Types].xml");
  assert.match(ct, /PartName="\/xl\/threadedComments\/threadedComment1\.xml" ContentType="application\/vnd\.ms-excel\.threadedcomments\+xml"/);
  assert.match(ct, /PartName="\/xl\/persons\/person\.xml" ContentType="application\/vnd\.ms-excel\.person\+xml"/);
  assert.match(await read("xl/_rels/workbook.xml.rels"), /relationships\/person" Target="persons\/person\.xml"/);
  assert.match(await read("xl/worksheets/_rels/sheet1.xml.rels"), /relationships\/threadedComment" Target="..\/threadedComments\/threadedComment1\.xml"/);
  const tc = await read("xl/threadedComments/threadedComment1.xml");
  assert.match(tc, /<threadedComment ref="B1" dT="2025-03-01T09:30:00\.00" personId="\{[0-9A-F-]{36}\}" id="(\{[0-9A-F-]{36}\})"><text>Is 5 right\? &lt;check&gt;<\/text>/);
  assert.match(tc, /parentId="\{[0-9A-F-]{36}\}"><text>Yes &amp; checked\.<\/text>/);
  assert.match(await read("xl/threadedComments/threadedComment2.xml"), /ref="D7"[^>]*done="1"/);
  const persons = await read("xl/persons/person.xml");
  assert.equal([...persons.matchAll(/<person /g)].length, 4, "Shane, Ana, Bob and the note");
  assert.match(persons, /displayName="Ana" id="\{[^"]+\}" userId="ana@example.com" providerId="None"/);

  // The legacy comment on B1 carries the text and points at its thread.
  const comments = await read("xl/comments1.xml");
  const rootId = /id="(\{[^"]+\})"/.exec(tc)![1];
  const authors = [...comments.matchAll(/<author>([^<]*)<\/author>/g)].map((m) => m[1]);
  const b1 = /<comment ref="B1" authorId="(\d+)"/.exec(comments)!;
  assert.equal(authors[Number(b1[1])], `tc=${rootId}`);
  assert.match(comments, /\[Threaded comment\]/);
  assert.match(comments, /<comment ref="E5" authorId="0"/, "a plain note keeps the plain author");
  assert.ok(guidFrom("x") === guidFrom("x") && guidFrom("x") !== guidFrom("y"));

  // openpyxl (a strict reader) opens it and sees the legacy comments.
  const dir = mkdtempSync(path.join(tmpdir(), "threads-"));
  try {
    const file = path.join(dir, "t.xlsx");
    writeFileSync(file, bytes);
    const out = execFileSync("python3", ["-c", "import sys,openpyxl;wb=openpyxl.load_workbook(sys.argv[1]);print(wb['Sales']['B1'].comment.text.splitlines()[0]);print(wb['Sales']['E5'].comment.text)", file]).toString();
    assert.deepEqual(out.trim().split("\n"), ["[Threaded comment]", "plain note"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("threaded comments read back with authors, replies and resolved state, and not as notes", async () => {
  const bytes = await univerToXlsx(book(), { threads });
  const back = await readThreadedComments(bytes);
  const sales = back.get(0)!;
  const b1 = sales.find((t) => t.ref === "B1")!;
  assert.deepEqual(
    b1.messages.map((m) => [m.author_name, m.author_email, m.body, m.created_ms]),
    [
      ["Shane", "shane@example.com", "Is 5 right? <check>", t0],
      ["Ana", "ana@example.com", "Yes & checked.", t0 + 60_000],
    ],
  );
  assert.equal(b1.resolved, false);
  const c3 = sales.find((t) => t.ref === "C3")!;
  assert.deepEqual(c3.messages.map((m) => [m.author_name, m.body]), [["Note", "note under a thread"], ["Bob", "On a noted cell"]], "a note on a commented cell leads the thread");
  assert.equal(back.get(1)![0].resolved, true);

  const wb = await xlsxToUniver(bytes);
  const notes = JSON.parse(wb.resources!.find((r) => r.name === RESOURCE.note)?.data || "{}");
  assert.deepEqual(Object.keys(notes["sheet-1"]), ["4"], "only the plain note is a note");
  assert.equal(notes["sheet-2"], undefined);
});
