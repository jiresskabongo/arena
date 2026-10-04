import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getEventForOrg } from '@/server/services/event';
import { getSubscriptionView } from '@/server/services/subscription';
import { logActivity } from '@/server/services/activity';
import {
  createGuestSchema, updateGuestSchema, listGuestsQuerySchema,
  createTableSchema, updateTableSchema, importConfirmSchema,
  type ImportField,
} from '@/lib/schemas/guest';
import type z from 'zod';
import type { Prisma } from '@prisma/client';

export type CreateGuestInput = z.input<typeof createGuestSchema>;
export type UpdateGuestInput = z.input<typeof updateGuestSchema>;
export type ListGuestsQuery = z.input<typeof listGuestsQuerySchema>;
export type ImportConfirmInput = z.input<typeof importConfirmSchema>;

async function getOwnedGuest(ctx: TenantContext, eventId: string, guestId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, eventId, ...tenantWhere(orgId) },
    include: { table: true, preference: true },
  });
  if (!guest) throw new TenantError(404, 'guest_not_found', 'Invité introuvable.');
  return { event, guest };
}

// ─────────────────────────── CRUD invités ───────────────────────────

/** Ajout manuel (quota par événement inclus). */
export async function addGuest(
  ctx: TenantContext,
  eventId: string,
  input: CreateGuestInput,
  ip: string | null = null,
): Promise<{ id: string }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const sub = await getSubscriptionView(orgId);
  const limit = sub ? Number((sub.plan.limits as Record<string, unknown>).guestsPerEvent ?? 0) : 0;
  const current = await prisma.guest.count({ where: { eventId, ...tenantWhere(orgId) } });
  if (limit > 0 && current + 1 > limit) {
    throw new TenantError(403, 'quota_exceeded', `Quota atteint : ${current}/${limit} invités par événement.`);
  }

  if (input.tableId) {
    const table = await prisma.table.findFirst({ where: { id: input.tableId, eventId, ...tenantWhere(orgId) } });
    if (!table) throw new TenantError(400, 'table_not_found', 'Table inconnue pour cet événement.');
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
      companions: input.companions ?? 0,
      internalNotes: input.internalNotes || null,
      preference: input.preference
        ? {
            create: {
              meal: input.preference.meal ?? null,
              drink: input.preference.drink ?? null,
              allergies: input.preference.allergies ?? null,
              ceremonyAttending: input.preference.ceremonyAttending ?? null,
              receptionAttending: input.preference.receptionAttending ?? null,
            },
          }
        : undefined,
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'guest.create',
    entity: 'guest', entityId: guest.id, meta: { eventId }, ip,
  });
  return { id: guest.id };
}

/** Mise à jour partielle (+ préférences upsert). */
export async function updateGuest(
  ctx: TenantContext,
  eventId: string,
  guestId: string,
  input: UpdateGuestInput,
  ip: string | null = null,
): Promise<{ id: string }> {
  const { guest } = await getOwnedGuest(ctx, eventId, guestId);
  const orgId = ctx.organization!.id;

  if (input.tableId) {
    const table = await prisma.table.findFirst({ where: { id: input.tableId, eventId, ...tenantWhere(orgId) } });
    if (!table) throw new TenantError(400, 'table_not_found', 'Table inconnue pour cet événement.');
  }

  const updated = await prisma.guest.update({
    where: { id: guest.id },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.tableId !== undefined ? { tableId: input.tableId || null } : {}),
      ...(input.companions !== undefined ? { companions: input.companions } : {}),
      ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes || null } : {}),
      ...(input.rsvpStatus !== undefined ? { rsvpStatus: input.rsvpStatus } : {}),
      ...(input.preference
        ? {
            preference: {
              upsert: {
                create: input.preference,
                update: input.preference,
              },
            },
          }
        : {}),
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'guest.update',
    entity: 'guest', entityId: updated.id, meta: { fields: Object.keys(input) }, ip,
  });
  return { id: updated.id };
}

/** Suppression (permission guest:delete côté route). */
export async function removeGuest(
  ctx: TenantContext,
  eventId: string,
  guestId: string,
  ip: string | null = null,
): Promise<void> {
  const { guest } = await getOwnedGuest(ctx, eventId, guestId);
  await prisma.guest.delete({ where: { id: guest.id } });
  await logActivity({
    organizationId: ctx.organization!.id, userId: ctx.user.id, action: 'guest.delete',
    entity: 'guest', entityId: guest.id, meta: { eventId }, ip,
  });
}

