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
