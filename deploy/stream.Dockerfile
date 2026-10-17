# Synergy Stream: the video library (Next.js, with ffmpeg for processing) and its video editor, the
# FilmCraft engine built for the browser with our host bridge. Run from the repository root:
#   docker build -f deploy/stream.Dockerfile -t synergy/stream .
ARG FILMCRAFT_REF=v0.8.0

FROM rust:1.95-slim-bookworm AS engine
ARG FILMCRAFT_REF
# Matches WASM_BINDGEN in FilmCraft's xtask for this release.
ARG WASM_BINDGEN_VERSION=0.2.129
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version ${WASM_BINDGEN_VERSION} --locked
# Retried: a dropped connection mid-clone shouldn't fail the whole build.
RUN for i in 1 2 3 4; do \
      git clone --depth 1 --branch ${FILMCRAFT_REF} https://github.com/storytold/filmcraft.git /src && exit 0; \
      rm -rf /src; echo "clone failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done; exit 1
COPY apps/stream/engine/host-bridge.patch /tmp/host-bridge.patch
# A Windows checkout made before .gitattributes pinned LF may have CRLF patches, which don't apply.
RUN sed -i 's/\r$//' /tmp/host-bridge.patch \
 && git -C /src apply /tmp/host-bridge.patch
WORKDIR /src
# Thin LTO and two jobs keep peak memory within a small build machine.
ARG CARGO_PROFILE_RELEASE_LTO=thin
ARG CARGO_BUILD_JOBS=2
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target-cache \
    CARGO_TARGET_DIR=/src/target-cache cargo xtask web \
 && mkdir -p /engine && cp -R /src/target-cache/web/dist/. /engine/ \
 && test -s /engine/index.html

FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ENV NEXT_TELEMETRY_DISABLED=1
# ffmpeg makes uploads playable everywhere (posters, H.264 copies, speech for captions).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# npm needs every workspace manifest to validate the lockfile, even the ones it won't install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/books/api/package.json apps/books/api/
COPY apps/books/web/package.json apps/books/web/
COPY apps/admin/package.json apps/admin/
COPY apps/search/package.json apps/search/
COPY apps/base/package.json apps/base/
COPY apps/builder/package.json apps/builder/
COPY apps/cad/package.json apps/cad/
COPY apps/bookings/package.json apps/bookings/
COPY apps/calendar/package.json apps/calendar/
COPY apps/chat/package.json apps/chat/
COPY apps/contacts/package.json apps/contacts/
COPY apps/crm/package.json apps/crm/
COPY apps/desk/package.json apps/desk/
COPY apps/diagrams/package.json apps/diagrams/
COPY apps/devices/package.json apps/devices/
COPY apps/ops/package.json apps/ops/
COPY apps/commerce/package.json apps/commerce/
COPY apps/drive/package.json apps/drive/
COPY apps/engage/package.json apps/engage/
COPY apps/flow/package.json apps/flow/
COPY apps/forms/package.json apps/forms/
COPY apps/hr/package.json apps/hr/
COPY apps/insights/package.json apps/insights/
COPY apps/loop/package.json apps/loop/
COPY apps/mail/package.json apps/mail/
COPY apps/meet/package.json apps/meet/
COPY apps/notes/package.json apps/notes/
COPY apps/office/package.json apps/office/
COPY apps/planner/package.json apps/planner/
COPY apps/projects/package.json apps/projects/
COPY apps/field/package.json apps/field/
COPY apps/contracts/package.json apps/contracts/
COPY apps/photo/package.json apps/photo/
COPY apps/sites/package.json apps/sites/
COPY apps/stream/package.json apps/stream/
COPY apps/todo/package.json apps/todo/
COPY apps/phone/package.json apps/phone/
COPY apps/trust/package.json apps/trust/
COPY apps/whiteboard/package.json apps/whiteboard/
COPY apps/groups/package.json apps/groups/
COPY addons/portal/package.json addons/portal/
COPY addons/campaigns/package.json addons/campaigns/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/stream --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/stream apps/stream
COPY --from=engine /engine apps/stream/public/engine
COPY --from=engine /src/LICENSE-MIT /src/LICENSE-APACHE /src/NOTICE /src/ATTRIBUTION.md apps/stream/public/engine/licenses/
RUN npm run build --workspace apps/stream
ENV NODE_ENV=production
WORKDIR /repo/apps/stream
CMD ["npm", "run", "start"]
