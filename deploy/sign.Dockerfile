# Builds the Sign add-on (addons/sign). It stays on Next.js 14 / React 18 with its own lockfile,
# so it isn't a root workspace; it uses the suite's packages (identity, shell, search, compliance,
# ai) through file: links, built here first. Run from the repository root:
#   docker build -f deploy/sign.Dockerfile -t synergy/sign .
FROM node:22-bookworm-slim
# openssl: Prisma. The cairo/pango/jpeg libraries: `canvas`, which pdf.js pulls in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# npm needs every workspace manifest to validate the root lockfile, even the ones it won't install.
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
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace packages/shell --workspace packages/search --workspace packages/identity --workspace packages/compliance --workspace packages/ai --include-workspace-root \
 && npm run build:packages
# --legacy-peer-deps: canvas@3 vs jest-environment-jsdom's peer on canvas@2 (dev-only conflict).
COPY addons/sign/package.json addons/sign/package-lock.json addons/sign/
RUN --mount=type=cache,target=/root/.npm cd addons/sign && npm ci --legacy-peer-deps --no-audit --no-fund
COPY addons/sign addons/sign
RUN cd addons/sign && npx prisma generate && npm run build
ENV NODE_ENV=production
WORKDIR /repo/addons/sign
EXPOSE 3300
# Brings the database up to date (creating it on first start), then serves.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
