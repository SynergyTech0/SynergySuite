#!/bin/sh
# Builds Chili3D (3D modeling on Open CASCADE, compiled to WebAssembly) into public/engine3d/,
# with engine/chili3d-host.patch. Needs Node 22 and git; the WebAssembly kernel ships prebuilt
# in Chili3D's repository, so no C++ toolchain is needed.
#   npm run engine:3d --workspace apps/cad
set -eu
# Chili3D has no release tags yet; pin a commit of its main branch.
REF="${CHILI3D_REF:-03a6a542e841a7f1952f67aa729e0658a8096c08}"
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/.chili3d"
if [ ! -d "$src/.git" ]; then
  git init -q "$src"
  git -C "$src" remote add origin https://github.com/xiangechen/chili3d.git
  git -C "$src" fetch -q --depth 1 origin "$REF"
  git -C "$src" checkout -q FETCH_HEAD
fi
# Start from the pinned commit every time, so an updated patch applies to a clean tree.
git -C "$src" reset -q --hard
git -C "$src" clean -fdq -e node_modules
git -C "$src" apply "$here/chili3d-host.patch"
(cd "$src" && npm ci --no-audit --no-fund && NODE_ENV=production npx rspack build)
rm -rf "$here/../public/engine3d"
mkdir -p "$here/../public/engine3d/licenses"
cp -R "$src/dist/." "$here/../public/engine3d/"
cp "$src/LICENSE" "$here/../public/engine3d/licenses/LICENSE-chili3d"
cp "$src/cpp/LICENSE-chili-wasm.txt" "$here/../public/engine3d/licenses/"
