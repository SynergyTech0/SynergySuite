// DWG <-> DXF conversion off the page's thread, in a WebAssembly instance of its own (built by
// engine/build.sh into public/dwg/ from engine/dwg). lib/dwg.ts drives it. A damaged file can trap
// the instance; the worker reports that and the page replaces it.
import init, { dwg_to_dxf, dwg_version, dxf_to_dwg } from "./dwg/synergy_cad_dwg.js";

const ready = init({ module_or_path: new URL("./dwg/synergy_cad_dwg_bg.wasm", import.meta.url) });

self.onmessage = async (event) => {
  const { id, op, bytes, version } = event.data;
  try {
    await ready;
    const input = new Uint8Array(bytes);
    let out;
    let found = null;
    if (op === "toDxf") {
      found = dwg_version(input) ?? null;
      out = dwg_to_dxf(input);
    } else {
      out = dxf_to_dwg(input, version ?? "");
    }
    self.postMessage({ id, ok: true, bytes: out.buffer, version: found }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err), trapped: err instanceof WebAssembly.RuntimeError });
  }
};
