// Animation sequencing and the PresentationML written for transitions/animations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSteps, type Anim, type Slide } from "../lib/slides/model";
import { readTiming, readTransition, timingXml, transitionXml, patchSlideXml } from "../lib/slides/pptx-anim";
import { parseXml } from "../lib/slides/xml";

const A = (p: Partial<Anim>): Anim => ({ effect: "fade", start: "click", dur: 500, delay: 0, order: 0, ...p });
const slide = (p: Partial<Slide>): Slide => ({ id: "s", title: "T", body: "<ul><li><p>a</p></li><li><p>b</p></li></ul>", notes: "", layout: "content", bg: "", bgImg: "", elements: [], ...p });
const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

test("buildSteps groups with/after effects into click steps", () => {
  const s = slide({
    tanim: A({ start: "with", order: 1 }), // plays automatically
    banim: A({ order: 2, byPara: true }),
    elements: [
      { id: "x", type: "text", html: "", x: 0, y: 0, w: 1, h: 1, z: 1, anim: A({ start: "after", order: 3, delay: 100, dur: 300 }) },
      { id: "y", type: "text", html: "", x: 0, y: 0, w: 1, h: 1, z: 2, anim: A({ start: "with", order: 4 }) },
    ],
  });
  const st = buildSteps(s);
  assert.equal(st.length, 3);
  assert.equal(st[0].auto, true);
  assert.deepEqual(st[0].items.map((i) => i.key), ["title"]);
  assert.deepEqual(st[1].items.map((i) => [i.key, i.at]), [["body#0", 0]]);
  assert.deepEqual(st[2].items.map((i) => [i.key, i.at]), [["body#1", 0], ["x", 600], ["y", 500]]);
});

test("transition XML round-trips", () => {
  for (const t of [
    { type: "fade" as const, dur: 500 },
    { type: "push" as const, dir: "u" as const, dur: 750, advAfter: 3000 },
    { type: "wipe" as const, dir: "r" as const, dur: 1000, advClick: false },
    { type: "cover" as const, dir: "d" as const, dur: 500 },
    { type: "split" as const, dur: 750 },
    { type: "zoom" as const, dur: 1000 },
  ]) {
    const sld = parseXml(`<p:sld ${NS}><p:cSld/>${transitionXml(t)}</p:sld>`);
    assert.deepEqual(readTransition(sld), t);
  }
});

test("timing XML round-trips through the reader", () => {
  const s = slide({
    banim: A({ order: 1, byPara: true, effect: "wipe", dir: "l" }),
    tanim: A({ order: 0, effect: "zoom", dur: 700 }),
    elements: [
      { id: "x", type: "image", src: "", x: 0, y: 0, w: 1, h: 1, z: 1, anim: A({ effect: "fly", dir: "r", start: "after", delay: 200, order: 2 }) },
      { id: "y", type: "text", html: "", x: 0, y: 0, w: 1, h: 1, z: 2, anim: A({ effect: "appear", start: "with", order: 3 }) },
    ],
  });
  const spid: Record<string, number> = { title: 2, body: 3, x: 4, y: 5 };
  const xml = timingXml(s, (k) => (k.startsWith("body#") ? { spid: 3, para: Number(k.slice(5)), text: true } : { spid: spid[k], text: k !== "x" }));
  const patched = patchSlideXml(`<p:sld ${NS}><p:cSld><p:spTree/></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`, "", xml);
  assert.match(patched, /<\/p:clrMapOvr><p:timing>/);
  const { anims, skipped } = readTiming(parseXml(patched));
  assert.equal(skipped, false);
  assert.deepEqual(
    anims.map((r) => [r.spid, r.para, r.anim.effect, r.anim.start, r.anim.dir, r.anim.delay]),
    [
      [2, undefined, "zoom", "click", undefined, 0],
      [3, 0, "wipe", "click", "l", 0],
      [3, 1, "wipe", "click", "l", 0],
      [4, undefined, "fly", "after", "r", 200],
      [5, undefined, "appear", "with", undefined, 0],
    ],
  );
  assert.equal(anims[0].anim.dur, 700);
  assert.match(xml, /<p:bldP spid="3" grpId="0" build="p" animBg="1"\/>/);
});

