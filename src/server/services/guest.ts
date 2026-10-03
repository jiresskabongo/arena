import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { getSubscriptionView } from '@/server/services/subscription';
import { logActivity } from '@/server/services/activity';
import { addGuestSchema } from '@/lib/schemas/event';
import type z from 'zod';

export type AddGuestInput = z.input<typeof addGuestSchema>;

/**
 * Invités (CDC §11). Phase 4 : ajout minimal (onboarding) ;
 * Phase 6 : CRUD complet, filtres, import CSV/Excel, tables.
 */
export async function addGuest(
  ctx: TenantContext,
  eventId: string,
  input: AddGuestInput,
  ip: string | null = null,
): Promise<{ id: string }> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const orgId = ctx.organization.id;

  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  // Quota invités PAR ÉVÉNEMENT (CDC §59)
  const sub = await getSubscriptionView(orgId);
  const limit = sub ? Number((sub.plan.limits as Record<string, unknown>).guestsPerEvent ?? 0) : 0;
  const current = await prisma.guest.count({
    where: { eventId, ...tenantWhere(orgId) },
  });
  if (limit > 0 && current + 1 > limit) {
    throw new TenantError(403, 'quota_exceeded', `Quota atteint : ${current}/${limit} invités par événement.`);
  }

  const guest = await prisma.guest.create({
    data: {
      eventId,
      organizationId: orgId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || null,
      phone: input.phone || null,
      category: input.category,
      tableId: input.tableId ?? null,
    },
  });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'guest.create',
    entity: 'guest',
    entityId: guest.id,
    meta: { eventId },
    ip,
  });

  return { id: guest.id };
}
