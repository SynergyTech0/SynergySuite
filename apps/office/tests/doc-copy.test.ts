// File > Make a copy: the copy's content points at its own copies of the media.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { mediaIdsIn, mediaRewrite, rewriteYdoc } from "../lib/doc-copy";

test("a copied presentation points at the copy's media", () => {
  const doc = new Y.Doc();
  const slides = doc.getArray<Y.Map<string>>("slides");
  const s = new Y.Map<string>();
  slides.push([s]);
  s.set("el:v", JSON.stringify({ id: "v", type: "media", kind: "video", src: "/api/docs/OLD/media/m1", poster: "data:image/png;base64,AA" }));
  s.set("el:m", JSON.stringify({ id: "m", type: "model3d", src: "/api/docs/OLD/media/m2" }));
  s.set("el:x", JSON.stringify({ id: "x", type: "media", src: "/api/docs/OTHER/media/m9" }));
  s.set("title", "Media");
  doc.getMap<string>("meta").set("name", "Deck");
  const state = Y.encodeStateAsUpdate(doc);
  const found = new Set<string>();
  rewriteYdoc(state, (v) => (mediaIdsIn(v, "OLD").forEach((m) => found.add(m)), v));
  assert.deepEqual([...found].sort(), ["m1", "m2"]);
  const out = rewriteYdoc(state, mediaRewrite("OLD", "NEW", new Map([["m1", "n1"], ["m2", "n2"]])));
  const copy = new Y.Doc();
  Y.applyUpdate(copy, out);
  const cs = copy.getArray<Y.Map<string>>("slides").get(0);
  assert.equal(JSON.parse(cs.get("el:v")!).src, "/api/docs/NEW/media/n1");
  assert.equal(JSON.parse(cs.get("el:m")!).src, "/api/docs/NEW/media/n2");
  assert.equal(JSON.parse(cs.get("el:x")!).src, "/api/docs/OTHER/media/m9", "another document's media is left alone");
  assert.equal(cs.get("title"), "Media");
  assert.equal(copy.getMap("meta").get("name"), "Deck");
  // the old URLs are gone from the copy's state, deleted history included
  assert.ok(!Buffer.from(out).toString("latin1").includes("/api/docs/OLD/media/"));
});
