# Builds any of the Express + Vite suite apps (calendar, chat, forms, notes, sites)
# and add-ons (portal; pass APP_DIR=addons/<name>).
# Run from the repository root so the shared packages are in the build context:
#   docker build -f deploy/express-app.Dockerfile --build-arg APP=chat -t synergy/chat .
#   docker build -f deploy/express-app.Dockerfile --build-arg APP=portal --build-arg APP_DIR=addons/portal -t synergy/portal .
ARG APP
ARG APP_DIR=apps/${APP}

FROM node:22-alpine AS web
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ARG APP
ARG APP_DIR
WORKDIR /src/web
COPY ${APP_DIR}/web/package.json ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund
COPY ${APP_DIR}/web/ .
RUN npm run build

FROM node:22-alpine AS server
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ARG APP
ARG APP_DIR
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
COPY apps/flow/package.json apps/flow/
COPY apps/forms/package.json apps/forms/
COPY apps/mail/package.json apps/mail/
COPY apps/meet/package.json apps/meet/
COPY apps/phone/package.json apps/phone/
COPY apps/notes/package.json apps/notes/
COPY apps/office/package.json apps/office/
COPY apps/planner/package.json apps/planner/
COPY apps/photo/package.json apps/photo/
COPY apps/sites/package.json apps/sites/
COPY apps/stream/package.json apps/stream/
COPY apps/trust/package.json apps/trust/
COPY apps/whiteboard/package.json apps/whiteboard/
COPY apps/hr/package.json apps/hr/
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace ${APP_DIR} --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages \
 && npm prune --omit=dev --workspace ${APP_DIR} --workspace packages/shell --workspace packages/search --include-workspace-root
COPY ${APP_DIR}/server ${APP_DIR}/server

FROM node:22-alpine
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ARG APP
ARG APP_DIR
ENV NODE_ENV=production APP=${APP}
WORKDIR /repo
COPY --from=server /repo /repo
COPY --from=web /src/web/dist ${APP_DIR}/web/dist
WORKDIR /repo/${APP_DIR}
CMD ["node", "server/index.js"]
