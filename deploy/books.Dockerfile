# Builds Synergy Books (NestJS API + the Vite web app it serves). Run from the repository root:
#   docker build -f deploy/books.Dockerfile -t synergy/books .
FROM node:22-slim
ENV npm_config_fetch_retries=6 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=180000 npm_config_fetch_timeout=900000
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# npm needs every workspace manifest to validate the lockfile, even the ones it won't install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/books/api/package.json apps/books/api/
COPY apps/books/web/package.json apps/books/web/
COPY apps/base/package.json apps/base/
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
COPY apps/hr/package.json apps/hr/
COPY addons/portal/package.json addons/portal/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --workspace apps/books/api --workspace apps/books/web --workspace packages/shell --workspace packages/search --include-workspace-root \
 && npm run build:packages
COPY apps/books apps/books
RUN npm run build --workspace apps/books/web && npm run build --workspace apps/books/api
ENV NODE_ENV=production
WORKDIR /repo/apps/books/api
# Apply pending database migrations, then serve the API and the web app on one port.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
