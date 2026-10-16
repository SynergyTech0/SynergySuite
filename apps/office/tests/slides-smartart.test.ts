// SmartArt import: the saved drawing becomes one group of editable shapes;
// a graphic without a drawing is rebuilt from its data model's text.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { ShapeEl, Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DGM = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"';
const EMU = 9525;

const frame = (id: number, dm: string, lo: string, x: number, y: number, w: number, h: number) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Diagram ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds ${DGM} xmlns:r="${R}" r:dm="${dm}" r:lo="${lo}" r:qs="" r:cs=""/></a:graphicData></a:graphic></p:graphicFrame>`;

const dsp = (x: number, text: string) =>
  `<dsp:sp modelId="{${x}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${x * EMU}" y="0"/><a:ext cx="${100 * EMU}" cy="${60 * EMU}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`;

const pt = (id: string, text: string) => `<dgm:pt modelId="${id}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></dgm:t></dgm:pt>`;
const cxn = (src: string, dst: string, ord: number) => `<dgm:cxn modelId="c${dst}" srcId="${src}" destId="${dst}" srcOrd="${ord}" destOrd="0"/>`;

test("SmartArt: drawings become grouped shapes; a graphic without one is rebuilt from its text", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [] };
  const zip = await JSZip.loadAsync(await buildPptx([s], { name: "d", w: 1280, h: 720, theme: "plain" }));
  const slidePath = "ppt/slides/slide1.xml";
  let xml = await zip.file(slidePath)!.async("string");
  xml = xml.replace("</p:spTree>", `${frame(50, "rIdD1", "rIdL1", 100, 50, 400, 200)}${frame(51, "rIdD2", "rIdL2", 600, 300, 400, 400)}</p:spTree>`);
  if (!/xmlns:a=/.test(xml)) xml = xml.replace("<p:sld ", `<p:sld ${A} `);
  zip.file(slidePath, xml);
  const relsPath = "ppt/slides/_rels/slide1.xml.rels";
  const rels = (await zip.file(relsPath)!.async("string")).replace(
    "</Relationships>",
    [
      `<Relationship Id="rIdD1" Type="${R}/diagramData" Target="../diagrams/data1.xml"/>`,
      `<Relationship Id="rIdL1" Type="${R}/diagramLayout" Target="../diagrams/layout1.xml"/>`,
      `<Relationship Id="rIdDr1" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>`,
      `<Relationship Id="rIdD2" Type="${R}/diagramData" Target="../diagrams/data2.xml"/>`,
      `<Relationship Id="rIdL2" Type="${R}/diagramLayout" Target="../diagrams/layout2.xml"/>`,
    ].join("") + "</Relationships>",
  );
  zip.file(relsPath, rels);
  zip.file("ppt/diagrams/data1.xml", `<dgm:dataModel ${DGM} ${A}><dgm:ptLst><dgm:pt modelId="0" type="doc"/>${pt("1", "One")}${pt("2", "Two")}</dgm:ptLst><dgm:cxnLst>${cxn("0", "1", 0)}${cxn("0", "2", 1)}</dgm:cxnLst><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rIdDr1" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`);
  zip.file("ppt/diagrams/layout1.xml", `<dgm:layoutDef ${DGM} uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/default"/>`);
  zip.file("ppt/diagrams/drawing1.xml", `<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" ${A}><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>${dsp(0, "One")}${dsp(150, "Two")}</dsp:spTree></dsp:drawing>`);
  // the second graphic: a cycle with only its data model (Stage 1 -> 3, the last with a child)
  zip.file("ppt/diagrams/data2.xml", `<dgm:dataModel ${DGM} ${A}><dgm:ptLst><dgm:pt modelId="0" type="doc"/>${pt("a", "Stage 1")}${pt("b", "Stage 2")}${pt("c", "Stage 3")}${pt("d", "Detail")}<dgm:pt modelId="x" type="pres"/></dgm:ptLst><dgm:cxnLst>${cxn("0", "b", 1)}${cxn("0", "a", 0)}${cxn("0", "c", 2)}${cxn("c", "d", 0)}<dgm:cxn modelId="p1" type="presOf" srcId="a" destId="x"/></dgm:cxnLst></dgm:dataModel>`);
  zip.file("ppt/diagrams/layout2.xml", `<dgm:layoutDef ${DGM} uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/cycle2"/>`);
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const els = deck.slides[0].elements as ShapeEl[];
  const drawn = els.filter((e) => e.type === "shape" && e.shape === "roundRect");
  assert.equal(drawn.length, 2);
  assert.ok(drawn[0].group && drawn[0].group === drawn[1].group);
  assert.deepEqual([drawn[0].x, drawn[0].y, drawn[1].x], [100, 50, 250]);
  assert.match(drawn[1].html || "", /Two/);
  const rebuilt = els.filter((e) => !drawn.includes(e));
  const nodes = rebuilt.filter((e) => e.shape === "ellipse");
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map((n) => /Stage \d/.exec(n.html || "")?.[0]), ["Stage 1", "Stage 2", "Stage 3"]);
  assert.match(nodes[2].html || "", /Detail/);
  assert.equal(rebuilt.filter((e) => e.shape === "rightArrow").length, 3);
  assert.equal(new Set(rebuilt.map((e) => e.group)).size, 1);
  assert.notEqual(rebuilt[0].group, drawn[0].group);
  assert.ok(rebuilt.every((e) => e.x >= 600 - 1 && e.y >= 300 - 1 && e.x + e.w <= 1001 && e.y + e.h <= 701));
  assert.ok(deck.warnings.some((w) => /rebuilt from its text/.test(w)));
});

