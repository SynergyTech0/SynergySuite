#!/bin/sh
# Builds the FilmCraft editor for the browser, with the host bridge, into public/engine/.
# Needs Rust with the wasm32-unknown-unknown target and the wasm-bindgen CLI at the version
# FilmCraft's xtask names (0.2.129 for v0.8.0):
#   cargo install wasm-bindgen-cli --version 0.2.129 --locked
#   npm run engine --workspace apps/stream
set -eu
REF="${FILMCRAFT_REF:-v0.8.0}"
here="$(cd "$(dirname "$0")" && pwd)"
src="${FILMCRAFT_SRC:-$here/.filmcraft}"
if [ ! -d "$src/.git" ]; then
  git clone --depth 1 --branch "$REF" https://github.com/storytold/filmcraft.git "$src"
  git -C "$src" apply "$here/host-bridge.patch"
fi
# Thin LTO builds with far less memory than a fat-LTO release.
(cd "$src" && CARGO_PROFILE_RELEASE_LTO="${CARGO_PROFILE_RELEASE_LTO:-thin}" cargo xtask web)
rm -rf "$here/../public/engine"
mkdir -p "$here/../public/engine/licenses"
cp -R "$src/target/web/dist/." "$here/../public/engine/"
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$src/NOTICE" "$src/ATTRIBUTION.md" "$here/../public/engine/licenses/"
