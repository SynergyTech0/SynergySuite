// Sensitivity labels in Word and PowerPoint files: exports write the label as Office's
// MSIP_Label_<id>_* custom properties beside the file's other custom properties, and imports
// read it back so a document takes the organization's matching label.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DEFAULT_LABELS } from "@synergy/compliance/dist/labels";
import { fileLabelOf, isLabelProperty, knownLabel, withFileLabel } from "../lib/labels";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { buildPptx } from "../lib/slides/pptx-export";
import { importPptx } from "../lib/slides/pptx-import";
import { readCustomProps } from "../lib/sensitivity";
import type { PMNode } from "../lib/docs/model";
import type { Slide } from "../lib/slides/model";

const [, general, confidential] = DEFAULT_LABELS;
const settings = { labels: DEFAULT_LABELS };
const OTHER = "0f0e0d0c-0b0a-4908-8706-050403020100";
const doc: PMNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Q3 plan" }] }] };
const slide: Slide = { id: "s1", title: "Q3 plan", body: "", notes: "", layout: "title", bg: "", bgImg: "", elements: [] };

const props = async (bytes: Uint8Array | ArrayBuffer) => {
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file("docProps/custom.xml")?.async("string")) ?? "";
  return {
    custom: Object.fromEntries(readCustomProps(xml).map((p) => [p.name, p.value])),
    rels: (await zip.file("_rels/.rels")!.async("string")) || "",
    types: (await zip.file("[Content_Types].xml")!.async("string")) || "",
  };
};

test("withFileLabel replaces a label and keeps every other property; fileLabelOf reads it", () => {
  const setDate = new Date("2026-10-16T12:00:00.123Z");
  const custom = withFileLabel({ Client: "Contoso", [`MSIP_Label_${OTHER}_Enabled`]: "true", [`MSIP_Label_${OTHER}_Name`]: "Secret" }, confidential, setDate);
  assert.equal(custom.Client, "Contoso");
  assert.ok(!Object.keys(custom).some((k) => k.includes(OTHER)));
  assert.equal(custom[`MSIP_Label_${confidential.id}_Enabled`], "true");
  assert.equal(custom[`MSIP_Label_${confidential.id}_Name`], "Confidential");
  assert.equal(custom[`MSIP_Label_${confidential.id}_SetDate`], "2026-10-16T12:00:00Z");
  assert.deepEqual(fileLabelOf(custom), { id: confidential.id, name: "Confidential" });
  assert.deepEqual(withFileLabel(custom, null), { Client: "Contoso" });
  assert.equal(fileLabelOf({ Client: "Contoso" }), null);
  // a disabled label isn't the file's label
  assert.equal(fileLabelOf({ [`MSIP_Label_${OTHER}_Enabled`]: "false", [`MSIP_Label_${OTHER}_Name`]: "Old" }), null);
  // Docs reads boolean properties as Y/N
  assert.deepEqual(fileLabelOf({ [`MSIP_Label_${OTHER}_Enabled`]: "Y", [`MSIP_Label_${OTHER}_Name`]: "Secret" }), { id: OTHER, name: "Secret" });
  assert.ok(isLabelProperty(`MSIP_Label_${OTHER}_Method`) && !isLabelProperty("MSIP_Label_x_Name"));
});

test("knownLabel matches a file's label by id, then by name, else not at all", () => {
  assert.equal(knownLabel(settings, { id: general.id.toUpperCase(), name: "Anything" })?.id, general.id);
  assert.equal(knownLabel(settings, { id: OTHER, name: "confidential " })?.id, confidential.id);
  assert.equal(knownLabel(settings, { id: OTHER, name: "Secret" }), null);
  assert.equal(knownLabel(settings, null), null);
});

test("a .docx export writes the label as MSIP properties beside the document's own", async () => {
  const bytes = await buildDocx({ doc, title: "Plan", settings: { customProperties: { Client: "Contoso", [`MSIP_Label_${OTHER}_Enabled`]: "true", [`MSIP_Label_${OTHER}_Name`]: "Secret" } }, label: confidential });
  const p = await props(bytes);
  assert.equal(p.custom.Client, "Contoso");
  assert.equal(p.custom[`MSIP_Label_${confidential.id}_Enabled`], "true");
  assert.equal(p.custom[`MSIP_Label_${confidential.id}_Name`], "Confidential");
  assert.equal(p.custom[`MSIP_Label_${confidential.id}_Method`], "Privileged");
  assert.ok(!Object.keys(p.custom).some((k) => k.includes(OTHER)), "the old label is replaced");
  assert.match(p.rels, /relationships\/custom-properties" Target="docProps\/custom.xml"/);
  assert.match(p.types, /PartName="\/docProps\/custom.xml"/);

  // and it reads back: the document takes the organization's label
  const back = await importDocx(bytes);
  const label = fileLabelOf(back.settings.customProperties);
  assert.deepEqual(label, { id: confidential.id, name: "Confidential" });
  assert.equal(knownLabel(settings, label)?.id, confidential.id);
});

test("a .docx export with no label of ours keeps the file's own label; null removes it", async () => {
  const foreign = { Client: "Contoso", [`MSIP_Label_${OTHER}_Enabled`]: "true", [`MSIP_Label_${OTHER}_Name`]: "Secret" };
  const kept = await importDocx(await buildDocx({ doc, settings: { customProperties: foreign } }));
  assert.deepEqual(fileLabelOf(kept.settings.customProperties), { id: OTHER, name: "Secret" });
  const removed = await props(await buildDocx({ doc, settings: { customProperties: foreign }, label: null }));
  assert.deepEqual(removed.custom, { Client: "Contoso" });
  // nothing to write: no custom properties part at all
  const none = await JSZip.loadAsync(await buildDocx({ doc, label: null }));
  assert.equal(none.file("docProps/custom.xml"), null);
});

test("a .pptx export writes the label beside the deck's own properties, and the import reads it", async () => {
  const bytes = await buildPptx([slide], { name: "Plan", w: 1280, h: 720, theme: "plain", label: general });
  const p = await props(bytes);
  assert.equal(p.custom.SynergyTheme, "plain");
  assert.equal(p.custom[`MSIP_Label_${general.id}_Enabled`], "true");
  assert.equal(p.custom[`MSIP_Label_${general.id}_Name`], "General");
  assert.match(p.rels, /docProps\/custom.xml/);
  const deck = await importPptx(bytes);
  assert.deepEqual(deck.label, { id: general.id, name: "General" });
  assert.equal(deck.theme, "plain", "the deck's own properties still read back");

  const plain = await importPptx(await buildPptx([slide], { name: "Plan", w: 1280, h: 720, theme: "plain" }));
  assert.equal(plain.label, undefined);
});
