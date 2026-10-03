import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { can, isOrgRole, type OrgRole } from '@/server/services/permissions';
import { assertQuota } from '@/server/services/quotas';
import { logActivity } from '@/server/services/activity';
import { emailProvider, getTemplate, renderTemplate } from '@/server/providers/email';
import type { InviteMemberInput } from '@/lib/schemas/event';

/**
 * Équipe (CDC §12, R2). L'invitation est un e-mail mock (outbox) avec lien
 * d'inscription : l'invité crée son compte avec CETTE adresse, puis rejoint
 * l'organisation au premier login (voir acceptInvite par e-mail).
 */

const ROLE_LABELS: Record<string, { fr: string; en: string }> = {
  owner: { fr: 'Propriétaire', en: 'Owner' },
  manager: { fr: 'Gestionnaire', en: 'Manager' },
  designer: { fr: 'Designer', en: 'Designer' },
  scanner: { fr: 'Agent de contrôle', en: 'Scanner agent' },
  viewer: { fr: 'Lecture seule', en: 'Viewer' },
};

export function roleLabel(role: string, locale: 'fr' | 'en'): string {
  return ROLE_LABELS[role]?.[locale] ?? role;
}

export async function inviteMember(
  ctx: TenantContext,
  input: InviteMemberInput,
  ip: string | null = null,
): Promise<{ id: string; email: string; role: string }> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const orgId = ctx.organization.id;
  const email = input.email.toLowerCase();

  // 1. Un compte existe déjà avec cet e-mail → impossible de l'inviter ici
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new TenantError(409, 'account_exists', 'Cette adresse possède déjà un compte EventFlow.');
  }
  // 2. Déjà membre (actif) ou invitation en attente
  const existingMember = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, invitedEmail: email, status: { not: 'removed' } },
  });
  if (existingMember) {
    throw new TenantError(409, 'member_exists', 'Cette personne est déjà membre ou invitée.');
  }

  // 3. Quota collaborateurs
  await assertQuota(ctx, 'members', 1);

  const member = await prisma.organizationMember.create({
    data: {
      organizationId: orgId,
      invitedEmail: email,
      role: input.role,
      status: 'invited',
      invitedBy: ctx.user.id,
    },
  });

  // 4. E-mail d'invitation (mock — outbox)
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const locale = ctx.organization.locale as 'fr' | 'en';
  const tpl = await getTemplate('invite_member', 'email', orgId, locale);
  const vars = {
    inviter_name: `${ctx.user.firstName} ${ctx.user.lastName}`,
    organization_name: ctx.organization.name,
    role_label: roleLabel(input.role, locale),
    invitation_url: `${appUrl}/register`,
  };
  await emailProvider.send({
    to: email,
    organizationId: orgId,
    templateKey: 'invite_member',
    subject: renderTemplate(tpl?.subject || 'Invitation EventFlow', vars),
    text: renderTemplate(tpl?.body ?? 'Invitation', vars),
  });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'member.invite',
    entity: 'organization_member',
    entityId: member.id,
    meta: { email, role: input.role },
    ip,
  });

  return { id: member.id, email, role: input.role };
}

export interface MemberView {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  isSelf: boolean;
  canEdit: boolean;
}

export async function listMembers(ctx: TenantContext): Promise<MemberView[]> {
  if (!ctx.organization) return [];
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organization.id, status: { not: 'removed' } },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members.map((m) => {
    const isSelf = m.userId === ctx.user.id;
    return {
      id: m.id,
      email: m.user?.email ?? m.invitedEmail ?? '',
      name: m.user ? `${m.user.firstName} ${m.user.lastName}` : null,
      role: m.role,
      status: m.status,
      isSelf,
      canEdit:
        !isSelf &&
        m.role !== 'owner' &&
        (ctx.isSuperAdmin || (ctx.role !== null && can(ctx.role, 'members:remove'))),
    };
  });
}

export async function changeMemberRole(
  ctx: TenantContext,
  memberId: string,
  newRole: OrgRole,
): Promise<void> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  if (newRole === 'owner') throw new TenantError(400, 'invalid_role', 'Impossible de créer un second propriétaire.');
  if (!isOrgRole(newRole)) throw new TenantError(400, 'invalid_role', 'Rôle invalide.');

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, ...tenantWhere(ctx.organization.id) },
    include: { user: true },
  });
  if (!member) throw new TenantError(404, 'member_not_found', 'Membre introuvable.');
  if (member.role === 'owner') throw new TenantError(403, 'owner_protected', 'Le rôle propriétaire ne peut pas être modifié.');

  await prisma.organizationMember.update({ where: { id: member.id }, data: { role: newRole } });
  await logActivity({
    organizationId: ctx.organization.id,
    userId: ctx.user.id,
    action: 'member.role_change',
    entity: 'organization_member',
    entityId: member.id,
    meta: { email: member.user?.email ?? member.invitedEmail, newRole },
  });
}

export async function removeMember(ctx: TenantContext, memberId: string): Promise<void> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, ...tenantWhere(ctx.organization.id) },
    include: { user: true },
  });
  if (!member) throw new TenantError(404, 'member_not_found', 'Membre introuvable.');
  if (member.userId === ctx.user.id) throw new TenantError(400, 'self_removal', 'Vous ne pouvez pas vous retirer ici.');
  if (member.role === 'owner') throw new TenantError(403, 'owner_protected', 'Le propriétaire ne peut pas être retiré.');

  await prisma.$transaction([
    prisma.organizationMember.update({ where: { id: member.id }, data: { status: 'removed' } }),
    prisma.userActiveOrg.deleteMany({ where: { userId: member.userId! } }),
  ]);
  await logActivity({
    organizationId: ctx.organization.id,
    userId: ctx.user.id,
    action: 'member.remove',
    entity: 'organization_member',
    entityId: member.id,
    meta: { email: member.user?.email ?? member.invitedEmail },
  });
}

