import { prisma } from '@/lib/prisma';
import { slugify } from '@/lib/crypto';
import { assertQuota, assertWritable } from '@/server/services/quotas';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { logActivity } from '@/server/services/activity';
import {
  createEventSchema, updateEventSchema, eventMemberSchema,
} from '@/lib/schemas/event';
import type z from 'zod';

/**
 * Événements (CDC §10) — Phase 5 : CRUD complet, statut (publier/archiver/
 * dupliquer/supprimer avec politique), personnes principales, page publique.
 * Photos des personnes/cover : phase 7 (upload médias).
 */

export type CreateEventInput = z.input<typeof createEventSchema>;
export type UpdateEventInput = z.input<typeof updateEventSchema>;

const DEFAULT_OPTIONS = {
  qr: true, rsvp: true, sms: false, email: false, whatsapp: false,
  guestbook: false, preferences: false, tables: false, gallery: false, countdown: true,
};

async function uniqueEventSlug(tx: { event: typeof prisma.event }, base: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const exists = await tx.event.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  throw new Error('event_slug_collision');
}

/** Récupère un événement en forçant le tenant (null → 404 côté route). */
export async function getEventForOrg(eventId: string, organizationId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, ...tenantWhere(organizationId) },
  });
}

async function getOwnedEvent(
  ctx: TenantContext,
  eventId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getEventForOrg>>>> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, ctx.organization.id);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  return event;
}

export async function createEvent(
  ctx: TenantContext,
  input: CreateEventInput,
  ip: string | null = null,
): Promise<{ id: string; slug: string }> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const orgId = ctx.organization.id;

  // Contrôle essai + quota événements (CDC §59)
  await assertWritable(orgId);
  await assertQuota(ctx, 'events', 1);

  const type = await prisma.eventType.findUnique({ where: { code: input.typeCode } });
  if (!type) throw new TenantError(400, 'event_type_invalid', 'Type d’événement inconnu.');

  const options: Record<string, boolean> = { ...DEFAULT_OPTIONS, ...(input.optionsJson ?? {}) };
  const baseSlug = (slugify(input.name) || 'evenement').slice(0, 60);

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: input.name,
      typeCode: input.typeCode,
      slug: await uniqueEventSlug(prisma, baseSlug),
      date: new Date(`${input.date}T00:00:00`),
      startTime: input.startTime,
      endTime: input.endTime || null,
      timezone: input.timezone,
      venue: input.venue,
      address: input.address || null,
      city: input.city || null,
      country: input.country || null,
      description: input.description || null,
      contactPhone: input.contactPhone || null,
      contactEmail: input.contactEmail || null,
      website: input.website || null,
      dressCode: input.dressCode || null,
      practicalInfo: input.practicalInfo || null,
      welcomeMessage: input.welcomeMessage || null,
      allowMultipleEntries: input.allowMultipleEntries ?? false,
      optionsJson: options,
      status: 'draft',
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'event.create',
    entity: 'event', entityId: event.id, meta: { name: input.name, type: input.typeCode }, ip,
  });

  return { id: event.id, slug: event.slug };
}

/** Mise à jour complète (tous les champs CDC §10). */
export async function updateEvent(
  ctx: TenantContext,
  eventId: string,
  input: UpdateEventInput,
  ip: string | null = null,
): Promise<{ id: string; slug: string }> {
  const event = await getOwnedEvent(ctx, eventId);

  // Si le nom change, le slug change avec (la page publique suit)
  const rename = input.name && input.name !== event.name;
  const options =
    input.optionsJson !== undefined
      ? { ...JSON.parse(JSON.stringify(event.optionsJson)), ...input.optionsJson }
      : undefined;

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.typeCode !== undefined ? { typeCode: input.typeCode } : {}),
      ...(input.date !== undefined ? { date: new Date(`${input.date}T00:00:00`) } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.endTime !== undefined ? { endTime: input.endTime || null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.venue !== undefined ? { venue: input.venue } : {}),
      ...(input.address !== undefined ? { address: input.address || null } : {}),
      ...(input.city !== undefined ? { city: input.city || null } : {}),
      ...(input.country !== undefined ? { country: input.country || null } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone || null } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail || null } : {}),
      ...(input.website !== undefined ? { website: input.website || null } : {}),
      ...(input.dressCode !== undefined ? { dressCode: input.dressCode || null } : {}),
      ...(input.practicalInfo !== undefined ? { practicalInfo: input.practicalInfo || null } : {}),
      ...(input.welcomeMessage !== undefined ? { welcomeMessage: input.welcomeMessage || null } : {}),
      ...(input.allowMultipleEntries !== undefined ? { allowMultipleEntries: input.allowMultipleEntries } : {}),
      ...(rename ? { slug: await uniqueEventSlug(prisma, (slugify(input.name!) || 'evenement').slice(0, 60)) } : {}),
      ...(options ? { optionsJson: options } : {}),
    },
  });

  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: 'event.update',
    entity: 'event', entityId: updated.id, meta: { fields: Object.keys(input) }, ip,
  });

  return { id: updated.id, slug: updated.slug };
}