// ─────────────────────────── Liste paginée / filtres / tris ───────────────────────────

const SORTS: Record<string, (a: any, b: any) => number> = {
  name: (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'fr'),
  createdAt: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  category: (a, b) => (a.category ?? '').localeCompare(b.category ?? ''),
  table: (a, b) => (a.table?.name ?? 'zzz').localeCompare(b.table?.name ?? 'zzz'),
};

export interface GuestListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  category: string;
  tableId: string | null;
  table: { id: string; name: string; capacity: number } | null;
  companions: number;
  internalNotes: string | null;
  rsvpStatus: string;
  presenceStatus: string;
  preference: { meal: string | null; drink: string | null; allergies: string | null } | null;
  createdAt: Date;
}

export async function listGuests(
  ctx: TenantContext,
  eventId: string,
  query: ListGuestsQuery,
  opts?: { pageSizeOverride?: number },
): Promise<{
  items: GuestListItem[]; total: number; page: number; pageSize: number; totalPages: number;
  counts: { total: number; confirmed: number; declined: number; maybe: number; pending: number };
}> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const q = listGuestsQuerySchema.parse(query);
  if (opts?.pageSizeOverride) q.pageSize = opts.pageSizeOverride;
  const where: Record<string, unknown> = { eventId, ...tenantWhere(orgId) };
  if (q.category) where.category = q.category;
  if (q.tableId) where.tableId = q.tableId;
  if (q.noTable) where.tableId = null;
  if (q.rsvpStatus) where.rsvpStatus = q.rsvpStatus;
  if (q.presenceStatus) where.presenceStatus = q.presenceStatus;
  if (q.search) {
    // SQLite : contains est déjà insensible à la casse (portable vers Postgres ?
    // en y ajoutant mode: 'insensitive' via une extension si nécessaire)
    where.OR = [
      { firstName: { contains: q.search } },
      { lastName: { contains: q.search } },
      { phone: { contains: q.search } },
      { email: { contains: q.search } },
    ];
  }

  const orderBy: Prisma.GuestOrderByWithRelationInput | Prisma.GuestOrderByWithRelationInput[] =
    q.sort === 'name'
      ? [{ firstName: q.dir }, { lastName: q.dir }]
      : q.sort === 'createdAt'
        ? { createdAt: q.dir }
        : q.sort === 'category'
          ? { category: q.dir }
          : { id: 'asc' }; // tri par table : JS ci-dessous (relation)

  const [all, counts] = await Promise.all([
    prisma.guest.findMany({
      where,
      include: { table: { select: { id: true, name: true, capacity: true } }, preference: true },
      orderBy,
    }),
    prisma.guest.groupBy({
      by: ['rsvpStatus'],
      where: { eventId, ...tenantWhere(orgId) },
      _count: { _all: true },
    }),
  ]);

  const sorted = [...all].sort((a, b) => (q.dir === 'asc' ? 1 : -1) * (SORTS[q.sort]?.(a, b) ?? 0));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, totalPages);
  const items = sorted.slice((page - 1) * q.pageSize, page * q.pageSize);

  const c: Record<string, number> = {};
  for (const row of counts) c[row.rsvpStatus] = row._count._all;

  return {
    items,
    total,
    page,
    pageSize: q.pageSize,
    totalPages,
    counts: {
      total: all.length,
      confirmed: c.confirmed ?? 0,
      declined: c.declined ?? 0,
      maybe: c.maybe ?? 0,
      pending: c.pending ?? 0,
    },
  };
}

// ─────────────────────────── Tables ───────────────────────────

