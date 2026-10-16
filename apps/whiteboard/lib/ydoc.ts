import * as Y from "yjs";
import { ELEMENTS, FILES, MAX_FILE_CHARS, sceneSummary } from "./scene.mjs";
import { UserError } from "./util";

export type Scene = { elements: Record<string, unknown>[]; files: Record<string, unknown>[] };

const MAX_ELEMENTS = 20_000;

/**
 * Reads an Excalidraw file (.excalidraw JSON, as Excalidraw and this app save it) into elements
 * and images. Anything that isn't a scene is refused.
 */
export function parseExcalidraw(raw: string): Scene {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new UserError("That file isn't a whiteboard (.excalidraw) file");
  }
  const d = data as { type?: unknown; elements?: unknown; files?: unknown };
  if (!d || typeof d !== "object" || d.type !== "excalidraw" || !Array.isArray(d.elements)) {
    throw new UserError("That file isn't a whiteboard (.excalidraw) file");
  }
  if (d.elements.length > MAX_ELEMENTS) throw new UserError(`That board has more than ${MAX_ELEMENTS} shapes`);
  const elements = d.elements.filter(
    (e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" && typeof (e as { type?: unknown }).type === "string",
  );
  const files = d.files && typeof d.files === "object" ? Object.values(d.files as Record<string, unknown>) : [];
  return {
    elements,
    files: files.filter(
      (f): f is Record<string, unknown> =>
        !!f && typeof f === "object" && typeof (f as { id?: unknown }).id === "string" &&
        typeof (f as { dataURL?: unknown }).dataURL === "string" && ((f as { dataURL: string }).dataURL.length <= MAX_FILE_CHARS),
    ),
  };
}

/** A board's Yjs document holding `scene`, encoded the way the collaboration server stores it. */
export function encodeScene(scene: Scene): { ydoc: Buffer; text: string; count: number } {
  const doc = new Y.Doc();
  const els = doc.getMap<string>(ELEMENTS);
  const files = doc.getMap<string>(FILES);
  doc.transact(() => {
    for (const el of scene.elements) els.set(String(el.id), JSON.stringify(el));
    for (const f of scene.files) files.set(String(f.id), JSON.stringify(f));
  });
  const { text, count } = sceneSummary(els.values());
  return { ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)), text, count };
}

/** The scene in a stored board document, deleted elements left out (for exports). */
export function decodeScene(ydoc: Uint8Array | null): Scene {
  const doc = new Y.Doc();
  if (ydoc?.length) Y.applyUpdate(doc, ydoc);
  const elements: Record<string, unknown>[] = [];
  for (const json of doc.getMap<string>(ELEMENTS).values()) {
    try {
      const el = JSON.parse(json);
      if (el && !el.isDeleted) elements.push(el);
    } catch {
      /* skip a bad entry */
    }
  }
  const files: Record<string, unknown>[] = [];
  for (const json of doc.getMap<string>(FILES).values()) {
    try {
      files.push(JSON.parse(json));
    } catch {
      /* skip a bad entry */
    }
  }
  return { elements, files };
}

/** A scene as an .excalidraw file, which Excalidraw and this app can open. */
export function toExcalidrawFile(scene: Scene): string {
  const files: Record<string, unknown> = {};
  const used = new Set(scene.elements.map((e) => e.fileId).filter(Boolean));
  for (const f of scene.files) if (used.has(f.id)) files[String(f.id)] = f;
  return JSON.stringify({ type: "excalidraw", version: 2, source: "synergy-whiteboard", elements: scene.elements, appState: { viewBackgroundColor: "#ffffff" }, files });
}
