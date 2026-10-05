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
| Phase 12 — Stats, rapports, livre d'or (critères M/N) : KPIs événement complets (invités, RSVP + perspectives, présents, invitations, tables, livre d'or), graphiques recharts (évolution RSVP cumulative, arrivées/heure, présence/catégorie, occupation tables), rapports exportables × 8 types × CSV/XLSX/PDF (générés à la demande, rien de persistant), livre d'or : modération publié/masqué/rejeté + export + page stats dédiée | ✅ |
| Phase 13 — Studio IA (CDC §18) : provider IA **mock déterministe** (palettes/mises en page + textes assemblés, même entrée ⇒ même sortie ; échec simulé `#fail` testable), `POST /api/ai/generate` (design → proposition `isAiGenerated` ouvrable dans l'éditeur ; texte → copy), **cycle de crédits complet** : quota → réservation `AiUsage(pending)` → exécution → `success` \| `failed` + remboursement intégral (502), `GET /api/ai/usage` (historique paginé + total mensuel coût/remboursé), dialog IA sur /designs (badge « Démo », onglet historique) | ✅ |
| Phase 14 — Super admin (complet §51) : panneau `/admin` (11 pages) sous garde `isSuperAdmin` (API 403 + écran « Accès réservé ») : dashboard KPIs plateforme, utilisateurs (recherche, rôle super admin, suppression protégée), organisations (activation, suppression protégée si sub active), événements (statut, suppression), abonnements & paiements (filtres), **plans CRUD** (création/édition limites+features+prix — quotas appliqués immédiatement — archivage), templates plateforme (CRUD, archivage si référencé, vedette/premium), **crédits IA** (ajustement admin + historique org), journal d'activité (filtres action/org/date), analytics 6 mois (croissance, revenus, crédits IA, top orgs) | ✅ |
| Phase 15 — Finitions : docs (`API.md`, `OFFLINE_SCANNER.md`, `DEPLOYMENT.md`), `.env.example` final, accessibilité des dialogs (Échap, `role="dialog"`, aria), cache dashboard admin (TTL 60 s), skeletons de chargement admin, dark mode, corrections polishes, traçabilité A–P ci-dessous | ✅ |

> Périmètre MVP et réserves signalées (CDC §76) : [`docs/ARCHITECTURE.md` §13](docs/ARCHITECTURE.md).

## Documentation

- **Architecture & plan d'implémentation** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  (stack, multi-tenancy, schéma BDD, API, env vars, intégrations, phases, tests, réserves §13)
- **Référence API** — [docs/API.md](docs/API.md) (~92 routes, authentification, contrats, erreurs)
- **Scanner hors ligne** — [docs/OFFLINE_SCANNER.md](docs/OFFLINE_SCANNER.md)
  (protocole check-in/sync : clientUuid, journal local, replay batch)
- **Déploiement** — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
  (PostgreSQL, variables d'environnement, providers réels, checklist go-live)

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS + shadcn/ui · Prisma 6
(SQLite en sandbox → PostgreSQL en prod) · next-intl (FR/EN) · zod · vitest + Playwright

Intégrations externes derrière des interfaces (`EmailProvider`, `SmsProvider`,
`WhatsAppProvider`, `PaymentProvider`, `AiProvider`, `StorageProvider`, `PushProvider`) avec
mode mock clairement identifié en développement (badge « Démo », outbox).

## Installation & développement

Prérequis : Node.js ≥ 20, npm.

```bash
git clone <repo> && cd eventflow
npm install
cp .env.example .env        # valeurs dev prêtes à l'emploi (voir .env.example pour le mode prod)
npx prisma generate
npx prisma db push          # ou : npx prisma migrate dev --name init
npx prisma seed             # super admin dev, plans, templates, flags
npm run dev                 # http://localhost:3000 (binding 0.0.0.0 pour la preview)
```

Compte super admin (seed, **dev uniquement**) : `admin@eventflow.app` / `EventFlow#2026!`

Notes :

- **Dev sandbox** : SQLite (`prisma/dev.db`), tous les providers en mode mock identifié
  (e-mail/SMS/WhatsApp → outbox `/outbox`, paiement → webhook signé simulé, IA → provider
  déterministe, stockage → disque local).
- **Réseau restreint** : si `binaries.prisma.sh` est injoignable, les binaires Prisma peuvent
  être servis via `PRISMA_ENGINES_MIRROR` (+ `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`) —
  voir [ARCHITECTURE §13.47](docs/ARCHITECTURE.md).

## Tests

```bash
npm run lint                # ESLint
npx tsc --noEmit            # typage strict
npx vitest run              # unit + intégration (181 tests)
```

- **Unit** : quota, check-in (valide/déjà utilisé/invalide/multi-entrée/idempotence),
  tokens, isolement tenant, machine d'états abonnement, templates de notification, stats.
- **Intégration** (route handlers complets) : auth, saas (critère P), onboarding, events
  (critère C), guests (E/F), designs (D), invitations (G/H), check-in (I/K/L),
  communications, billing (O), statistics (M/N), IA, admin.
- **Smoke HTTP** : session réelle — login → APIs → pages (11 pages admin 200). L'e2e
  navigateur Playwright (parcours A→F) est branché pour le go-live ; voir
  [ARCHITECTURE §13.46](docs/ARCHITECTURE.md).

## Traçabilité CDC §74 — critères d'acceptation A–P

Chaque critère est couvert par sa phase d'implémentation et ses tests
(`tests/integration/`, `tests/unit/`) ; vérification manuelle décrite dans le
`Exit criteria` de [ARCHITECTURE §12](docs/ARCHITECTURE.md).

| Critère | Périmètre | Phase | Vérification |
|---|---|---|---|
| **A** | Compte : inscription, vérification e-mail, connexion, sessions par appareil, reset mdp | 2 | `unit/auth.test.ts`, `integration/onboarding.test.ts` |
| **B** | Workspace & onboarding : org, 5 rôles, premier événement créé < 5 min | 4 | `integration/onboarding.test.ts` |
| **C** | Page publique de l'événement `/e/[slug]` (sections optionnelles on/off) | 5 | `integration/events.test.ts` |
| **D** | Studio design : templates, éditeur visuel, médiathèque, autosave | 7 | `integration/designs.test.ts` |
| **E** | Import invités CSV/Excel (mapping, doublons, lignes invalides, quota toute ou rien) | 6 | `integration/guests.test.ts` |
| **F** | Exports : invités CSV, design PNG/PDF, rapports CSV/XLSX/PDF | 6/7/12 | `guests`, `designs`, `statistics` |
| **G** | Invitations en lot + QR unique par invité (tokens opaques non devinables) | 8 | `integration/invitations.test.ts` |
| **H** | RSVP : page `/i/[token]`, statuts, accompagnants, questions, anti-énumération | 8 | `integration/invitations.test.ts` |
| **I** | Check-in : VALIDE / DÉJÀ UTILISÉ / INVALIDE, idempotence `clientUuid` | 9 | `integration/checkin.test.ts` |
| **J** | Contrôle d'accès : agents, points d'entrée, permissions, recherche invité | 9 | `integration/checkin.test.ts` |
| **K** | Scanner hors ligne : pré-sync, journal local, replay batch | 9 | `integration/checkin.test.ts` + `OFFLINE_SCANNER.md` |
| **L** | Multi-entrée & anti double-entrée (`allow_multiple_entries`) | 9 | `integration/checkin.test.ts` |
| **M** | Statistiques & rapports (KPIs complets, 8 types × 3 formats) | 12 | `integration/statistics.test.ts` |
| **N** | Livre d'or : dépôt public, modération, export, stats | 5/12 | `statistics.test.ts`, `events.test.ts` |
| **O** | Paiement : webhook signé (HMAC) + idempotent, jamais via navigateur | 11 | `integration/billing.test.ts` |
| **P** | Multi-tenant : isolement cross-tenant (403/404), quotas réels | 3 | `integration/saas.test.ts`, `unit/tenant.test.ts` |

## Déploiement

PostgreSQL, variables d'environnement de production, branchement des providers réels
(Stripe, Meta WhatsApp, SMTP, IA), cache multi-instance (Redis) et checklist go-live :
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