const slideOf = (elements: Slide["elements"]): Slide => ({ id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements });
async function diagramDeck(kind: "process" | "hierarchy" | "list") {
  const { buildDiagram, parseOutline } = await import("../lib/slides/smartart");
  const text = kind === "hierarchy" ? "CEO\n  Sales\n  Finance" : kind === "list" ? "Goals\n  Grow\nRisks\n  Hiring" : "Plan\nBuild\nShip";
  const els = buildDiagram(kind, parseOutline(text), { x: 100, y: 100, w: 800, h: 400 }, "4472C4", "g1");
  return slideOf(els.map((e, i) => ({ ...e, id: `d${i}`, z: i + 1 }) as Slide["elements"][number]));
}

test("live SmartArt: the data model rides on the group and typed text goes back into it", async () => {
  const { syncShapeText, outlineText } = await import("../lib/slides/smartart");
  const s = await diagramDeck("list");
  const lead = s.elements[0] as ShapeEl;
  assert.deepEqual(lead.dgm?.items, [{ text: "Goals", level: 0 }, { text: "Grow", level: 1 }, { text: "Risks", level: 0 }, { text: "Hiring", level: 1 }]);
  assert.equal(outlineText(lead.dgm!.items), "Goals\n  Grow\nRisks\n  Hiring");
  const details = s.elements.find((e) => e.type === "shape" && e.dpt?.[0] === 1) as ShapeEl;
  assert.deepEqual(details.dpt, [1]);
  const next = syncShapeText(lead.dgm!, details.dpt, "<ul><li><p>Grow fast</p></li></ul>");
  assert.equal(next.items[1].text, "Grow fast");
  assert.equal(next.items[0].text, "Goals");
});

