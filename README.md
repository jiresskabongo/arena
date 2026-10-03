# EventFlow SaaS

> Créez des invitations élégantes, invitez vos participants et gérez votre événement de A à Z
> depuis une seule plateforme.

SaaS multi-tenant de création d'invitations et de gestion d'événements : studio de création
(Save the Date, invitations, affiches, badges, cartes d'accès), invités, QR unique par invité,
RSVP, contrôle d'accès par scan (mode hors ligne inclus), statistiques, rapport, abonnement &
paiement, IA (crédits), communications (e-mail / SMS / WhatsApp), super admin.

## État du projet

| Phase | Statut |
|---|---|
| Analyse du cahier des charges | ✅ |
| Architecture technique & plan d'implémentation | ✅ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Phase 0 — Scaffolding (Next.js 15, TS, Tailwind v4, i18n FR/EN, design system, landing) | ✅ |
| Phase 1 — Base de données (38 modèles, migration `init`, seeders) | ✅ |
| Phase 2 — Authentification (register/login/logout, Argon2id, sessions par appareil, vérif. e-mail, reset, rate limiting) | ✅ |
| Phase 3 — Multi-tenancy & SaaS (contexte tenant, matrice 5 rôles, essai gratuit, quotas réels, page Plan & quotas) | ✅ |
| Phases 4 → 15 | ⏳ |

## Documentation

- **Architecture & plan d'implémentation** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  (stack, multi-tenancy, schéma BDD, API, env vars, intégrations, phases, tests, réserves)
- À venir : `docs/API.md`, `docs/OFFLINE_SCANNER.md`, `docs/DEPLOYMENT.md`

## Stack (décidée)

Next.js 15 (App Router) · TypeScript · Tailwind CSS + shadcn/ui · Prisma 6
(SQLite en sandbox → PostgreSQL en prod) · next-intl (FR/EN) · zod · vitest + Playwright

Intégrations externes derrière des interfaces (`EmailProvider`, `SmsProvider`,
`WhatsAppProvider`, `PaymentProvider`, `AiProvider`, `StorageProvider`, `PushProvider`) avec
mode mock clairement identifié en développement.

## Démarrage (dès validation du plan)

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```
