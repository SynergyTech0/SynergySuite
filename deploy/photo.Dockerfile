# Synergy Photo: the PhotoCraft engine built for the browser (with our host bridge), served by the
# Next.js app. Run from the repository root:
#   docker build -f deploy/photo.Dockerfile -t synergy/photo .
ARG PHOTOCRAFT_REF=v0.9.0

FROM rust:1.95-slim-bookworm AS engine
ARG PHOTOCRAFT_REF
# Matches TRUNK_VERSION in PhotoCraft's release workflow.
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
# Retried: a dropped connection mid-clone shouldn't fail the whole build.
RUN for i in 1 2 3 4; do \
      git clone --depth 1 --branch ${PHOTOCRAFT_REF} https://github.com/storytold/photocraft.git /src && exit 0; \
      rm -rf /src; echo "clone failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done; exit 1
COPY apps/photo/engine/host-bridge.patch /tmp/host-bridge.patch
# A Windows checkout made before .gitattributes pinned LF may have CRLF patches, which don't apply.
RUN sed -i 's/\r$//' /tmp/host-bridge.patch \
 && git -C /src apply /tmp/host-bridge.patch
WORKDIR /src/apps/photocraft-web
# Thin LTO and two jobs keep peak memory within a small build machine.
ARG CARGO_PROFILE_WASM_RELEASE_LTO=thin
ARG CARGO_BUILD_JOBS=2
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    --mount=type=cache,target=/root/.cache/trunk \
    trunk build --release --locked \
 && test -s /src/dist/web/index.html

FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# npm needs every workspace manifest to validate the lockfile, even the ones it won't install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/books/api/package.json apps/books/api/
COPY apps/books/web/package.json apps/books/web/
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
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/photo --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/photo apps/photo
COPY --from=engine /src/dist/web apps/photo/public/engine
COPY --from=engine /src/LICENSE-MIT /src/LICENSE-APACHE /src/NOTICE /src/ATTRIBUTION.md apps/photo/public/engine/licenses/
RUN npm run build --workspace apps/photo
ENV NODE_ENV=production
WORKDIR /repo/apps/photo
CMD ["npm", "run", "start"]
