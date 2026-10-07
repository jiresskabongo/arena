# EventFlow — Déploiement & exploitation

Guide de mise en production (sandbox = SQLite ; production = PostgreSQL).

## 1. Prérequis

- **Node.js ≥ 20** (LTS recommandé)
- **PostgreSQL 14+** (la sandbox utilise SQLite — le schéma est PostgreSQL-ready,
  aucune dépendance à SQLite dans le code : les requêtes ne font pas usage de
  `mode: insensitive`, qui est PostgreSQL-only)
- Build : `next build` (Next.js 15, output node-server)

## 2. Variables d'environnement

Voir `.env.example` (exhaustif). Indispensables en prod :

| Variable | Rôle | Remarque prod |
|---|---|---|
| `DATABASE_URL` | Connexion BDD | `postgresql://user:pass@host:5432/eventflow` |
| `SECRET_KEY` | Signature sessions / URLs média (64 hex) | `openssl rand -hex 32` |
| `SESSION_TTL_DAYS` | Durée de session | 30 par défaut |
| `APP_URL` | URL publique | `https://app.mondomaine.cd` |
| `MOCK_WEBHOOK_SECRET` | HMAC webhook paiement mock | En prod : clé de webhook réelle du provider |

### Providers (mock vs réel)

Chaque provider a un mode **mock identifié** (badge « Démo » + outbox) — c'est le
comportement par défaut. Pour brancher un vrai provider :