/**
 * Machine à états (CDC §10) :
 *  draft → published | archived
 *  published → draft (dépublier) | archived
 *  archived → draft (restaurer)
 */
export async function setEventStatus(
  ctx: TenantContext,
  eventId: string,
  status: 'draft' | 'published' | 'archived',
  ip: string | null = null,
): Promise<{ id: string; status: string }> {
  const event = await getOwnedEvent(ctx, eventId);
  const from = event.status;

  const allowed: Record<string, string[]> = {
    draft: ['published', 'archived'],
    published: ['draft', 'archived'],
    archived: ['draft'],
  };
  if (from === status || !allowed[from]?.includes(status)) {
    throw new TenantError(409, 'invalid_status_change', `Transition ${from} → ${status} non autorisée.`);
  }

  const updated = await prisma.event.update({ where: { id: event.id }, data: { status } });
  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: `event.${status}`,
    entity: 'event', entityId: updated.id, meta: { from }, ip,
  });
  return { id: updated.id, status: updated.status };
}

/**
 * Suppression (politique CDC §10) :
 *  - publié → interdiction directe : archiver d'abord (données RSVP/check-in préservées)
 *  - brouillon/archivé → suppression physique (cascade invités, RSVP…)
 */
export async function deleteEvent(
  ctx: TenantContext,
  eventId: string,
  ip: string | null = null,
): Promise<void> {
  const event = await getOwnedEvent(ctx, eventId);
  if (event.status === 'published') {
    throw new TenantError(
      409,
      'archive_required',
      'Un événement publié ne peut pas être supprimé directement : archivez-le d’abord.',
    );
  }
  await prisma.event.delete({ where: { id: event.id } });
  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: 'event.delete',
    entity: 'event', entityId: event.id, meta: { name: event.name }, ip,
  });
}

/** Duplication (config + options, SANS invités) → brouillon, nouveau slug. */
export async function duplicateEvent(
  ctx: TenantContext,
  eventId: string,
  ip: string | null = null,
): Promise<{ id: string; slug: string }> {
  const event = await getOwnedEvent(ctx, eventId);
  await assertWritable(ctx.organization!.id);
  await assertQuota(ctx, 'events', 1);

  const copy = await prisma.event.create({
    data: {
      organizationId: event.organizationId,
      name: `${event.name} (copie)`,
      typeCode: event.typeCode,
      slug: await uniqueEventSlug(
        prisma,
        `${(slugify(event.name) || 'evenement').slice(0, 50)}-copie`,
      ),
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      timezone: event.timezone,
      venue: event.venue,
      address: event.address,
      city: event.city,
      country: event.country,
      description: event.description,
      contactPhone: event.contactPhone,
      contactEmail: event.contactEmail,
      website: event.website,
      dressCode: event.dressCode,
      practicalInfo: event.practicalInfo,
      welcomeMessage: event.welcomeMessage,
      allowMultipleEntries: event.allowMultipleEntries,
      optionsJson: JSON.parse(JSON.stringify(event.optionsJson)),
      status: 'draft',
    },
  });
  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: 'event.duplicate',
    entity: 'event', entityId: copy.id, meta: { source: event.id }, ip,
  });
  return { id: copy.id, slug: copy.slug };
}

// ─────────────────────────── Personnes principales ───────────────────────────

export async function listEventMembers(eventId: string, organizationId: string) {
  const event = await getEventForOrg(eventId, organizationId);
  if (!event) return null;
  const members = await prisma.eventMember.findMany({
    where: { eventId },
    orderBy: { sortOrder: 'asc' },
  });
  return members;
}

