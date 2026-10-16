// Align / distribute / grouping geometry, and groups surviving a .pptx round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignedPositions, distributedPositions, groupZ, rotationFrom, withGroups } from "../lib/slides/selection";
import { buildPptx } from "../lib/slides/pptx-export";
import { importPptx } from "../lib/slides/pptx-import";
import { wrapGroups } from "../lib/slides/pptx-group";
import type { Slide, SlideElement } from "../lib/slides/model";

const items = [
  { id: "a", x: 10, y: 10, w: 100, h: 50 },
  { id: "b", x: 300, y: 80, w: 40, h: 40 },
  { id: "c", x: 150, y: 200, w: 60, h: 20 },
];
const SLIDE = { x: 0, y: 0, w: 1280, h: 720 };

test("a single object aligns to the slide", () => {
  assert.deepEqual(alignedPositions([items[0]], "center", SLIDE).get("a"), { x: 590, y: 10 });
  assert.deepEqual(alignedPositions([items[0]], "bottom", SLIDE).get("a"), { x: 10, y: 670 });
});

test("distribute across the slide when fewer than three objects are selected", () => {
  const v = distributedPositions(items, "vertical", SLIDE);
  const gap = (720 - (50 + 40 + 20)) / 2;
  assert.equal(v.get("a")?.y, 0);
  assert.equal(v.get("b")?.y, 50 + gap);
  assert.equal(v.get("c")?.y, 700);
  assert.equal(distributedPositions([items[1]], "horizontal", SLIDE).get("b")?.x, 620);
});

test("grouped objects select together", () => {
  const els = [{ ...items[0], group: "g" }, items[1], { ...items[2], group: "g" }];
  assert.deepEqual(withGroups(els, ["a"]), ["a", "c"]);
  assert.deepEqual(withGroups(els, ["b"]), ["b"]);
});

test("grouping makes members contiguous below the topmost member", () => {
  const all = [{ id: "a", z: 1 }, { id: "x", z: 2 }, { id: "b", z: 3 }, { id: "y", z: 4 }];
  const m = groupZ(all, new Set(["a", "b"]));
  const z = (id: string) => m.get(id) ?? all.find((e) => e.id === id)!.z;
  const order = ["a", "x", "b", "y"].sort((p, q) => z(p) - z(q));
  assert.deepEqual(order, ["x", "a", "b", "y"]);
});

test("rotation handle angle with snapping", () => {
  assert.equal(rotationFrom(0, 0, 0, -10, false), 0);
  assert.equal(rotationFrom(0, 0, 10, 0, false), 90);
  assert.equal(rotationFrom(0, 0, 10, 10.5, false), 136.4);
  assert.equal(rotationFrom(0, 0, 10, 10.5, true), 135);
  assert.equal(rotationFrom(0, 0, -10, 0.2, false), 270);
});

test("wrapGroups leaves non-adjacent members alone", () => {
  const sp = (id: number, name: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${id * 100}" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sp>`;
  const xml = `<p:spTree>${sp(2, "syn-el-a")}${sp(3, "other")}${sp(4, "syn-el-b")}${sp(5, "syn-el-c")}</p:spTree>`;
  assert.equal(wrapGroups(xml, [{ name: "G", ids: ["a", "b"] }]), xml);
  const out = wrapGroups(xml, [{ name: "G", ids: ["b", "c"] }]);
  assert.match(out, /<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="G"\/>.*<a:off x="400" y="0"\/><a:ext cx="200" cy="100"\/><a:chOff x="400" y="0"\/>.*name="syn-el-c".*<\/p:grpSp><\/p:spTree>$/);
});

test("groups, rotation and animations survive export and re-import", async () => {
  const el = (id: string, x: number, z: number, extra: Partial<SlideElement> = {}) =>
    ({ id, type: "shape", shape: "rect", fill: "FF0000", line: null, x, y: 100, w: 120, h: 80, z, ...extra }) as SlideElement;
  const s: Slide = {
    id: "s1", title: "Groups", body: "", notes: "", layout: "titleOnly", bg: "", bgImg: "",
    elements: [
      el("ga", 100, 1, { group: "g1", anim: { effect: "fade", start: "click", dur: 500, delay: 0, order: 1 } }),
      el("gb", 300, 2, { group: "g1", rot: 30 }),
      el("solo", 600, 3),
    ],
  };
  const bytes = await buildPptx([s], { name: "t", w: 1280, h: 720, theme: "plain" });
  const deck = await importPptx(bytes);
  const els = deck.slides[0].elements;
  const ga = els.find((e) => e.id === "ga")!, gb = els.find((e) => e.id === "gb")!, solo = els.find((e) => e.id === "solo")!;
  assert.ok(ga.group && ga.group === gb.group, "members share a group");
  assert.equal(solo.group, undefined);
  assert.equal(gb.rot, 30);
  for (const [a, b] of [[ga, s.elements[0]], [gb, s.elements[1]]]) for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(a[k] - b[k]) <= 1, `${a.id}.${k}`);
  assert.equal(ga.anim?.effect, "fade");
});

