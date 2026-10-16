// Restrict editing: what an enforced protection lets through, content
// controls and editable exceptions through .docx and back.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { ContentControl, EditableRange, allowed } from "../components/docs/protection-ext";
import { CommentMark } from "../components/tiptap-ext";
import { readSdtPr, sdtPrXml, protectionXml, readProtection, hashPassword, checkPassword, needsPassword, uncheckablePassword } from "../lib/docs/protection";
import { checkWordPassword, legacyWordKey, legacyWordKeyHex } from "../lib/docs/word-password";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { parseXml } from "../lib/slides/xml";
import type { PMNode } from "../lib/docs/model";

const schema = getSchema([StarterKit, ContentControl, EditableRange, CommentMark]);
const doc = schema.nodeFromJSON({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Fixed text. " }, { type: "text", text: "Edit me", marks: [{ type: "editableRange" }] }, { type: "text", text: " end." }] },
    { type: "paragraph", content: [{ type: "text", text: "Name: " }, { type: "contentControl", attrs: { kind: "text" }, content: [{ type: "text", text: "Ann" }] }, { type: "text", text: " ok" }] },
  ],
});
const state = EditorState.create({ schema, doc });
const at = (t: string) => {
  let p = -1;
  doc.descendants((n, pos) => {
    if (p < 0 && n.isText && n.text!.includes(t)) p = pos + n.text!.indexOf(t);
  });
  return p;
};

test("read-only protection allows only the exceptions", () => {
  const p = { edit: "readOnly" as const, enforced: true };
  assert.equal(allowed(state.tr.insertText("x", at("Fixed") + 2), p), false);
  assert.equal(allowed(state.tr.insertText("x", at("Edit me") + 2), p), true);
  assert.equal(allowed(state.tr.delete(at("Edit me"), at("Edit me") + 4), p), true);
  assert.equal(allowed(state.tr.delete(at("Edit me") - 2, at("Edit me") + 4), p), false);
  assert.equal(allowed(state.tr.addMark(at("Fixed"), at("Fixed") + 5, schema.marks.bold.create()), p), false);
  // not enforced: anything goes
  assert.equal(allowed(state.tr.insertText("x", 2), { edit: "readOnly", enforced: false }), true);
  // collaborators' changes are never dropped
  assert.equal(allowed(state.tr.insertText("x", 2).setMeta("y-sync$", { isChangeOrigin: true }), p), true);
});

test("forms and comments protection", () => {
  const forms = { edit: "forms" as const, enforced: true };
  assert.equal(allowed(state.tr.insertText("e", at("Ann") + 3), forms), true);
  assert.equal(allowed(state.tr.insertText("e", at("Name")), forms), false);
  const comments = { edit: "comments" as const, enforced: true };
  assert.equal(allowed(state.tr.addMark(2, 6, schema.marks.comment.create({ threadId: "t1" })), comments), true);
  assert.equal(allowed(state.tr.insertText("x", 2), comments), false);
});

test("locked content controls", () => {
  const locked = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "contentControl", attrs: { kind: "text", lockContents: true, lockControl: true }, content: [{ type: "text", text: "fixed" }] }, { type: "text", text: " after" }] }] });
  const s = EditorState.create({ schema, doc: locked });
  assert.equal(allowed(s.tr.insertText("x", 3), undefined), false);
  assert.equal(allowed(s.tr.delete(1, 1 + locked.firstChild!.firstChild!.nodeSize), undefined), false);
  assert.equal(allowed(s.tr.insertText("x", locked.firstChild!.content.size), undefined), true);
});

