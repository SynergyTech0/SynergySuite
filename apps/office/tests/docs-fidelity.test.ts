// What the .docx fidelity pass fixed: rows inside content controls, controls
// inside controls, VML text boxes and grouped shapes, embedded objects, legacy
// form fields, comments on a point, very deep tables, metafile pictures,
// "odd" headers and phonetic guides.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { importDocx } from "../lib/docs/docx-import";
import { buildDocx, svgSize } from "../lib/docs/docx-export";
import type { PMNode } from "../lib/docs/model";

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function pkg(body: string, opts: { rels?: string; files?: Record<string, string | Uint8Array> } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.rels || ""}</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  for (const [k, v] of Object.entries(opts.files || {})) zip.file(k, v);
  return zip.generateAsync({ type: "uint8array" });
}
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const textOf = (n: PMNode): string => (n.text || "") + (n.content || []).map(textOf).join("");
const find = (n: PMNode, type: string): PMNode[] => [...(n.type === type ? [n] : []), ...(n.content || []).flatMap((c) => find(c, type))];

test("table rows inside content controls, and a control inside a control", async () => {
  const d = await importDocx(
    await pkg(
      `<w:tbl><w:tr><w:tc>${p("Top")}</w:tc></w:tr><w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent><w:tr><w:tc>${p("In control")}</w:tc></w:tr></w:sdtContent></w:sdt></w:tbl>` +
        `<w:p><w:sdt><w:sdtPr><w:alias w:val="outer"/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:alias w:val="inner"/></w:sdtPr><w:sdtContent><w:r><w:t>Subject</w:t></w:r></w:sdtContent></w:sdt></w:sdtContent></w:sdt></w:p>`,
    ),
  );
  const table = find(d.doc, "table")[0];
  assert.equal(table.content!.length, 2);
  assert.equal(textOf(table.content![1]), "In control");
  const cc = find(d.doc, "contentControl");
  assert.equal(cc.length, 1);
  assert.equal(cc[0].attrs!.title, "outer");
  assert.equal(textOf(cc[0]), "Subject");
});

