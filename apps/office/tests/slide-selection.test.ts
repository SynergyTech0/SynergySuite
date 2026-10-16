import { test } from "node:test";
import assert from "node:assert/strict";
import { alignedPositions, boundsOf, clickSelection, distributedPositions, inMarquee } from "../lib/slides/selection";

const objects = [
  { id: "a", x: 10, y: 20, w: 20, h: 20 },
  { id: "b", x: 90, y: 60, w: 30, h: 40 },
  { id: "c", x: 210, y: 130, w: 40, h: 30 },
];

test("modifier click adds and removes objects while a plain drag keeps the group", () => {
  assert.deepEqual(clickSelection([], "a", false), ["a"]);
  assert.deepEqual(clickSelection(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(clickSelection(["a", "b"], "a", false), ["a", "b"]);
  assert.deepEqual(clickSelection(["a", "b"], "a", true), ["b"]);
  assert.deepEqual(clickSelection(["a", "b"], "c", false), ["c"]);
});

test("marquee selects intersecting objects and group bounds enclose them", () => {
  assert.deepEqual(inMarquee(objects, { x: 25, y: 25, w: 100, h: 90 }), ["a", "b"]);
  assert.deepEqual(inMarquee(objects, { x: 30, y: 20, w: 60, h: 30 }), []);
  assert.deepEqual(boundsOf(objects.slice(0, 2)), { x: 10, y: 20, w: 110, h: 80 });
});

test("alignment preserves each object's size and lines up its chosen edge or centre", () => {
  assert.deepEqual([...alignedPositions(objects, "left").values()].map((p) => p.x), [10, 10, 10]);
  assert.deepEqual([...alignedPositions(objects, "center").values()].map((p) => p.x), [120, 115, 110]);
  assert.deepEqual([...alignedPositions(objects, "bottom").values()].map((p) => p.y), [140, 120, 130]);
});

test("distribution spaces three objects between the outer edges without moving endpoints", () => {
  const across = distributedPositions(objects, "horizontal");
  assert.equal(across.get("a")?.x, 10);
  assert.equal(across.get("b")?.x, 105);
  assert.equal(across.get("c")?.x, 210);
  const down = distributedPositions(objects, "vertical");
  assert.equal(down.get("a")?.y, 20);
  assert.equal(down.get("b")?.y, 65);
  assert.equal(down.get("c")?.y, 130);
});
