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
| Phase 4 — Dashboard & onboarding (KPIs réels, assistant 7 étapes, création événement minimale, équipe & invitations) | ✅ |
| Phase 5 — Événements : CRUD complet, machine à états, duplication, personnes, page publique /e/[slug], livre d'or | ✅ |
| Phase 6 — Invités : CRUD, recherche/filtres/tris, pagination, tables, import CSV/Excel (5 étapes), export CSV | ✅ |
| Phase 7 — Studio design : bibliothèque de 19 templates (dont 8 styles Save the Date), éditeur visuel (texte/formes/icônes/images/QR, undo/redo, autosave 1 s), médiathèque (compression, vignettes, quota), export PNG/PDF | ✅ |
| Phase 8 — Invitations, QR & RSVP : génération en lot (1 invitation + token opaque + QR unique par invité), page publique /i/[token] mobile-first, RSVP (confirmé / peut-être / décliné, accompagnants, questions personnalisées), stats temps réel, anti-énumération, révocation | ✅ |
| Phase 9 — Contrôle d'accès : agents de scan (token opaque, points d'entrée, permissions), app scanner mobile /scanner/[token] (caméra BarcodeDetector, saisie manuelle), check-in transactionnel idempotent (clientUuid), anti-réutilisation, multi-entrée, mode hors ligne (pré-sync + journal local + replay batch), historique paginé | ✅ |
| Phase 10 — Communications & rappels (CDC §26, §30) : templates `{{…}}` (plateforme + surcharge org), campagnes invitation/confirmation/rappel/changement/custom × e-mail/SMS/WhatsApp (audience tous/RSVP en attente/confirmés/déclinés/sélection), **outbox démo** (providers mock identifiés, badge « Démo »), **quotas e-mail/SMS mensuels réels** (refus avant envoi si dépassés), automatisations (rsvp_confirmed → confirmation+QR, event_48h/24h → rappels anti-relance 24 h), invitation → `sent` à l'envoi | ✅ |
| Phase 11 — Billing (CDC §60, critère O) : checkout **mock identifié** (badge « Démo »), paiement simulé → **webhook signé (HMAC) + idempotent** (double livraison = 1 effet), statut d'abonnement modifié uniquement par le webhook, factures PDF, annulation fin de période / réactivation, renouvellement lazy, devises USD/CDF/EUR (CDF sans centimes), post-trial (verrouillage des écritures, données conservées), plans modifiables par super admin | ✅ |
| Phases 12 → 15 | ⏳ |

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
