# Synergy Diagrams: draw.io's web editor (Apache-2.0, https://github.com/jgraph/drawio) served
# from the Next.js app's public/drawio. Run from the repository root:
#   docker build -f deploy/diagrams.Dockerfile -t synergy/diagrams .
ARG DRAWIO_REF=v29.7.12

FROM alpine:3.22 AS engine
ARG DRAWIO_REF
RUN apk add --no-cache git
# Only the web app folder: the repository's history and Java sources are large.
# Retried: a dropped connection mid-clone shouldn't fail the whole build.
RUN for i in 1 2 3 4; do \
      git clone -q --depth 1 --branch ${DRAWIO_REF} --filter=blob:none --sparse https://github.com/jgraph/drawio.git /drawio \
      && git -C /drawio sparse-checkout set --no-cone /src/main/webapp/ /LICENSE /README.md && exit 0; \
      rm -rf /drawio; echo "clone failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done; exit 1
COPY apps/diagrams/engine /engine
RUN sed -i 's/\r$//' /engine/*.sh && sh /engine/install.sh /drawio /out/drawio

FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ENV NEXT_TELEMETRY_DISABLED=1
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
COPY apps/photo/package.json apps/photo/
COPY apps/sites/package.json apps/sites/
COPY apps/stream/package.json apps/stream/
COPY apps/todo/package.json apps/todo/
COPY apps/phone/package.json apps/phone/
COPY apps/trust/package.json apps/trust/
COPY apps/whiteboard/package.json apps/whiteboard/
COPY apps/groups/package.json apps/groups/
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/diagrams --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/diagrams apps/diagrams
COPY --from=engine /out/drawio apps/diagrams/public/drawio
RUN npm run build --workspace apps/diagrams
ENV NODE_ENV=production
WORKDIR /repo/apps/diagrams
CMD ["npm", "run", "start"]
