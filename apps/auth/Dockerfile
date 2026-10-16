# SynergyAuth (Next.js 15 IdP) — containerized (no host Node needed).
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
EXPOSE 3500
CMD ["npm", "run", "start"]
