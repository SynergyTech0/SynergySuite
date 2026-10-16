#!/bin/sh
# Builds the PhotoCraft engine for the browser, with the host bridge, into public/engine/.
# Needs Rust with the wasm32-unknown-unknown target and Trunk (https://trunkrs.dev).
#   npm run engine --workspace apps/photo
set -eu
REF="${PHOTOCRAFT_REF:-v0.9.0}"
here="$(cd "$(dirname "$0")" && pwd)"
src="${PHOTOCRAFT_SRC:-$here/.photocraft}"
if [ ! -d "$src/.git" ]; then
  git clone --depth 1 --branch "$REF" https://github.com/storytold/photocraft.git "$src"
  git -C "$src" apply "$here/host-bridge.patch"
fi
# Thin LTO builds with far less memory than the upstream release's fat LTO.
(cd "$src/apps/photocraft-web" && CARGO_PROFILE_WASM_RELEASE_LTO="${CARGO_PROFILE_WASM_RELEASE_LTO:-thin}" trunk build --release --locked)
rm -rf "$here/../public/engine"
mkdir -p "$here/../public/engine/licenses"
cp -R "$src/dist/web/." "$here/../public/engine/"
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$src/NOTICE" "$src/ATTRIBUTION.md" "$here/../public/engine/licenses/"