export async function listTables(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  return prisma.table.findMany({
    where: { eventId, ...tenantWhere(orgId) },
    include: { _count: { select: { guests: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createTable(
  ctx: TenantContext, eventId: string, input: z.input<typeof createTableSchema>, ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const d = createTableSchema.parse(input);
  const table = await prisma.table.create({
    data: { eventId, organizationId: orgId, name: d.name, capacity: d.capacity, sortOrder: d.sortOrder },
  });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'table.create',
    entity: 'table', entityId: table.id, meta: { eventId }, ip,
  });
  return table;
}

export async function updateTable(
  ctx: TenantContext, eventId: string, tableId: string, input: z.input<typeof updateTableSchema>, ip: string | null = null,
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const existing = await prisma.table.findFirst({ where: { id: tableId, eventId, ...tenantWhere(orgId) } });
  if (!existing) throw new TenantError(404, 'table_not_found', 'Table introuvable.');
  const d = updateTableSchema.parse(input);
  const table = await prisma.table.update({
    where: { id: existing.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
    },
  });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'table.update',
    entity: 'table', entityId: table.id, meta: { eventId }, ip,
  });
  return table;
}

/** Suppression : les invités passent simplement « sans table ». */
export async function removeTable(
  ctx: TenantContext, eventId: string, tableId: string, ip: string | null = null,
): Promise<void> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const existing = await prisma.table.findFirst({ where: { id: tableId, eventId, ...tenantWhere(orgId) } });
  if (!existing) throw new TenantError(404, 'table_not_found', 'Table introuvable.');
  await prisma.guest.updateMany({
    where: { tableId: existing.id, ...tenantWhere(orgId) },
    data: { tableId: null },
  });
  await prisma.table.delete({ where: { id: existing.id } });
  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'table.delete',
    entity: 'table', entityId: existing.id, meta: { eventId }, ip,
  });
}

// ─────────────────────────── Import CSV/Excel (CDC §11) ───────────────────────────

export async function createImportJob(
  ctx: TenantContext,
  eventId: string,
  meta: { fileName: string; mimeType: string; totalRows: number },
): Promise<{ id: string }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const job = await prisma.importJob.create({
    data: {
      organizationId: orgId,
      eventId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      totalRows: meta.totalRows,
      status: 'pending',
      createdById: ctx.user.id,
    },
  });
  return { id: job.id };
}