test("VML text boxes, grouped shapes and embedded objects", async () => {
  const d = await importDocx(
    await pkg(
      `<w:p><w:r><w:pict><v:shape style="width:150pt;height:30pt"><v:textbox><w:txbxContent>${p("Boxed text")}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>` +
        `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>` +
        `<wps:wsp><wps:spPr/><wps:txbx><w:txbxContent>${p("First shape")}</w:txbxContent></wps:txbx></wps:wsp><wps:wsp><wps:spPr/><wps:txbx><w:txbxContent>${p("Second shape")}</w:txbxContent></wps:txbx></wps:wsp>` +
        `</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
        `<w:p><w:r><w:object><v:shape style="width:60pt;height:45pt"><v:imagedata r:id="rIdPic"/></v:shape></w:object></w:r></w:p>`,
      { rels: `<Relationship Id="rIdPic" Type="${REL}/image" Target="media/p.png"/>`, files: { "word/media/p.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) } },
    ),
  );
  const shapes = find(d.doc, "shape");
  assert.equal(shapes.length, 2);
  assert.equal(textOf(shapes[0]), "Boxed text");
  assert.equal(shapes[0].attrs!.width, 200);
  assert.equal(shapes[0].attrs!.textBox, true);
  assert.equal(textOf(shapes[1]), "First shapeSecond shape", "both shapes of the group keep their text");
  assert.equal(shapes[1].attrs!.width, 200);
  const img = find(d.doc, "image");
  assert.equal(img.length, 1);
  assert.equal(img[0].attrs!.width, 80);
  assert.ok(d.warnings!.some((w) => /Grouped shapes/.test(w)));
  assert.ok(d.warnings!.some((w) => /Embedded objects/.test(w)));
});

test("legacy form fields become content controls; one running into a table hides nothing", async () => {
  const field = (kind: string, ff: string, result = "") =>
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="F_${kind}"/>${ff}</w:ffData></w:fldChar></w:r><w:r><w:instrText> ${kind} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const d = await importDocx(
    await pkg(
      `<w:p><w:r><w:t xml:space="preserve">Agree </w:t></w:r>${field("FORMCHECKBOX", '<w:checkBox><w:sizeAuto/><w:default w:val="0"/><w:checked/></w:checkBox>')}</w:p>` +
        `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r>${field("FORMTEXT", "<w:textInput/>", "<w:r><w:t>Ada</w:t></w:r>")}</w:p>` +
        `<w:p>${field("FORMTEXT", "<w:textInput/>", "<w:r><w:t>   </w:t></w:r>")}</w:p>` +
        `<w:p>${field("FORMDROPDOWN", '<w:ddList><w:result w:val="1"/><w:listEntry w:val="Red"/><w:listEntry w:val="Blue"/></w:ddList>')}</w:p>` +
        // a text field whose end comes after a table (as some writers leave it)
        `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Data</w:t></w:r></w:p>` +
        `<w:tbl><w:tr><w:tc>${p("Cell text")}</w:tc></w:tr></w:tbl><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    ),
  );
  const cc = find(d.doc, "contentControl");
  assert.deepEqual(
    cc.map((c) => [c.attrs!.kind, c.attrs!.title ?? null, textOf(c)]),
    [
      ["checkbox", "F_FORMCHECKBOX", "☒"],
      ["text", "F_FORMTEXT", "Ada"],
      ["text", "F_FORMTEXT", ""],
      ["dropdown", "F_FORMDROPDOWN", "Blue"],
      ["text", null, "Data"],
    ],
  );
  assert.equal(cc[0].attrs!.checked, true);
  assert.deepEqual(JSON.parse(String(cc[3].attrs!.items)).map((i: { text: string }) => i.text), ["Red", "Blue"]);
  assert.match(textOf(d.doc), /Cell text/);
  const back = await (await JSZip.loadAsync(await buildDocx({ doc: d.doc }))).file("word/document.xml")!.async("string");
  assert.match(back, /<w14:checkbox>/);
  assert.match(back, /<w:dropDownList>/);
});

test("a comment on a point is anchored on the word before it", async () => {
  const d = await importDocx(
    await pkg(`<w:p><w:r><w:t xml:space="preserve">See this word</w:t></w:r><w:r><w:commentReference w:id="4"/></w:r></w:p>`, {
      rels: `<Relationship Id="rIdC" Type="${REL}/comments" Target="comments.xml"/>`,
      files: { "word/comments.xml": `<w:comments ${NS}><w:comment w:id="4" w:author="Ann"><w:p><w:r><w:t>Check</w:t></w:r></w:p></w:comment></w:comments>` },
    }),
  );
  const texts = d.doc.content![0].content!;
  assert.deepEqual(texts.map((t) => t.text), ["See this ", "word"]);
  assert.equal(texts[1].marks!.find((m) => m.type === "comment")!.attrs!.threadId, "docx-4");
  assert.equal(d.comments[0].quote, "word");
});

test("very deep tables are flattened below 24 levels instead of overflowing", async () => {
  let body = p("deepest");
  for (let i = 0; i < 3000; i++) body = `<w:tbl><w:tr><w:tc>${body}</w:tc></w:tr></w:tbl>`;
  const d = await importDocx(await pkg(body + p("after")));
  assert.match(textOf(d.doc), /deepest.*after/);
  let depth = 0;
  for (let n: PMNode | undefined = d.doc.content![0]; n; n = n.content?.[0]?.content?.[0]?.content?.find((c) => c.type === "table")) depth++;
  assert.equal(depth, 24);
  assert.ok(d.warnings!.some((w) => /nested more than 24/.test(w)));
});

