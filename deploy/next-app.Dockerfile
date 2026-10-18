# Builds a Next.js suite app (admin, base, builder, bookings, commerce, contacts, crm, desk, drive, engage, hr, insights, loop, mail, meet, office, ops, phone, groups, planner, projects, contracts, status, field, search, todo, trust, whiteboard)
# or add-on (campaigns, law; pass APP_DIR=addons/<name>). Run from the repository root:
#   docker build -f deploy/next-app.Dockerfile --build-arg APP=office -t synergy/office .
ARG APP
ARG APP_DIR=apps/${APP}

FROM node:22-slim
# Extra Debian packages an app needs at run time (Phone: espeak-ng for spoken voicemail greetings).
ARG APT_PACKAGES=""
RUN if [ -n "$APT_PACKAGES" ]; then apt-get update && apt-get install -y --no-install-recommends $APT_PACKAGES && rm -rf /var/lib/apt/lists/*; fi
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
ARG APP
ARG APP_DIR
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
COPY apps/field/package.json apps/field/
COPY apps/contracts/package.json apps/contracts/
COPY apps/status/package.json apps/status/
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
COPY addons/law/package.json addons/law/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace ${APP_DIR} --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY ${APP_DIR} ${APP_DIR}
# Public URLs the browser code needs are baked in at build time.
ARG NEXT_PUBLIC_COLLAB_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
RUN npm run build --workspace ${APP_DIR}
ENV NODE_ENV=production
WORKDIR /repo/${APP_DIR}
CMD ["npm", "run", "start"]
