import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/crypto';
import { assertQuota, assertWritable } from '@/server/services/quotas';
import { tenantWhere, type TenantContext } from '@/server/services/tenant';
import { logActivity } from '@/server/services/activity';
import { createEventSchema } from '@/lib/schemas/event';
import type z from 'zod';

export type CreateEventInput = z.input<typeof createEventSchema>;

/**
 * Événements (CDC §10). Phase 4 : création minimale + liste paginée avec
 * KPIs ; Phase 5 : CRUD complet, options avancées, page publique.
 */

const DEFAULT_OPTIONS = {
  qr: true,
  rsvp: true,
  sms: false,
  email: false,
  whatsapp: false,
  guestbook: false,
  preferences: false,
  tables: false,
  gallery: false,
  countdown: true,
};

async function uniqueEventSlug(tx: { event: typeof prisma.event }, base: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const exists = await tx.event.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  throw new Error('event_slug_collision');
}

export async function createEvent(
  ctx: TenantContext,
  input: CreateEventInput,
  ip: string | null = null,
): Promise<{ id: string; slug: string }> {
  if (!ctx.organization) throw new Error('event_no_org');
  const orgId = ctx.organization.id;

  // Contrôle essai + quota événements (CDC §59)
  await assertWritable(orgId);
  await assertQuota(ctx, 'events', 1);

  const type = await prisma.eventType.findUnique({ where: { code: input.typeCode } });
  if (!type) throw new Error('event_type_invalid');

  const options = { ...DEFAULT_OPTIONS, ...(input.optionsJson ?? {}) };
  const baseSlug = (slugify(input.name) || 'evenement').slice(0, 60);

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: input.name,
      typeCode: input.typeCode,
      slug: await uniqueEventSlug(prisma, baseSlug),
      date: new Date(`${input.date}T00:00:00`),
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      timezone: input.timezone,
      venue: input.venue,
      address: input.address || null,
      city: input.city || null,
      country: input.country || null,
      description: input.description || null,
      contactPhone: input.contactPhone || null,
      contactEmail: input.contactEmail || null,
      dressCode: input.dressCode || null,
      practicalInfo: input.practicalInfo || null,
      optionsJson: options,
      status: 'draft',
    },
  });

  await logActivity({
    organizationId: orgId,
    userId: ctx.user.id,
    action: 'event.create',
    entity: 'event',
    entityId: event.id,
    meta: { name: input.name, type: input.typeCode },
    ip,
  });

  return { id: event.id, slug: event.slug };
}

export interface EventListItem {
  id: string;
  name: string;
  slug: string;
  typeCode: string;
  date: Date;
  startTime: string;
  venue: string;
  city: string | null;
  status: string;
  guests: number;
  rsvpConfirmed: number;
  rsvpTotal: number;
  createdAt: Date;
}

export interface PagedEvents {
  items: EventListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Liste paginée des événements de l'organisation + KPIs par événement. */
export async function listEvents(
  organizationId: string,
  page = 1,
  pageSize = 10,
): Promise<PagedEvents> {
  const where = tenantWhere(organizationId);
  const [total, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { guests: true } },
      },
    }),
  ]);

  const ids = rows.map((r) => r.id);
  const rsvpAgg = ids.length
    ? await prisma.rsvp.groupBy({
        by: ['eventId', 'status'],
        where: { eventId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const rsvpByEvent = new Map<string, { total: number; confirmed: number }>();
  for (const g of rsvpAgg) {
    const cur = rsvpByEvent.get(g.eventId) ?? { total: 0, confirmed: 0 };
    cur.total += g._count._all;
    if (g.status === 'confirmed') cur.confirmed += g._count._all;
    rsvpByEvent.set(g.eventId, cur);
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      typeCode: r.typeCode,
      date: r.date,
      startTime: r.startTime,
      venue: r.venue,
      city: r.city,
      status: r.status,
      guests: r._count.guests,
      rsvpConfirmed: rsvpByEvent.get(r.id)?.confirmed ?? 0,
      rsvpTotal: rsvpByEvent.get(r.id)?.total ?? 0,
      createdAt: r.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Récupère un événement en forçant le tenant (404 s'il n'appartient pas à l'org). */
export async function getEventForOrg(eventId: string, organizationId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, ...tenantWhere(organizationId) },
  });
  if (!event) return null;
  return event;
}