test("metafile pictures show as SVG and go back as the original EMF", async () => {
  const emf = new Uint8Array([1, 0, 0, 0, 108, 0, 0, 0, 9, 9, 9, 9]);
  const d = await importDocx(
    await pkg(`<w:p><w:r><w:pict><v:shape style="width:30pt;height:30pt"><v:imagedata r:id="rIdE"/></v:shape></w:pict></w:r></w:p>`, {
      rels: `<Relationship Id="rIdE" Type="${REL}/image" Target="media/image1.emf"/>`,
      files: { "word/media/image1.emf": emf },
    }),
  );
  const img = find(d.doc, "image")[0];
  assert.match(String(img.attrs!.src), /^data:image\/svg\+xml;base64,/);
  assert.match(String(img.attrs!.orig), /^data:image\/x-emf;base64,/);
  const zip = await JSZip.loadAsync(await buildDocx({ doc: d.doc }));
  const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir);
  assert.deepEqual(media, ["word/media/image1.emf"]);
  assert.deepEqual(new Uint8Array(await zip.file(media[0])!.async("uint8array")), emf);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /Extension="emf" ContentType="image\/x-emf"/);
});

test('"odd" headers count as the default; phonetic guides keep their base text', async () => {
  const d = await importDocx(
    await pkg(`<w:p><w:r><w:ruby><w:rubyPr/><w:rt><w:r><w:t>とうきょう</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>東京</w:t></w:r></w:rubyBase></w:ruby></w:r></w:p><w:sectPr><w:headerReference w:type="odd" r:id="rIdH"/></w:sectPr>`, {
      rels: `<Relationship Id="rIdH" Type="${REL}/header" Target="header1.xml"/>`,
      files: { "word/header1.xml": `<w:hdr ${NS}>${p("Running head")}</w:hdr>` },
    }),
  );
  assert.equal(textOf(d.doc), "東京");
  assert.equal(textOf(d.body.headers!.default as unknown as PMNode), "Running head");
});

test("task lists go out as Word checkboxes and come back as task lists", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "taskList", content: [
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Done thing" }] }] },
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Open thing" }] }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ],
  };
  const bytes = await buildDocx({ doc });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.equal((xml.match(/<w14:checkbox>/g) || []).length, 2);
  assert.match(xml, /<w14:checked w14:val="1"\/>.*<w:t>☒<\/w:t>/);
  assert.ok(!/Click or tap/.test(xml), "a checkbox has no placeholder text");
  const back = await importDocx(bytes);
  assert.deepEqual(back.doc.content!.map((n) => n.type), ["taskList", "paragraph"]);
  assert.deepEqual(back.doc.content![0].content!.map((i) => [i.attrs!.checked, textOf(i)]), [[true, "Done thing"], [false, "Open thing"]]);
});

test("SVG pictures go out with a PNG beside them (asvg:svgBlip) and come back as SVG", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="red"/></svg>';
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const doc: PMNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src, width: 240, height: 120 } }] }] };
  // without a rasterizer (no browser) the picture is left out
  const bare = await (await JSZip.loadAsync(await buildDocx({ doc }))).file("word/document.xml")!.async("string");
  assert.ok(!/<pic:pic>/.test(bare));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 240, 0, 0, 0, 120]);
  let asked: number[] = [];
  const bytes = await buildDocx({ doc, rasterize: async (_s, w, h) => ((asked = [w, h]), png) });
  assert.deepEqual(asked, [120, 60], "drawn at the SVG's own size");
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<a:blip r:embed="(rId\d+)"><a:extLst><a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"><asvg:svgBlip [^>]*r:embed="(rId\d+)"\/>/);
  assert.deepEqual(Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir).sort(), ["word/media/image1.png", "word/media/image2.svg"]);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /Extension="svg" ContentType="image\/svg\+xml"/);
  const back = await importDocx(bytes);
  const img = find(back.doc, "image")[0];
  assert.match(String(img.attrs!.src), /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(String(img.attrs!.src).split(",")[1], "base64").toString(), svg);
});