test("exit, emphasis and motion-path effects: sequence state and XML round trip", async () => {
  const { animStateAt, pathEnd, pathPoints } = await import("../lib/slides/model");
  const s = slide({
    elements: [
      {
        id: "x", type: "shape", shape: "rect", fill: "FF0000", line: null, x: 0, y: 0, w: 10, h: 10, z: 1,
        anim: A({ order: 1 }),
        fx: [
          { effect: "pulse", kind: "emph", start: "click", dur: 600, delay: 0, order: 2 },
          { effect: "path", kind: "path", path: "M 0 0 L 0.25 0 E", start: "after", dur: 2000, delay: 0, order: 3 },
          { effect: "grow", kind: "emph", amount: 2, start: "click", dur: 500, delay: 0, order: 4 },
          { effect: "fly", kind: "exit", dir: "r", start: "click", dur: 500, delay: 0, order: 5 },
        ],
      },
      { id: "y", type: "text", html: "<p>t</p>", x: 0, y: 0, w: 1, h: 1, z: 2, anim: A({ kind: "exit", effect: "spin" as never, order: 6 }) },
    ],
  });
  assert.deepEqual(pathEnd("M 0 0 L 0.25 0 E"), { x: 0.25, y: 0 });
  assert.equal(pathPoints("M 0 0 C 0 1 1 1 1 0 E", 4).length, 5);
  const st = buildSteps(s);
  assert.equal(st.length, 5);
  // y's first effect is an exit, so it is visible from the start; x waits for its entrance
  let a = animStateAt(st, 0, true);
  assert.deepEqual([...a.hidden], ["x"]);
  a = animStateAt(st, 2, true); // pulse + path playing
  assert.deepEqual(a.play.get("x")?.map((i) => i.anim.effect), ["pulse", "path"]);
  assert.equal(a.rest.get("x"), undefined);
  a = animStateAt(st, 3, true); // grow playing, path done
  assert.deepEqual(a.rest.get("x"), { dx: 0.25, dy: 0, scale: 1 });
  a = animStateAt(st, 4, false); // back to after the exit: gone, grown
  assert.ok(a.hidden.has("x"));
  assert.deepEqual(a.rest.get("x"), { dx: 0.25, dy: 0, scale: 2 });

  const xml = timingXml(s, (k) => ({ spid: k === "x" ? 4 : 5, text: k === "y" }));
  assert.match(xml, /presetClass="exit"/);
  assert.match(xml, /<p:animMotion origin="layout" path="M 0 0 L 0.25 0 E"/);
  assert.match(xml, /<p:animScale>.*<p:by x="200000" y="200000"\/>/);
  assert.match(xml, /<p:bldP spid="5" grpId="0"/);
  const { anims, skipped } = readTiming(parseXml(`<p:sld ${NS}><p:cSld/>${xml}</p:sld>`));
  assert.equal(skipped, false);
  assert.deepEqual(
    anims.map((r) => [r.spid, r.anim.kind, r.anim.effect, r.anim.dur, r.anim.dir, r.anim.path, r.anim.amount]),
    [
      [4, undefined, "fade", 500, undefined, undefined, undefined],
      [4, "emph", "pulse", 600, undefined, undefined, undefined],
      [4, "path", "path", 2000, undefined, "M 0 0 L 0.25 0 E", undefined],
      [4, "emph", "grow", 500, undefined, undefined, 2],
      [4, "exit", "fly", 500, "r", undefined, undefined],
      [5, "exit", "fade", 500, undefined, undefined, undefined],
    ],
  );
});

test("triggers: effects started by clicking another object form its own sequence; sounds ride on effects", async () => {
  const { animStateAt, triggerSteps } = await import("../lib/slides/model");
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const s = slide({
    layout: "blank",
    elements: [
      { id: "btn", type: "shape", shape: "rect", fill: "FF0000", line: null, ...box, z: 1 },
      { id: "x", type: "shape", shape: "rect", fill: "00FF00", line: null, ...box, z: 2, anim: A({ order: 1, trigger: "btn", sound: { src: "builtin:chime", name: "Chime" } }), fx: [A({ order: 3, kind: "exit", trigger: "btn" })] },
      { id: "y", type: "shape", shape: "rect", fill: "0000FF", line: null, ...box, z: 3, anim: A({ order: 2 }) },
      // a trigger that no longer exists falls back to the click sequence
      { id: "z", type: "shape", shape: "rect", fill: "0000FF", line: null, ...box, z: 4, anim: A({ order: 4, trigger: "gone" }) },
    ],
  });
  const main = buildSteps(s);
  assert.deepEqual(main.map((st) => st.items.map((i) => i.key)), [["y"], ["z"]]);
  const trig = triggerSteps(s);
  assert.deepEqual([...trig.keys()], ["btn"]);
  assert.equal(trig.get("btn")!.length, 2);
  assert.equal(trig.get("btn")![0].auto, false);
  let st = animStateAt(main, 0, true, [{ steps: trig.get("btn")!, shown: 0 }]);
  assert.deepEqual([...st.hidden].sort(), ["x", "y", "z"]);
  st = animStateAt(main, 0, true, [{ steps: trig.get("btn")!, shown: 1, play: true }]);
  assert.equal(st.hidden.has("x"), false);
  assert.deepEqual(st.play.get("x")?.map((i) => i.anim.effect), ["fade"]);
  st = animStateAt(main, 1, false, [{ steps: trig.get("btn")!, shown: 2 }]);
  assert.ok(st.hidden.has("x"));

  const spid: Record<string, number> = { btn: 4, x: 5, y: 6, z: 7 };
  const xml = timingXml(s, (k) => ({ spid: spid[k], text: false }), [], (snd) => (snd.src === "builtin:chime" ? { rid: "rId9", name: "Chime.wav" } : undefined));
  assert.match(xml, /nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"\/>/);
  assert.match(xml, /<p:subTnLst><p:audio><p:cMediaNode showWhenStopped="0">[\s\S]*<p:sndTgt r:embed="rId9" name="Chime.wav"\/>/);
  const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ids).size, ids.length, "time node ids are unique");
  const { anims } = readTiming(parseXml(`<p:sld ${NS}><p:cSld/>${xml}</p:sld>`));
  assert.deepEqual(anims.map((r) => [r.spid, r.anim.kind, r.trigger, r.sound?.rid]), [
    [6, undefined, undefined, undefined],
    [7, undefined, undefined, undefined],
    [5, undefined, 4, "rId9"],
    [5, "exit", 4, undefined],
  ]);
  // only triggers: no empty main sequence
  const only = timingXml(slide({ layout: "blank", elements: s.elements.slice(0, 2) }), (k) => ({ spid: spid[k], text: false }));
  assert.doesNotMatch(only, /mainSeq/);
  assert.match(only, /interactiveSeq/);
});

