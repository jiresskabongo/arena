# EventFlow — Référence API

Toutes les routes sont sous `/api`. Convention de réponse :

```jsonc
// succès
{ "ok": true, ...données }
// erreur
{ "error": { "code": "snake_case", "message": "Message utilisateur (FR)" } }
```

Codes HTTP courants : `200` OK · `400` validation (`code: validation` + `details[]`) ·
`401` non authentifié · `403` interdit (rôle / quota / `trial_expired` /
`quota_exceeded`) · `404` introuvable (ou **autre tenant** — critère P) ·
`409` état conflictuel (org inactive, déjà utilisée…) · `429` rate limiting ·
`502` provider en échec (IA).

**Multi-tenancy** : le tenant est dérivé de la **session uniquement** ; tout
`organization_id` envoyé par le client est ignoré. Les routes publiques
(invitation, RSVP, livre d'or, scan) s'authentifient par **token** signé.
**Super admin** : routes `/api/admin/*` sous garde `isSuperAdmin` (403 sinon).

Légende : 🔒 = session membre · 🛡 = super admin · 🔑 = token (pas de session) ·
👤 = anonyme.

## Santé

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/health` | 👤 | `{ status: "ok", db: "up" }` |

## Auth & compte

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/auth/register` | 👤 | `{ email, password, firstName, lastName, organizationName, currency?, locale? }` → utilisateur + org + essai + e-mail de bienvenue. Anti-énumération côté `forgot-password`/`login`. |
| POST | `/api/auth/login` | 👤 | `{ email, password }` → cookie session (httpOnly). Rate-limité. |
| POST | `/api/auth/logout` | 🔒 | Révoque la session. |
| POST | `/api/auth/verify-email` | 🔑 | `{ token }` — confirmation e-mail. |
| POST | `/api/auth/forgot-password` | 👤 | `{ email }` — toujours 200 ; lien mock en outbox. |
| POST | `/api/auth/reset-password` | 🔑 | `{ token, password }`. |
| GET/DELETE | `/api/account/sessions[/:id]` | 🔒 | Liste / révocation des sessions actives. |
| POST | `/api/account/change-password` | 🔒 | `{ currentPassword, newPassword }`. |

## Onboarding & organisation

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/onboarding` | 🔒 | Complète l'organisation (adresse, téléphone, devise, fuseau). |
| GET | `/api/organization` | 🔒 | Profil + quotas + souscription. |
| GET | `/api/organization/members` | 🔒 | Membres (rôles). `members:read`. |
| POST | `/api/organization/members` | 🔒 | `POST { email, role }` → invitation e-mail (outbox). `members:invite`. |
| PATCH/DELETE | `/api/organization/members/:id` | 🔒 | Changer rôle / retirer. `members:update` / `members:remove`. |
| GET | `/api/organization/plans` | 🔒 | Catalogue plans + prix (pour l'écran abonnement). |

## Événements

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/events?page&pageSize` | 🔒 | Liste paginée (+ KPIs RSVP). |
| POST | `/api/events` | 🔒 | `{ name, typeCode, date, startTime, timezone, venue?, city?, optionsJson }`. `event:create` + quota events. |
| GET/PATCH/DELETE | `/api/events/:id` | 🔒 | Détail / édition / suppression. `event:update` (suppression `event:delete`). |
| PATCH | `/api/events/:id/status` | 🔒 | `draft → published → archived`. |
| POST | `/api/events/:id/duplicate` | 🔒 | Clone (invités exclus). |
| GET | `/api/events/:id/members` | 🔒 | Membres invités sur l'événement. |
| POST | `/api/events/:id/members` | 🔒 | Ajouter un membre org. `event:update`. |
| PATCH/DELETE | `/api/events/:id/members/:mid` | 🔒 | Rôle événement / retrait. |
| GET/POST | `/api/events/:id/rsvp-questions` | 🔒 | Questions personnalisées RSVP (max 5). |
| GET | `/api/events/:id/automations` | 🔒 | Automatisations (rappel 24h, message confirmation…). |
| POST | `/api/events/:id/automations` | 🔒 | Créer une automatisation. |
| POST | `/api/events/:id/automations/run` | 🔒 | Exécution manuelle (avec garde anti-doublon 24h). |

### Invités (P6)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/events/:id/guests?page&pageSize&q&category&rsvp&presence` | 🔒 | Liste paginée + filtres. |
| POST | `/api/events/:id/guests` | 🔒 | Création (bulk ≤ 50). `guest:create` + quota invités/événement. |
| GET/PATCH/DELETE | `/api/events/:id/guests/:gid` | 🔒 | Détail / édition / suppression. |
| GET | `/api/events/:id/guests/export?format=csv|xlsx` | 🔒 | Export CSV (`;` + BOM) ou XLSX. |
| POST | `/api/events/:id/import/upload` | 🔒 | Upload CSV/XLSX → job d'import (aperçu, détection dupes par téléphone/e-mail). |
| POST | `/api/events/:id/import/confirm` | 🔒 | Confirmation de l'import (mode `add` ou `merge`). |

### Tables

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET/POST | `/api/events/:id/tables` | 🔒 | Liste / création. |
| PATCH/DELETE | `/api/events/:id/tables/:tid` | 🔒 | Édition / suppression (déplace les invités → null). |

### Design (P7)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/designs?page&pageSize&eventId` | 🔒 | Designs de l'org. |
| POST | `/api/designs` | 🔒 | Création (vierge, template, ou IA côté `/api/ai/generate`). `design:create`. |
| GET/PATCH/DELETE | `/api/designs/:id` | 🔒 | Détail / contenu (`background`, `elements` ≤ 200) / suppression. |
| POST | `/api/designs/:id/duplicate` | 🔒 | Duplication. |
| POST | `/api/designs/:id/template` | 🔒 | Enregistrer comme template org. |
| GET | `/api/designs/:id/export?format=png|pdf` | 🔒 | Rendu serveur (sharp/PDFKit), export temporaire 24 h. |
| GET | `/api/templates?search&category` | 🔒 | Templates (plateforme + org), gate premium. |

### IA (P13)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/ai/generate` | 🔒 | Coûts par opération + provider (`mock-démo`). |
| POST | `/api/ai/generate` | 🔒 | `{ kind: design\|text, prompt, eventRef?, designId? }` → quota → réservation `AiUsage(pending)` → exécution → `success` ou `failed` + **remboursement** (502 `ai_provider_error`). |
| GET | `/api/ai/usage?page&pageSize` | 🔒 | Historique crédits + total mensuel (coût / remboursé / consommé). |

### Invitation & RSVP (P8)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/events/:id/invitations` | 🔒 | `{ guestIds[], templateId?, send: "now"\|"none" }` → génération tokens + e-mails (outbox). `invitation:send`. |
| POST | `/api/events/:id/invitations/:iid/revoke` | 🔒 | Révocation du token. |
| GET | `/api/invitations/:token` | 🔑 | Page publique (design + infos + module RSVP si ouvert). |
| POST | `/api/invitations/:token/rsvp` | 🔑 | `{ status: confirmed\|maybe\|declined, companions?, answers? }` — idempotent, clos si événement terminé. Rate-limité. |

### Contrôle d'accès (P9)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/events/:id/scanner-agents` | 🔒 | Agent de scan : `{ name, entryPoint, allowMultipleEntries? }` → token agent. |
| GET | `/api/events/:id/scanner-agents` | 🔒 | Agents de l'événement. |
| PATCH | `/api/events/:id/scanner-agents/:aid` | 🔒 | Activer/désactiver. |
| POST | `/api/checkin/scan` | 🔑 | `{ agentToken, token, clientUuid?, entryPoint?, clientAt? }` → `valid` / `already_used` / `invalid` / `expired` (idempotent par `clientUuid`). |
| GET | `/api/scanner/sync?agentToken&since` | 🔑 | Sortie hors-ligne : scans locaux à consolider + état (événement, agents). |
| POST | `/api/scanner/sync` | 🔑 | Remise en file (P9) : `{ agentToken, scans[] }` → application serveur (dédoublement par clientUuid). |
| GET | `/api/events/:id/checkins?result&from&to` | 🔒 | Journal des passages. |

### Communications (P10)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/notifications/templates` | 🔒 | Templates de campagne (seed + personnalisés). |
| GET/POST | `/api/events/:id/campaigns` | 🔒 | Campagnes (rappel, annonce, changement). Feature `communications`. |
| POST | `/api/events/:id/campaigns/:cid/send` | 🔒 | Envoi (audience RSVP) → e-mails/SMS mock. Quota messages. |
| GET | `/api/notifications` | 🔒 | Notifications in-app de l'org. |
| GET | `/api/outbox` | 🔒 | **Outbox démo** : messages sortants mock (e-mails + SMS) — badge « Démo ». |

### Statistiques & rapports (P12)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/events/:id/statistics` | 🔒 | KPIs (invités, RSVP + perspectives, check-ins, tables, livre d'or) + séries (RSVP cumulée, arrivées/heure UTC, par catégorie, occupation tables). |
| GET | `/api/events/:id/reports/:type?format=csv\|xlsx\|pdf` | 🔒 | `type ∈ guests, rsvp, present, absent, scans, tables, stats, guestbook` — téléchargement attachment. |
| GET | `/api/events/:id/guestbook?status&page` | 🔒 | Messages + statuts (modération). |
| PATCH | `/api/events/:id/guestbook/:mid` | 🔒 | `{ status: approved\|hidden\|rejected }`. `event:update`. |

### Billing (P11)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/billing/subscription` | 🔒 | Souscription + plan + quotas + factures récentes. Rollover périodique lazy. |
| POST | `/api/billing/checkout` | 🔒 | `{ planId, currency, interval }` → paiement mock `pending` (Starter non achetable : 400). |
| POST | `/api/billing/checkout/:pid/confirm` | 🔒 | `{ result: succeeded\|failed }` → déclenche le **webhook signé** (même chemin que le webhook). |
| GET | `/api/billing/invoices?page` | 🔒 | Factures (numéro `INV-YYYY-NNNN`). |
| GET | `/api/billing/invoices/:iid/pdf` | 🔒 | Facture PDF (badge DÉMO, CDF sans centimes). |
| POST | `/api/billing/cancel` | 🔒 | Résiliation à l'échéance. |
| POST | `/api/billing/reactivate` | 🔒 | Réactivation. |
| POST | `/api/webhooks/mock` | 🔑 | Webhook mock **signé** (`x-mock-signature` HMAC-SHA256, `MOCK_WEBHOOK_SECRET`) + **idempotence** (`WebhookEvent`). Seul chemin qui change le statut paiement. |

### Média

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/media/upload` | 🔒 | Multipart (jpg/png/webp, liste blanche MIME, taille réelle). Quota stockage. |
| DELETE | `/api/media/:id` | 🔒 | Suppression (soft `deletedAt`). |
| GET | `/api/storage/:key` | 🔑 | **URL signée** (HMAC, TTL) pour servir les médias. |

## Public (aucune session)

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/i/:token` | 👤 | Page d'invitation (rendu design + RSVP). |
| GET | `/api/public/events/:slug/guestbook` | 👤 | Livre d'or public : messages **approved uniquement**. |
| POST | `/api/public/events/:slug/guestbook` | 👤 | Dépôt message (auto-publié en MVP — réserve §13). |

## Super admin (`/api/admin/*` — 🛡, 403 sinon)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/admin/dashboard` | KPIs plateforme (utilisateurs, orgs, événements, subs, revenus, IA, stockage…). |
| GET | `/api/admin/users?page&search` | Utilisateurs (+ organisations membres). |
| PATCH/DELETE | `/api/admin/users/:id` | Drapeau `isSuperAdmin` / suppression (409 si owner d'org active). |
| GET | `/api/admin/organizations?page&search` | Organisations (+ sub, plan, compteurs). |
| PATCH/DELETE | `/api/admin/organizations/:id` | `isActive`, devise / suppression (409 si sub active). |
| GET | `/api/admin/events?page&search&orgId` | Événements plateforme. |
| PATCH/DELETE | `/api/admin/events/:id` | `{ status }` / suppression cascade. |
| GET | `/api/admin/subscriptions?page&status&planCode` | Souscriptions. |
| GET | `/api/admin/payments?page&status&orgId` · GET `/api/admin/payments/:id` | Paiements + détail. |
| GET | `/api/admin/plans?all=1` · POST `/api/admin/plans` | Catalogue / création (code unique, limites, features, prix). **Quotas appliqués immédiatement.** |
| PUT | `/api/admin/plans/:id` | Édition (limites/features/prix/trial). |
| POST | `/api/admin/plans/:id/archive` | Archivage (subs existantes conservées). |
| GET/POST | `/api/admin/templates` · PATCH/DELETE `/api/admin/templates/:id` | Templates plateforme (DELETE → archivage si référencé). |
| GET/POST | `/api/admin/ai/credits/:orgId` | Historique IA / ajustement `{ delta, reason }` (delta<0 = crédit). |
| GET | `/api/admin/logs?page&action&entity&orgId&from&to` | Journal d'activité plateforme. |
| GET | `/api/admin/analytics` | Métriques descriptives 6 mois (croissance, revenus, crédits IA, top orgs). |
