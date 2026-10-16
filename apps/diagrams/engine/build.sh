#!/bin/sh
# Puts draw.io's web editor (Apache-2.0, https://github.com/jgraph/drawio) into public/drawio/,
# with Synergy's engine/PreConfig.js and engine/PostConfig.js in place of upstream's. Needs git;
# nothing is compiled, the release tag already holds the built editor.
#   npm run engine --workspace apps/diagrams
set -eu
REF="${DRAWIO_REF:-v29.7.12}"
here="$(cd "$(dirname "$0")" && pwd)"
src="${DRAWIO_SRC:-$here/.drawio}"
if [ ! -d "$src/.git" ]; then
  # Only the web app folder: the repository's history and Java sources are large.
  git clone -q --depth 1 --branch "$REF" --filter=blob:none --sparse https://github.com/jgraph/drawio.git "$src"
  git -C "$src" sparse-checkout set --no-cone /src/main/webapp/ /LICENSE /README.md
fi
sh "$here/install.sh" "$src" "$here/../public/drawio"
