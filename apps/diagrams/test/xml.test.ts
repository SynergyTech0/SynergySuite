import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { blankXml, cleanXml, modelText, pages, summarize } from "../lib/xml";

const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
/** A page the way older draw.io builds and the Visio importer store it. */
const compressed = (m: string) => deflateRawSync(Buffer.from(encodeURIComponent(m), "latin1")).toString("base64");

describe("draw.io files", () => {
  it("makes a blank one-page file", () => {
    const xml = blankXml();
    expect(cleanXml(xml)).toBe(xml);
    expect(summarize(xml)).toEqual({ pages: 1, text: "" });
  });

  it("reads labels, HTML labels and shape data, on inline and compressed pages", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><mxfile><diagram id="a" name="Process">${model(
      '<mxCell id="2" value="Order &lt;b&gt;received&lt;/b&gt;&lt;br&gt;by sales" vertex="1" parent="1"/><mxCell id="3" value="" edge="1" parent="1"/>',
    )}</diagram><diagram id="b" name="Page-2">${compressed(
      model('<object id="4" label="Jane Doe" role="CFO &amp; treasurer" placeholders="1"><mxCell vertex="1" parent="1"/></object>'),
    )}</diagram></mxfile>`;
    const ps = pages(xml);
    expect(ps.map((p) => p.name)).toEqual(["Process", "Page-2"]);
    expect(modelText(ps[1].model!)).toEqual(["Jane Doe", "CFO & treasurer"]);
    const s = summarize(xml);
    expect(s.pages).toBe(2);
    // Default page names ("Page-2") are not worth searching for.
    expect(s.text.split("\n")).toEqual(["Process", "Order received by sales", "Jane Doe", "CFO & treasurer"]);
  });

  it("keeps a page it can't decompress without failing", () => {
    const xml = `<mxfile><diagram id="a" name="Broken">not-base64-deflate</diagram></mxfile>`;
    expect(pages(xml)[0].model).toBeNull();
    expect(summarize(xml)).toEqual({ pages: 1, text: "Broken" });
  });

  it("accepts a bare model as a one-page file and refuses anything else", () => {
    const one = cleanXml(model('<mxCell id="2" value="Hi" vertex="1" parent="1"/>'));
    expect(one).toMatch(/^<mxfile><diagram id="\w+" name="Page-1"><mxGraphModel>/);
    expect(summarize(one).text).toBe("Hi");
    expect(() => cleanXml("<html></html>")).toThrow(/isn't a draw.io diagram/);
    expect(() => cleanXml("<mxfile></mxfile>")).toThrow(/no pages/);
    expect(() => cleanXml(42)).toThrow(/draw.io XML/);
    expect(() => cleanXml(blankXml(), { DIAGRAMS_MAX_MB: "0.0001" })).toThrow(/too large/);
  });
});
