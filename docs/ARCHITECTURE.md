# EventFlow SaaS — Architecture technique & plan d'implémentation

> Document de référence issu de l'analyse du cahier des charges (§76 : première étape).
> Statut : **à valider** avant démarrage de la Phase 0.
> Toute simplification d'exigence est explicitement signalée en §13.

---

## 1. Analyse du cahier des charges

### 1.1 Nature du produit

SaaS multi-tenant commercial de création d'invitations et de gestion d'événements, de A à Z :
création de supports graphiques (Save the Date, invitations, affiches, badges, cartes d'accès),
gestion des invités, QR unique par invité, RSVP, contrôle d'accès par scan, statistiques,
abonnement/paiement, IA (générations), multi-devise, FR/EN.

**Ce n'est pas une maquette** : chaque fonctionnalité principale est reliée à une vraie base de
données et à une vraie logique métier (§76). Les fournisseurs externes non configurés tournent en
**mode mock clairement identifié** — jamais de « fausse intégration ».

### 1.2 Les 4 espaces applicatifs

| Espace | Acteur | Périmètre |
|---|---|---|
| **Public** | Visiteur, invité | Landing, galerie de templates, tarifs, FAQ, auth, pages publiques événement `/e/[slug]` et invitation `/i/[token]` |
| **Client** | Owner, Manager, Designer, Viewer | Dashboard, workspace, événements, studio, invités, invitations, RSVP, QR, communications, livre d'or, tables, statistiques, rapports, fichiers, équipe, abonnement, facturation, paramètres |
| **Scanner** | Agent de contrôle | Connexion, sélection événement autorisé, scan QR, résultat, historique, recherche invité, mode hors ligne |
| **Super Admin** | Plateforme | Dashboard global, utilisateurs, organisations, événements, abonnements, paiements, plans, templates, crédits IA, logs, analytics SaaS |

### 1.3 Rôles & permissions (vérifiées côté serveur, §5/§6)

- **Owner** : accès complet à son organisation.
- **Manager** : événements, invités, invitations, communications (selon permissions).
- **Designer** : studio, assets, templates.
- **Scanner** : contrôle d'accès uniquement (+ informations d'accueil).
- **Viewer** : lecture seule.
- **Super Admin** : administration globale (drapeau `isSuperAdmin` sur l'utilisateur, hors tenant).

Matrice de permissions centralisée (`server/tenant/permissions.ts`) : une seule source de vérité
côté serveur ; l'UI se contente de masquer ce qui est interdit (jamais l'inverse).

### 1.4 Contraintes non négociables → décisions d'architecture

| Principe (CDC) | Décision |
|---|---|
| Multi-tenancy stricte | `organization_id` sur **toutes** les tables métier ; contexte tenant dérivé de la session uniquement ; helper `tenantScoped()` ; tests d'isolement entre tenants (§3.2) |
| Permissions côté serveur | Middleware de garde + matrice de permissions consultée dans chaque service, jamais dans le composant |
| Mobile-first | Layout responsive de base ; scanner et page publique optimisés smartphone |
| Quotas/plan contrôlent le payant | `QuotaService` (checkLimit/consume/refund/getUsage/getRemaining) appelé dans chaque service métier avant toute opération payante (§9.1) |
| Aucun secret côté client | Providers appelés uniquement depuis les routes serveur / services ; le client reçoit des URLs signées, jamais de clé |
| Opérations sensibles journalisées | `ActivityLogService` : login, CRUD événement, import/export, envoi, paiement, scan, actions admin — sans données sensibles (§9.9) |
| Intégrations abstraites | Interfaces `EmailProvider`, `SmsProvider`, `WhatsAppProvider`, `PaymentProvider`, `AiProvider`, `StorageProvider`, `PushProvider` + implémentation mock par défaut (§8) |
| Internationalisation | `next-intl`, messages FR/EN en fichiers JSON, zéro texte codé dans les composants ; dates/heures via fuseau de l'événement |
| Validation double | Schemas **zod** partagés client (UX) et serveur (autorité) |
| Pas de fausses intégrations | Chaque mock est explicitement signalé dans l'UI (badge « mode démo ») et journalisé |

### 1.5 Flux clients critiques (CDC §68)

- **A** Inscription → workspace → onboarding → plan/essai → dashboard → premier événement
- **B** Événement → studio → template → photos → personnalisation → prévisualisation → export
- **C** Invités → import CSV/Excel → mapping → validation/doublons → invitations + QR
- **D** Invité → lien → page → RSVP → QR → jour J
- **E** Agent → connexion → événement → scan → validation → check-in → synchronisation
- **F** Après événement → stats → rapports → livre d'or → export → archivage

### 1.6 Points de complexité identifiés (gestion du risque)

1. **Éditeur visuel** — le plus gros poste de développement. MVP : modèle JSON + positionnement
   absolu (drag/scale/rotation), texte, image, formes, QR, undo/redo, autosave, export PNG/PDF.
   (Simplification déclarée §13.1.)
2. **Scan QR mobile** — caméra + saisie manuelle de secours ; tests sur URL de préview.
3. **Mode hors ligne scanner** — cache pré-synchronisé + journal local + resynchronisation
   idempotente ; comportement documenté dans `docs/OFFLINE_SCANNER.md` et testé.
4. **Import CSV/Excel** — pipeline mapping → aperçu → validation → doublons → confirmation,
   jamais d'import direct d'un fichier invalide (§21).
5. **Anti-réutilisation QR** — transaction + politique `allow_multiple_entries` + historique
   intégral des scans (§9.4).
6. **Webhooks paiement** — vérification de signature + idempotence (table `WebhookEvent`) ;
   le statut d'abonnement ne change **jamais** à partir d'une réponse navigateur.

---

## 2. Choix techniques

> Contrainte environnementale de ce workspace : pas de serveur PostgreSQL installé. Le schéma
> Prisma est écrit pour être **portable SQLite → PostgreSQL** (changement de 1 ligne de
> `provider` + migration équivalente). En sandbox on utilise SQLite (migrations réelles,
> zéro configuration) ; en production : PostgreSQL. C'est une vraie base, pas des fixtures.

| Domaine | Choix | Justification | Alternative |
|---|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Full-stack unique : RSC, Server Actions, API routes, middleware ; un seul déploiement | Nuxt, Remix |
| UI | **Tailwind CSS + shadcn/ui** + lucide-react | Design system premium/épuré accessible, mobile-first, dark/light | MUI, Chakra |
| ORM / BDD | **Prisma 6** ; **SQLite (sandbox)** → **PostgreSQL (prod)** | Typage fort, migrations versionnées, seeders ; portable | Drizzle, Kysely |
| Auth | **Auth maison** : Argon2id (`@node-rs/argon2`), cookies httpOnly, table `Session` (appareils/IP), tokens e-mail | Contrôle total : vérification e-mail, reset, OTP, gestion des sessions/appareils (CDC §51), pas de dépendance à un SDK | Auth.js v5 |
| Validation | **zod** (schemas partagés client/serveur) | Une définition, deux usages | class-validator |
| i18n | **next-intl** (FR, EN) | Convention App Router, lazy loading | i18next |
| QR génération | **qrcode** (SVG/PNG, serveur & client) | Standard, sans secret côté client |
| QR lecture | **html5-qrcode** (caméra) + saisie manuelle | Robuste mobile, fallback sans caméra |
| Import | **papaparse** (CSV) + **xlsx** (Excel) | Mapping/aperçu côté client, validation **réelle** côté serveur |
| Export PDF | **pdfkit** (server-side) + PNG client (`html-to-image`) | Rapports fiables sans navigateur headless | Puppeteer |
| Graphiques | **recharts** | Léger, React, suffisant pour les KPI |
| Éditeur | **Éditeur maison** (canvas DOM, modèle JSON) | Contrôlé, exportable, compatible mobile | fabric.js (fallback si besoin) |
| Tests | **vitest** (unité) + **Playwright** (E2E) | Cohérent avec TS/Next | Jest |
| Jobs | File in-process + table `MessageLog`/outbox (polling) | Pas d'infrastructure externe en sandbox ; l'abstraction permet BullMQ/Redis en prod | BullMQ dès prod |

---

## 3. Architecture générale

### 3.1 Couches