test("live SmartArt: written as PowerPoint's SmartArt (data, layout, style, colours, drawing) and read back", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { schemaProblems, ruledElements } = await import("./fixtures/ooxml-check.mts");
  for (const kind of ["process", "hierarchy", "list"] as const) {
    const bytes = await buildPptx([await diagramDeck(kind)], { name: "d", w: 1280, h: 720, theme: "plain" });
    const zip = await JSZip.loadAsync(bytes);
    const sl = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.match(sl, /<a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/diagram"><dgm:relIds [^>]*r:dm="[^"]+" r:lo="[^"]+" r:qs="[^"]+" r:cs="[^"]+"\/>/, kind);
    assert.ok(!/syn-el-d\d/.test(sl), "the shapes moved into the drawing part");
    assert.equal(new DOMParser().parseFromString(sl, "application/xml").getElementsByTagName("parsererror").length, 0);
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    for (const t of ["diagramData", "diagramLayout", "diagramQuickStyle", "diagramColors", "diagramDrawing"]) assert.match(rels, new RegExp(`/${t}" Target="\\.\\./diagrams/`), t);
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    for (const t of ["diagramData", "diagramLayout", "diagramStyle", "diagramColors", "diagramDrawing"]) assert.match(ct, new RegExp(`drawingml\\.${t}\\+xml`), t);
    for (const part of ["data1", "layout1", "quickStyle1", "colors1", "drawing1"]) {
      const x = await zip.file(`ppt/diagrams/${part}.xml`)!.async("string");
      assert.deepEqual(schemaProblems(x), [], `${kind} ${part}`);
      assert.ok(ruledElements(x) > 0, part);
    }
    const data = await zip.file("ppt/diagrams/data1.xml")!.async("string");
    const drawingRel = /<dsp:dataModelExt [^>]*relId="([^"]+)"/.exec(data)![1];
    assert.match(rels, new RegExp(`Id="${drawingRel}" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing"`));
    // the drawing's shapes point at the data model's points
    const drawing = await zip.file("ppt/diagrams/drawing1.xml")!.async("string");
    const firstNode = /<dgm:pt modelId="([^"]+)"><dgm:prSet phldrT/.exec(data)![1];
    assert.ok(drawing.includes(`modelId="${firstNode}"`), kind);

    const back = await importPptx(bytes);
    const lead = back.slides[0].elements.find((e) => e.type === "shape" && e.dgm) as ShapeEl;
    assert.equal(lead.dgm!.kind, kind);
    assert.equal(lead.dgm!.src, undefined, "our own diagrams are laid out by us again");
    assert.ok(back.slides[0].elements.every((e) => e.group === lead.group));
    assert.ok(back.slides[0].elements.some((e) => e.type === "shape" && e.dpt?.length));
  }
});

test("live SmartArt from another application keeps its parts; edited text lands in its data model", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const zip = await JSZip.loadAsync(await buildPptx([await diagramDeck("process")], { name: "d", w: 1280, h: 720, theme: "plain" }));
  const props = await zip.file("docProps/custom.xml")!.async("string");
  zip.file("docProps/custom.xml", props.replace(/<property[^>]*name="Synergy\w+"[^>]*>[\s\S]*?<\/property>/g, ""));
  // a layout of its own (as PowerPoint's own definitions are)
  const lay = await zip.file("ppt/diagrams/layout1.xml")!.async("string");
  zip.file("ppt/diagrams/layout1.xml", lay.replace(/uniqueId="[^"]+"/, 'uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/chevron1"').replace("<dgm:title val=\"\"/>", '<dgm:title val="Basic Chevron Process"/>'));
  const deck = await importPptx(await zip.generateAsync({ type: "arraybuffer" }));
  const lead = deck.slides[0].elements.find((e) => e.type === "shape" && e.dgm) as ShapeEl;
  assert.equal(lead.dgm!.kind, "process");
  assert.ok(lead.dgm!.src?.layout.includes("Basic Chevron Process"));
  assert.equal(lead.dgm!.src!.ids.length, 3);
  // typed into the second box
  const { syncShapeText } = await import("../lib/slides/smartart");
  const box = deck.slides[0].elements.find((e) => e.type === "shape" && e.dpt?.[0] === 1) as ShapeEl;
  lead.dgm = syncShapeText(lead.dgm!, box.dpt, "<p>Build it</p>");
  const out = await JSZip.loadAsync(await buildPptx(deck.slides, { name: "d", w: 1280, h: 720, theme: "plain" }));
  const data = await out.file("ppt/diagrams/data1.xml")!.async("string");
  assert.match(data, new RegExp(`modelId="${lead.dgm!.src!.ids[1].replace(/[{}]/g, "\\$&")}"[\\s\\S]*?<a:t>Build it</a:t>`));
  assert.match(await out.file("ppt/diagrams/layout1.xml")!.async("string"), /Basic Chevron Process/);
});