export async function addEventMember(
  ctx: TenantContext,
  eventId: string,
  input: z.input<typeof eventMemberSchema>,
  ip: string | null = null,
): Promise<{ id: string }> {
  const event = await getOwnedEvent(ctx, eventId);
  const member = await prisma.eventMember.create({
    data: {
      eventId: event.id,
      roleLabel: input.roleLabel,
      firstName: input.firstName,
      lastName: input.lastName,
      mediaId: input.mediaId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: 'event.member_add',
    entity: 'event_member', entityId: member.id, ip,
  });
  return { id: member.id };
}

export async function updateEventMember(
  ctx: TenantContext,
  eventId: string,
  memberId: string,
  input: z.input<typeof eventMemberSchema>,
): Promise<void> {
  const event = await getOwnedEvent(ctx, eventId);
  const member = await prisma.eventMember.findFirst({
    where: { id: memberId, eventId: event.id },
  });
  if (!member) throw new TenantError(404, 'member_not_found', 'Personne introuvable.');
  await prisma.eventMember.update({
    where: { id: member.id },
    data: {
      roleLabel: input.roleLabel,
      firstName: input.firstName,
      lastName: input.lastName,
      sortOrder: input.sortOrder ?? member.sortOrder,
    },
  });
}

export async function removeEventMember(
  ctx: TenantContext,
  eventId: string,
  memberId: string,
): Promise<void> {
  const event = await getOwnedEvent(ctx, eventId);
  const member = await prisma.eventMember.findFirst({
    where: { id: memberId, eventId: event.id },
  });
  if (!member) throw new TenantError(404, 'member_not_found', 'Personne introuvable.');
  await prisma.eventMember.delete({ where: { id: member.id } });
}

// ─────────────────────────── Vue publique /e/[slug] ───────────────────────────

export interface PublicEventView {
  slug: string;
  name: string;
  typeCode: string;
  date: Date;
  startTime: string;
  endTime: string | null;
  timezone: string;
  venue: string;
  address: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  dressCode: string | null;
  practicalInfo: string | null;
  welcomeMessage: string | null;
  options: Record<string, boolean>;
  members: { roleLabel: string; firstName: string; lastName: string; initials: string }[];
  guestbookCount: number;
  guestbookMessages: { authorName: string; message: string; createdAt: Date }[];
}

/**
 * Page publique : SEULEMENT les événements publishés (le draft/archivé est
 * invisible publiquement — même slug → 404 propre, jamais d'info leakée).
 */
export async function getPublicEvent(slug: string): Promise<PublicEventView | null> {
  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      members: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { guestBookMessages: true } },
    },
  });
  if (!event || event.status !== 'published') return null;

  const options = (event.optionsJson ?? {}) as Record<string, boolean>;
  const guestbookMessages =
    options.guestbook
      ? await prisma.guestBookMessage.findMany({
          where: { eventId: event.id, status: 'approved' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : [];

  return {
    slug: event.slug,
    name: event.name,
    typeCode: event.typeCode,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    venue: event.venue,
    address: event.address,
    city: event.city,
    country: event.country,
    description: event.description,
    contactPhone: event.contactPhone,
    contactEmail: event.contactEmail,
    website: event.website,
    dressCode: event.dressCode,
    practicalInfo: event.practicalInfo,
    welcomeMessage: event.welcomeMessage,
    options,
    members: event.members.map((m) => ({
      roleLabel: m.roleLabel,
      firstName: m.firstName,
      lastName: m.lastName,
      initials: `${m.firstName[0] ?? ''}${m.lastName[0] ?? ''}`.toUpperCase(),
    })),
    guestbookCount: event._count.guestBookMessages,
    guestbookMessages: guestbookMessages.map((g) => ({
      authorName: g.authorName,
      message: g.message,
      createdAt: g.createdAt,
    })),
  };
}

/** Livre d'or public (auto-validation en Phase 5 ; modération : phase 12). */
export async function postGuestbook(
  slug: string,
  input: { authorName: string; authorEmail?: string; message: string },
  ip: string | null,
): Promise<{ id: string }> {
  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || event.status !== 'published') {
    throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  }
  const options = (event.optionsJson ?? {}) as Record<string, boolean>;
  if (!options.guestbook) {
    throw new TenantError(403, 'guestbook_disabled', 'Le livre d’or est désactivé pour cet événement.');
  }

  const msg = await prisma.guestBookMessage.create({
    data: {
      eventId: event.id,
      organizationId: event.organizationId,
      authorName: input.authorName,
      authorEmail: input.authorEmail || null,
      message: input.message,
      status: 'approved',
      publishedAt: new Date(),
    },
  });
  await logActivity({
    organizationId: event.organizationId,
    action: 'guestbook.post',
    entity: 'guest_book_message',
    entityId: msg.id,
    ip,
  });
  return { id: msg.id };
}

// ─────────────────────────── Liste / KPIs ───────────────────────────

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
      include: { _count: { select: { guests: true } } },
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
