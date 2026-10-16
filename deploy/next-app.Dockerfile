# Builds a Next.js suite app (admin, base, contacts, crm, desk, drive, engage, insights, mail, meet, office, planner, search, todo, trust). Run from the repository root:
#   docker build -f deploy/next-app.Dockerfile --build-arg APP=office -t synergy/office .
ARG APP

FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ARG APP
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# npm needs every workspace manifest to validate the lockfile, even the ones it won't install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/books/api/package.json apps/books/api/
COPY apps/books/web/package.json apps/books/web/
COPY apps/admin/package.json apps/admin/
COPY apps/base/package.json apps/base/
COPY apps/cad/package.json apps/cad/
COPY apps/calendar/package.json apps/calendar/
COPY apps/chat/package.json apps/chat/
COPY apps/contacts/package.json apps/contacts/
COPY apps/crm/package.json apps/crm/
COPY apps/desk/package.json apps/desk/
COPY apps/diagrams/package.json apps/diagrams/
COPY apps/drive/package.json apps/drive/
COPY apps/engage/package.json apps/engage/
COPY apps/forms/package.json apps/forms/
COPY apps/insights/package.json apps/insights/
COPY apps/mail/package.json apps/mail/
COPY apps/meet/package.json apps/meet/
COPY apps/notes/package.json apps/notes/
COPY apps/office/package.json apps/office/
COPY apps/planner/package.json apps/planner/
COPY apps/photo/package.json apps/photo/
COPY apps/search/package.json apps/search/
COPY apps/sites/package.json apps/sites/
COPY apps/todo/package.json apps/todo/
COPY apps/trust/package.json apps/trust/
COPY addons/people/package.json addons/people/
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/${APP} --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/${APP} apps/${APP}
# Public URLs the browser code needs are baked in at build time.
ARG NEXT_PUBLIC_COLLAB_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
RUN npm run build --workspace apps/${APP}
ENV NODE_ENV=production
WORKDIR /repo/apps/${APP}
CMD ["npm", "run", "start"]
