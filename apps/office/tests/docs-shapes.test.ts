// Floating pictures, shapes and text boxes: wrap and position survive the
// .docx round trip (wp:anchor with wrapSquare / wrapTight / wrapNone, wps:wsp
// with preset geometry, fill, outline and text).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { shapeSvg } from "../lib/docs/drawing";
import type { PMNode } from "../lib/docs/model";

// a 2×2 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

test("shape SVG draws the preset geometry", () => {
  assert.match(shapeSvg("ellipse", 100, 50, "#ff0000", "#000000", 2), /<ellipse cx="50" cy="25" rx="49" ry="24"\/>/);
  assert.match(shapeSvg("triangle", 100, 50, "#ff0000", "none", 0), /<polygon points="50\.0,0\.0 100\.0,50\.0 0\.0,50\.0"\/>/);
});

test("floating pictures, shapes and text boxes round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: PNG, width: 120, height: 120, wrap: "square", align: "right" } },
      { type: "paragraph", content: [{ type: "text", text: "Text that wraps around the picture." }] },
      { type: "shape", attrs: { kind: "ellipse", width: 150, height: 80, fill: "#4472c4", stroke: "#2f528f", strokeWidth: 1, color: "#ffffff", valign: "middle", wrap: "front", offsetX: 300, offsetY: 20 }, content: [{ type: "paragraph", content: [{ type: "text", text: "In front" }] }] },
      { type: "shape", attrs: { kind: "rect", width: 200, height: 90, fill: "#ffffff", stroke: "#000000", strokeWidth: 0.75, valign: "top", wrap: "tight", textBox: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Boxed note" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "More text." }] },
      { type: "image", attrs: { src: PNG, width: 60, height: 60, align: "center" } },
    ],
  };
  const bytes = await buildDocx({ doc });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  // the floating picture is anchored in the paragraph it floats beside
  assert.match(main, /<w:p><w:r><w:drawing><wp:anchor [^>]*behindDoc="0"[^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="column"><wp:align>right<\/wp:align><\/wp:positionH>.*?<wp:wrapSquare wrapText="bothSides"\/>.*?<\/wp:anchor><\/w:drawing><\/w:r><w:r><w:t>Text that wraps/);
  assert.match(main, /<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor [^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="column"><wp:posOffset>2857500<\/wp:posOffset><\/wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>190500<\/wp:posOffset><\/wp:positionV>.*?<wp:wrapNone\/>.*?<a:prstGeom prst="ellipse">.*?<a:srgbClr val="4472C4"\/>.*?<w:txbxContent><w:p>.*?<w:color w:val="FFFFFF"\/>.*?In front.*?anchor="ctr"/);
  assert.match(main, /<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0">.*?<wps:cNvSpPr txBox="1"\/>/);
  assert.match(main, /<w:jc w:val="center"\/><\/w:pPr><w:r><w:drawing><wp:inline/);

  const back = await importDocx(bytes);
  const c = back.doc.content!;
  assert.deepEqual(c.map((n) => n.type), ["image", "paragraph", "shape", "shape", "paragraph", "image"]);
  assert.equal(c[0].attrs!.wrap, "square");
  assert.equal(c[0].attrs!.align, "right");
  assert.deepEqual([c[2].attrs!.kind, c[2].attrs!.wrap, c[2].attrs!.offsetX, c[2].attrs!.offsetY, c[2].attrs!.fill, c[2].attrs!.color, c[2].attrs!.valign], ["ellipse", "front", 300, 20, "#4472c4", "#ffffff", "middle"]);
  assert.equal(c[2].content![0].content![0].text, "In front");
  assert.deepEqual([c[3].attrs!.textBox, c[3].attrs!.wrap, c[3].attrs!.stroke, c[3].attrs!.strokeWidth, c[3].attrs!.width, c[3].attrs!.height], [true, "tight", "#000000", 0.75, 200, 90]);
  assert.equal(c[5].attrs!.wrap ?? "inline", "inline");
  assert.equal(c[5].attrs!.align, "center");
});
