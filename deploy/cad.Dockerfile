# Synergy CAD: the CADCraft engine built for the browser, plus its DWG converter (engine/dwg), and
# Chili3D for 3D models, served by the Next.js app. Run from the repository root:
#   docker build -f deploy/cad.Dockerfile -t synergy/cad .
ARG CADCRAFT_REF=v0.7.0

FROM rust:1.95-slim-bookworm AS engine
ARG CADCRAFT_REF
# The Trunk deploy/photo.Dockerfile uses (CADCraft's release workflow doesn't pin one).
ARG TRUNK_VERSION=0.21.14
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add wasm32-unknown-unknown
RUN set -eu; \
    case "$(uname -m)" in x86_64) arch=x86_64 ;; aarch64) arch=aarch64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    asset="trunk-${arch}-unknown-linux-musl.tar.gz"; \
    url="https://github.com/trunk-rs/trunk/releases/download/v${TRUNK_VERSION}"; \
    cd /tmp; \
    curl -fsSL --retry 3 "$url/$asset" -o "$asset"; \
    curl -fsSL --retry 3 "$url/$asset.sha256" -o "$asset.sha256"; \
    printf '%s  %s\n' "$(cat "$asset.sha256")" "$asset" | sha256sum -c -; \
    tar -xzf "$asset" -C /usr/local/bin trunk; \
    rm "$asset" "$asset.sha256"
# Must match the wasm-bindgen version pinned in apps/cad/engine/dwg/Cargo.toml.
ARG WASM_BINDGEN_VERSION=0.2.129
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version ${WASM_BINDGEN_VERSION} --locked
# The same layout engine/build.sh makes: CADCraft in .cadcraft beside the converter crate.
# Retried: a dropped connection mid-clone shouldn't fail the whole build.
RUN for i in 1 2 3 4; do \
      git clone --depth 1 --branch ${CADCRAFT_REF} https://github.com/storytold/cadcraft.git /engine/.cadcraft && exit 0; \
      rm -rf /engine/.cadcraft; echo "clone failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done; exit 1
COPY apps/cad/engine/dwg-wasm.patch apps/cad/engine/cadcraft-brand.patch /engine/
COPY apps/cad/engine/dwg /engine/dwg
# A Windows checkout made before .gitattributes pinned LF may have CRLF patches, which don't apply.
# cadcraft-brand.patch shows Synergy CAD in place of CADCraft, keeping the credit in About.
RUN sed -i 's/\r$//' /engine/dwg-wasm.patch /engine/cadcraft-brand.patch \
 && git -C /engine/.cadcraft apply /engine/dwg-wasm.patch \
 && git -C /engine/.cadcraft apply /engine/cadcraft-brand.patch
# Two jobs keep peak memory within a small build machine.
ARG CARGO_BUILD_JOBS=2
WORKDIR /engine/.cadcraft/apps/cadcraft-web
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/engine/.cadcraft/target \
    --mount=type=cache,target=/root/.cache/trunk \
    trunk build --release --locked \
 && test -s /engine/.cadcraft/dist/web/index.html
WORKDIR /engine/dwg
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --locked --target wasm32-unknown-unknown \
 && wasm-bindgen --target web --no-typescript --out-dir /engine/out/dwg target/wasm32-unknown-unknown/release/synergy_cad_dwg.wasm

FROM node:22-slim AS engine3d
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
# Chili3D has no release tags yet; the same commit engine/build-3d.sh pins.
ARG CHILI3D_REF=03a6a542e841a7f1952f67aa729e0658a8096c08
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*
COPY apps/cad/engine/chili3d-host.patch /engine3d/chili3d-host.patch
WORKDIR /engine3d/src
RUN --mount=type=cache,target=/root/.npm git init -q . \
 && git remote add origin https://github.com/xiangechen/chili3d.git \
 && for i in 1 2 3 4; do \
      git fetch --depth 1 origin ${CHILI3D_REF} && break; \
      [ "$i" = 4 ] && exit 1; echo "fetch failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done \
 && git checkout -q FETCH_HEAD \
 && sed -i 's/\r$//' /engine3d/chili3d-host.patch \
 && git apply /engine3d/chili3d-host.patch \
 && npm ci --no-audit --no-fund \
 && NODE_ENV=production npx rspack build \
 && test -s dist/index.html

FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# npm needs every workspace manifest to validate the lockfile, even the ones it won't install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/base/package.json apps/base/
COPY apps/cad/package.json apps/cad/
COPY apps/calendar/package.json apps/calendar/
COPY apps/chat/package.json apps/chat/
COPY apps/forms/package.json apps/forms/
COPY apps/mail/package.json apps/mail/
COPY apps/meet/package.json apps/meet/
COPY apps/notes/package.json apps/notes/
COPY apps/office/package.json apps/office/
COPY apps/planner/package.json apps/planner/
COPY apps/photo/package.json apps/photo/
COPY apps/sites/package.json apps/sites/
COPY apps/trust/package.json apps/trust/
COPY apps/whiteboard/package.json apps/whiteboard/
COPY addons/people/package.json addons/people/
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/cad --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/cad apps/cad
COPY --from=engine /engine/.cadcraft/dist/web apps/cad/public/engine
COPY --from=engine /engine/out/dwg apps/cad/public/dwg
COPY --from=engine3d /engine3d/src/dist apps/cad/public/engine3d
COPY --from=engine3d /engine3d/src/LICENSE apps/cad/public/engine3d/licenses/LICENSE-chili3d
COPY --from=engine3d /engine3d/src/cpp/LICENSE-chili-wasm.txt apps/cad/public/engine3d/licenses/
COPY --from=engine /engine/.cadcraft/LICENSE-MIT /engine/.cadcraft/LICENSE-APACHE /engine/.cadcraft/NOTICE /engine/.cadcraft/ATTRIBUTION.md apps/cad/public/engine/licenses/
RUN npm run build --workspace apps/cad
ENV NODE_ENV=production
WORKDIR /repo/apps/cad
CMD ["npm", "run", "start"]
