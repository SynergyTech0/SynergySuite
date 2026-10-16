//! CADCraft's DWG bridge for JavaScript: DWG to DXF to open a drawing, DXF to DWG to save one.
//!
//! wasm32 panics abort, which traps this instance (CADCraft guards the DWG reader with
//! `catch_unwind`, which can't catch there). So the host runs this module in a Web Worker of its
//! own and starts a fresh one after a trap: a damaged file fails its own conversion and nothing
//! else.
use wasm_bindgen::prelude::*;

/// DWG bytes to ASCII DXF, in failsafe mode (records the reader can't decode are skipped).
#[wasm_bindgen]
pub fn dwg_to_dxf(dwg: &[u8]) -> Result<Vec<u8>, JsError> {
    cadcraft_dwg::dwg_to_dxf_noted(dwg, cadcraft_dwg::Limits::DEFAULT).map(|(dxf, _notes)| dxf).map_err(|e| JsError::new(&e))
}

/// DXF bytes to a DWG of `version` (a code such as "AC1032"); empty means the DXF's own version.
#[wasm_bindgen]
pub fn dxf_to_dwg(dxf: &[u8], version: &str) -> Result<Vec<u8>, JsError> {
    let out = if version.is_empty() { cadcraft_dwg::dxf_to_dwg(dxf) } else { cadcraft_dwg::dxf_to_dwg_as(dxf, version) };
    out.map_err(|e| JsError::new(&e))
}

/// The DWG version code ("AC1032") of a DWG file, if it is one.
#[wasm_bindgen]
pub fn dwg_version(bytes: &[u8]) -> Option<String> {
    cadcraft_dwg::version(bytes)
}
