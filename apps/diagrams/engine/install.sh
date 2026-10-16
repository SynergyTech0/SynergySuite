#!/bin/sh
# Copies draw.io's web app from a checkout ($1) to $2, leaving out what the suite never serves
# (the Java servlet folders, cloud storage pages, unminified sources, source maps), and puts in
# Synergy's PreConfig.js and PostConfig.js and the licenses. Used by build.sh and
# deploy/diagrams.Dockerfile.
set -eu
src="$1"
out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
web="$src/src/main/webapp"
test -s "$web/index.html"
rm -rf "$out"
mkdir -p "$out"
cp -R "$web/." "$out/"
cd "$out"
rm -rf WEB-INF META-INF connect js/diagramly js/grapheditor js/dropbox js/onedrive js/simplepeer \
  dropbox.html github.html gitlab.html onedrive3.html teams.html monday-app-association.json \
  service-worker.js workbox-*.js open.html
find . -name '*.map' -delete
cp "$here/PreConfig.js" js/PreConfig.js
cp "$here/PostConfig.js" js/PostConfig.js
mkdir -p licenses
cp "$src/LICENSE" licenses/LICENSE-drawio
cp templates/LICENSE licenses/LICENSE-drawio-templates
test -s js/app.min.js
