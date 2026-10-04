import { prisma } from '@/lib/prisma';
import { getAuth } from '@/server/auth/session';
import { can, isOrgRole, type OrgRole, type Permission } from '@/server/services/permissions';
import type { User } from '@prisma/client';

/**
 * Multi-tenancy (CDC §6) : le tenant est dérivé UNIQUEMENT de la session.
 * Tout `organization_id` envoyé par le client est ignoré ; chaque requête
 * serveur passe par requireTenant() puis filtre par tenantWhere(orgId).
 */

export class TenantError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TenantOrg {
  id: string;
  name: string;
  slug: string;
  currency: string;
  locale: string;
  timezone: string;
  isActive: boolean;
}

export interface TenantContext {
  user: User;
  isSuperAdmin: boolean;
  organization: TenantOrg | null;
  role: OrgRole | null;
}

/**
 * Contexte tenant de la session courante.
 * Lève TenantError(401) si non authentifié, (409) si org inactive.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const auth = await getAuth();
  if (!auth) throw new TenantError(401, 'unauthenticated', 'Connexion requise.');

  const { user } = auth;
  if (user.isSuperAdmin) {
    return { user, isSuperAdmin: true, organization: null, role: null };
  }

  const active = await prisma.userActiveOrg.findUnique({
    where: { userId: user.id },
    include: { organization: true },
  });
  if (!active || !active.organization.isActive) {
    throw new TenantError(409, 'no_active_org', 'Aucune organisation active pour votre compte.');
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { userId: user.id },
  });
  if (!membership || membership.status === 'removed' || !isOrgRole(membership.role)) {
    throw new TenantError(403, 'no_membership', 'Votre compte n’est pas associé à cette organisation.');
  }

  return {
    user,
    isSuperAdmin: false,
    organization: {
      id: active.organization.id,
      name: active.organization.name,
      slug: active.organization.slug,
      currency: active.organization.currency,
      locale: active.organization.locale,
      timezone: active.organization.timezone,
      isActive: active.organization.isActive,
    },
    role: membership.role,
  };
}

/**
 * Contexte tenant + contrôle de permission (CDC §12 : vérification serveur).
 * SuperAdmin passe le contrôle (espace plateforme).
 */
export async function requireTenant(permission?: Permission): Promise<TenantContext> {
  const ctx = await getTenantContext();

  if (ctx.isSuperAdmin || !ctx.organization) return ctx;

  if (permission && !can(ctx.role!, permission)) {
    throw new TenantError(403, 'forbidden', 'Votre rôle ne permet pas cette action.');
  }
  return ctx;
}

/**
 * Garde super admin (espace plateforme, hors tenant) : 401 si non authentifié,
 * 403 si le compte n'a pas le drapeau isSuperAdmin.
 */
export async function requireSuperAdmin(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.isSuperAdmin) {
    throw new TenantError(403, 'forbidden', 'Accès réservé aux administrateurs de la plateforme.');
  }
  return ctx;
}

/**
 * Filtre tenant OBLIGATOIRE pour toute requête multi-tenant (critère d'acceptation P).
 * Ne JAMAIS construire un where d'organisation à la main ailleurs.
 */
export function tenantWhere(organizationId: string): { organizationId: string } {
  return { organizationId };
}
