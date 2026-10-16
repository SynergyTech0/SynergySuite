// File > Make a copy: a new document with the same content, owned by whoever
// makes it. Audio, video and 3D models live outside the CRDT (doc_media), so
// the copy gets copies of them and its content points at those.
import * as Y from "yjs";

/** The root lists of our editors (slides; spreadsheet operations) and their rich-text roots; every other root is a map. */
const ARRAYS = new Set(["slides", "ops"]);
const FRAGMENTS = new Set(["default", "prosemirror"]);

/** Every string value in a Yjs document passed through `rewrite` (maps, arrays, XML attributes), as a new state. */
export function rewriteYdoc(state: Uint8Array, rewrite: (s: string) => string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const walk = (t: unknown) => {
    if (t instanceof Y.Map) {
      for (const [k, v] of [...t.entries()]) {
        if (typeof v === "string") {
          const n = rewrite(v);
          if (n !== v) t.set(k, n);
        } else walk(v);
      }
    } else if (t instanceof Y.Array) {
      const arr = t.toArray();
      arr.forEach((v, i) => {
        if (typeof v === "string") {
          const n = rewrite(v);
          if (n !== v) {
            t.delete(i, 1);
            t.insert(i, [n]);
          }
        } else walk(v);
      });
    } else if (t instanceof Y.XmlElement || t instanceof Y.XmlFragment) {
      if (t instanceof Y.XmlElement)
        for (const [k, v] of Object.entries(t.getAttributes())) {
          if (typeof v !== "string") continue;
          const n = rewrite(v);
          if (n !== v) t.setAttribute(k, n);
        }
      t.toArray().forEach(walk);
    }
  };
  doc.transact(() => {
    for (const name of [...doc.share.keys()]) {
      // a root type takes its kind from how it is read: read each the way the editors write it
      const kind = ARRAYS.has(name) ? doc.getArray(name) : FRAGMENTS.has(name) ? doc.getXmlFragment(name) : doc.getMap(name);
      walk(kind);
    }
  });
  return Y.encodeStateAsUpdate(doc);
}

/** Media URLs of document `from` in some text, with their ids. */
export const mediaIdsIn = (s: string, from: string): string[] => [...s.matchAll(new RegExp(`/api/docs/${from.replace(/[^A-Za-z0-9_-]/g, "")}/media/([A-Za-z0-9_-]+)`, "g"))].map((m) => m[1]);

/** A rewrite that points document `from`'s media URLs at document `to`, with new media ids. */
export function mediaRewrite(from: string, to: string, ids: Map<string, string>): (s: string) => string {
  const re = new RegExp(`/api/docs/${from.replace(/[^A-Za-z0-9_-]/g, "")}/media/([A-Za-z0-9_-]+)`, "g");
  return (s) => (s.includes("/media/") ? s.replace(re, (m, id: string) => (ids.has(id) ? `/api/docs/${to}/media/${ids.get(id)}` : m)) : s);
}
