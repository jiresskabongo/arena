# EventFlow — Scanner d'accès & mode hors-ligne

Contrôle d'accès au contrôle d'entrée (P9) : agents de scan, tokens d'invitation,
file hors-ligne. CDC §27–28.

## Modèle

- **Agent de scan** (`ScannerAgent`) : créé par un membre (`event:update`) pour un
  événement. `{ name, entryPoint, active, permissionsJson }` + **token opaque**
  (HMAC-safe, 16–80 caractères) qui authentifie le poste — pas de session.
  Points d'entrée : `entrance | vip | staff | family | custom`.
  Permissions : `canViewPhoto`, `canSearch`, `canSeeHistory`.
- **Token d'invitation** : chaque invitation publiée porte un token (expirable,
  révocable). Le scan se fait **sur le token**, jamais sur l'identité.

## Scan en ligne

```
POST /api/checkin/scan
Authorization implicit (body) : {
  "agentToken": "...",
  "token": "INV-TOKEN",
  "entryPoint": "vip",          // optionnel — défaut = point d'entrée de l'agent
  "clientUuid": "uuid-local",   // optionnel — idempotence (8–64 car.)
  "clientAt": "ISO-8601",       // optionnel — horodatage appareil
  "deviceId": "android-xxx"     // optionnel
}
```

Réponse `ScanResult` :

```jsonc
{
  "status": "valid",                    // valid | already_used | invalid | expired
  "reason": "unknown_token",            // unknown_token | token_revoked | token_expired
  "guest": { "name": "…", "category": "vip", "rsvpStatus": "confirmed", "companions": 1 },
  "welcome": "Bienvenue, Alice !",      // message d'accueil (null si refus)
  "meta": {
    "checkedInAt": "ISO-8601", "firstCheckedInAt": "ISO-8601",
    "entryPoint": "vip", "first": true, "allowMultipleEntries": false
  }
}
```

Règles (toutes côté serveur) :

| Situation | Résultat | Trace |
|---|---|---|
| Token inconnu | `invalid` / `unknown_token` | ligne `CheckIn result=invalid` + log |
| Token révoqué | `invalid` / `token_revoked` | idem |
| Token expiré | `expired` / `token_expired` | ligne `CheckIn result=expired` |
| Agent inconnu/désactivé | `invalid` / `agent_denied` | réponse 200 (le poste ne doit pas cracher) |
| Événement non publié | `invalid` / `event_not_published` | idem |
| Déjà passé (multi-entrée OFF) | `already_used` | **pas de ligne** — audit `ActivityLog scan.already_used` (réservation P9 : idempotence sans état) |
| Déjà passé (multi-entrée ON) | `valid` (nouveau passage) | ligne `CheckIn` supplémentaire |

**Idempotence `clientUuid`** : un re-scan (double tap, retry réseau) avec le même
`clientUuid` renvoie le **même** résultat sans créer de doublon. Absent → un uuid
serveur est généré.

**Anti-réutilisation** : `Guest.checkedInAt` + `CheckIn` (indexés). La 2ᵉ entrée
n'est autorisée que si `Event.allowMultipleEntries`.

## Mode hors-ligne (CDC §28)

Le scanner (app PWA / téléphone sur le terrain) fonctionne sans réseau :

1. **Pré-synchronisation** — `GET /api/scanner/sync?agentToken=…&since=ISO` :
   - renvoie l'état de l'événement (nom, `eventPublished`, `eventEnd`,
     `allowMultipleEntries`, point d'entrée de l'agent) ;
   - renvoie la **liste des invitations actives** (plafond 2 000) :
     `{ token, guest { name, category, rsvpStatus, companions }, checkedInAt, expiresAt }` ;
   - avec `since` : uniquement les invités touchés depuis (incrémental).
   Le poste stocke cette base localement (SQLite/IndexedDB côté client).

2. **Scan local** : le poste vérifie la base locale (token connu ? déjà passé ?
   expiré ?), affiche immédiatement le résultat **avec bandeau « hors-ligne »**,
   et **enregistre le scan en file locale** :
   `{ clientUuid (génééré au moment du scan), token, entryPoint, clientAt, deviceId }`.

3. **Replay** — `POST /api/scanner/sync` :
   ```jsonc
   { "agentToken": "…", "scans": [ { "clientUuid": "…", "token": "…",
       "entryPoint": "vip", "clientAt": "ISO-8601", "deviceId": "…" } ] }
   ```
   - **maximum 200 scans par batch** (400 `sync_batch_invalid` au-delà) ;
   - chaque scan est **rejoué en ligne** via le même noyau que le scan online
     (`scanCheckIn`) → le serveur reste la source de vérité (règles, quota,
     logs) ;
   - le dédoublement est absorbé par l'**idempotence `clientUuid`** : le replay
     d'un batch déjà partiellement traité ne crée jamais de doublon ;
   - réponse : `{ synced: n, results: [{ clientUuid, status }] }` — le poste
     peut corriger l'affichage local si le verdict serveur diffère
     (ex. token révoqué entre-temps).

4. **Conflits & limites honnêtes** (réserves §13) :
   - le verdict **définitif** est celui du serveur (le local peut afficher un
     résultat provisoire divergent — le bandeau « hors-ligne » le signale) ;
   - un token **révoqué pendant l'hors-ligne** sera refusé au replay
     (`already`-used → `invalid` selon l'état final) ;
   - pas de synchronisation d'invitations créées pendant l'hors-ligne
     (le replay ne connaît que les tokens de la base locale) ;
   - pas de limite de taille stricte sur la file locale côté serveur (200/batch,
     le poste re-essaie jusqu'à succès — chaque replay est idempotent).

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `agent_denied` persistant | Agent désactivé ou événement archivé — re-créer l'agent. |
| `event_not_published` | L'événement est en `draft`/`archived` — le publier. |
| Doubles passages malgré multi-entrée OFF | Vérifier `Event.allowMultipleEntries` ; les `already_used` ne créent pas de ligne (voir `ActivityLog`). |
| Replay refusé 400 | Plus de 200 scans par batch — fractionner la file. |
