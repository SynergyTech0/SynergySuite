import type { AssistantSettings } from "./ai";
import type { Part } from "./views";

/**
 * The messages Chili3D exchanges with this page when it runs in our iframe with `?host=parent`
 * (engine/chili3d-host.patch adds them; the patch's index.ts documents each one).
 */
export type ModelerMessage =
  | { type: "chili3d:ready"; version: string }
  | { type: "chili3d:save"; name: string; bytes: ArrayBuffer }
  | { type: "chili3d:failed"; error: string }
  | { type: "chili3d:geometry"; id: string; document: string; parts: Part[] };

export function asModelerMessage(data: unknown): ModelerMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "chili3d:ready":
      return { type: "chili3d:ready", version: typeof m.version === "string" ? m.version : "" };
    case "chili3d:save":
      return typeof m.name === "string" && m.bytes instanceof ArrayBuffer ? { type: "chili3d:save", name: m.name, bytes: m.bytes } : null;
    case "chili3d:failed":
      return { type: "chili3d:failed", error: typeof m.error === "string" ? m.error : "unknown error" };
    case "chili3d:geometry": {
      if (typeof m.id !== "string" || !Array.isArray(m.parts)) return null;
      const parts = m.parts.filter(isPart);
      if (parts.length !== m.parts.length) return null;
      return { type: "chili3d:geometry", id: m.id, document: typeof m.document === "string" ? m.document : "", parts };
    }
    default:
      return null;
  }
}

/** Chili3D's own document format (JSON). Saving a model writes one of these. */
export const MODEL_EXT = ".cd";

/** Files the 3D editor opens: its own documents, and the CAD exchange formats it imports. */
export const OPENS_3D = /\.(cd|step|stp|iges|igs|brep|stl)$/i;
/** Files the 2D editor opens. */
export const OPENS_2D = /\.(dxf|dwg)$/i;

/** Where a file in the library opens: the 2D editor, the 3D editor, or neither (a plain download). */
export function editorFor(name: string): "edit" | "model" | null {
  if (OPENS_2D.test(name)) return "edit";
  if (OPENS_3D.test(name)) return "model";
  return null;
}

/**
 * The model document a file becomes in the 3D editor, named after the file, so saving it writes
 * `<name>.cd`: over the file itself when it is a .cd, beside it when it was an import (a STEP or
 * STL can't hold everything a model does, so it isn't overwritten).
 */
export function documentName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "Untitled";
}

function isPart(p: unknown): p is Part {
  if (!p || typeof p !== "object") return false;
  const { position, index, face, edges } = p as Record<string, unknown>;
  return (
    position instanceof Float32Array &&
    index instanceof Uint32Array &&
    face instanceof Uint32Array &&
    edges instanceof Float32Array &&
    face.length * 3 === index.length &&
    index.every((i) => i < position.length / 3)
  );
}

/** The name a drawing made from a model is saved under. */
export function drawingName(document: string): string {
  return `${document.trim() || "Untitled"} drawing.dxf`;
}

/**
 * What the 3D editor's AI assistant is told: off, or to reach the suite's model through this
 * app's relay (app/api/ai) in the protocol that model speaks. The editor holds no key.
 */
export function assistantMessage(settings: AssistantSettings) {
  return settings.enabled
    ? { type: "chili3d:ai", enabled: true, protocol: settings.protocol, model: settings.model, baseURL: `/api/ai/${settings.protocol}` }
    : { type: "chili3d:ai", enabled: false };
}