test("an SVG's size comes from width and height or its viewBox", () => {
  assert.deepEqual(svgSize('<svg width="30pt" height="15pt">'), { width: 40, height: 20 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 100 50">'), { width: 100, height: 50 });
  assert.deepEqual(svgSize('<svg width="200" viewBox="0 0 100 50">'), { width: 200, height: 100 });
});

test("block-level content controls stay blocks and are written back around their paragraphs", async () => {
  const d = await importDocx(
    await pkg(
      `<w:sdt><w:sdtPr><w:alias w:val="Terms"/><w:tag w:val="terms"/><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>${p("First term")}<w:tbl><w:tr><w:tc>${p("Cell")}</w:tc></w:tr></w:tbl>${p("Second term")}</w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${p("Cover")}</w:sdtContent></w:sdt>` +
        // a control holding a page break is opened as plain paragraphs (pages break between top-level blocks)
        `<w:sdt><w:sdtPr><w:alias w:val="Broken"/></w:sdtPr><w:sdtContent>${p("Before")}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${p("After")}</w:sdtContent></w:sdt>` +
        p("Outside"),
    ),
  );
  const blocks = find(d.doc, "blockControl");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].attrs, { kind: "richText", title: "Terms", tag: "terms", lockControl: true });
  assert.deepEqual(blocks[0].content!.map((n) => n.type), ["paragraph", "table", "paragraph"]);
  assert.equal(blocks[1].attrs!.kind, "docPart");
  assert.equal(blocks[1].attrs!.gallery, "Cover Pages");
  assert.equal(d.doc.content!.map((n) => n.type).filter((t) => t === "blockControl").length, 2);
  assert.ok(d.doc.content!.some((n) => textOf(n) === "Before"));

  const bytes = await buildDocx({ doc: d.doc });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:body><w:sdt><w:sdtPr><w:alias w:val="Terms"\/><w:tag w:val="terms"\/><w:id w:val="\d+"\/><w:lock w:val="sdtLocked"\/><\/w:sdtPr><w:sdtContent><w:p>/);
  assert.match(xml, /<w:docPartObj><w:docPartGallery w:val="Cover Pages"\/>/);
  const again = await importDocx(bytes);
  assert.deepEqual(find(again.doc, "blockControl").map((b) => [b.attrs!.title ?? null, textOf(b)]), [["Terms", "First termCellSecond term"], [null, "Cover"]]);
});

test("pictures, tables and text boxes in a header round-trip", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const para = (text: string): PMNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const header: PMNode = {
    type: "doc",
    content: [
      { type: "image", attrs: { src: png, width: 40, height: 40 } },
      { type: "table", content: [{ type: "tableRow", content: ["Left", "Middle", "Right"].map((x) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [para(x)] })) }] },
      { type: "shape", attrs: { shape: "rect", width: 120, height: 30, textBox: true }, content: [para("Boxed")] },
    ],
  };
  const body = { type: "nextPage", pageWidth: 612, pageHeight: 792, orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36 }, headers: { default: header } };
  const bytes = await buildDocx({ doc: { type: "doc", content: [para("Body")] }, body: body as never });
  const zip = await JSZip.loadAsync(bytes);
  const hdrName = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f))!;
  const hdr = await zip.file(hdrName)!.async("string");
  assert.match(hdr, /<w:tbl>/);
  assert.match(hdr, /<w:drawing>/);
  const rels = await zip.file(hdrName.replace("word/", "word/_rels/") + ".rels")!.async("string");
  assert.match(rels, /relationships\/image/);
  const back = await importDocx(bytes);
  const h = (back.body.headers as Record<string, PMNode>).default;
  assert.equal(find(h, "image").length, 1);
  assert.equal(find(h, "table").length, 1);
  assert.equal(textOf(find(h, "table")[0]), "LeftMiddleRight");
  assert.equal(textOf(find(h, "shape")[0]), "Boxed");
});
