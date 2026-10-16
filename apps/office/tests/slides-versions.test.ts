// Version history: a deck snapshot captures slides, deck settings and layouts,
// survives encoding, and restores in place (keeping the deck's name).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { slideFields } from "../lib/slides/model";
import { decodeSnapshot, encodeSnapshot, restoreSnapshot, snapshotMasters, snapshotSlides, takeSnapshot } from "../lib/slides/versions";

function deck() {
  const ydoc = new Y.Doc();
  const yslides = ydoc.getArray<Y.Map<string>>("slides");
  const ymeta = ydoc.getMap<string>("meta");
  const ylayouts = ydoc.getMap<Y.Map<string>>("layouts");
  return { ydoc, yslides, ymeta, ylayouts };
}
const ymap = (o: Record<string, string>) => {
  const m = new Y.Map<string>();
  for (const [k, v] of Object.entries(o)) m.set(k, v);
  return m;
};

test("snapshots capture and restore the whole deck", () => {
  const d = deck();
  d.ydoc.transact(() => {
    d.yslides.push([
      ymap(slideFields({ id: "s1", title: "First", body: "<p>Hello</p>", notes: "n", layout: "title", elements: [{ id: "e1", z: 1, type: "shape", shape: "rect", x: 1, y: 2, w: 3, h: 4, fill: "FF0000" }] })),
      ymap(slideFields({ id: "s2", title: "Second", body: "", notes: "", layout: "content", elements: [] })),
    ]);
    d.ymeta.set("name", "Deck");
    d.ymeta.set("theme", "plain");
    d.ymeta.set("w", "1280");
    d.ylayouts.set("master", ymap(slideFields({ bg: "112233", elements: [] })));
  });
  const snap = takeSnapshot(d.yslides, d.ymeta, d.ylayouts);
  const text = encodeSnapshot(snap);
  assert.ok(text.startsWith("synergy-deck:v1:"));
  const back = decodeSnapshot(text)!;
  assert.deepEqual(back, snap);
  assert.equal(decodeSnapshot("<p>a document</p>"), null);
  assert.deepEqual(snapshotSlides(back).map((s) => [s.id, s.title, s.elements.length]), [["s1", "First", 1], ["s2", "Second", 0]]);
  assert.equal(snapshotMasters(back).master?.bg, "112233");

  // edit: delete a slide, change the theme and name, drop the master, add a key
  d.ydoc.transact(() => {
    d.yslides.delete(1, 1);
    d.yslides.get(0).set("title", "Changed");
    d.ymeta.set("theme", "synergy");
    d.ymeta.set("name", "Renamed deck");
    d.ymeta.set("hf", '{"num":true}');
    d.ylayouts.delete("master");
  });
  let updates = 0;
  d.ydoc.on("update", () => updates++);
  restoreSnapshot(d.ydoc, d.yslides, d.ymeta, d.ylayouts, back);
  assert.equal(updates, 1, "one transaction");
  const now = takeSnapshot(d.yslides, d.ymeta, d.ylayouts);
  assert.deepEqual(now.slides, snap.slides);
  assert.deepEqual(now.layouts, snap.layouts);
  assert.deepEqual({ ...now.meta, name: "Deck" }, snap.meta);
  assert.equal(d.ymeta.get("name"), "Renamed deck", "restoring keeps the current name");
  assert.equal(d.ymeta.get("hf"), undefined);
});
