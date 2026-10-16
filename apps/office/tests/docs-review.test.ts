// Track changes: edits made while tracking become insertion and deletion
// marks, can be accepted or rejected, and round-trip through .docx as w:ins
// and w:del (with the Track Changes setting).
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import JSZip from "jszip";
import { Insertion, Deletion, trackTransaction, trackedChanges, resolveChanges } from "../components/docs/track-changes";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

const schema = getSchema([StarterKit, Insertion, Deletion]);
let tracking = true;
const tracker = new Plugin({ appendTransaction: (trs, o, n) => (tracking ? trackTransaction(trs, o, n, "Ann") : null) });

function state(text: string) {
  const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  return EditorState.create({ doc, plugins: [tracker] });
}
const apply = (s: EditorState, f: (s: EditorState) => import("@tiptap/pm/state").Transaction) => s.applyTransaction(f(s)).state;
const plain = (s: EditorState) => s.doc.textContent;
const marked = (s: EditorState, kind: string) => {
  let out = "";
  s.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === kind)) out += n.text;
  });
  return out;
};

test("typing, deleting and replacing while tracking leaves marked text", () => {
  tracking = true;
  let s = state("The quick fox");
  // type " brown" after "quick" (pos 1 + 9)
  s = apply(s, (s) => s.tr.setSelection(TextSelection.create(s.doc, 10)).insertText(" brown"));
  assert.equal(plain(s), "The quick brown fox");
  assert.equal(marked(s, "insertion"), " brown");
  // Backspace over "The " (select it and delete): text stays, struck through
  s = apply(s, (s) => s.tr.setSelection(TextSelection.create(s.doc, 1, 5)).deleteSelection());
  assert.equal(plain(s), "The quick brown fox");
  assert.equal(marked(s, "deletion"), "The ");
  // Backspace one character at the end: the cursor moves before the struck character
  const end = s.doc.content.size - 1;
  s = apply(s, (s) => s.tr.setSelection(TextSelection.create(s.doc, end)));
  s = apply(s, (s) => s.tr.delete(end - 1, end));
  assert.equal(plain(s), "The quick brown fox");
  assert.equal(marked(s, "deletion"), "The x");
  assert.equal(s.selection.from, end - 1);
  // deleting your own insertion removes it for real
  const at = s.doc.textContent.indexOf(" brown") + 1;
  s = apply(s, (s) => s.tr.delete(at, at + 6));
  assert.equal(plain(s), "The quick fox");
  assert.equal(marked(s, "insertion"), "");
  // typing over a selection: the old word struck, the new one inserted after it
  const q = s.doc.textContent.indexOf("quick") + 1;
  s = apply(s, (s) => s.tr.setSelection(TextSelection.create(s.doc, q, q + 5)).insertText("slow"));
  assert.equal(plain(s), "The quickslow fox");
  assert.equal(marked(s, "deletion"), "The quickx");
  assert.equal(marked(s, "insertion"), "slow");
  const changes = trackedChanges(s.doc);
  assert.deepEqual(changes.map((c) => [c.kind, c.text, c.author]), [["deletion", "The quick", "Ann"], ["insertion", "slow", "Ann"], ["deletion", "x", "Ann"]]);
});

test("accept and reject", () => {
  tracking = true;
  let s = state("one two three");
  s = apply(s, (s) => s.tr.delete(5, 9)); // "two "
  s = apply(s, (s) => s.tr.insert(s.doc.content.size - 1, schema.text(" four")));
  tracking = false;
  const [del, ins] = trackedChanges(s.doc);
  assert.equal(del.text, "two ");
  assert.equal(ins.text, " four");
  // reject the deletion: the text is back, unmarked; accept the insertion
  let r = s.applyTransaction(resolveChanges(s, del.from, del.to, false)!).state;
  r = r.applyTransaction(resolveChanges(r, 0, r.doc.content.size, true)!).state;
  assert.equal(plain(r), "one two three four");
  assert.equal(trackedChanges(r.doc).length, 0);
  // accept everything: the deletion goes, the insertion stays
  const a = s.applyTransaction(resolveChanges(s, 0, s.doc.content.size, true)!).state;
  assert.equal(plain(a), "one three four");
  // reject everything: back to the original
  const b = s.applyTransaction(resolveChanges(s, 0, s.doc.content.size, false)!).state;
  assert.equal(plain(b), "one two three");
});

test("tracked changes round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Kept " },
          { type: "text", text: "removed", marks: [{ type: "deletion", attrs: { author: "Bea", date: "2026-03-01T10:00:00Z" } }] },
          { type: "text", text: "added", marks: [{ type: "bold" }, { type: "insertion", attrs: { author: "Ann", date: "2026-03-02T11:00:00Z" } }] },
        ],
      },
    ],
  };
  const bytes = await buildDocx({ doc, settings: { trackRevisions: true } });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:del w:id="\d+" w:author="Bea" w:date="2026-03-01T10:00:00Z"><w:r><w:delText>removed<\/w:delText><\/w:r><\/w:del>/);
  assert.match(xml, /<w:ins w:id="\d+" w:author="Ann" w:date="2026-03-02T11:00:00Z"><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t>added<\/w:t><\/w:r><\/w:ins>/);
  assert.match(await zip.file("word/settings.xml")!.async("string"), /<w:zoom w:percent="100"\/><w:trackRevisions\/><w:defaultTabStop/);
  const back = await importDocx(bytes);
  assert.equal(back.settings.trackRevisions, true);
  const runs = back.doc.content![0].content!;
  assert.deepEqual(runs.map((r) => r.text), ["Kept ", "removed", "added"]);
  assert.deepEqual(runs[1].marks, [{ type: "deletion", attrs: { id: runs[1].marks![0].attrs!.id, author: "Bea", date: "2026-03-01T10:00:00Z" } }]);
  assert.ok(runs[2].marks!.some((m) => m.type === "bold"));
  assert.equal(runs[2].marks!.find((m) => m.type === "insertion")?.attrs?.author, "Ann");
});

test("accepting or rejecting a whole-paragraph change removes the paragraph", async () => {
  const { compareDocs } = await import("../lib/docs/compare");
  const para = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const merged = compareDocs([para("Keep."), para("Old paragraph.")], [para("Keep."), para("Brand new text here.")], "Cmp").content;
  const mk = () => EditorState.create({ doc: schema.nodeFromJSON({ type: "doc", content: merged }) });
  const s0 = mk();
  assert.equal(trackedChanges(s0.doc).length, 2);
  const accepted = s0.apply(resolveChanges(s0, 0, s0.doc.content.size, true)!);
  assert.deepEqual(accepted.doc.content.content.map((n) => n.textContent), ["Keep.", "Brand new text here."]);
  const s1 = mk();
  const rejected = s1.apply(resolveChanges(s1, 0, s1.doc.content.size, false)!);
  assert.deepEqual(rejected.doc.content.content.map((n) => n.textContent), ["Keep.", "Old paragraph."]);
});
