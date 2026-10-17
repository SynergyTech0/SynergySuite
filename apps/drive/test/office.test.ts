import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, matchLabel, msipProperties } from "@synergy/compliance";
import { decodeXml, isOfficeName, labelFromCustomXml, officeLabel, officeText, xmlText } from "../lib/office";

const highly = DEFAULT_LABELS.find((l) => l.name === "Highly Confidential")!;

/** docProps/custom.xml as Office writes it. */
function customXml(props: [string, string][]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${props
    .map(([k, v], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${k}"><vt:lpwstr>${v}</vt:lpwstr></property>`)
    .join("")}</Properties>`;
}

function pkg(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

const docx = (body: string, custom?: string) =>
  pkg({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
    ...(custom ? { "docProps/custom.xml": custom } : {}),
  });

describe("Office labels", () => {
  it("reads the enabled label a Word file carries", () => {
    const file = docx("<w:p><w:r><w:t>Hi</w:t></w:r></w:p>", customXml(msipProperties(highly)));
    expect(officeLabel(file)).toEqual({ id: highly.id, name: "Highly Confidential" });
  });

  it("ignores labels that are not enabled, and files without any", () => {
    const off = customXml([[`MSIP_Label_${highly.id}_Enabled`, "false"], [`MSIP_Label_${highly.id}_Name`, "Highly Confidential"]]);
    expect(labelFromCustomXml(off)).toBeNull();
    expect(officeLabel(docx("<w:p/>"))).toBeNull();
    expect(officeLabel(strToU8("not a zip"))).toBeNull();
  });

  it("matches another tenant's label by name, and its own by id whatever the case", () => {
    const other = "0e8a1b2c-3d4e-4f50-8a9b-0c1d2e3f4a5b";
    const xml = customXml([[`MSIP_Label_${other}_Enabled`, "true"], [`MSIP_Label_${other}_Name`, "confidential"]]);
    const found = labelFromCustomXml(xml)!;
    expect(found.id).toBe(other);
    expect(matchLabel({ labels: DEFAULT_LABELS }, found.id, found.name)?.name).toBe("Confidential");
    const upper = labelFromCustomXml(customXml([[`MSIP_Label_${highly.id.toUpperCase()}_Enabled`, "TRUE"]]))!;
    expect(matchLabel({ labels: DEFAULT_LABELS }, upper.id)?.id).toBe(highly.id);
  });

  it("decodes names with XML entities", () => {
    const xml = customXml([[`MSIP_Label_${highly.id}_Enabled`, "true"], [`MSIP_Label_${highly.id}_Name`, "R&amp;D &#x2013; only"]]);
    expect(labelFromCustomXml(xml)?.name).toBe("R&D – only");
  });

  it("knows Office files by name", () => {
    expect(isOfficeName("Plan.DOCX")).toBe(true);
    expect(isOfficeName("plan.doc")).toBe(false);
  });
});

describe("Office text", () => {
  it("joins runs split by Word and keeps paragraphs apart", () => {
    const file = docx(
      "<w:p><w:r><w:t>Card 4111 1111</w:t></w:r><w:r><w:t xml:space=\"preserve\"> 1111 1111</w:t></w:r></w:p><w:p><w:r><w:t>Next &amp; last</w:t></w:r></w:p>",
    );
    expect(officeText(file)).toBe("Card 4111 1111 1111 1111\nNext & last");
  });

  it("reads Excel cells and PowerPoint slides", () => {
    const xlsx = pkg({
      "xl/sharedStrings.xml": "<sst><si><t>SSN</t></si><si><t>123-45-6789</t></si></sst>",
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="inlineStr"><is><t>Routing</t></is></c><c><v>021000021</v></c></row></sheetData></worksheet>',
      "xl/styles.xml": "<styleSheet><t>not text</t></styleSheet>",
    });
    const t = officeText(xlsx)!;
    expect(t).toContain("SSN\n123-45-6789");
    expect(t).toContain("Routing\t021000021");
    expect(t).not.toContain("not text");
    const pptx = pkg({ "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>", "ppt/slides/slide10.xml": "<a:p><a:t>Tenth</a:t></a:p>" });
    expect(officeText(pptx)).toBe("Second\nTenth");
  });

  it("turns markup into plain text", () => {
    expect(xmlText("<w:p><w:r><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b</w:t></w:r></w:p>")).toBe("a\tb");
    expect(decodeXml("&lt;x&gt; &#65; &bogus;")).toBe("<x> A &bogus;");
  });
});
