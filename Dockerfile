# EventFlow — image de production (Next.js 15 + Prisma)
#
# Build :  docker build -t eventflow .
#          (build arg DB_PROVIDER, défaut postgresql ; sqlite possible)
# Run   :  docker run -p 3000:3000 -e DATABASE_URL=... -e SECRET_KEY=... eventflow
#
# L'entrypoint applique le schéma (`prisma db push` — MVP, voir docs/DEPLOYMENT.md
# §3.1 sur la réserve migration), seed idempotent (SEED_ON_BOOT), puis `next start`.

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dépendances (npm ci, dev deps incluses : tsx pour le seed) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM base AS builder
ARG DB_PROVIDER=postgresql
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le repo committe le provider sqlite (sandbox) ; l'image cible par défaut Postgres.
RUN node scripts/switch-db-provider.mjs "$DB_PROVIDER"
RUN npx prisma generate && npm run build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
RUN useradd -m appuser && mkdir -p /app/storage && chown -R appuser:appuser /app
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/.next ./.next
COPY --from=builder --chown=appuser:appuser /app/public ./public
COPY --from=builder --chown=appuser:appuser /app/package.json ./package.json
COPY --from=builder --chown=appuser:appuser /app/prisma ./prisma
COPY --from=builder --chown=appuser:appuser /app/scripts ./scripts
COPY --from=builder --chown=appuser:appuser /app/entrypoint.sh ./entrypoint.sh
USER appuser
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