```
┌────────────────────────────────────────────────────────────────────┐
│  UI — Next.js App Router (RSC + Server Actions)                    │
│  (public) / (app client) / (scanner) / (admin) / (pages publiques) │
├────────────────────────────────────────────────────────────────────┤
│  API routes /api/*  (REST, JSON)  — tokens publics, webhooks,      │
│  scanner, import/export                                               │
├────────────────────────────────────────────────────────────────────┤
│  Service layer (domaine) — la logique métier vit ICI               │
│  EventService · GuestService · InvitationService · CheckInService   │
│  DesignService · AiService · QuotaService · BillingService          │
│  CommsService · ImportService · ReportService · AutomationService   │
│  ActivityLogService · TenantService                                  │
├────────────────────────────────────────────────────────────────────┤
│  Providers (abstractions intégrations)                              │
│  EmailProvider · SmsProvider · WhatsAppProvider · PaymentProvider   │
│  AiProvider · StorageProvider · PushProvider                        │
│  [implémentation mock par défaut, signalée comme tel]               │
├────────────────────────────────────────────────────────────────────┤
│  Data — Prisma (SQLite sandbox / PostgreSQL prod) + Storage local   │
│  (media : URLs signées, quotas) + exports temporaires (purge)       │
└────────────────────────────────────────────────────────────────────┘
```

Règle : **les composants UI n'appellent jamais Prisma ni un provider directement** — tout passe
par un Server Action ou une API route qui appelle un service. Les services sont testables sans UI.

### 3.2 Multi-tenancy (CDC §6) — règles opérationnelles

- **R1** — Toutes les tables portent `organization_id` (y compris `MediaFile`, `UsageCounter`,
  `Design`, `ActivityLog`, `MessageLog`…).
- **R2** — `getTenantContext()` : session → user → **organisation active** (table
  `UserActiveOrg` avec défaut = première org) → vérification de l'appartenance membre **active**
  → `{ orgId, userId, role }`. Un `organization_id` reçu du client est **ignoré/rejeté** sur les
  routes tenant ; l'onglet d'organisation est un préférence utilisateur.
- **R3** — Tout accès data passe par `tenantScoped(orgId)` : les requêtes Prisma reçoivent
  systématiquement `where: { organization_id }`. Un index composite `(organization_id, …)` sur
  chaque entité chaude.
- **R4** — Permissions : chaque service vérifie `requireRole(ctx, 'manager')` etc. selon la
  matrice. Scanner : de plus, l'appel doit porter un `scannerAgentId` **autorisé sur l'événement
  concerné** (table `ScannerAgent`), point d'entrée + permissions spécifiques (photo autorisée,
  historique, etc.).
- **R5** — Endpoints publics par token : le token est **opaque** (32 octets `crypto.randomBytes`
  → base62, aucune donnée personnelle). Résolution : token → invitation → événement, puis
  autorisation via le contexte (invité : RSVP/lecture ; agent : scan). Réponse `INVALIDE`
  générique, sans révélation de données.
- **R6** — Isolation vérifiée par tests : suite E2E + tests unités « cross-tenant » (un utilisateur
  du tenant B doit systématiquement recevoir 403/404 sur les ressources du tenant A) —
  critère d'acceptation **P**.
- **R7** — Suppression d'organisation : désactivation + rétention configurable (CDC §63), pas de
  wipe immédiat.

### 3.3 Sécurité (CDC §62)

