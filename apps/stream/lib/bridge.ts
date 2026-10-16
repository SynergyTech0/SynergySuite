/**
 * The messages the FilmCraft editor sends this app when it runs in our iframe with `?host`
 * (see engine/host-bridge.patch). Requests the other way go through `window.filmcraft`.
 */
export type EditorSave = { type: "filmcraft:save"; name: string; path: string; bytes: ArrayBuffer };
export type EngineMessage = { type: "filmcraft:ready" } | EditorSave;

export function asEngineMessage(data: unknown): EngineMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "filmcraft:ready") return { type: "filmcraft:ready" };
  if (m.type === "filmcraft:save" && typeof m.name === "string" && m.name && m.bytes instanceof ArrayBuffer) {
    return { type: "filmcraft:save", name: m.name, path: typeof m.path === "string" ? m.path : m.name, bytes: m.bytes };
  }
  return null;
}

const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;

/** Where a file the editor wrote goes: exported videos to the library, projects to the projects shelf, the rest to downloads. */
export function saveKind(name: string): "video" | "project" | "download" {
  if (/\.fcproj$/i.test(name)) return "project";
  if (VIDEO.test(name)) return "video";
  return "download";
}
