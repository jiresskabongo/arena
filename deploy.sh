#!/usr/bin/env bash
# EventFlow — déploiement VPS / serveur local (Docker Compose)
#
# Usage :
#   ./deploy.sh                  # premier déploiement (génère .env + clés)
#   APP_URL=https://app.mondomaine.cd ./deploy.sh   # ensuite
#
# Prérequis : docker + docker compose installés sur la machine.
set -euo pipefail
cd "$(dirname "$0")"

APP_URL="${APP_URL:-}"
PORT="${APP_PORT:-3000}"

if [ ! -f .env ]; then
  echo "→ Premier déploiement : génération de .env"
  cp .env.example .env
  SK="$(openssl rand -hex 32)"
  WH="$(openssl rand -hex 32)"
  PG="$(openssl rand -hex 16)"
  # Passe en production + remplit les clés aléatoires
  sed -i.bak "s/^NODE_ENV=.*/NODE_ENV=production/" .env
  sed -i.bak "s/^SECRET_KEY=.*/SECRET_KEY=$SK/" .env
  sed -i.bak "s/^MOCK_WEBHOOK_SECRET=.*/MOCK_WEBHOOK_SECRET=$WH/" .env
  sed -i.bak "s|^# DATABASE_URL=.*|DATABASE_URL=postgresql://eventflow:$PG@127.0.0.1:5432/eventflow|" .env
  echo "POSTGRES_PASSWORD=$PG" >> .env
  [ -n "$APP_URL" ] && sed -i.bak "s|^APP_URL=.*|APP_URL=$APP_URL|" .env
  rm -f .env.bak
  echo "  ✔ .env créé (SECRET_KEY, MOCK_WEBHOOK_SECRET, POSTGRES_PASSWORD aléatoires)"
fi

# Vérifications avant build
grep -q "^SECRET_KEY=change-me" .env && { echo "❌ SECRET_KEY non générée (change-me)"; exit 1; }
grep -q "^POSTGRES_PASSWORD=" .env  || { echo "❌ POSTGRES_PASSWORD manquant dans .env"; exit 1; }
grep -q "^APP_URL=http://localhost" .env && echo "⚠ APP_URL=localhost — OK pour un test local, à remplacer pour un accès public"

echo "→ Build de l'image + démarrage de la stack (app + PostgreSQL 16)…"
docker compose up -d --build

echo "→ Santé de l'application (jusqu'à 90 s)…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    echo ""
    echo "✅ EventFlow est en ligne : http://127.0.0.1:$PORT"
    echo "   Health : $(curl -fsS "http://127.0.0.1:$PORT/api/health")"
    echo ""
    echo "Prochaines étapes :"
    echo "  • Reverse proxy TLS devant (cf. Caddyfile.example) pour l'accès public"
    echo "  • Super admin : admin@eventflow.app — CHANGEZ son mot de passe (SEED_SUPERADMIN_PASSWORD)"
    echo "  • Providers en mock identifié (badge Démo) tant que non configurés"
    exit 0
  fi
  sleep 3
done

echo "❌ L'application n'a pas répondu — derniers logs :"
docker compose logs --tail=50 app
exit 1
