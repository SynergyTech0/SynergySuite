// 3D models (glTF 2.0): reading and packing GLB files, the views PowerPoint
// offers for a model, and the turn (rotation) we keep for it.

export const GLB_MIME = "model/gltf-binary";

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

/** True for a glTF 2.0 binary (GLB). */
export function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(0, true) === MAGIC && v.getUint32(4, true) === 2;
}

export type GlbInfo = { meshes: number; nodes: number; images: number; animations: number; name?: string; generator?: string; extensionsRequired: string[] };

/** The JSON chunk of a GLB (null when the file is not one). */
export function glbJson(bytes: Uint8Array): Record<string, unknown> | null {
  if (!isGlb(bytes)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(12, true);
  if (v.getUint32(16, true) !== JSON_CHUNK || 20 + len > bytes.length) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
  } catch {
    return null;
  }
}

/** What a model holds, for the insert dialog and checks. */
export function glbInfo(bytes: Uint8Array): GlbInfo | null {
  const j = glbJson(bytes);
  if (!j) return null;
  const n = (k: string) => (Array.isArray(j[k]) ? (j[k] as unknown[]).length : 0);
  const asset = (j.asset || {}) as Record<string, unknown>;
  const scenes = Array.isArray(j.scenes) ? (j.scenes as Record<string, unknown>[]) : [];
  const name = scenes[0]?.name || (Array.isArray(j.nodes) ? (j.nodes as Record<string, unknown>[])[0]?.name : undefined);
  return {
    meshes: n("meshes"),
    nodes: n("nodes"),
    images: n("images"),
    animations: n("animations"),
    ...(typeof name === "string" && name ? { name: name.slice(0, 120) } : {}),
    ...(typeof asset.generator === "string" ? { generator: asset.generator.slice(0, 120) } : {}),
    extensionsRequired: Array.isArray(j.extensionsRequired) ? (j.extensionsRequired as unknown[]).filter((x): x is string => typeof x === "string") : [],
  };
}

const pad4 = (n: number) => (n + 3) & ~3;

function dataUriBytes(uri: string): Uint8Array | null {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  if (m[1]) {
    const bin = atob(m[2]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(m[2]));
}

/** A GLB from a JSON chunk and an optional binary chunk. */
export function writeGlb(json: unknown, bin?: Uint8Array): Uint8Array {
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad4(js.length);
  if (jl !== js.length) {
    const p = new Uint8Array(jl).fill(0x20);
    p.set(js);
    js = p;
  }
  const bl = bin ? pad4(bin.length) : 0;
  const total = 12 + 8 + jl + (bin ? 8 + bl : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jl, true);
  v.setUint32(16, JSON_CHUNK, true);
  out.set(js, 20);
  if (bin) {
    v.setUint32(20 + jl, bl, true);
    v.setUint32(24 + jl, BIN_CHUNK, true);
    out.set(bin, 28 + jl);
  }
  return out;
}

/**
 * A self-contained .gltf (its buffers, and any pictures, as data: URIs) as
 * one GLB, which is what we store and what PowerPoint embeds. A .gltf that
 * points at other files cannot be packed from the one file.
 */
export function gltfToGlb(text: string): Uint8Array {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("the .gltf file is not valid JSON");
  }
  const asset = j.asset as { version?: string } | undefined;
  if (!asset || !String(asset.version || "").startsWith("2")) throw new Error("only glTF 2.0 models are supported");
  const buffers = (Array.isArray(j.buffers) ? j.buffers : []) as { uri?: string; byteLength?: number }[];
  const parts: Uint8Array[] = [];
  for (const b of buffers) {
    const bytes = b.uri ? dataUriBytes(b.uri) : null;
    if (!bytes) throw new Error("this .gltf needs other files next to it; save it as one .glb file and insert that");
    parts.push(bytes.subarray(0, b.byteLength ?? bytes.length));
  }
  for (const im of (Array.isArray(j.images) ? j.images : []) as { uri?: string }[])
    if (im.uri && !im.uri.startsWith("data:")) throw new Error("this .gltf needs its pictures next to it; save it as one .glb file and insert that");
  // one binary chunk: the buffers end to end (4-byte aligned), buffer views moved along
  const base: number[] = [];
  let at = 0;
  for (const p of parts) {
    base.push(at);
    at = pad4(at + p.length);
  }
  const bin = new Uint8Array(at);
  parts.forEach((p, k) => bin.set(p, base[k]));
  const views = (Array.isArray(j.bufferViews) ? j.bufferViews : []) as { buffer: number; byteOffset?: number }[];
  for (const bv of views) {
    bv.byteOffset = (bv.byteOffset || 0) + (base[bv.buffer] || 0);
    bv.buffer = 0;
  }
  j.buffers = parts.length ? [{ byteLength: at }] : [];
  return writeGlb(j, parts.length ? bin : undefined);
}

// ---- views ----

/** A model's turn: `rx` tilts it (about the horizontal axis), `ry` turns it (about the vertical), `rz` rolls it; degrees. */
export type Turn = { rx: number; ry: number; rz: number };

