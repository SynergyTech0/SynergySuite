#!/bin/sh
# Builds CADCraft for the browser into public/engine/, and its DWG converter into public/dwg/.
# Needs Rust with the wasm32-unknown-unknown target, Trunk (https://trunkrs.dev) and
# wasm-bindgen-cli 0.2.129 (cargo install wasm-bindgen-cli --version 0.2.129 --locked).
#   npm run engine --workspace apps/cad
set -eu
REF="${CADCRAFT_REF:-v0.7.0}"
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.cadcraft"   # engine/dwg/Cargo.toml finds CADCraft's DWG crate here
if [ ! -d "$src/.git" ]; then
  git clone --depth 1 --branch "$REF" https://github.com/storytold/cadcraft.git "$src"
fi
# Start from the tag every time, so updated patches apply to a clean tree.
git -C "$src" reset -q --hard
git -C "$src" clean -fdq -e target
git -C "$src" apply "$here/dwg-wasm.patch"
# The editor is upstream's web build with Synergy CAD's name (cadcraft-brand.patch); its host
# bridge (?host=parent) already hands files to and from this page.
git -C "$src" apply "$here/cadcraft-brand.patch"
# Saving keeps 3D meshes as meshes and the arrowhead blocks leaders name (cadcraft-save-fidelity.patch).
git -C "$src" apply "$here/cadcraft-save-fidelity.patch"
(cd "$src/apps/cadcraft-web" && trunk build --release --locked)
# The DWG converter: CADCraft's DWG crate with the patch's `wasm` feature, in its own module.
(cd "$here/dwg" && cargo build --release --locked --target wasm32-unknown-unknown)
rm -rf "$here/../public/engine" "$here/../public/dwg"
mkdir -p "$here/../public/engine/licenses"
cp -R "$src/dist/web/." "$here/../public/engine/"
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$src/NOTICE" "$src/ATTRIBUTION.md" "$here/../public/engine/licenses/"
wasm-bindgen --target web --no-typescript --out-dir "$here/../public/dwg" \
  "$here/dwg/target/wasm32-unknown-unknown/release/synergy_cad_dwg.wasm"
