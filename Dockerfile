# Atlas — productie-image (Next.js standalone)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# pdftotext (poppler) voor orderbevestigingen in PDF
RUN apk add --no-cache poppler-utils && addgroup -S atlas && adduser -S atlas -G atlas
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migraties draaien bij het starten (idempotent)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
USER atlas
EXPOSE 3000
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && node server.js"]
