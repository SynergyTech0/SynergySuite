// Version history for presentations. A version is a snapshot of the deck's
// shared state (every slide map, the deck metadata and the master/layouts),
// stored through the same /api/docs/<id>/versions endpoints Docs uses, as
// JSON with a prefix so it is never mistaken for a document's HTML.
import * as Y from "yjs";
import { MASTER_KEYS, isAddedMaster, isCustomKey, masterLayout, readSlide, type MasterKey, type Masters, type Slide } from "./model";

export const SNAPSHOT_PREFIX = "synergy-deck:v1:";

export type DeckSnapshot = {
  slides: Record<string, string>[];
  meta: Record<string, string>;
  layouts: Record<string, Record<string, string>>;
};

const strings = (o: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
};

export function takeSnapshot(yslides: Y.Array<Y.Map<string>>, ymeta: Y.Map<string>, ylayouts: Y.Map<Y.Map<string>>): DeckSnapshot {
  const layouts: Record<string, Record<string, string>> = {};
  ylayouts.forEach((m, k) => (layouts[k] = strings(m.toJSON())));
  return { slides: yslides.toArray().map((m) => strings(m.toJSON())), meta: strings(ymeta.toJSON()), layouts };
}

export const encodeSnapshot = (s: DeckSnapshot) => SNAPSHOT_PREFIX + JSON.stringify(s);

export function decodeSnapshot(text: string | undefined | null): DeckSnapshot | null {
  if (!text || !text.startsWith(SNAPSHOT_PREFIX)) return null;
  try {
    const o = JSON.parse(text.slice(SNAPSHOT_PREFIX.length)) as Record<string, unknown>;
    if (!Array.isArray(o.slides)) return null;
    const layouts: Record<string, Record<string, string>> = {};
    for (const [k, v] of Object.entries(strings2(o.layouts))) layouts[k] = strings(v);
    return { slides: o.slides.map(strings), meta: strings(o.meta), layouts };
  } catch {
    return null;
  }
}
const strings2 = (o: unknown): Record<string, unknown> => (o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {});

const mapOf = (o: Record<string, string>) => new Map(Object.entries(o));

/** The slide master and layouts stored under these keys (as the editor reads them). */
export function readMasters(entries: Iterable<[string, { get(k: string): unknown; forEach(f: (v: unknown, k: string) => void): void }]>): Masters {
  const next: Masters = {};
  for (const [k, m] of entries) {
    if (MASTER_KEYS.some((x) => x.id === k)) next[k as MasterKey] = { ...readSlide(m), layout: masterLayout(k as MasterKey) };
    else if (isCustomKey(k)) next[k] = readSlide(m); // custom layouts store their base layout
    else if (isAddedMaster(k)) next[k] = { ...readSlide(m), layout: "content" };
  }
  return next;
}

export function snapshotSlides(s: DeckSnapshot): Slide[] {
  return s.slides.map((o) => readSlide(mapOf(o)));
}

export function snapshotMasters(s: DeckSnapshot): Masters {
  return readMasters(Object.entries(s.layouts).map(([k, o]) => [k, mapOf(o)] as [string, Map<string, string>]));
}

/** Replace the deck's shared state with a snapshot (the deck keeps its name). One transaction, so it undoes and syncs as one change. */
export function restoreSnapshot(ydoc: Y.Doc, yslides: Y.Array<Y.Map<string>>, ymeta: Y.Map<string>, ylayouts: Y.Map<Y.Map<string>>, s: DeckSnapshot) {
  ydoc.transact(() => {
    yslides.delete(0, yslides.length);
    yslides.insert(
      0,
      s.slides.map((o) => {
        const m = new Y.Map<string>();
        for (const [k, v] of Object.entries(o)) m.set(k, v);
        return m;
      }),
    );
    for (const k of [...ymeta.keys()]) if (k !== "name" && !(k in s.meta)) ymeta.delete(k);
    for (const [k, v] of Object.entries(s.meta)) if (k !== "name" && ymeta.get(k) !== v) ymeta.set(k, v);
    for (const k of [...ylayouts.keys()]) ylayouts.delete(k);
    for (const [k, o] of Object.entries(s.layouts)) {
      const m = new Y.Map<string>();
      for (const [f, v] of Object.entries(o)) m.set(f, v);
      ylayouts.set(k, m);
    }
  });
}