test("custom motion paths: drawn lines and scribbles, reversed, edited as points", async () => {
  const { linesToPath, scribbleToPath, reversePath, pathToGeom, geomToPath, pathSvgD } = await import("../lib/slides/motion");
  const { pathEnd, pathPoints } = await import("../lib/slides/model");
  const p = linesToPath([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 280 }], 1000, 600)!;
  assert.equal(p, "M 0 0 L 0.2 0 L 0.2 0.3 E");
  assert.deepEqual(pathEnd(p), { x: 0.2, y: 0.3 });
  assert.equal(linesToPath([{ x: 0, y: 0 }], 10, 10), null);
  const r = reversePath(p);
  assert.equal(r, "M 0 0 L 0 -0.3 L -0.2 -0.3 E");
  assert.equal(pathSvgD(p, { x: 50, y: 60 }, 1000, 600), "M 50 60 L 250 60 L 250 240");
  const g = pathToGeom(p, { x: 50, y: 60 }, 1000, 600)!;
  assert.deepEqual(g.box, { x: 50, y: 60, w: 200, h: 180 });
  assert.equal(geomToPath(g.geom, g.box, { x: 50, y: 60 }, 1000, 600), p);
  const sc = scribbleToPath(Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 10, y: 100 + Math.sin(i / 4) * 50 })), 1000, 600)!;
  assert.match(sc, /^M 0 0 C /);
  const end = pathPoints(sc).pop()!;
  assert.ok(Math.abs(end.x - 0.29) < 0.01, `ends near the last point (${end.x})`);
});

test("animation sounds, triggers and custom paths survive .pptx export and import", async () => {
  const JSZip = (await import("jszip")).default;
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { builtinWav, isWav, wavBytes } = await import("../lib/slides/anim-sound");
  const chime = builtinWav("builtin:chime")!;
  assert.ok(isWav(chime) && chime.length > 20000);
  const own = `data:audio/wav;base64,${Buffer.from(wavBytes([new Float32Array(800).fill(0.1)], 8000)).toString("base64")}`;
  const box = { x: 100, y: 100, w: 100, h: 80 };
  const s = slide({
    layout: "blank",
    elements: [
      { id: "btn", type: "shape", shape: "rect", fill: "FF0000", line: null, ...box, z: 1 },
      { id: "x", type: "shape", shape: "ellipse", fill: "00FF00", line: null, ...box, x: 400, z: 2, anim: A({ order: 1, trigger: "btn", sound: { src: "builtin:chime", name: "Chime" } }), fx: [{ effect: "path", kind: "path", path: "M 0 0 L 0.2 0 L 0.2 0.3 E", start: "click", dur: 1500, delay: 0, order: 2, sound: { src: own, name: "Mine" } }] },
    ],
  });
  const out = await buildPptx([s], { name: "a", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  assert.ok(zip.file("ppt/media/syn-sound-chime.wav"));
  assert.ok(zip.file("ppt/media/syn-sound1.wav"));
  assert.match((await zip.file("[Content_Types].xml")!.async("string")), /Extension="wav"/);
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.match(rels, /relationships\/audio" Target="\.\.\/media\/syn-sound-chime\.wav"/);
  const back = await importPptx(out);
  const x = back.slides[0].elements.find((e) => e.type === "shape" && e.shape === "ellipse")!;
  const btn = back.slides[0].elements.find((e) => e.type === "shape" && e.shape === "rect")!;
  // the click sequence is read first, then each trigger's
  const fx = [x.anim!, ...(x.fx || [])];
  const fade = fx.find((a) => a.effect === "fade")!, path = fx.find((a) => a.kind === "path")!;
  assert.equal(fade.trigger, btn.id);
  assert.deepEqual(fade.sound, { src: "builtin:chime", name: "Chime" });
  assert.equal(path.path, "M 0 0 L 0.2 0 L 0.2 0.3 E");
  assert.equal(path.trigger, undefined);
  assert.match(path.sound?.src || "", /^data:audio\/wav;base64,UklGR/);
  assert.equal(path.sound?.name, "Mine");
});