| Domaine | Variable | Valeurs |
|---|---|---|
| E-mail | `EMAIL_PROVIDER` | `mock` (outbox `MessageLog`) ou SMTP réel (`SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`) |
| SMS | `SMS_PROVIDER` | `mock` ou provider réel (`SMS_API_KEY`, `SMS_SENDER_ID`) |
| WhatsApp | `WHATSAPP_PROVIDER` | `mock` ou **API officielle uniquement** (`WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — CDC : jamais d'API non officielle |
| Paiement | `PAYMENT_PROVIDER` | `mock` (checkout + webhook signé) ou réel (`PAYMENT_PUBLIC_KEY/SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`) |
| IA | `AI_PROVIDER` | `mock` (compositions déterministes) ou LLM/image réel (`AI_API_KEY`) |
| Stockage | `STORAGE_PROVIDER` | `local` (`storage/`) ou S3 (`S3_BUCKET/REGION/ACCESS_KEY/SECRET_KEY`) |

**Règle** : un provider non configuré doit tourner en mock **clairement identifié**
— jamais d'intégration factice silencieuse.

## 3. Build & lancement

### 3.1 Docker — voie rapide (recommandée)

Le dépôt contient un `Dockerfile` (multi-stage, `node:20-bookworm-slim`), un
`docker-compose.yml` (app + PostgreSQL 16) et un `entrypoint.sh` :

```bash
# 1. Générer les clés
export SECRET_KEY=$(openssl rand -hex 32)
export MOCK_WEBHOOK_SECRET=$(openssl rand -hex 32)
export APP_URL="https://ton-domaine.cd"
export POSTGRES_PASSWORD="<mot-de-passe-bdd>"

# 2. Lancer la stack (build image + Postgres + app)
docker compose up -d --build

# 3. Vérifier
curl -fsS "$APP_URL/api/health"   # {"status":"ok",...}
```

- L'image bascule le schéma sur **PostgreSQL** (build arg `DB_PROVIDER`, défaut
  `postgresql`) via `scripts/switch-db-provider.mjs` — le repo committe le
  provider sqlite (réalité du sandbox de développement).
- Entrypoint : `prisma db push --skip-generate` → seed idempotent
  (`SEED_ON_BOOT`, défaut `true`) → `next start` sur `0.0.0.0:$PORT`.
- **Réserve (MVP)** : le conteneur applique le schéma via `prisma db push`
  plutôt que `prisma migrate deploy`, car les migrations commitées sont
  spécifiques SQLite. Sur une base Postgres fraîche c'est équivalent ; pour
  l'hygiène de migration ensuite : générer une migration initiale Postgres
  (`prisma migrate dev --name init` après bascule du provider) et basculer
  l'entrypoint sur `prisma migrate deploy`.
- Volumes : `pgdata` (BDD) et `storage` (médias/exports) — les sauvegarder
  (§8). Les providers restent en **mock identifié** tant que leurs variables
  ne sont pas définies (§2).

### 3.2 Sans Docker (serveur Node direct)

```bash
npm ci
cp .env.example .env   # remplir les valeurs
npx prisma migrate deploy      # migrations (ou `prisma migrate dev` en dev)
npx prisma seed              # plans, types d'événements, templates, super admin
npm run build
NODE_ENV=production npm start
```

Le serveur doit écouter sur **0.0.0.0** (reverse proxy devant : Nginx/Traefik/Caddy).
`APP_URL` doit matcher le domaine public (les URLs signées et les liens d'invitation
en dépendent).

## 4. Webhooks (paiement)

- **MVP/mock** : `POST /api/webhooks/mock` avec header `x-mock-signature`
  (HMAC-SHA256 du corps brut, clé `MOCK_WEBHOOK_SECRET`). L'UI (mode démo) déclenche
  ce webhook elle-même — mais **seul le webhook signé change le statut** d'un
  paiement (jamais la réponse navigateur).
- **Prod** : brancher le webhook réel du provider sur cette même route (adapter le
  vérificateur de signature). L'**idempotence** est garantie par `WebhookEvent`
  (clé naturelle provider+eventId) : une re-livraison ne double ni le paiement ni
  la facturation.

## 5. Multi-tenancy & sécurité (rappels)

- Le **tenant est dérivé de la session uniquement** ; `organization_id` envoyé par
  le client est ignoré. Chaque requête serveur passe par `requireTenant()` +
  `tenantWhere(orgId)` (critère P : isolation testée cross-tenant 404).
- **Permissions** vérifiées côté serveur (`can(role, permission)`), jamais côté
  client. Super admin = drapeau `isSuperAdmin` (hors tenant), routes `/api/admin/*`.
- **URLs médias signées** (HMAC, TTL) — jamais de `/media/<id>` direct.
- **Rate limiting** in-memory par IP : `RATE_LIMIT_AUTH_PER_MIN`,
  `RATE_LIMIT_PUBLIC_RSVP_PER_MIN`, `RATE_LIMIT_SCAN_PER_MIN`. (En prod multi-
  instances : passer à un store partagé — réserve §13.)
- **Anti-énumération** : login/forgot-password répondent de façon identique
  utilisateur inexistant / mauvais mot de passe.

## 6. Stockage & exports temporaires

- `storage/` (en dehors de Git) : `media/` (uploads, `.gitignore`) et `exports/`
  (rapports/exports générés à la demande). **Purge** : exports après
  `EXPORT_RETENTION_HOURS` (24 h par défaut) — l'export est un fichier temporaire,
  rien n'est persisté comme « rapport stocké ».
- Quota stockage vérifié à l'upload (`storageMb` du plan), taille réelle du fichier
  (pas la taille déclarée).

## 7. Surveillance & journal

- `GET /api/health` : `{ status, db }` — à brancher sur le monitoring.
- `ActivityLog` : journal d'audit (auth, scans, billing, admin). Consultable via
  le panneau super admin (`/admin/logs`, filtres action/org/date).
- Logs applicatifs : `LOG_LEVEL` (info par défaut), stdout (structuré).

## 8. Sauvegardes & ops

- **BDD** : dump PostgreSQL régulier (journal WAL recommandé pour le scan).
- **storage/** : synchroniser vers S3 ou sauvegarde objet (média + exports).
- **Clés** : `SECRET_KEY`, `MOCK_WEBHOOK_SECRET` à tourner en cas d'incident
  (rotation des sessions signées).
- **Migrations** : toujours `prisma migrate deploy` avant un déploiement d'images
  (le schéma évolue entre phases).

## 9. Rollback

Les migrations sont réversibles via `prisma migrate reset` (dev) — en prod,
privilégier des migrations **additives** (colonne nullable / table nouvelle) pour
pouvoir rebrousser chemin sans perdre de données. Le code applicatif est versionné
par commit ; un rollback d'image s'accompagne d'un rollback du schéma si nécessaire.

## 10. Check-list go-live

- [ ] `DATABASE_URL` PostgreSQL + `prisma migrate deploy` exécutés
- [ ] `SECRET_KEY` (64 hex) + `MOCK_WEBHOOK_SECRET` générés
- [ ] `APP_URL` = domaine public, reverse proxy TLS
- [ ] `npm run build` + `npm start` sur 0.0.0.0
- [ ] `GET /api/health` vert dans le monitoring
- [ ] Webhook paiement branché + testé (re-livraison idempotente)
- [ ] Providers réels configurés **ou** mock identifié (badge Démo)
- [ ] Super admin créé (seed) + mot de passe changé
- [ ] Sauvegarde BDD + storage/ planifiée

## 11. Déployer en 5 minutes (par cible)

Le repo contient tout ce qu'il faut pour un déploiement quasi 1-clic. Choisis
une cible :

### A. Render (le plus simple — Blueprint)
1. Compte Render → **New → Blueprint** → sélectionner le repo (branche `arena/01a1031a-arena` ou `main`).
2. Render lit `render.yaml` → provisionne **l'app + un PostgreSQL 16** + génère `SECRET_KEY` / `MOCK_WEBHOOK_SECRET`.
3. Après le 1er deploy : **Settings → Environment → `APP_URL`** = l'URL publique du service (obligatoire pour les liens d'invitation/QR).
4. Terminé. Le healthcheck pointe sur `/api/health`.

### B. Railway (Docker natif)
1. Compte Railway → **New Project → Deploy from GitHub repo**.
2. Railway utilise le `Dockerfile` (config dans `railway.json`).
3. **Variables** à définir dans le service : `SECRET_KEY`, `MOCK_WEBHOOK_SECRET`, `APP_URL`.
4. **Plugin** : + → **PostgreSQL** → Railway génère `DATABASE_URL` automatiquement.
5. **Domains** (optionnel) : ajouter un domaine.

### C. Fly.io (machines + Postgres managé)
```bash
fly launch --no-deploy            # utilise fly.toml (région cdg)
fly postgres create eventflow-db
fly postgres credentials eventflow-db   # → DATABASE_URL
fly secrets set DATABASE_URL="..." SECRET_KEY="$(openssl rand -hex 32)" \
  MOCK_WEBHOOK_SECRET="$(openssl rand -hex 32)" APP_URL="https://app.mondomaine.cd"
fly deploy
```

### D. VPS / serveur dédié (Docker Compose + Caddy)
```bash
git clone <repo> && cd arena
APP_URL=https://app.mondomaine.cd ./deploy.sh   # build + Postgres + santé
```
Puis pour l'accès public sécurisé : `Caddyfile.example` (TLS Let's Encrypt
automatique) — le guide est dans le fichier.

### Ce qui est commun à toutes les cibles
- **`APP_URL`** = domaine public exact (les liens d'invitation, QR et URLs
  médias signées en dépendent) — c'est la variable la plus importante.
- **Providers en mock** (badge « Démo » + outbox) tant que leurs clés ne sont
  pas définies — comportement conforme CDC, jamais d'intégration factice.
- **Super admin** créé par le seed → **changer son mot de passe** après le
  premier login (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` en dev).
- **Check-list go-live** §10 à dérouler avant d'annoncer la mise en ligne.

## 12. CI (GitHub Actions)

`.github/workflows/ci.yml` tourne à chaque push/PR : install → `prisma
generate` → base SQLite de test + seed → **lint** → **tests (vitest)** →
**build production**. Un vert CI = le code est déployable (le build prod est
exactement l'artefact servi par le `Dockerfile`).
