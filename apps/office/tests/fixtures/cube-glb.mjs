// A small glTF 2.0 binary for tests: a cube whose six faces have six colours
// (one material each), so turning it shows different colours.
const FACES = [
  { n: [0, 0, 1], c: [1, 0.15, 0.15, 1] }, // front: red
  { n: [0, 0, -1], c: [0.15, 0.35, 1, 1] }, // back: blue
  { n: [1, 0, 0], c: [0.1, 0.8, 0.2, 1] }, // right: green
  { n: [-1, 0, 0], c: [1, 0.85, 0.1, 1] }, // left: yellow
  { n: [0, 1, 0], c: [0.9, 0.9, 0.9, 1] }, // top: white
  { n: [0, -1, 0], c: [0.6, 0.2, 0.8, 1] }, // bottom: purple
];

function faceVerts([nx, ny, nz]) {
  // two axes across the face
  const u = nx ? [0, 1, 0] : [1, 0, 0];
  const v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
  const p = (a, b) => [nx + u[0] * a + v[0] * b, ny + u[1] * a + v[1] * b, nz + u[2] * a + v[2] * b];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

export function cubeGlb() {
  const pos = [], nor = [];
  for (const f of FACES) for (const q of faceVerts(f.n)) { pos.push(...q); nor.push(...f.n); }
  const idx = [];
  FACES.forEach((_, k) => {
    const b = k * 4;
    // both windings, so the face shows whichever way it was built
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const posB = new Float32Array(pos), norB = new Float32Array(nor), idxB = new Uint16Array(idx);
  const bin = new Uint8Array(posB.byteLength + norB.byteLength + idxB.byteLength);
  bin.set(new Uint8Array(posB.buffer), 0);
  bin.set(new Uint8Array(norB.buffer), posB.byteLength);
  bin.set(new Uint8Array(idxB.buffer), posB.byteLength + norB.byteLength);
  const per = 12 * 2; // index bytes per face
  const json = {
    asset: { version: "2.0", generator: "synergy test cube" },
    scene: 0,
    scenes: [{ name: "Test cube", nodes: [0] }],
    nodes: [{ mesh: 0, name: "Cube" }],
    meshes: [{ primitives: FACES.map((_, k) => ({ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 + k, material: k })) }],
    materials: FACES.map((f, k) => ({ name: `Face ${k}`, pbrMetallicRoughness: { baseColorFactor: f.c, metallicFactor: 0, roughnessFactor: 0.6 } })),
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posB.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posB.byteLength, byteLength: norB.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posB.byteLength + norB.byteLength, byteLength: idxB.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      ...FACES.map((_, k) => ({ bufferView: 2, byteOffset: k * per, componentType: 5123, count: 12, type: "SCALAR" })),
    ],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jl = (js.length + 3) & ~3;
  const jp = new Uint8Array(jl).fill(0x20);
  jp.set(js);
  js = jp;
  const bl = (bin.length + 3) & ~3;
  const total = 12 + 8 + jl + 8 + bl;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}