test("several objects resize together: positions and sizes scale with the selection's bounds", async () => {
  const { resizedBoxes, dragBounds } = await import("../lib/slides/selection");
  const els = [{ id: "a", x: 100, y: 100, w: 100, h: 50 }, { id: "b", x: 300, y: 200, w: 100, h: 100 }];
  const from = { x: 100, y: 100, w: 300, h: 200 };
  const to = dragBounds(from, "se", 300, 200, false);
  assert.deepEqual(to, { x: 100, y: 100, w: 600, h: 400 });
  const out = resizedBoxes(els, from, to);
  assert.deepEqual(out.get("a"), { x: 100, y: 100, w: 200, h: 100 });
  assert.deepEqual(out.get("b"), { x: 500, y: 300, w: 200, h: 200 });
  // dragging the left edge keeps the right edge; Shift keeps the proportions
  assert.deepEqual(dragBounds(from, "w", 100, 0, false), { x: 200, y: 100, w: 200, h: 200 });
  assert.deepEqual(dragBounds(from, "nw", -150, 0, true), { x: -50, y: 0, w: 450, h: 300 });
  assert.equal(dragBounds(from, "e", -1000, 0, false).w, 8);
});

test("groups inside groups: kept through grouping, ungrouping, .pptx and .odp", async () => {
  const { groupTree, groupedPatch, ungroupedPatch } = await import("../lib/slides/selection");
  const { buildOdp } = await import("../lib/slides/odp-export");
  const { importOdp } = await import("../lib/slides/odp-import");
  // a and b were grouped (g1); grouping that group with c makes g2 around both
  const a1 = { ...groupedPatch({ group: "g1" }, "g2") };
  assert.deepEqual(a1, { group: "g2", sub: ["g1"] });
  assert.deepEqual(groupedPatch({}, "g2"), { group: "g2", sub: undefined });
  assert.deepEqual(ungroupedPatch(a1), { group: "g1", sub: undefined });
  assert.deepEqual(ungroupedPatch({ group: "g3", sub: ["g2", "g1"] }), { group: "g2", sub: ["g1"] });
  const box = (x: number) => ({ x, y: 10, w: 50, h: 50 });
  const els: SlideElement[] = [
    { id: "a", type: "shape", shape: "rect", fill: "FF0000", line: null, ...box(10), z: 1, group: "g2", sub: ["g1"] },
    { id: "b", type: "shape", shape: "rect", fill: "00FF00", line: null, ...box(70), z: 2, group: "g2", sub: ["g1"] },
    { id: "c", type: "shape", shape: "ellipse", fill: "0000FF", line: null, ...box(200), z: 3, group: "g2" },
    { id: "d", type: "shape", shape: "rect", fill: "000000", line: null, ...box(400), z: 4 },
  ];
  assert.deepEqual(groupTree(els), [
    { id: "g1", depth: 1, members: ["a", "b"] },
    { id: "g2", depth: 0, members: ["group:g1", "c"] },
  ]);
  const s: Slide = { id: "s", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: els };
  const bytes = await buildPptx([s], { name: "g", w: 1280, h: 720, theme: "plain" });
  const JSZip = (await import("jszip")).default;
  const xml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="Group 2"\/>[\s\S]*<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="Group 1"\/>[\s\S]*syn-el-a[\s\S]*syn-el-b[\s\S]*<\/p:grpSp>[\s\S]*syn-el-c[\s\S]*<\/p:grpSp>[\s\S]*syn-el-d/);
  const check = (back: SlideElement[]) => {
    const by = (id: string) => back.find((e) => e.id === id)!;
    assert.ok(by("a").group && by("a").group === by("c").group, "a and c share the outer group");
    assert.equal(by("a").sub?.length, 1);
    assert.deepEqual(by("a").sub, by("b").sub, "a and b share the inner group");
    assert.equal(by("c").sub, undefined);
    assert.equal(by("d").group, undefined);
  };
  check((await importPptx(bytes)).slides[0].elements);
  check((await importOdp((await buildOdp([s], { name: "g", w: 1280, h: 720, theme: "plain" })).data)).slides[0].elements);
});
