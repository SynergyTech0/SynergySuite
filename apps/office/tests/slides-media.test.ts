// Audio and video: .pptx export (embedded media, audio parts, autoplay/loop timing) and import.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { Slide } from "../lib/slides/model";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed) & 255));
const VIDEO = `data:video/mp4;base64,${bytes(2048, 7).toString("base64")}`;
const AUDIO = `data:audio/mpeg;base64,${bytes(1024, 13).toString("base64")}`;

test("audio and video are embedded, keep their settings and come back", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const s: Slide = {
    id: "s1", title: "Media", body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "",
    elements: [
      { id: "t", type: "text", html: "<p>caption</p>", x: 40, y: 600, w: 300, h: 40, z: 1 },
      { id: "v", type: "media", kind: "video", src: VIDEO, mime: "video/mp4", poster: PNG, name: "Clip", autoplay: true, loop: true, x: 100, y: 150, w: 640, h: 360, z: 2 },
      { id: "a", type: "media", kind: "audio", src: AUDIO, mime: "audio/mpeg", name: "Theme tune", x: 900, y: 150, w: 96, h: 96, z: 3, anim: { effect: "fade", start: "click", dur: 500, delay: 0, order: 1 } },
    ],
  };
  const out = await buildPptx([s], { name: "m", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<a:videoFile r:link="rId\d+"\/>/);
  assert.match(xml, /<a:audioFile r:link="rId\d+"\/>/);
  assert.match(xml, /presetClass="mediacall"/);
  assert.match(xml, /<p:video><p:cMediaNode vol="80000"><p:cTn id="\d+" repeatCount="indefinite"/);
  const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "shape ids are unique");
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /Extension="mp3" ContentType="audio\/mpeg"/);
  assert.match(rels, /relationships\/audio" Target="..\/media\/[^"]+\.mp3"/);
  assert.match(rels, /relationships\/video" Target="..\/media\/[^"]+\.mp4"/);
  const mp4 = Object.keys(zip.files).find((f) => f.endsWith(".mp4"))!;
  assert.deepEqual(Buffer.from(await zip.file(mp4)!.async("uint8array")), bytes(2048, 7));

  const deck = await importPptx(out);
  const els = deck.slides[0].elements;
  const v = els.find((e) => e.type === "media" && e.kind === "video");
  const a = els.find((e) => e.type === "media" && e.kind === "audio");
  assert.ok(v?.type === "media" && a?.type === "media");
  assert.equal(v.src, VIDEO);
  assert.equal(v.autoplay, true);
  assert.equal(v.loop, true);
  assert.equal(v.name, "Clip");
  assert.match(v.poster || "", /^data:image\/png;base64,/);
  assert.equal(a.src, AUDIO);
  assert.equal(a.autoplay, undefined);
  assert.equal(a.anim?.effect, "fade");
  assert.deepEqual([v.x, v.y, v.w, v.h], [100, 150, 640, 360]);
  assert.ok(!deck.warnings.some((w) => /audio|video/i.test(w)), deck.warnings.join("; "));
});

test("narration: AAC/MP4, MP3 and WAV are kept; WebM stays as it is where no AAC encoder exists", async () => {
  const { playsInPowerPoint, narrationForPowerPoint, encodeAacMp4 } = await import("../lib/slides/narration");
  assert.ok(playsInPowerPoint("audio/mp4") && playsInPowerPoint("audio/mpeg") && playsInPowerPoint("audio/wav"));
  assert.ok(!playsInPowerPoint("audio/webm") && !playsInPowerPoint("audio/ogg"));
  const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  assert.equal(await narrationForPowerPoint(webm), webm);
  assert.equal(await encodeAacMp4([new Float32Array(480)], 48000), null);
});

test("a selected audio or video object gets a player on the canvas", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { CanvasPlayer } = await import("../components/slides/MediaView");
  const v = renderToStaticMarkup(createElement(CanvasPlayer, { el: { id: "m", z: 1, type: "media", kind: "video", src: "/api/docs/d/media/abc", x: 0, y: 0, w: 320, h: 180, loop: true }, scale: 0.5 }));
  assert.match(v, /<video[^>]+data-testid="canvas-video"/);
  assert.match(v, /loop=""/);
  for (const id of ["media-play", "media-seek", "media-time", "media-mute", "media-back", "media-fwd"]) assert.match(v, new RegExp(`data-testid="${id}"`));
  assert.match(v, /0:00 \/ 0:00/);
  const a = renderToStaticMarkup(createElement(CanvasPlayer, { el: { id: "a", z: 1, type: "media", kind: "audio", src: "/api/docs/d/media/abc", x: 0, y: 0, w: 60, h: 60 }, scale: 1 }));
  assert.match(a, /<audio[^>]+data-testid="canvas-audio"/);
  // an unsafe source gets no player
  assert.equal(renderToStaticMarkup(createElement(CanvasPlayer, { el: { id: "x", z: 1, type: "media", kind: "video", src: "javascript:alert(1)", x: 0, y: 0, w: 60, h: 60 }, scale: 1 })), "");
});

test("Windows Media and AVI are kept for PowerPoint (shown as their poster here)", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { playableHere } = await import("../lib/slides/media-client");
  assert.equal(playableHere("video/x-ms-wmv", "video"), false);
  assert.equal(playableHere("audio/x-ms-wma", "audio"), false);
  const wmv = `data:video/x-ms-wmv;base64,${Buffer.from("0&²u\u008efÏ\u0011fake asf").toString("base64")}`;
  const s: Slide = { id: "s", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [{ id: "v", z: 1, type: "media", kind: "video", src: wmv, mime: "video/x-ms-wmv", x: 10, y: 10, w: 320, h: 180 }] };
  const out = await buildPptx([s], { name: "w", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  assert.ok(Object.keys(zip.files).some((f) => /^ppt\/media\/.*\.wmv$/.test(f)), "the WMV file is in the package");
  const deck = await importPptx(out);
  const v = deck.slides[0].elements.find((e) => e.type === "media");
  assert.equal(v?.type === "media" && v.mime, "video/x-ms-wmv");
  assert.ok(deck.warnings.some((w) => /Windows Media or AVI/.test(w)));
});
