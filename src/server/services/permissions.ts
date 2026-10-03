/**
 * Matrice de permissions par rôle (CDC §9-12).
 * SuperAdmin (plateforme) bypass ces vérifications — géré dans requireTenant.
 * Vérification TOUJOURS côté serveur ; le rôle client est ignoré.
 */

export const ROLES = ['owner', 'manager', 'designer', 'scanner', 'viewer'] as const;
export type OrgRole = (typeof ROLES)[number];

export type Permission =
  | 'event:create'
  | 'event:update'
  | 'event:delete'
  | 'guest:read'
  | 'guest:invite'
  | 'guest:import'
  | 'guest:delete'
  | 'rsvp:read'
  | 'checkin:scan'
  | 'checkin:manage'
  | 'design:create'
  | 'design:update'
  | 'design:delete'
  | 'design:export'
  | 'design:use_premium_template'
  | 'stats:read'
  | 'stats:advanced'
  | 'stats:export'
  | 'comm:send'
  | 'ai:use'
  | 'billing:read'
  | 'billing:manage'
  | 'members:read'
  | 'members:invite'
  | 'members:remove'
  | 'members:change_role'
  | 'settings:org';

const OWNER_MANAGER: readonly OrgRole[] = ['owner', 'manager'];
const CREATIVE: readonly OrgRole[] = ['owner', 'manager', 'designer'];
const EVERYONE: readonly OrgRole[] = ['owner', 'manager', 'designer', 'scanner', 'viewer'];

const MATRIX: Record<Permission, readonly OrgRole[]> = {
  'event:create': CREATIVE,
  'event:update': CREATIVE,
  'event:delete': OWNER_MANAGER,
  'guest:read': EVERYONE,
  'guest:invite': CREATIVE,
  'guest:import': OWNER_MANAGER,
  'guest:delete': OWNER_MANAGER,
  'rsvp:read': EVERYONE,
  'checkin:scan': ['owner', 'manager', 'scanner'],
  'checkin:manage': OWNER_MANAGER,
  'design:create': CREATIVE,
  'design:update': CREATIVE,
  'design:delete': OWNER_MANAGER,
  'design:export': CREATIVE,
  'design:use_premium_template': CREATIVE, // + contrôle du feature plan (subscription.hasFeature)
  'stats:read': EVERYONE,
  'stats:advanced': OWNER_MANAGER,
  'stats:export': OWNER_MANAGER,
  'comm:send': OWNER_MANAGER,
  'ai:use': CREATIVE,
  'billing:read': OWNER_MANAGER,
  'billing:manage': ['owner'],
  'members:read': OWNER_MANAGER,
  'members:invite': OWNER_MANAGER,
  'members:remove': OWNER_MANAGER,
  'members:change_role': ['owner'],
  'settings:org': ['owner'],
};

/** Un rôle a-t-il la permission ? (permission inconnue → false) */
export function can(role: OrgRole, permission: Permission): boolean {
  const allowed = MATRIX[permission];
  return allowed ? allowed.includes(role) : false;
}

/** Rôles autorisés pour une permission (affichage UI : aider les owners à attribuer les bons rôles). */
export function rolesFor(permission: Permission): readonly OrgRole[] {
  return MATRIX[permission] ?? [];
}

export function isOrgRole(value: string): value is OrgRole {
  return (ROLES as readonly string[]).includes(value);
}
