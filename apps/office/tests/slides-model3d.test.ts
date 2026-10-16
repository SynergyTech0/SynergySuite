// 3D models: GLB reading and packing, turns, and the .pptx / .odp round trips.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { dragTurn, fitDistance, fromAngle60k, glbInfo, glbJson, gltfToGlb, isGlb, normDeg, toAngle60k, writeGlb } from "../lib/slides/model3d";
import type { Model3dEl, Slide } from "../lib/slides/model";
import { cubeGlb } from "./fixtures/cube-glb.mjs";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

test("GLB files are recognised and described", () => {
  const glb: Uint8Array = cubeGlb();
  assert.ok(isGlb(glb));
  assert.equal(isGlb(new TextEncoder().encode("not a model at all!!")), false);
  const info = glbInfo(glb)!;
  assert.equal(info.meshes, 1);
  assert.equal(info.name, "Test cube");
  assert.deepEqual(info.extensionsRequired, []);
  // a GLB written back reads the same
  const again = writeGlb(glbJson(glb));
  assert.equal(glbInfo(again)?.name, "Test cube");
});

test("a self-contained .gltf becomes one GLB; one that needs other files does not", () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]), b = new Uint8Array([9, 8, 7, 6]);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ uri: `data:application/octet-stream;base64,${b64(a)}`, byteLength: 5 }, { uri: `data:application/octet-stream;base64,${b64(b)}`, byteLength: 4 }],
    bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 4 }, { buffer: 1, byteLength: 4 }],
    meshes: [{ primitives: [] }],
  };
  const glb = gltfToGlb(JSON.stringify(gltf));
  assert.ok(isGlb(glb));
  const j = glbJson(glb) as { buffers: { byteLength: number; uri?: string }[]; bufferViews: { buffer: number; byteOffset: number }[] };
  assert.deepEqual(j.buffers, [{ byteLength: 12 }]);
  assert.deepEqual(j.bufferViews.map((v) => [v.buffer, v.byteOffset]), [[0, 1], [0, 8]]);
  // the binary chunk holds both buffers, the second at 8
  const dv = new DataView(glb.buffer, glb.byteOffset);
  const jl = dv.getUint32(12, true);
  const bin = glb.subarray(28 + jl);
  assert.deepEqual([...bin.subarray(0, 5)], [...a]);
  assert.deepEqual([...bin.subarray(8, 12)], [...b]);
  assert.throws(() => gltfToGlb(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "cube.bin", byteLength: 4 }] })), /other files/);
  assert.throws(() => gltfToGlb(JSON.stringify({ asset: { version: "1.0" } })), /glTF 2.0/);
  assert.throws(() => gltfToGlb("{"), /JSON/);
});

test("turns: angles wrap, dragging turns and tilts, PowerPoint's units", () => {
  assert.equal(normDeg(190), -170);
  assert.equal(normDeg(-540), 180);
  assert.equal(normDeg(Number.NaN), 0);
  assert.deepEqual(dragTurn({ rx: 80, ry: 170, rz: 5 }, 40, 40), { rx: 90, ry: -170, rz: 5 });
  assert.equal(toAngle60k(-90), -5400000);
  assert.equal(fromAngle60k(1800000), 30);
  assert.equal(fromAngle60k(undefined), 0);
  // a wide view is limited by its height, a tall one by its width
  assert.ok(fitDistance(1, 30, 2) < fitDistance(1, 30, 0.5));
  assert.ok(Math.abs(fitDistance(1, 30, 1) - 1 / Math.sin(Math.PI / 12)) < 1e-9);
});

const model = (): Model3dEl => ({ id: "m1", z: 1, type: "model3d", src: `data:model/gltf-binary;base64,${b64(cubeGlb())}`, name: "Test cube", alt: "A cube", rx: 20, ry: -35, poster: PNG, x: 100, y: 100, w: 300, h: 300 });
const deckOf = (els: Slide["elements"]): Slide[] => [{ id: "s1", title: "Model", body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "", elements: els }];

test("a 3D model survives .pptx export and import (picture plus model file)", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const bytes = await buildPptx(deckOf([model()]), { name: "m", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(isGlb(await zip.file("ppt/media/model3d1.glb")!.async("uint8array")));
  assert.match(await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string"), /2017\/06\/relationships\/model3d" Target="\.\.\/media\/model3d1\.glb"/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /<Default Extension="glb" ContentType="model\/gltf\.binary"\/>/);
  assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /<p:pic>[\s\S]*name="syn-el-m1" descr="A cube"/);
  const d = await importPptx(bytes);
  const m = d.slides[0].elements.find((e) => e.type === "model3d");
  assert.ok(m?.type === "model3d");
  assert.equal(m.id, "m1");
  assert.equal(m.rx, 20);
  assert.equal(m.ry, -35);
  assert.equal(m.name, "Test cube");
  assert.match(m.poster || "", /^data:image\/png;base64,/);
  assert.match(m.src, /^data:model\/gltf-binary;base64,/);
  assert.equal(glbInfo(Uint8Array.from(Buffer.from(m.src.split(",")[1], "base64")))?.name, "Test cube");
});