- HTTPS en prod ; cookies `httpOnly`, `Secure`, `SameSite=Lax` (CSRF couvert par SameSite +
  vérification d'origine sur les mutations API).
- Argon2id (coût configuré) ; **jamais** de hash MD5/SHA seul.
- Rate limiting : routes auth, `/api/rsvp/*`, `/api/checkin/scan`, envois masse (store mémoire +
  quota par IP/session ; clé en env).
- Uploads : extension + **type réel** (magic bytes) + taille max (env) ; stockage à chemin aléatoire
  (`crypto.randomUUID`), jamais le nom d'origine.
- URLs signées (HMAC, TTL) pour tout média ; liste blanche MIME : jpg/png/webp.
- Secrets uniquement en `.env` ; logs structurés sans secret ni donnée sensible.
- Sanitisation des sorties (React par défaut) + validation zod en entrée ; `Content-Security-Policy`
  restrictive en prod.
- Sessions : révocables individuellement (table `Session`, section Paramètres → Sécurité).

---

## 4. Modèle de données

> Entités du CDC §58 + entités **ajoutées** marquées ⭐ (justifiées). Toutes les tables ont
> `id` (cuid) et `created_at`/`updated_at` sauf mention.

### 4.1 Schéma relationnel (principales relations)

```mermaid
erDiagram
    USER ||--o{ SESSION : "sessions"
    USER ||--o{ ORGANIZATION_MEMBER : ""
    ORGANIZATION ||--o{ ORGANIZATION_MEMBER : ""
    ORGANIZATION ||--o| SUBSCRIPTION : ""
    PLAN ||--o{ PLAN_PRICE : ""
    PLAN ||--o{ SUBSCRIPTION : ""
    ORGANIZATION ||--o{ EVENT : ""
    EVENT_TYPE ||--o{ EVENT : ""
    EVENT ||--o{ EVENT_MEMBER : ""
    EVENT ||--o{ GUEST : ""
    EVENT ||--o{ TABLE : ""
    GUEST }o--o| TABLE : ""
    GUEST ||--o| INVITATION : ""
    INVITATION ||--o| INVITATION_TOKEN : ""
    INVITATION ||--o| RSVP : ""
    INVITATION ||--o| QRCODE : ""
    INVITATION ||--o{ CHECKIN : ""
    SCANNER_AGENT ||--o{ CHECKIN : ""
    EVENT ||--o{ SCANNER_AGENT : ""
    GUEST ||--o| GUEST_PREFERENCE : ""
    EVENT ||--o{ GUESTBOOK_MESSAGE : ""
    GUEST ||--o| RSPV : ""
    ORGANIZATION ||--o{ DESIGN : ""
    EVENT }o--o{ DESIGN : ""
    DESIGN_TEMPLATE }o--o{ DESIGN : ""
    ORGANIZATION ||--o{ MEDIA_FILE : ""
    ORGANIZATION ||--o{ AI_USAGE : ""
    ORGANIZATION ||--o{ NOTIFICATION : ""
    ORGANIZATION ||--o{ NOTIFICATION_CAMPAIGN : ""
    EVENT ||--o{ NOTIFICATION_CAMPAIGN : ""
    ORGANIZATION ||--o{ AUTOMATION : ""
    EVENT ||--o{ AUTOMATION : ""
    ORGANIZATION ||--o{ ACTIVITY_LOG : ""
    ORGANIZATION ||--o{ USAGE_COUNTER : ""
    ORGANIZATION ||--o{ PAYMENT : ""
    ORGANIZATION ||--o{ INVOICE : ""
    EVENT ||--o{ RSPV_QUESTION : ""
    EVENT ||--o{ IMPORT_JOB : ""
    ORGANIZATION ||--o{ MESSAGE_LOG : ""
    SUBSCRIPTION ||--o{ PAYMENT : ""
```

### 4.2 Entités détaillées

#### Identité & accès

**User**
| champ | type | notes |
|---|---|---|
| email | String, unique | vérifiable |
| password_hash | String | Argon2id |
| phone | String? | format E.164 |
| first_name, last_name | String | |
| avatar_media_id | String? | |
| locale | String | `fr`/`en` (défaut `fr`) |
| currency | String | `USD`/`CDF`/`EUR` |
| timezone | String | ex. `Africa/Kinshasa` |
| is_super_admin | Boolean | défaut false |
| email_verified_at | DateTime? | |

**Session** ⭐ (CDC §51 : sessions/appareils) — `user_id`, `token_hash`, `user_agent`, `ip`,
`expires_at`, `last_seen_at`, `revoked_at`.

**EmailVerificationToken** ⭐ / **PasswordResetToken** ⭐ / **OtpCode** ⭐ — `token_hash`,
`expires_at`, `used_at`, `attempts` (OTP : `phone`, `purpose`, code hashé).

**Role** ⭐ (table de config lisible par l'UI ; l'autorité reste la matrice serveur) — `code`
(`owner`/`manager`/`designer`/`scanner`/`viewer`), `label_fr`, `label_en`, `permissions_json`.

#### Organisation & abonnement

**Organization** — `name`, `slug`, `logo_media_id`, `address`, `phone`, `email`, `currency`,
`locale`, `timezone`, `is_active`, `deleted_at` (rétention §63).
Index : `(slug)`.

**OrganizationMember** — `organization_id`, `user_id`, `invited_email` (si invitation en attente),
`role` (owner|manager|designer|scanner|viewer), `status` (invited|active|removed), `invited_by`,
`active_org_default` (bool).
Unique : `(organization_id, user_id)` ; index `(organization_id, status)`.

**UserActiveOrg** ⭐ — `user_id` (unique), `organization_id` : détermine le tenant courant (R2).

**Plan** — `code` (starter|pro|business, extensible), `name`, `description`, `trial_days`
(configurable §41), `limits_json` (events, guests_per_event, storage_mb, sms_per_month,
emails_per_month, ai_credits_per_month, collaborators, premium_templates, white_label,
advanced_stats, communications, team…), `features_json`, `is_active`, `is_archived`.
**Les limites ne sont jamais codées en dur** (CDC §38).

**PlanPrice** ⭐ (devises §53) — `plan_id`, `currency` (USD|CDF|EUR), `amount_minor` (entier ;
CDF sans centimes), `interval` (monthly|yearly), `is_active`.

**Subscription** — `organization_id`, `plan_id`, `status` (trialing|active|past_due|canceled|
expired|paused), `trial_ends_at`, `current_period_start`, `current_period_end`,
`cancel_at_period_end`, `provider`, `provider_customer_id`, `provider_subscription_id`.

**Payment** — `organization_id`, `subscription_id`, `provider`, `provider_payment_id`,
`amount_minor`, `currency`, `status` (pending|succeeded|failed|refunded), `description`,
`raw_json`, `created_at`.

**Invoice** — `organization_id`, `subscription_id`, `number` (séquentiel `/org`), `amount_minor`,
`currency`, `status` (open|paid|void), `issued_at`, `due_at`, `pdf_url`, `provider_invoice_id`.

**WebhookEvent** ⭐ (idempotence §60) — `provider`, `provider_event_id` (unique par provider),
`type`, `payload_json`, `processed_at`.

#### Événement

**EventType** — `code`, `label_fr`, `label_en`, `category` (personnel|corporate). Seed : les 20
types du CDC §3.

**Event** — `organization_id`, `name`, `type_code`, `date`, `start_time`, `end_time`,
`timezone` (ex. `Africa/Kinshasa`), `venue`, `address`, `city`, `country`, `description`,
`contact_phone`, `contact_email`, `website`, `dress_code`, `practical_info`,
`cover_media_id`, `logo_media_id`, `slug` (unique, pour page publique), `status`
(draft|published|archived), `options_json` (qr, rsvp, sms, email, whatsapp, guestbook,
preferences, tables, gallery, countdown), `allow_multiple_entries` (bool, §26),
`welcome_message`.
Index : `(organization_id, status)`, `(organization_id, date)`, `(slug)`.

**EventMember** (personnes principales : mariée, marié, conférencier…) — `event_id`,
`role_label` (libre : « Mariée »…), `first_name`, `last_name`, `media_id`, `sort_order`.

**RsvpQuestion** ⭐ (questions personnalisées §24) — `event_id`, `label`, `type` (text|number|
choice), `choices_json`, `required`, `sort_order`.

#### Invités, tables, RSVP

**Guest** — `event_id`, `organization_id`, `first_name`, `last_name`, `phone` (E.164 normalisé),
`email` (lowercased), `category` (famille|amis|VIP|collègues|autre, extensible), `table_id`,
`companions` (int, défaut 0), `internal_notes`, `invite_status` (none|created|sent|failed),
`rsvp_status` (pending|confirmed|declined|maybe), `presence_status` (pending|present|absent),
`checked_in_at`, `source` (manual|import), `import_job_id`.
Unique (détection doublons §21) : `(event_id, phone)` non-null, `(event_id, email)` non-null.
Index : `(event_id, rsvp_status)`, `(event_id, category)`, `(organization_id)`.
→ **pagination** obligatoire sur listing (CDC §57).

**Table** — `event_id`, `organization_id`, `name`, `capacity`, `sort_order`, `position_x`,
`position_y` (plan de salle). Dashboard : `Table 1 — 8/10` (occupation calculée).

**GuestPreference** ⭐ — `guest_id` (unique), `meal`, `drink`, `allergies`,
`ceremony_attending` (bool?), `reception_attending` (bool?).

**Invitation** — `event_id`, `organization_id`, `guest_id` (**unique 1:1** : un QR par invité,
§22), `design_id`, `public_url`, `status` (draft|sent|used|expired), `sent_at`,
`last_reminder_at`, `qr_png_media_id` (rendu à la demande, stocké pour offline/export).

**InvitationToken** — `invitation_id` (unique), `token` (**unique global**, 32B base62, sans PII),
`expires_at`?, `revoked_at`. Index : `(token)`.

**QRCode** — `invitation_id` (unique), `data` (URL publique `/i/{token}`), `size`, `format`,
`media_id` (rendu PNG), `generated_at`. (Stock pour audit + pré-synchronisation offline.)

**Rsvp** — `invitation_id` (unique), `guest_id`, `status` (confirmed|declined|maybe),
`companions`, `answers_json` (réponses aux `RsvpQuestion`), `updated_at`.
→ Chaque changement RSVP : `ActivityLog` + déclenchement des automatisations.

**CheckIn** — `event_id`, `invitation_id`, `guest_id`, `scanner_agent_id`, `entry_point`,
`device_id` (UUID stable du navigateur agent), `result` (valid|already_used|invalid|expired),
`client_uuid` (**unique**, idempotence offline §28), `synced` (bool), `checked_in_at`.
Index : `(event_id, checked_in_at)`, `(invitation_id, checked_in_at)`.

**ScannerAgent** — `event_id`, `organization_id`, `user_id`, `name`, `entry_point`
(entrance|vip|staff|family|custom), `permissions_json` (can_view_photo, can_search,
can_see_history…), `active`, `token` (token d'accès agent, révocable).

**GuestBookMessage** — `event_id`, `author_name`, `author_email`?, `message`, `status`
(pending|approved|hidden|rejected) — modération §34, `published_at`.

#### Design

**Design** — `organization_id`, `event_id`?, `type` (save_the_date|invitation|vip_invitation|
access_card|poster|badge|program|thank_you_card|facebook_post|instagram_post|story|
whatsapp_visual|custom), `template_id`?, `name`, `format` (portrait|landscape|square|print|
social), `width`, `height`, `background_json` (couleur|image|motif), `elements_json`
(**contenu structuré du design** — les éléments du canvas, ordonnés, styleables),
`cover_media_id`?, `status` (draft|published), `is_ai_generated`, `created_by`, `version`
(autosave), `updated_at`.

**DesignTemplate** — `organization_id` (null = plateforme), `name`, `category` (mariage|
anniversaire|soutenance|conférence|baptême|gala|entreprise|vip|save_the_date), `style`
(romantique|luxe|moderne|minimaliste|classique|floral|africain contemporain|professionnel),
`format`, `width`, `height`, `thumbnail_media_id`, `content_json` (mêmes `elements_json`),
`is_premium`, `required_plan`, `is_featured` (vedette §48), `status` (draft|published|archived),
`published_at`.

**DesignAsset** ⭐ — `organization_id`, `design_id`?, `kind` (shape|icon|ornament|logo),
`media_id`, `data_json`.

**MediaFile** — `organization_id`, `uploaded_by`, `event_id`?, `kind` (photo|logo|cover|
thumbnail|qr|export|template_thumb), `storage_key` (chemin aléatoire), `original_name`,
`mime_type`, `size_bytes`, `width`?, `height`?, `deleted_at` (suppression sécurisée §61).
Quota stockage vérifié via `QuotaService` à l'upload. Index : `(organization_id, kind)`.

#### IA

**AiUsage** — `organization_id`, `user_id`, `operation` (design|text|image_enhance|
background_remove|variants|sttd|poster), `credits_cost`, `credits_refunded`, `status`
(success|failed), `input_summary` (sans donnée sensible), `output_design_id`?, `created_at`.

#### Communication

**Notification** — `organization_id`?, `user_id`? (notification produit interne), `type`,
`channel`, `title`, `body`, `read_at`.

**NotificationTemplate** ⭐ (§31) — `organization_id` (null = plateforme), `key` (welcome|
invitation|confirmation|reminder|change|payment|expiration|quota), `channel` (email|sms|
whatsapp|push), `subject_fr`, `subject_en`, `body_fr`, `body_en` (variables `{{guest_name}}`,
`{{event_name}}`, `{{event_date}}`, `{{event_location}}`, …), `active`.

**NotificationCampaign** — `organization_id`, `event_id`, `type` (invitation|confirmation|
reminder|change|custom), `channel`, `template_id`, `audience_json` (tous|rsvp_pending|confirmed|
declined|custom_list), `status` (draft|sending|sent|failed), `scheduled_at`, `sent_count`,
`failed_count`, `created_by`.

**MessageLog** ⭐ (outbox / boîte d'envoi démo) — `organization_id`, `campaign_id`?,
`guest_id`?, `channel`, `recipient`, `template_key`, `subject`, `body`, `status` (queued|sent|
delivered|failed), `provider_message_id`, `error`, `created_at`.
→ En mock : les messages apparaissent ici + page « Boîte d'envoi (démo) » ; en prod : statut de
livraison remonté par provider (WhatsApp/Cloud API, e-mail receipts, SMS reports).

#### Automatisations, journal, quotas, flags

**Automation** — `organization_id`, `event_id`?, `name`, `trigger` (rsvp_confirmed|
event_48h|event_24h|location_changed|invitation_sent), `condition_json` (ex. `rsvp_status ==
pending`), `action_json` (ex. `send:reminder` via campagne), `active`, `last_run_at`.
Moteur : job périodique (1 min) évaluant triggers/conditions ; **idempotent** (une automatisation
ne fire qu'une fois par état, suivi via `last_run_at` + clé naturelle).

**ActivityLog** (§50) — `organization_id`?, `user_id`?, `action` (login|event.create|event.
update|event.delete|import.run|export.run|invite.send|payment.succeeded|subscription.changed|
scan.valid|admin.*), `entity`, `entity_id`, `meta_json` (non sensible), `ip`, `created_at`.
Index : `(organization_id, created_at)`, `(user_id, action, created_at)`.

**UsageCounter** (CDC §42) — `organization_id`, `key` (events|guests|storage_mb|sms|emails|
ai_credits|collaborators), `period` (`YYYY-MM` ou `all`), `value`.
Unique : `(organization_id, key, period)`. Écrits **en transaction** avec l'opération.

**FeatureFlag** — `key`, `value_json`, `scope` (platform|plan:pro|…), `active`.

#### ⭐ Ajouts utilitaires (non listés au CDC §58, justifiés)

- **ImportJob** — `organization_id`, `event_id`, `file_name`, `mime`, `mapping_json`, `status`
  (pending|validated|confirmed|failed), `total_rows`, `valid_rows`, `error_rows`,
  `duplicate_rows`, `errors_json` (par ligne : message compréhensible), `created_by`.
- **OnboardingState** — `user_id` (unique), `organization_id`, `current_step` (1..7),
  `skipped_steps_json`, `completed_at`.
- **WebhookEvent**, **MessageLog**, **NotificationTemplate**, **RsvpQuestion**,
  **UserActiveOrg**, **Session**, tokens e-mail/OTP (ci-dessus).

---

## 5. API

> Conventions : JSON ; auth par cookie de session (routes tenant) ; validation zod ;
> erreurs `{ error: { code, message, details? } }` ; pagination `?page&pageSize` +
> `X-Total-Count` sur les listings ; tokens publics sans PII.

### 5.1 Auth & compte
```
POST   /api/auth/register            → user + organization + onboarding
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/verify-email        { token }
POST   /api/auth/forgot-password     { email }   (toujours 200, anti-énumération)
POST   /api/auth/reset-password      { token, password }
POST   /api/auth/change-password
POST   /api/auth/otp/send            { phone }   (optionnel)
POST   /api/auth/otp/verify
GET    /api/account/sessions         (appareil, IP, dernière activité)
DELETE /api/account/sessions/:id     (révoquer un appareil)
POST   /api/auth/social/:provider    (si configuré — sinon 501 explicite)
```

### 5.2 Organisation & équipe
```
GET    /api/organization             PATCH /api/organization
POST   /api/organization/members     (invitation email — mock outbox)
PATCH  /api/organization/members/:id (rôle)
DELETE /api/organization/members/:id
POST   /api/organization/switch      (changer l'organisation active — R2)
GET    /api/organization/quota       (usage vs limites plan)
```

### 5.3 Événements
```
GET    /api/events                   POST /api/events
GET    /api/events/:id               PATCH /api/events/:id
POST   /api/events/:id/duplicate     POST /api/events/:id/archive
DELETE /api/events/:id               POST /api/events/:id/publish | /unpublish
POST   /api/events/:id/members       (personnes principales)  GET/PATCH/DELETE …/:id/members/:mid
PUT    /api/events/:id/options
```
Pages publiques (RSC, pas de JSON) : `GET /e/[slug]` (événement publié),
`GET /i/[token]` (invitation publique : infos + RSVP + QR), `POST /api/rsvp/:token`.

### 5.4 Invités & import
```
GET    /api/events/:id/guests        (?search&category&rsvp&presence&table&page&sort)
POST   /api/events/:id/guests        PUT /api/events/:id/guests/:gid
DELETE /api/events/:id/guests/:gid
POST   /api/events/:id/guests/import   (step: upload → mapping → preview → validate → confirm)
GET    /api/events/:id/guests/export   (CSV/XLSX)
GET/POST/PATCH/DELETE /api/events/:id/tables…
PUT    /api/events/:id/guests/:gid/preference
GET/POST /api/events/:id/guestbook    PUT …/guestbook/:mid (modération)
```

### 5.5 Design & studio
```
GET    /api/templates                (?category&style&format&premium)
POST   /api/designs                  (à partir d'un template ou vierge)
GET    /api/designs/:id              PUT /api/designs/:id (autosave versionné)
POST   /api/designs/:id/export       (png|pdf, serveur)
POST   /api/media/upload             (multipart, validation type réel)
DELETE /api/media/:id                GET /api/media/:id/signed-url
```

### 5.6 Invitations, QR, RSVP, contrôle
```
POST   /api/events/:id/invitations/generate-for-guests  (lot : 1 invitation+token+QR par invité)
GET    /api/invitations/:token              (public : page invitation)
POST   /api/rsvp/:token                     (public, rate-limité)
GET    /api/events/:id/invitations          (statuts, relances)
POST   /api/events/:id/invitations/reminder (envoie rappel, quota SMS/email)
POST   /api/checkin/scan                    { agentId?, token, entryPoint, deviceId, clientUuid }
GET    /api/events/:id/checkins             (historique, pagination)
GET    /api/scanner/events                  (événements autorisés pour l'agent)
GET    /api/scanner/sync                    (pré-synchro offline : tokens autorisés + min data)
```

### 5.7 Dashboard, stats, rapports
```
GET    /api/dashboard/summary
GET    /api/events/:id/statistics
GET    /api/events/:id/reports/:type        (guests|rsvp|present|absent|scans|tables|stats|guestbook)
                                              → download (pdf|csv|xlsx) — export temp purgé
```

### 5.8 Communication & automatisation
```
GET/POST/PATCH /api/notifications/templates…
GET/POST/PATCH /api/events/:id/campaigns…   POST …/:cid/send
GET/POST/PATCH /api/events/:id/automations…
GET    /api/outbox                          (démo mock : messages envoyés)
```

### 5.9 Studio IA
```
POST   /api/ai/generate                    { kind, prompt?, eventRef?, designId? }
                                            → vérif. quota → réservation → exécution →
                                              AIUsage → remboursement si échec
GET    /api/ai/usage
```

### 5.10 Billing
```
GET    /api/subscription
POST   /api/billing/checkout               { planId, currency, interval }
                                            → PaymentProvider.checkout (URL)
POST   /api/billing/webhook                (signature + idempotence WebhookEvent)
GET    /api/billing/invoices               GET …/invoices/:iid (PDF)
POST   /api/billing/cancel                 (à la fin de période)
```

### 5.11 Super admin (`/api/admin/*`, garde `isSuperAdmin`)
```
GET    /api/admin/dashboard                (KPIs plateforme)
GET/PATCH/DELETE /api/admin/users|organizations|events
GET/PATCH/POST /api/admin/plans            (CRUD plans, prix, quotas, features)
POST   /api/admin/plans/:id/archive
GET/POST/PATCH/DELETE /api/admin/templates
GET    /api/admin/subscriptions|payments   GET …/payments/:id
POST   /api/admin/ai/credits/:orgId        (ajuster crédits)
GET    /api/admin/logs                     GET …/logs?entity&entityId
GET    /api/admin/analytics                (métriques descriptives §49)
PATCH  /api/admin/platform                 (trial_days, flags, maintenance)
```

---

## 6. Arborescence du projet

```
arena/
├── prisma/
│   ├── schema.prisma               # schéma complet (§4)
│   ├── migrations/                 # versionnées
│   └── seed.ts                     # plans, types d'événements, templates plateforme,
│                                   # super admin, templates de notifications, roles
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── page.tsx                    # landing (promesse, features, CTA)
│   │   │   ├── gallery/                    # galerie de templates (publiés)
│   │   │   ├── pricing/                    # tarifs (plans × devises, configurable)
│   │   │   ├── faq/
│   │   │   ├── login/  register/  forgot-password/  reset-password/  verify-email/
│   │   │   └── e/[slug]/                   # page publique événement (mobile-first)
│   │   ├── i/[token]/                      # page publique invitation + RSVP + QR
│   │   ├── (app)/                          # client — protégé, layout tenant (sidebar)
│   │   │   ├── dashboard/
│   │   │   ├── onboarding/                 # assistant 7 étapes, skippable
│   │   │   ├── events/
│   │   │   │   ├── new/                    # création (assistant ou form)
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx            # vue événement (options, personnes)
│   │   │   │       ├── guests/             # CRUD, import, filtres, pagination
│   │   │   │       ├── tables/
│   │   │   │       ├── invitations/
│   │   │   │       ├── rsvp/
│   │   │   │       ├── guestbook/
│   │   │   │       ├── communications/     # campagnes, templates, automations, outbox
│   │   │   │       ├── stats/              # KPI + graphiques + rapports
│   │   │   │       ├── agents/             # agents de contrôle
│   │   │   │       └── files/
│   │   │   ├── studio/                     # éditeur visuel
│   │   │   │   ├── page.tsx                # liste de mes designs
│   │   │   │   └── [designId]/             # canvas + panneaux (couches, style, props)
│   │   │   ├── scanner/                    # mode agent (mobile-first)
│   │   │   │   ├── page.tsx                # sélection événement autorisé
│   │   │   │   ├── scan/                   # caméra + saisie manuelle + historique
│   │   │   ├── subscription/  billing/     # plan actif, quotas, checkout, factures
│   │   │   └── settings/
│   │   │       ├── organization/  account/  notifications/  security/  team/
│   │   ├── admin/                          # super admin
│   │   │   ├── dashboard/ users/ organizations/ events/ plans/ templates/
│   │   │   ├── subscriptions/ payments/ ai-credits/ logs/ analytics/ settings/
│   │   ├── api/                            # routes §5
│   │   └── layout.tsx / globals.css / not-found.tsx / error.tsx
│   ├── components/
│   │   ├── ui/                             # shadcn (button, dialog, table, toast…)
│   │   ├── layout/ (sidebar, topbar, org-switcher, quota-pill)
│   │   ├── editor/ (canvas/, layers/, style-panel/, history/, export/)
│   │   ├── scanner/ (camera, result-card, history-list, offline-badge)
│   │   ├── import/ (mapping, preview, errors)
│   │   └── charts/
│   ├── server/
│   │   ├── auth/        (session.ts, password.ts, tokens.ts, otp.ts, guards.ts)
│   │   ├── tenant/      (context.ts, scope.ts, permissions.ts)   ← cœur multi-tenant
│   │   ├── services/    (event, guest, guest-import, invitation, checkin,
│   │   │                design, template, ai, billing, quota, comms,
│   │   │                campaign, automation, rsvp, guestbook, tables,
│   │   │                report, media, activity, organization, team, onboarding)
│   │   ├── providers/
│   │   │   ├── email/    (types.ts, index.ts → mock|smtp)
│   │   │   ├── sms/      (types.ts, index.ts → mock|africastalking)
│   │   │   ├── whatsapp/(types.ts, index.ts → mock|meta-cloud)
│   │   │   ├── payment/  (types.ts, index.ts → mock|stripe)
│   │   │   ├── ai/       (types.ts, index.ts → mock|…)
│   │   │   ├── storage/  (types.ts, index.ts → local|s3)
│   │   │   └── push/     (types.ts, index.ts → mock|fcm)
│   │   ├── jobs/        (runner.ts, reminders.ts, webhook-retry.ts, export-cleanup.ts)
│   │   └── utils/       (crypto.ts, csv.ts, pdf.ts, time.ts, signed-url.ts)
│   ├── lib/             (prisma.ts, i18n.ts, schemas/ (zod), format.ts, constants.ts)
│   └── messages/        (fr.json, en.json)
├── storage/             # .gitignore — media/, exports/ (purge)
├── docs/
│   ├── ARCHITECTURE.md  (ce document)
│   ├── API.md           (généré/renseigné en cours de route)
│   ├── OFFLINE_SCANNER.md (CDC §28 : comportement exact)
│   └── DEPLOYMENT.md    (install, env, prod, backups, monitoring)
├── tests/
│   ├── unit/            # vitest : quota, checkin, token, tenant-isolation, rsvp,
│   │                    # import, automations, subscription states
│   └── e2e/             # Playwright : parcours A–F + critères A–P du CDC §74
├── .env.example
├── .gitignore
├── package.json / tsconfig.json / next.config.ts / tailwind.config.ts
└── README.md
```

---

## 7. Variables d'environnement (`.env.example`)

```bash
# ——— Core ———
NODE_ENV=development
APP_URL=http://localhost:3000
# sandbox: sqlite ; prod: postgresql://user:pass@host:5432/eventflow
DATABASE_URL="file:./prisma/eventflow.db"
SECRET_KEY=change-me-64-hex-chars          # sessions, tokens, signatures
SESSION_TTL_DAYS=30
LOG_LEVEL=info

# ——— Business (défauts, surchargeables par admin/plans) ———
TRIAL_DAYS=7
GUESTS_PAGE_SIZE=50
MAX_UPLOAD_MB=8
EXPORT_RETENTION_HOURS=24

# ——— Rate limiting ———
RATE_LIMIT_AUTH_PER_MIN=5
RATE_LIMIT_PUBLIC_RVP_PER_MIN=10
RATE_LIMIT_SCAN_PER_MIN=60

# ——— Providers (vide/« mock » = mode mock identifié dans l'UI) ———
EMAIL_PROVIDER=mock
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="EventFlow <no-reply@eventflow.app>"

SMS_PROVIDER=mock
SMS_API_KEY=
SMS_SENDER_ID=

WHATSAPP_PROVIDER=mock
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

PAYMENT_PROVIDER=mock
PAYMENT_PUBLIC_KEY=
PAYMENT_SECRET_KEY=
PAYMENT_WEBHOOK_SECRET=

AI_PROVIDER=mock
AI_API_KEY=

STORAGE_PROVIDER=local
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

Règle : **chaque provider vide = mock**, et le mock est visible (badge « Démo » + outbox).
Aucune clé ne quitte le serveur.

---

## 8. Intégrations externes — abstractions & mocks

```ts
// Pattern identique pour chaque provider ; l'implémentation est choisie par env var.
interface EmailProvider   { send(m: {to,subject,html,text}): Promise<{id}>;
                            getDeliveryStatus?(id: string): Promise<Status>; }
interface SmsProvider     { sendSms(to: string, body: string): Promise<{id}>;
                            getBalance(): Promise<{credits}>;
                            getDeliveryStatus?(id: string): Promise<Status>; }
interface WhatsAppProvider{ sendTemplate(to: string, template: string, vars: Record<string,string>): Promise<{id}>;
                            supported(): boolean; }   // official API only (CDC §33)
interface PaymentProvider { createCheckout({amountMinor,currency,interval,orgId,planId}): Promise<{url,sessionId}>;
                            confirm(sessionId): Promise<PaidStatus>;
                            handleWebhook(payload, signature): Promise<WebhookEvent>;  // signé + idempotent
                            refund?(paymentId): Promise<void>; }
interface AiProvider      { generateDesign(spec): Promise<DesignProposal>;   // exploitable par l'éditeur
                            generateText(spec): Promise<string>;
                            improveImage?(mediaKey, hint): Promise<MediaRef>;
                            removeBackground?(mediaKey): Promise<MediaRef>;
                            variants(designId, n): Promise<DesignProposal[]>; }
interface StorageProvider { put(key, body, meta): Promise<{url}>;
                            signedUrl(key, ttlSec): Promise<string>;
                            delete(key): Promise<void>; }
interface PushProvider    { send(deviceToken, payload): Promise<void>; }
```

| Domaine | Mock (sandbox, identifié) | Prod recommandé |
|---|---|---|
| E-mail | Log + table `MessageLog` + page « Boîte d'envoi (démo) » | Resend / SES / SMTP |
| SMS | Idem + solde simulé par quota | **AfricasTalking** (pertinent RDC) / Twilio |
| WhatsApp | Idem | Meta Cloud API (officiel uniquement — §33) |
| Paiement | Checkout simulé → webhook signé auto → statut serveur | **CODA** (RDC/CDF) / Stripe (USD/EUR) |
| IA | Compositions **déterministes** à partir du template + données événement (clairement « mock ») | API de génération d'images/texte au choix |
| Stockage | `storage/media/*` local, URLs signées | S3 / GCS |
| Push | Log | FCM (si PWA — P3) |

Le CDC impose l'abstraction : changer de fournisseur = 1 fichier + env vars, zéro impact métier.

---

## 9. Règles de gestion transverses

### 9.1 QuotaService (CDC §42)
```ts
checkLimit(orgId, key, needed=1): {ok, remaining, limit, reason?}
consume(orgId, key, amount): void            // INCREMENT UsageCounter EN TRANSACTION
refund(orgId, key, amount): void
getUsage(orgId, key, period='currentMonth'): number
getRemaining(orgId, key): number
```
- Limite = `Plan.limits_json[key]` du plan de la souscription **active ou en trial** ; plan
  expiré → limites « free-locked » (fonctions payantes bloquées, **données conservées** §41).
- Clés : `events`, `guests` (par événement), `storage_mb`, `sms` (mois), `emails` (mois),
  `ai_credits` (mois), `collaborators`.
- Exemple d'appel : avant import de 300 invités → `checkLimit('guests', 300)` → si KO, message
  explicite + CTA « changer de plan » (UX §73 : proposer une solution).

### 9.2 Crédit IA (CDC §19)
1. `checkLimit(ai_credits, coût)` → 2. réservation atomique (consume) → 3. exécution
   `AiProvider` → 4. `AiUsage` (succès) → 5. en cas d'échec : `refund` + `AiUsage(failed)`.
Historique complet consultable (opération, date, coût, utilisateur, résultat).

### 9.3 Abonnement (CDC §39–41)
Machine d'états : `trialing → active → (past_due) → active|canceled|expired`, `paused` manuel.
- **Seul le webhook/confirmation serveur** modifie le statut (jamais la réponse navigateur).
- Checkout mock : page de confirmation simulée qui déclenche le webhook signé (flux complet testé).
- Factures générées serveur (PDF `pdfkit`), archivées.
- Expiration du trial : passage `trialing → expired`, fonctions payantes verrouillées, bannière
  « passer au plan Pro », **aucune suppression de données**.

### 9.4 Check-in & anti-réutilisation (CDC §25–27)
Transaction `scan(token, agentId, entryPoint, clientUuid)`, idempotente par `client_uuid` :
1. Résoudre token → invitation → événement (sinon **INVALIDE**, générique).
2. Vérifier agent autorisé sur l'événement + point d'entrée (sinon INVALIDE générique).
3. Vérifier statut/expiration (sinon **INVALIDE**/**EXPIRED**).
4. Si `checked_in_at` existante :
   - `allow_multiple_entries = true` → **VALIDE** (multi-entrée autorisée, horodatage mis à jour) ;
   - sinon → **DÉJÀ UTILISÉ** (heure du précédent scan, agent selon permissions).
5. Sinon : marquer `checked_in_at`, `presence_status = present`, `CheckIn(valid)`,
   `UsageCounter`/stats temps réel, `ActivityLog(scan.valid)`.
Résultat : `{ status, guest {name, category, table, photo?}, welcome, meta }` — la photo
n'est renvoyée que si `ScannerAgent.permissions.can_view_photo`.

### 9.5 Tokens (CDC §22–23)
`token = base64(crypto.randomBytes(32))` (43 chars) — aléatoire, non prédictible, **aucune donnée
personnelle**, sans lien avec email/nom. Table dédiée, unique global, révocable, expirable.
URL publique : `/i/{token}`. Le serveur résout et autorise (événement, invitation, statut,
expiration, usage, droits).

### 9.6 Mode hors ligne scanner (CDC §28) — synthèse (doc dédiée `OFFLINE_SCANNER.md`)
1. **Pré-synchro** : `GET /api/scanner/sync` renvoie les invitations autorisées de l'événement
   (token → {id, statut, checked_in_at, allow_multiple_entries, min guest info selon permissions}).
2. **Cache local sécurisé** : IndexedDB (chiffré par clé dérivée de la session), TTL, purge à
   déconnexion.
3. **Scan hors ligne** : résolution locale, même règles que §9.4 ; `client_uuid` (UUID v4 généré
   côté agent) = clé d'idempotence.
4. **Journal local** : chaque scan hors ligne est append-only dans IndexedDB + localStorage.
5. **Synchronisation** : au retour du réseau, POST batch `{scans[]}` → le serveur rejoue §9.4
   en transaction ; doublons de `client_uuid` ignorés (idempotent).
6. **Conflits** : si le serveur dit « déjà utilisé » (scan en ligne entre-temps) → l'entrée
   offline est marquée `result=already_used` et l'agent est notifié ; la source de vérité est
   toujours le serveur. Documenté + tests unitaires de replay.

### 9.7 Automatisations (CDC §30)
Job 1 min : pour chaque `Automation.active`, évaluer `trigger` (+ `condition_json`) sur les
événements concernés ; action = créer/lancer une campagne ciblée ou notifier.
Exemples implémentés : `rsvp_confirmed → envoyer QR` ; `event_48h & rsvp_pending → rappel` ;
`location_changed → notifier invités concernés`. Activables/désactivables, journalisées.

### 9.8 Webhooks (CDC §60)
`POST /api/webhooks/{provider}` : vérification signature (HMAC) → insert `WebhookEvent`
(unique `provider_event_id`) → traitement idempotent → `processed_at`. Retries avec backoff
(file jobs). En mock : le « fournisseur » mock appelle ce même endpoint avec signature valide.

### 9.9 ActivityLog (CDC §50)
Événements : login, register, event.create/update/delete/duplicate/publish, import.run,
export.run, invite.generate, invite.send, rsvp.update, payment.succeeded/failed,
subscription.changed, scan.valid/invalid, admin.*. Pas de mots de passe, pas de corps d'e-mails,
pas de coordonnées complètes (tronquées/hashees dans `meta_json`).

---

## 10. UI / UX

### 10.1 Design system
- **Style** : premium, épuré, élégant (CDC §55) — palette : encre `#0F172A`, neutres zinc,
  accent or `#C9A227` (premium) + accent secondaire indigo ; cartes arrondies douces,
  ombres légères, typographie sans-serif (Inter) + serif d'accent pour les titres événementiels
  (Playfair Display) — cohérent « invitations élégantes ».
- Composants : cartes, tableaux (pagination), graphiques (recharts), modales, assistants
  (steppers), toasts (sonner), skeletons, empty states illustrés, dark/light (toggle, persisté).
- **Mobile-first** : layout 1 colonne → sidebar rétractable → drawer mobile ; le scanner est un
  écran plein format caméra ; le studio a une variante mobile (panneaux en bottom-sheets).

### 10.2 États obligatoires (CDC §66) — partout
`loading` (skeletons/spinners) · `success` (toast + rafraîchissement) · `empty` (CTA explicite,
ex. « Ajoutez votre premier invité ») · `error` (message compréhensible + solution §73) ·
`unauthorized` (403, action suggérée) · `not found` (404) · `offline` (badge scanner, queue).
**Aucune page vide sans explication.**

### 10.3 i18n & devises
- `next-intl` : `fr.json` / `en.json` ; aucun texte codé dans les composants ; formatage des
  dates/nombres par locale ; fuseau de l'événement respecté (affichage local + UTC stocké).
- Devises (CDC §53) : `PlanPrice` par devise ; affichage dans la devise de l'organisation ;
  montants en unités mineures (CDF : entiers, sans centimes).

---

## 11. Stratégie de tests

| Niveau | Outil | Cibles |
|---|---|---|
| Unité | vitest | `QuotaService` (conso/refund/limits), `checkin` (valide/déjà utilisé/invalide/multi-entrée/idempotence clientUuid), **isolement cross-tenant** (critère P), tokens (non-prédictibilité, révocation), RSVP (transitions), import (mapping, doublons, lignes invalides), machine d'états abonnement, templates de notification (variables), calcul stats |
| Intégration | vitest + Prisma (SQLite temp) | API routes : auth → tenant → CRUD → scan ; webhook paiement (signature + double livraison idempotente) |
| E2E | Playwright | Parcours A→F ; critères d'acceptation A–P (§74) ; scan via URL (pas de caméra en CI) |

Gate : **ne pas casser les fonctionnalités existantes** (CDC §72) — la suite passe à chaque phase.

---

## 12. Plan d'implémentation par phases

> Ordre imposé par le CDC §72, ajusté ; chaque phase : code → tests → corrections → **jamais de
> régression**. Livrables finaux (§75) produits au fil de l'eau.

| # | Phase | Périmètre | Exit criteria |
|---|---|---|---|
| 0 | **Scaffolding** | Next.js 15 + TS, Tailwind/shadcn, next-intl (fr/en), Prisma (SQLite), vitest, lint, `.env.example`, structure §6, design system de base (layout public/app/admin, states, toasts) | `npm run dev` OK ; page de health ; i18n basique ; CI lint/test passe |
| 1 | **Base de données** | `schema.prisma` complet (§4), migrations, seeders (plans Starter/Pro/Business + prix × 3 devises, 20 types d'événements, templates plateforme ≥ 9, roles, templates de notifications, super admin) | Migrations propres ; seed reproductible ; tests schéma (index, uniques) |
| 2 | **Authentification** | Register/login/logout, Argon2id, sessions (appareil/IP), vérification e-mail (mock outbox), reset mot de passe, changement mdp, protection des routes, rate limiting, écran « sessions & appareils » | Parcours A partie 1 testé (unit + e2e) ; sessions révocables |
| 3 | **Multi-tenancy & SaaS** | Organization, membres, rôles + matrice permissions, `UserActiveOrg`, onboarding workspace, `QuotaService`, plans configurables, souscription trial (configurable), écran quota, flag super admin | Critère P unit-testé (cross-tenant 403/404) ; un utilisateur B n'accède à rien de A |
| 4 | **Dashboard & onboarding** | KPIs dashboard (événements, invités, RSVP, arrivées, envoyés, quotas, crédits IA, statut abo) + actions rapides ; assistant onboarding 7 étapes (skippable, retour arrière) | Un nouveau user atteint « premier événement créé » en < 5 min |
| 5 | **Événements** | CRUD complet (tous champs CDC §10), options (QR/RSVP/SMS/… ), personnes principales + photos, dupliquer/archiver/supprimer (politique)/publier, **page publique `/e/[slug]`** mobile-first (compte à rebours, lieu, programme, RSVP, galerie, livre d'or — sections optionnelles) | Critères C ; page publique rendue pour chaque option on/off |
| 6 | **Invités** | CRUD, recherche/filtres/tris, **pagination**, import CSV/Excel (upload → mapping → aperçu → validation → doublons → correction → confirmation), tables (capacité, occupation `8/10`), préférences, export | Critères E/F (partie invités) ; import de 300 lignes avec 3 erreurs gérées (toast §67) |
| 7 | **Studio & design** | Bibliothèque templates (métadonnées §13, admin CRUD), upload médias (compression, miniatures, quota, signed URLs), **éditeur visuel** (texte/imagen/formes/QR/arrière-plan, undo/redo, autosave, préviews desktop/mobile/impression), génération Save the Date (8 styles, multiples compositions) & invitation, export PNG/PDF | Critère D/F ; un design créé et exporté sans refresh ; autosave vérifiée |
| 8 | **Invitations, QR, RSVP** | Génération en lot (1 invitation + token + QR unique par invité), page publique `/i/[token]`, RSVP (statuts + questions personnalisées), QR scannable, anti-énumération | Critères G/H ; RSVP complet depuis un téléphone (URL de préview) |
| 9 | **Contrôle d'accès** | Agents (invitation, événement autorisé, point d'entrée, permissions), écran scanner (caméra + saisie manuelle), résultats VALIDE/DÉJÀ UTILISÉ/INVALIDE, historique, recherche invité, **mode hors ligne v1** (pré-synchro + journal + resync), `allow_multiple_entries` | Critères I/K/L ; tests replay offline ; anti double-entrée testée |
| 10 | **Communications** | Templates (variables `{{…}}`), campagnes (invitation/confirmation/rappel/changement/custom), quotas SMS/e-mail, **outbox démo** (mock identifié), automatisations (les 3 exemples §30), notifications produit | Rappels envoyés (mock) + journalisés ; automation `rsvp_confirmed→QR` vérifiée |
| 11 | **Billing** | `PaymentProvider` mock (checkout simulé → **webhook signé + idempotent** → statut), factures PDF, annulation/renouvellement, plans modifiables par admin (prix/quotas/features), devises USD/CDF/EUR, post-trial (verrouillage, données conservées) | Critère O ; double livraison webhook = 1 effet ; aucun état d'abo modifié côté client |
| 12 | **Stats, rapports, livre d'or** | KPIs événements (tous les KPIs §36), graphiques (évolution RSVP, arrivées/heure, présence/catégorie, occupation tables), rapports exportables (PDF/CSV/XLSX), livre d'or (modération, export) | Critères M/N ; exports cohérents avec DB |
| 13 | **IA** | `AiProvider` mock (compositions déterministes + textes), endpoint `/api/ai/generate`, cycle crédits complet (réservation → succès/échec → remboursement), historique crédits, intégration au studio (propose des designs exploitables) | Prompt CDC §18 → proposition éditée dans le studio ; échec fournisseur = crédit remboursé (test) |
| 14 | **Super Admin** | Dashboard global (tous KPIs §46), utilisateurs/organisations/événements, plans (CRUD §47), templates (CRUD §48 + vedette), crédits IA, logs, analytics SaaS (métriques descriptives §49), paramètres plateforme (trial_days, flags) | Un admin peut créer un plan et voir ses quotas s'appliquer chez un client |
| 15 | **Finitions** | Tests complets (unit + e2e A–P), docs (`API.md`, `OFFLINE_SCANNER.md`, `DEPLOYMENT.md`), `.env.example` final, perfs (lazy, pagination, cache dashboard), accessibilité (contrastes, clavier, focus), dark mode, polish premium | **Critères d'acceptation A–P tous verts** ; README d'installation/déploiement |

**Mapping priorités CDC §71** : P0 = phases 0–9 ; P1 = phases 10–12 (+3) ; P2 = 13 (+7 studio avancé, 9b offline complet) ; P3 = hors périmètre MVP (agences multi-clients, white label, app native, marketplace) — structures préparées (plan `white_label`, org→events→guests, flags) mais non livrées dans ce premier tronçon.

---

## 13. Simplifications & réserves (signalées, CDC §76)

1. **Éditeur visuel** : MVP = positionnement absolu + transforms (drag, resize, rotation),
   styles texte complets (CDC §14), masques d'images basiques. Pas de vectoriel avancé ni de
   collaboration temps réel. Améliorations itérables sans changer le modèle `elements_json`.
2. **IA mock** : compositions déterministes (templates × styles × données événement) —
   clairement identifiées « démo » ; aucune fausse promesse de génération neuronale.
3. **BDD sandbox = SQLite** (pas de PostgreSQL installé ici) ; schéma 100 % portable,
   migration prod documentée.
4. **WhatsApp** : interface prête, mais seule l'API officielle Meta sera jamais branchée (§33).
5. **CDF** : montants sans centimes ; conversion fixe par devise (pas de taux de change en temps
   réel dans l'MVP).
6. **Push notifications** : interface `PushProvider` + mock ; PWA/FCM = P3.
7. **Agences / white label** (CDC §44–45) : structure préparée (quota, flags, champs),
   pas de livrable UI dans ce tronçon.
8. **Vérification e-mail réelle** : mock (lien visible dans l'outbox démo) car pas de SMTP ici ;
   le flux complet (token, expiration, un-usage) est réel et testé.

**Ajouts Phase 5 :**

9. **Photos des personnalités** : avatars à initiales affichés ; les vraies photos (upload,
   miniatures, quota) arrivent avec le module médias (Phase 7) — le champ `mediaId` est déjà
   prévu sur `EventMember`.
10. **Livre d'or auto-validé** : les dépôts publics sont publiés immédiatement (statut
    `approved` inséré) ; le champ de statuts (pending/approved/rejected) et la file de
    modération arrivent en Phase 12. Le dépôt est limité par rate limiting (`guestbook`).
11. **RSVP/QR en blocs d'information** sur la page publique (le flux RSVP complet, les QR
    uniques par invité et le check-in arrivent en Phase 8) ; la galerie est un placeholder
    (Phase 7) ; la duplication copie config + options **sans** les invités.

**Ajouts Phase 6 :**

12. **Import** : les lignes parsées sont conservées en mémoire client pendant le flux
    (mapping → aperçu → correction) ; le serveur **re-valide toutes les lignes** à la
    confirmation (source de vérité : format, tables, doublons existants + intra-fichier,
    quota « toute ou rien ») et l'`ImportJob` journalise fichiers, comptes et erreurs.
    XLSX : 1ʳᵉ feuille, max 5 000 lignes.
13. **Export invités** : CSV (`;` + BOM UTF-8) avec filtres appliqués ; les exports
   PDF/XLSX des rapports arrivent en Phase 12.

**Ajouts Phase 7 :**

14. **Export PDF** : PDFKit = polices base-14 uniquement → `display`→Times, `sans`→Helvetica
   (pas d'embedding des polices web) ; retex estimé (largeur moyenne de caractère) ;
   emoji non supportés en PDF (fallback `•`) ; dégradé rendu haut→bas (approximation de
   l'angle CSS) ; l'export est journalisé (`MediaFile kind=export`, rétention §33).
15. **Export PNG** : rendu SVG → libvips (sharp) ; retex textuel approché (métriques de
   caractères moyennes, pas de mesure de police côté serveur) ; les glyphes emoji ne
   s'affichent que si une police les fournit dans l'environnement de rendu.
16. **Save the Date « multiples compositions »** : MVP = 8 styles STTD (minimal, luxe or,
   floral, gala, contemporain africain, corporate, romantique, story 9:16) + composition de
   plusieurs designs liés au même événement ; pas de design multi-pages dans ce tronçon.
17. **Médias publics** : `/api/storage/[key]` est public (les médias partagés via les
   invitations le sont par nature, CDC liens publics) ; clés non devinables (cuid/hex) ;
   URLs signées temporisées = prod (P15). Quota `storageMb` appliqué à l'upload
   (compression ≤ 2048 px qualité 82 + vignette 320 px ; fichiers non-images stockés tels
   quels ≤ 8 Mo).

**Ajouts Phase 8 :**

18. **Invitation = lien + QR unique par invité** : un lot d'invitations crée, pour chaque
   invité sans invitation, 1 `Invitation` + 1 `InvitationToken` (32 octets aléatoires,
   encodés base62, **sans PII** — le token ne doit pas permettre de deviner un email) +
   1 `QRCode`. Idempotent (`guestId @unique` sur `Invitation` : relancer le lot ne crée
   pas de doublon). Le QR encode `APP_URL + /i/<token>`. En sandbox `APP_URL` =
   `http://localhost:3000` (QR « pointant » vers le serveur local) ; en prod la variable
   `APP_URL` pointe sur le domaine réel. Le QR est *redessiné* côté client (data-URI) pour
   la page publique et la liste admin — la colonne `QRCode.data` reste l'URL source.
19. **Anti-énumération** : même réponse **404** pour token inconnu, révoqué, expiré, et
   pour événement non publié (aucun leak de statut différent). La regex de longueur sur le
   token évite les requêtes de base inutiles. La vue publique n'expose **ni email ni
   téléphone** de l'invité.
20. **RSVP public** : page `/i/[token]` mobile-first. Statuts `confirmed`/`maybe`/`declined`
   + accompagnants (0–30) + questions personnalisées (text/number/choice, requises ou non,
   max 10 questions, choix 2–10 valeurs). « En attente » = invitations **sans** RSVP.
   Le RSVP est clos (403) après la fin de l'événement (date + `endTime`, UTC — approximation)
   et désactivable par option d'événement (`options.rsvp`, 403). Synchronise
   `Guest.rsvpStatus`. Rate limiting par IP+route (`RATE_LIMIT_PUBLIC_RSVP_PER_MIN`, défaut
   10/min, 429 + `Retry-After`).
21. **Statut d'invitation** : reste `draft` à la génération ; le passage à `sent` (et les
   rappels) est fait par les communications (Phase 10) — on ne simule pas un envoi.
   Révocation = `token.revokedAt` + `invitation.status=expired` (plus de vue publique,
   plus de RSVP).

**Ajouts Phase 9 :**

22. **Check-in = une ligne par invité** (`CheckIn.guestId @unique`) : la ligne est l'état
   *courant* du passage. 1er scan → création (`result=valid`, `checked_in_at`,
   `presence_status=present`) ; 2e scan sans multi-entrée → **pas de ligne** (résultat
   `already_used` + audit `ActivityLog scan.already_used` — le re-scan redonne le même
   résultat, idempotence sans état) ; multi-entrée → mise à jour de la ligne (horodatage
   actualisé, `result=valid`). Scans `invalid`/`expired` résolus (token révoqué/expiré,
   événement non publié) → ligne auditée. `clientUuid` = clé d'idempotence du replay
   hors ligne (même uuid → même résultat, aucune écriture).
23. **Agent de scan** : credential = token opaque (32B) lié à **un** événement ; pas de
   compte requis (agent éphémère du jour) ; permissions `canViewPhoto`/`canSearch`/
   `canSeeHistory` (`permissionsJson`). Un agent ne scanne que son événement (sinon
   `agent_denied`, réponse générique identique aux autres erreurs). Activation/
   désactivation instantanée (désactivé → refus).
24. **Photo d'invité** : le modèle `Guest` n'a pas de champ photo → `photoUrl: null`
   dans le résultat de scan ; la permission `canViewPhoto` est portée pour l'avenir
   (ajout du champ = migration future, pas de changement de contrat API).
25. **Hors ligne (CDC §28, MVP)** : pré-sync `GET /api/scanner/sync` (≤ 2000 invitations,
   token → {guest min, checkedInAt, expiresAt, allowMultipleEntries}) ; journal local
   **append-only dans localStorage** (pas d'IndexedDB chiffré — réservé prod) ; scan hors
   ligne = mêmes règles que §9.4 appliquées sur le cache ; au retour réseau,
   `POST /api/scanner/sync` rejoue en batch (≤ 200) avec les mêmes règles serveur ;
   conflit (scan en ligne entre-temps) → le scan offline est re-qualifié `already_used`
   côté agent ; **le serveur reste la source de vérité** (replay idempotent par
   clientUuid). TTL/purge = à déconnexion (nettoyage du cache local).
26. **Caméra** : `BarcodeDetector` natif (QR) si disponible, sinon saisie manuelle du
   token ou du lien complet (le QR encode `APP_URL/i/<token>` → dernier segment du
   chemin = token). Pas de dépendance JS de scan. Rate limiting `RATE_LIMIT_SCAN_PER_MIN`
   (60/min/IP) sur scan et sync.

---

## 14. Points à valider avant la Phase 0

1. **Stack** : Next.js 15 + Prisma (SQLite sandbox → PostgreSQL prod) + Tailwind/shadcn — OK ?
2. **DB sandbox** : SQLite (vraies migrations, zéro infra) — OK ? (Alternative : installer
   PostgreSQL dans la sandbox si préféré.)
3. **Éditeur visuel MVP** : périmètre §13.1 — OK ?
4. **Périmètre de ce sprint** : phases 0→15 complètes (MVP commercial P0+P1+P2 partiel) — OK ?
5. **Langue UI par défaut** : français (EN en i18n) — OK ?

> Validation reçue → démarrage Phase 0 (scaffolding), puis Phase 1 (base de données) dans la
> foulée, avec vérification et tests à chaque phase.
