FROM node:20-bookworm-slim

WORKDIR /app

# openssl: required by Prisma. The cairo/pango/jpeg libs are for `canvas`, a transitive dep of
# pdfjs/react-pdf. We never import canvas (next.config externalises it), but npm installs it and it
# links against these at load time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --legacy-peer-deps: canvas@3 vs jest-environment-jsdom's peer on canvas@2 (dev-only conflict).
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Apply migrations before serving. The migration history was repaired, so `migrate deploy` alone now
# produces a schema the app can actually run against (it previously did not).
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start -- -p 3000"]
