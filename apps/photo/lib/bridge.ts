/**
 * The messages the PhotoCraft engine exchanges with this page when it runs in our iframe with
 * `?host` (see engine/host-bridge.patch).
 */
export type EngineMessage =
  | { type: "photocraft:ready" }
  | { type: "photocraft:save"; name: string; bytes: ArrayBuffer };

export function asEngineMessage(data: unknown): EngineMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "photocraft:ready") return { type: "photocraft:ready" };
  if (m.type === "photocraft:save" && typeof m.name === "string" && m.bytes instanceof ArrayBuffer) {
    return { type: "photocraft:save", name: m.name, bytes: m.bytes };
  }
  return null;
}

/**
 * Where a save from the engine goes. A name this editor already saved to, or the name of the file it
 * opened, replaces that file; any other name (the first Save of a PNG as PSD, Save As, Export) adds a
 * new file to the library, which later saves under that name then replace.
 */
export function saveTarget(known: { id: string; name: string }[], name: string): { replace: string } | { create: string } {
  const hit = known.find((f) => f.name === name);
  return hit ? { replace: hit.id } : { create: name };
}