export const MODEL_VIEWS: { id: string; label: string; turn: Turn }[] = [
  { id: "front", label: "Front", turn: { rx: 0, ry: 0, rz: 0 } },
  { id: "back", label: "Back", turn: { rx: 0, ry: 180, rz: 0 } },
  { id: "left", label: "Left", turn: { rx: 0, ry: 90, rz: 0 } },
  { id: "right", label: "Right", turn: { rx: 0, ry: -90, rz: 0 } },
  { id: "top", label: "Top", turn: { rx: 90, ry: 0, rz: 0 } },
  { id: "bottom", label: "Bottom", turn: { rx: -90, ry: 0, rz: 0 } },
  { id: "above-front-left", label: "Above Front Left", turn: { rx: 30, ry: 35, rz: 0 } },
  { id: "above-front-right", label: "Above Front Right", turn: { rx: 30, ry: -35, rz: 0 } },
  { id: "below-front-left", label: "Below Front Left", turn: { rx: -30, ry: 35, rz: 0 } },
  { id: "below-front-right", label: "Below Front Right", turn: { rx: -30, ry: -35, rz: 0 } },
  { id: "above-back-left", label: "Above Back Left", turn: { rx: 30, ry: 145, rz: 0 } },
  { id: "above-back-right", label: "Above Back Right", turn: { rx: 30, ry: -145, rz: 0 } },
];

/** An angle in (-180, 180], to a tenth of a degree. */
export function normDeg(d: number): number {
  if (!Number.isFinite(d)) return 0;
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x * 10) / 10 || 0;
}

/** The turn after dragging the rotate handle by (dx, dy) screen pixels: across turns it, up and down tilts it. */
export function dragTurn(t: Turn, dx: number, dy: number, degPerPx = 0.5): Turn {
  return { rx: Math.max(-90, Math.min(90, Math.round((t.rx + dy * degPerPx) * 10) / 10)), ry: normDeg(t.ry + dx * degPerPx), rz: t.rz };
}

/** How far the camera stands back so a sphere of `radius` fills a view `fovDeg` high with this aspect (w/h). */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(0.01, aspect));
  return radius / Math.sin(Math.min(v, h));
}

/** PowerPoint keeps a model's rotation (am3d:rot ax/ay/az) in 60000ths of a degree. */
export const toAngle60k = (deg: number) => Math.round(normDeg(deg) * 60000);
export const fromAngle60k = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? 0 : normDeg(v / 60000));

type Mat = number[]; // 4x4, column-major (glTF's order)
const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }): Mat {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number);
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export type Bounds = { center: [number, number, number]; half: [number, number, number] };

/**
 * The model's bounding box in scene space: every mesh's POSITION bounds
 * (accessor min/max, which glTF requires) moved by its node's transforms.
 */
export function glbBounds(bytes: Uint8Array): Bounds | null {
  const j = glbJson(bytes) as {
    scene?: number;
    scenes?: { nodes?: number[] }[];
    nodes?: { children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[];
    accessors?: { min?: number[]; max?: number[] }[];
  } | null;
  if (!j?.nodes || !j.meshes || !j.accessors) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const seen = new Set<number>();
  const visit = (i: number, parent: Mat) => {
    const n = j.nodes![i];
    if (!n || seen.has(i)) return;
    seen.add(i);
    const m = mul(parent, trs(n));
    for (const p of (n.mesh !== undefined ? j.meshes![n.mesh]?.primitives : undefined) || []) {
      const a = p.attributes?.POSITION !== undefined ? j.accessors![p.attributes.POSITION] : undefined;
      if (!a?.min || !a.max || a.min.length < 3) continue;
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        for (let r = 0; r < 3; r++) {
          const w = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r];
          lo[r] = Math.min(lo[r], w);
          hi[r] = Math.max(hi[r], w);
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const roots = j.scenes?.[j.scene ?? 0]?.nodes ?? j.nodes.map((_, i) => i).filter((i) => !j.nodes!.some((n) => n.children?.includes(i)));
  for (const r of roots) visit(r, IDENT);
  if (!Number.isFinite(lo[0]) || !Number.isFinite(hi[0])) return null;
  return { center: [0, 1, 2].map((r) => (lo[r] + hi[r]) / 2) as Bounds["center"], half: [0, 1, 2].map((r) => (hi[r] - lo[r]) / 2) as Bounds["half"] };
}

const EMU_PER_M = 36_000_000;

/**
 * How PowerPoint frames a model it inserts (matched against its own files):
 * the model is scaled so its longest half-extent is half a metre
 * (meterPerModelUnit), centred on the origin (preTrans, in EMU) and seen by a
 * 45° camera on +z just far enough for its bounding sphere to fill the view.
 */
export function am3dFraming(b: Bounds | null): { mpu: number; pre: [number, number, number]; camZ: number } {
  const maxHalf = b ? Math.max(...b.half) : 0;
  if (!b || !(maxHalf > 0)) return { mpu: 1, pre: [0, 0, 0], camZ: Math.round((Math.sqrt(3) * 0.5 * EMU_PER_M) / Math.sin(Math.PI / 8)) };
  const mpu = 1 / (2 * maxHalf);
  const pre = b.center.map((c) => Math.round(-c * mpu * EMU_PER_M) || 0) as [number, number, number];
  const radius = Math.hypot(...b.half.map((h) => h * mpu * EMU_PER_M));
  return { mpu, pre, camZ: Math.round(radius / Math.sin(Math.PI / 8)) };
}
