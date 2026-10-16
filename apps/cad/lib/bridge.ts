/**
 * The messages CADCraft exchanges with this page when it runs in our iframe with `?host=parent`
 * (CADCraft's own host bridge, `apps/cadcraft-web/src/host.rs` upstream).
 */
export type EngineMessage =
  | { type: "cadcraft:ready"; version: string }
  | { type: "cadcraft:save"; name: string; bytes: ArrayBuffer }
  | { type: "cadcraft:dirty"; dirty: boolean }
  | { type: "cadcraft:failed"; error: string };

export function asEngineMessage(data: unknown): EngineMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "cadcraft:ready":
      return { type: "cadcraft:ready", version: typeof m.version === "string" ? m.version : "" };
    case "cadcraft:save":
      return typeof m.name === "string" && m.bytes instanceof ArrayBuffer ? { type: "cadcraft:save", name: m.name, bytes: m.bytes } : null;
    case "cadcraft:dirty":
      return typeof m.dirty === "boolean" ? { type: "cadcraft:dirty", dirty: m.dirty } : null;
    case "cadcraft:failed":
      return { type: "cadcraft:failed", error: typeof m.error === "string" ? m.error : "unknown error" };
    default:
      return null;
  }
}

export const isDwg = (name: string) => /\.dwg$/i.test(name);

/**
 * The name CADCraft sees for a file. The browser build can't read DWG itself, so a DWG is
 * converted to DXF here first and opened under the same name with a .dxf extension.
 */
export function engineName(name: string): string {
  return isDwg(name) ? name.replace(/\.dwg$/i, ".dxf") : name;
}

/** A file this editor opened or saved. `dwg` is set when the file is a DWG (its version code). */
export type Known = { id: string; name: string; dwg?: string };

/**
 * Where a save from the engine goes. A name this editor opened or already saved to replaces that
 * file; a DWG opened here comes back from the engine as DXF under its .dxf name and is converted
 * back to DWG, in the version it had. Any other name (Save As, exports) adds a new file, which
 * later saves under that name then replace.
 */
export type SaveTarget = { replace: string; dwg?: string } | { create: string };

export function saveTarget(known: Known[], name: string): SaveTarget {
  const same = known.find((f) => f.name === name);
  if (same) return { replace: same.id };
  const dwg = known.find((f) => f.dwg !== undefined && engineName(f.name) === name);
  if (dwg) return { replace: dwg.id, dwg: dwg.dwg };
  return { create: name };
}

/** DWG versions CADCraft writes. Anything else saves as 2018 (AC1032), which AutoCAD 2018+ opens. */
const WRITABLE = new Set(["AC1015", "AC1018", "AC1021", "AC1024", "AC1027", "AC1032"]);

export function saveVersion(code: string | null | undefined): string {
  return code && WRITABLE.has(code) ? code : "AC1032";
}