export async function listImportJobs(ctx: TenantContext, eventId: string) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  return prisma.importJob.findMany({
    where: { eventId, ...tenantWhere(orgId) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

const normPhone = (p: string | null) => (p ? p.replace(/[^\d+]/g, '') : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = ['famille', 'amis', 'vip', 'collegues', 'autres'];

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

/**
 * Confirmation d'un import : re-validation complète (source de vérité),
 * doublons (existant + intra-fichier), quotas, création en lot.
 * Sur quota dépassé : AUCUNE ligne créée (toute ou rien).
 */
export async function confirmImport(
  ctx: TenantContext,
  eventId: string,
  input: z.input<typeof importConfirmSchema>,
  ip: string | null = null,
): Promise<{
  jobId: string;
  created: number;
  duplicates: number;
  errors: ImportRowError[];
}> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const event = await getEventForOrg(eventId, orgId);
  if (!event) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');

  const job = await prisma.importJob.findFirst({
    where: { id: input.jobId, eventId, ...tenantWhere(orgId) },
  });
  if (!job) throw new TenantError(404, 'import_job_not_found', 'Import introuvable.');
  if (job.status === 'confirmed') {
    throw new TenantError(409, 'import_already_confirmed', 'Cet import a déjà été confirmé.');
  }

  const q = importConfirmSchema.parse(input);
  const mapping = q.mapping;
  const get = (data: Record<string, string>, field: ImportField): string => {
    const col = Object.entries(mapping).find(([, f]) => f === field)?.[0];
    return col !== undefined ? (data[col] ?? '').trim() : '';
  };

  // Tables de l'événement (nom → id, insensible à la casse)
  const tables = await prisma.table.findMany({ where: { eventId, ...tenantWhere(orgId) } });
  const tableByName = new Map(tables.map((t) => [t.name.toLowerCase(), t.id]));

  // Invités existants → clés de doublon
  const existing = await prisma.guest.findMany({
    where: { eventId, ...tenantWhere(orgId) },
    select: { phone: true, email: true },
  });
  const seenPhones = new Set(existing.map((g) => normPhone(g.phone)).filter(Boolean));
  const seenEmails = new Set(existing.map((g) => (g.email ? g.email.toLowerCase() : '')).filter(Boolean));

  const rowsToCreate: {
    firstName: string; lastName: string; phone: string | null; email: string | null;
    category: string; tableId: string | null; companions: number;
  }[] = [];
  const errors: ImportRowError[] = [];
  let duplicates = 0;

  for (const { row, data } of q.rows) {
    const firstName = get(data, 'firstName');
    const lastName = get(data, 'lastName');
    if (!firstName) { errors.push({ row, field: 'firstName', message: 'Prénom manquant' }); continue; }
    if (!lastName) { errors.push({ row, field: 'lastName', message: 'Nom manquant' }); continue; }

    const phone = get(data, 'phone');
    const email = get(data, 'email');
    if (phone && (phone.replace(/[^\d+]/g, '').length < 5 || phone.length > 30)) {
      errors.push({ row, field: 'phone', message: 'Téléphone invalide' });
      continue;
    }
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ row, field: 'email', message: 'E-mail invalide' });
      continue;
    }

    const table = get(data, 'table');
    let tableId: string | null = null;
    if (table) {
      tableId = tableByName.get(table.toLowerCase()) ?? null;
      if (!tableId) {
        errors.push({ row, field: 'table', message: `Table inconnue : « ${table} »` });
        continue;
      }
    }

    const category = get(data, 'category');
    const cat = CATEGORIES.includes(category.toLowerCase()) ? category.toLowerCase() : 'autres';

    const companionsRaw = get(data, 'companions');
    let companions = 0;
    if (companionsRaw) {
      const n = Number(companionsRaw);
      if (!Number.isInteger(n) || n < 0 || n > 50) {
        errors.push({ row, field: 'companions', message: 'Accompagnateurs invalide (0–50)' });
        continue;
      }
      companions = n;
    }

    const pKey = phone ? normPhone(phone) : '';
    const eKey = email ? email.toLowerCase() : '';
    if ((pKey && seenPhones.has(pKey)) || (eKey && seenEmails.has(eKey))) {
      duplicates += 1;
      continue;
    }
    if (pKey) seenPhones.add(pKey);
    if (eKey) seenEmails.add(eKey);

    rowsToCreate.push({
      firstName, lastName,
      phone: phone || null,
      email: email || null,
      category: cat,
      tableId,
      companions,
    });
  }

  // Quota : toute ou rien
  const sub = await getSubscriptionView(orgId);
  const limit = sub ? Number((sub.plan.limits as Record<string, unknown>).guestsPerEvent ?? 0) : 0;
  const current = await prisma.guest.count({ where: { eventId, ...tenantWhere(orgId) } });
  if (limit > 0 && current + rowsToCreate.length > limit) {
    const msg = `Quota atteint : ${current}/${limit} invités (import de ${rowsToCreate.length} refusé en bloc).`;
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        errorsJson: [{ row: 0, field: 'quota', message: msg }] as Prisma.InputJsonValue,
        validRows: 0,
        errorRows: 0,
        duplicateRows: duplicates,
      },
    });
    throw new TenantError(403, 'quota_exceeded', msg);
  }

  if (rowsToCreate.length > 0) {
    await prisma.guest.createMany({
      data: rowsToCreate.map((g) => ({
        ...g,
        eventId,
        organizationId: orgId,
        importJobId: job.id,
      })),
    });
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: 'confirmed',
      totalRows: q.rows.length,
      validRows: rowsToCreate.length,
      errorRows: errors.length,
      duplicateRows: duplicates,
      errorsJson: errors.slice(0, 100) as unknown as Prisma.InputJsonValue,
      mappingJson: mapping as Prisma.InputJsonValue,
    },
  });

  await logActivity({
    organizationId: orgId, userId: ctx.user.id, action: 'guest.import',
    entity: 'import_job', entityId: job.id,
    meta: { created: rowsToCreate.length, duplicates, errors: errors.length }, ip,
  });

  return { jobId: job.id, created: rowsToCreate.length, duplicates, errors };
}

// ─────────────────────────── Export ───────────────────────────

/** Export CSV des invités (filtres appliqués). PDF/XLSX : Phase 12. */
export async function exportGuestsCsv(
  ctx: TenantContext,
  eventId: string,
  query: ListGuestsQuery,
): Promise<{ fileName: string; content: string }> {
  const res = await listGuests(ctx, eventId, { ...query, pageSize: 100, page: 1 }, { pageSizeOverride: 5000 });
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'Prénom', 'Nom', 'E-mail', 'Téléphone', 'Catégorie', 'Table',
    'Accompagnateurs', 'RSVP', 'Présence', 'Repas', 'Boisson', 'Allergies', 'Notes',
  ].join(';');
  const lines = res.items.map((g) =>
    [
      g.firstName, g.lastName, g.email, g.phone, g.category, g.table?.name ?? '',
      g.companions, g.rsvpStatus, g.presenceStatus,
      g.preference?.meal ?? '', g.preference?.drink ?? '', g.preference?.allergies ?? '',
      g.internalNotes ?? '',
    ].map(esc).join(';'),
  );
  const event = await getEventForOrg(eventId, ctx.organization!.id);
  return {
    fileName: `${event?.slug ?? 'evenement'}-invites.csv`,
    content: '\uFEFF' + [header, ...lines].join('\n'),
  };
}