test("PowerPoint's own 3D models (am3d) import with their turn and picture", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  // start from a picture, then dress it as PowerPoint writes a model: AlternateContent, am3d:model3d choice, picture fallback
  const bytes = await buildPptx(deckOf([{ id: "p", z: 1, type: "image", src: PNG, alt: "Robot", x: 10, y: 20, w: 200, h: 150 }]), { name: "m", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(bytes);
  zip.file("ppt/media/model3d9.glb", cubeGlb());
  const relsP = "ppt/slides/_rels/slide1.xml.rels";
  zip.file(relsP, (await zip.file(relsP)!.async("string")).replace("</Relationships>", '<Relationship Id="rIdM" Type="http://schemas.microsoft.com/office/2017/06/relationships/model3d" Target="../media/model3d9.glb"/></Relationships>'));
  const sp = "ppt/slides/slide1.xml";
  let xml = await zip.file(sp)!.async("string");
  xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/, (pic) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d" Requires="am3d"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="3D Model 8" descr="Robot"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2017/model3d"><am3d:model3d r:embed="rIdM"><am3d:trans><am3d:rot ax="1800000" ay="-2700000" az="0"/></am3d:trans></am3d:model3d></a:graphicData></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback>${pic.replace(/name="syn-el-p"/, 'name="3D Model 8"')}</mc:Fallback></mc:AlternateContent>`);
  zip.file(sp, xml);
  const d = await importPptx(await zip.generateAsync({ type: "uint8array" }));
  const m = d.slides[0].elements.find((e) => e.type === "model3d");
  assert.ok(m?.type === "model3d", JSON.stringify(d.slides[0].elements.map((e) => e.type)));
  assert.equal(m.rx, 30);
  assert.equal(m.ry, -45);
  assert.equal(m.poster, PNG);
  assert.equal(m.x, 10);
});

test("a 3D model survives .odp export and import", async () => {
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  const { data } = await buildOdp(deckOf([model()]), { name: "m", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(data);
  assert.ok(zip.file("Models/2.glb") || zip.file("Models/1.glb"));
  assert.match(await zip.file("META-INF/manifest.xml")!.async("string"), /media-type="model\/gltf-binary"/);
  const d = await importOdp(data);
  const m = d.slides[0].elements.find((e) => e.type === "model3d");
  assert.ok(m?.type === "model3d");
  assert.equal(m.rx, 20);
  assert.equal(m.ry, -35);
  assert.match(m.poster || "", /^data:image\/png/);
  assert.equal(m.name, "Test cube");
});

test("PowerPoint's framing: scale to half a metre, centre, and a camera that just fits", async () => {
  const { am3dFraming, glbBounds } = await import("../lib/slides/model3d");
  // the numbers PowerPoint wrote for a model it inserted (half-extents 0.945, 0.901, 1.0)
  const f = am3dFraming({ center: [-0.0025, 0, -0.187], half: [0.9449, 0.901, 1.0] });
  assert.ok(Math.abs(f.mpu - 0.5) < 1e-6);
  assert.deepEqual(f.pre, [45000, 0, 3366000]);
  assert.ok(Math.abs(f.camZ - 77_356_487) < 20_000, String(f.camZ));
  // the cube fixture is 2 units wide around the origin
  const b = glbBounds(cubeGlb());
  assert.deepEqual(b, { center: [0, 0, 0], half: [1, 1, 1] });
});

test("3D models are written as PowerPoint's own am3d:model3d with the picture as fallback", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { schemaProblems, ruledElements } = await import("./fixtures/ooxml-check.mts");
  const zip = await JSZip.loadAsync(await buildPptx(deckOf([model()]), { name: "m", w: 1280, h: 720, theme: "plain" }));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  const rid = /Id="([^"]+)" Type="http:\/\/schemas.microsoft.com\/office\/2017\/06\/relationships\/model3d"/.exec(rels)![1];
  assert.match(xml, new RegExp(`<mc:Choice xmlns:am3d="http://schemas.microsoft.com/office/drawing/2017/model3d" Requires="am3d"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="\\d+" name="syn-el-m1" descr="A cube"`));
  assert.match(xml, new RegExp(`<am3d:model3d r:embed="${rid}">`));
  // the cube: 1 m across after scaling, camera at sqrt(3) * 18,000,000 / sin(22.5°)
  assert.match(xml, /<am3d:meterPerModelUnit n="500000" d="1000000"\/><am3d:preTrans dx="0" dy="0" dz="0"\/>/);
  assert.match(xml, /<am3d:pos x="0" y="0" z="81469204"\/>/);
  assert.match(xml, /<am3d:rot ax="1200000" ay="19500000" az="0"\/>/);
  // the raster is the fallback picture
  const blip = /<mc:Fallback><p:pic>[\s\S]*?<a:blip r:embed="([^"]+)"/.exec(xml)![1];
  assert.match(xml, new RegExp(`<am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="${blip}"/>`));
  assert.deepEqual(schemaProblems(xml), []);
  assert.ok(ruledElements(xml) > 20);
});