test("sdtPr and documentProtection XML", () => {
  const x = sdtPrXml({ kind: "dropdown", title: "Colour", tag: "colour", items: JSON.stringify([{ text: "Red", value: "r" }, { text: "Blue", value: "b" }]), lockControl: true }, 7, true);
  const back = readSdtPr(parseXml(x) as never)!;
  assert.deepEqual(back, { kind: "dropdown", title: "Colour", tag: "colour", items: JSON.stringify([{ text: "Red", value: "r" }, { text: "Blue", value: "b" }]), lockControl: true, showingPlaceholder: true });
  const cb = readSdtPr(parseXml(sdtPrXml({ kind: "checkbox", checked: true }, 1, false)) as never)!;
  assert.equal(cb.kind, "checkbox");
  assert.equal(cb.checked, true);
  const d = readSdtPr(parseXml(sdtPrXml({ kind: "date", date: "2024-03-05", dateFormat: "d MMMM yyyy" }, 1, false)) as never)!;
  assert.deepEqual([d.kind, d.date, d.dateFormat], ["date", "2024-03-05", "d MMMM yyyy"]);
  assert.equal(readSdtPr(parseXml("<w:sdtPr><w:id w:val='1'/><w:citation/></w:sdtPr>") as never), null);
  const wordProt = readProtection(parseXml('<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" w:cryptAlgorithmSid="14" w:cryptSpinCount="100000" w:hash="abc=" w:salt="def="/>') as never)!;
  assert.equal(wordProt.edit, "forms");
  assert.equal(wordProt.enforced, true);
  assert.match(protectionXml(wordProt), /^<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" w:cryptAlgorithmSid="14" w:cryptSpinCount="100000" w:hash="abc=" w:salt="def="\/>$/);
});

test("passwords", async () => {
  const h = await hashPassword("s3cret");
  // new passwords are hashed the way Word does it, so Word asks for the same one
  assert.equal(h.word["w:cryptAlgorithmSid"], "14");
  assert.equal(h.word["w:cryptSpinCount"], "100000");
  assert.equal(await checkPassword({ edit: "readOnly", enforced: true, ...h }, "s3cret"), true);
  assert.equal(await checkPassword({ edit: "readOnly", enforced: true, ...h }, "nope"), false);
});

test("Word's password hash: the legacy key and a hash saved by Word", async () => {
  // the examples in [MS-OFFCRYPTO] and Apache POI's tests
  assert.equal(legacyWordKey("Example").toString(16).toUpperCase(), "64CEED7E");
  assert.equal(legacyWordKeyHex("Example"), "7EEDCE64");
  assert.equal(legacyWordKey("34579").toString(16).toUpperCase().padStart(8, "0"), "0005CB00");
  // w:documentProtection of a document protected in Word with the password "Example" (POI's bug56076.docx)
  const word = { "w:cryptProviderType": "rsaFull", "w:cryptAlgorithmClass": "hash", "w:cryptAlgorithmType": "typeAny", "w:cryptAlgorithmSid": "4", "w:cryptSpinCount": "100000", "w:hash": "MUHbcmpC9AnlLsd9v3lW0j30y6E=", "w:salt": "2Z+i7o/0EZyUNakVeWzU/w==" };
  const p = { edit: "trackedChanges" as const, enforced: true, word };
  assert.equal(needsPassword(p), true);
  assert.equal(await checkPassword(p, "Example"), true);
  assert.equal(await checkPassword(p, "example"), false);
  assert.equal(await checkWordPassword({ ...word, "w:cryptAlgorithmSid": "1" }, "Example"), null, "MD2 can't be checked");
  assert.equal(uncheckablePassword({ ...p, word: { ...word, "w:cryptAlgorithmSid": "1" } }), true);
  // the strict attribute names
  const strict = { "w:algorithmName": "SHA-1", "w:spinCount": "100000", "w:hashValue": word["w:hash"], "w:saltValue": word["w:salt"] };
  assert.equal(await checkWordPassword(strict, "Example"), true);
});

test("controls, exceptions and protection round-trip through .docx", async () => {
  const d: PMNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Agree: " },
          { type: "contentControl", attrs: { kind: "checkbox", checked: true, tag: "agree" }, content: [{ type: "text", text: "☒" }] },
          { type: "text", text: " Colour: " },
          { type: "contentControl", attrs: { kind: "dropdown", title: "Colour", items: JSON.stringify([{ text: "Red", value: "Red" }]) } },
          { type: "text", text: " Name: " },
          { type: "contentControl", attrs: { kind: "text", placeholder: "Your name" }, content: [{ type: "text", text: "Ann" }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Read only. " }, { type: "text", text: "Editable", marks: [{ type: "editableRange", attrs: { group: "everyone" } }] }] },
    ],
  };
  const bytes = await buildDocx({ doc: d, settings: { protection: { edit: "readOnly", enforced: true } } });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w14:checkbox><w14:checked w14:val="1"\/>/);
  assert.match(xml, /<w:alias w:val="Colour"\/>.*<w:showingPlcHdr\/><w:dropDownList>/);
  assert.match(xml, /<w:permStart w:id="1" w:edGrp="everyone"\/><w:r><w:t>Editable<\/w:t><\/w:r><w:permEnd w:id="1"\/>/);
  assert.match(await zip.file("word/settings.xml")!.async("string"), /<w:documentProtection w:edit="readOnly" w:enforcement="1"\/>/);
  const back = await importDocx(bytes);
  assert.deepEqual(back.settings.protection, { edit: "readOnly", enforced: true });
  const ccs = back.doc.content![0].content!.filter((n) => n.type === "contentControl");
  assert.deepEqual(ccs.map((c) => c.attrs?.kind), ["checkbox", "dropdown", "text"]);
  assert.equal(ccs[0].attrs?.checked, true);
  assert.equal(ccs[0].attrs?.tag, "agree");
  assert.equal(ccs[1].content, undefined);
  assert.equal(ccs[1].attrs?.placeholder, "Click or tap here to enter text.");
  assert.equal(ccs[2].content![0].text, "Ann");
  const p2 = back.doc.content![1].content!;
  assert.equal(p2[1].text, "Editable");
  assert.ok(p2[1].marks?.some((m) => m.type === "editableRange"));
  assert.ok(!p2[0].marks?.some((m) => m.type === "editableRange"));
});
