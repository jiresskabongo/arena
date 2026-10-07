#!/bin/sh
# Entry point production : schéma → seed (idempotent) → Next.js
set -e

echo "→ Application du schéma (prisma db push)…"
npx prisma db push --skip-generate

if [ "$SEED_ON_BOOT" != "false" ]; then
  echo "→ Seed (idempotent)…"
  npx prisma db seed
fi

PORT="${PORT:-3000}"
echo "→ Démarrage de Next.js sur 0.0.0.0:${PORT}"
exec npx next start -H 0.0.0.0 -p "$PORT"
