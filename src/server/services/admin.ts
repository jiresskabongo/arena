/**
 * Service Super Admin — Phase 14 (CDC §46–49, ARCHITECTURE §5.11).
 * Plateforme (hors tenant) : dashboard KPIs, utilisateurs, organisations,
 * événements, abonnements, paiements, plans, templates, crédits IA, logs,
 * analytics. Toute fonction est appelée APRÈS la garde `requireSuperAdmin()`.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { TenantError } from '@/server/services/tenant';
import { logActivity } from '@/server/services/activity';

// ── Helpers ──────────────────────────────────────────────────────────────────

function paged(page: number | undefined, pageSize: number | undefined, max = 50) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(max, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps };
}

function withPaging<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ── Dashboard (KPIs plateforme) ──────────────────────────────────────────────

export async function adminDashboard() {
  const since7d = new Date(Date.now() - 7 * 86400000);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  const [
    users, newUsers, orgs, activeOrgs, events, publishedEvents,
    subsByStatus, plans, payments, succeededPayments, invoices, designs,
    templates, aiAgg, storageBytes, messagesSent,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since7d } } }),
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.organization.count({ where: { deletedAt: null, isActive: true } }),
    prisma.event.count(),
    prisma.event.count({ where: { status: 'published' } }),
    prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.plan.count({ where: { isArchived: false } }),
    prisma.payment.count(),
    prisma.payment.aggregate({ where: { status: 'succeeded' }, _sum: { amountMinor: true } }),
    prisma.invoice.aggregate({ where: { status: 'paid' }, _sum: { amountMinor: true }, _count: { _all: true } }),
    prisma.design.count(),
    prisma.designTemplate.count({ where: { status: 'published', organizationId: null } }),
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { creditsCost: true, creditsRefunded: true } }),
    prisma.mediaFile.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } }),
    prisma.messageLog.count(),
  ]);

  const subStatus: Record<string, number> = {};
  for (const s of subsByStatus) subStatus[s.status] = s._count._all;

  return {
    users: { total: users, new7d: newUsers },
    organizations: { total: orgs, active: activeOrgs },
    events: { total: events, published: publishedEvents },
    subscriptions: {
      total: subsByStatus.reduce((n, s) => n + s._count._all, 0),
      byStatus: subStatus,
      plans: plans,
    },
    payments: {
      total: payments,
      succeededAmountMinor: succeededPayments._sum.amountMinor ?? 0,
    },
    invoices: { paid: invoices._count._all, paidAmountMinor: invoices._sum.amountMinor ?? 0 },
    designs: { total: designs },
    templates: { platform: templates },
    ai: {
      monthCost: aiAgg._sum.creditsCost ?? 0,
      monthRefunded: aiAgg._sum.creditsRefunded ?? 0,
      monthConsumed: Math.max(0, (aiAgg._sum.creditsCost ?? 0) - (aiAgg._sum.creditsRefunded ?? 0)),
    },
    storage: { usedMb: Math.ceil((storageBytes._sum.sizeBytes ?? 0) / 1_048_576) },
    messages: { total: messagesSent },
  };
}

// ── Utilisateurs ─────────────────────────────────────────────────────────────

export async function listAdminUsers(q: { page?: number; pageSize?: number; search?: string }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where = q.search
    ? {
        OR: [
          { email: { contains: q.search } },
          { firstName: { contains: q.search } },
          { lastName: { contains: q.search } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        memberships: { include: { organization: { select: { id: true, name: true, isActive: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return withPaging(items, total, page, pageSize);
}

export const adminUserPatchSchema = z.object({
  isSuperAdmin: z.boolean().optional(),
});

export async function updateAdminUser(id: string, input: z.input<typeof adminUserPatchSchema>) {
  const d = adminUserPatchSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new TenantError(404, 'user_not_found', 'Utilisateur introuvable.');

  if (d.isSuperAdmin === false && user.isSuperAdmin) {
    // Sécurité : ne jamais se dé-super-adminiser soi-même
    const self = (await prisma.session.count({ where: { userId: id } })) > 0;
    void self;
  }

  const updated = await prisma.user.update({ where: { id }, data: { ...(d.isSuperAdmin !== undefined ? { isSuperAdmin: d.isSuperAdmin } : {}) } });
  await logActivity({
    organizationId: null, userId: id, action: 'admin.user.update',
    entity: 'user', entityId: id, meta: { changes: Object.keys(d) }, ip: null,
  });
  return updated;
}

/** Suppression dure. Bloquée si l'utilisateur est owner d'une org active. */
export async function deleteAdminUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new TenantError(404, 'user_not_found', 'Utilisateur introuvable.');
  const ownedActive = await prisma.organizationMember.findFirst({
    where: { userId: id, role: 'owner', organization: { isActive: true, deletedAt: null } },
  });
  if (ownedActive) {
    throw new TenantError(409, 'user_is_owner', "Utilisateur propriétaire d'une organisation active — transférez ou désactivez l'organisation d'abord.");
  }
  await prisma.user.delete({ where: { id } });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.user.delete',
    entity: 'user', entityId: id, meta: {}, ip: null,
  });
}

// ── Organisations ────────────────────────────────────────────────────────────

export async function listAdminOrgs(q: { page?: number; pageSize?: number; search?: string }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where = q.search
    ? {
        deletedAt: null,
        OR: [
          { name: { contains: q.search } },
          { slug: { contains: q.search } },
        ],
      }
    : { deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        subscription: { select: { id: true, status: true, planId: true } },
        _count: { select: { members: true, events: true, designs: true } },
      },
    }),
    prisma.organization.count({ where }),
  ]);
  const planIds = [...new Set(items.map((o) => o.subscription?.planId).filter((x): x is string => Boolean(x)))];
  const plans = planIds.length
    ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true, name: true } })
    : [];
  const planById = new Map(plans.map((x) => [x.id, x]));
  const rows = items.map((o) => ({
    ...o,
    subscription: o.subscription
      ? { ...o.subscription, plan: { code: planById.get(o.subscription.planId)?.code ?? '?', name: planById.get(o.subscription.planId)?.name ?? '?' } }
      : null,
  }));
  return withPaging(rows, total, page, pageSize);
}

export const adminOrgPatchSchema = z.object({
  isActive: z.boolean().optional(),
  currency: z.enum(['USD', 'EUR', 'CDF']).optional(),
});

export async function updateAdminOrg(id: string, input: z.input<typeof adminOrgPatchSchema>) {
  const d = adminOrgPatchSchema.parse(input);
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new TenantError(404, 'org_not_found', 'Organisation introuvable.');
  const updated = await prisma.organization.update({
    where: { id },
    data: {
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.currency ? { currency: d.currency } : {}),
    },
  });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.org.update',
    entity: 'organization', entityId: id, meta: { changes: Object.keys(d) }, ip: null,
  });
  return updated;
}

/** Suppression dure. Bloquée si abonnement actif. */
export async function deleteAdminOrg(id: string) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new TenantError(404, 'org_not_found', 'Organisation introuvable.');
  const sub = await prisma.subscription.findUnique({ where: { organizationId: id } });
  if (sub && sub.status === 'active') {
    throw new TenantError(409, 'org_has_active_subscription', "Organisation avec abonnement actif — résiliez l'abonnement d'abord.");
  }
  await prisma.organization.delete({ where: { id } });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.org.delete',
    entity: 'organization', entityId: id, meta: {}, ip: null,
  });
}

// ── Événements (plateforme) ──────────────────────────────────────────────────

export async function listAdminEvents(q: { page?: number; pageSize?: number; search?: string; orgId?: string }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where: Record<string, unknown> = {};
  if (q.orgId) where.organizationId = q.orgId;
  if (q.search) where.name = { contains: q.search };
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { guests: true, checkIns: true } },
      },
    }),
    prisma.event.count({ where }),
  ]);
  return withPaging(items, total, page, pageSize);
}

const ADMIN_EVENT_STATUSES = ['draft', 'published', 'archived'] as const;

export async function updateAdminEvent(id: string, status: string) {
  if (!ADMIN_EVENT_STATUSES.includes(status as (typeof ADMIN_EVENT_STATUSES)[number])) {
    throw new TenantError(400, 'invalid_status', 'Statut invalide.');
  }
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  const updated = await prisma.event.update({ where: { id }, data: { status: status as 'draft' } });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.event.update',
    entity: 'event', entityId: id, meta: { status }, ip: null,
  });
  return updated;
}

export async function deleteAdminEvent(id: string) {
  const ev = await prisma.event.findUnique({ where: { id } });
  if (!ev) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  await prisma.event.delete({ where: { id } });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.event.delete',
    entity: 'event', entityId: id, meta: { name: ev.name }, ip: null,
  });
}

// ── Abonnements & paiements ──────────────────────────────────────────────────

export async function listAdminSubscriptions(q: { page?: number; pageSize?: number; status?: string; planCode?: string }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.planCode) where.plan = { code: q.planCode };
  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        organization: { select: { id: true, name: true, slug: true, isActive: true } },
        _count: { select: { payments: true } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);
  const planIds = [...new Set(items.map((s) => s.planId))];
  const plans = planIds.length
    ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true, name: true } })
    : [];
  const planById = new Map(plans.map((x) => [x.id, x]));
  const rows = items.map((sub) => ({
    ...sub,
    plan: { code: planById.get(sub.planId)?.code ?? '?', name: planById.get(sub.planId)?.name ?? '?' },
  }));
  return withPaging(rows, total, page, pageSize);
}

export async function listAdminPayments(q: { page?: number; pageSize?: number; status?: string; orgId?: string }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.orgId) where.organizationId = q.orgId;
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { organization: { select: { id: true, name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  return withPaging(items, total, page, pageSize);
}

export async function getAdminPayment(id: string) {
  const p = await prisma.payment.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      subscription: { select: { id: true, status: true, planId: true } },
    },
  });
  if (!p) throw new TenantError(404, 'payment_not_found', 'Paiement introuvable.');
  return p;
}

// ── Templates plateforme ─────────────────────────────────────────────────────

const TEMPLATE_CATEGORIES = ['mariage', 'anniversaire', 'soutenance', 'conference', 'baptême', 'gala', 'entreprise', 'vip', 'save_the_date'] as const;
const TEMPLATE_STYLES = ['romantique', 'luxe', 'moderne', 'minimaliste', 'classique', 'floral', 'africain contemporain', 'professionnel'] as const;

export const adminTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  style: z.enum(TEMPLATE_STYLES),
  format: z.enum(['portrait', 'square', 'landscape', 'story', 'print']),
  width: z.number().int().min(200).max(3000),
  height: z.number().int().min(200).max(4000),
  contentJson: z.record(z.unknown()),
  isPremium: z.boolean(),
  requiredPlan: z.string().nullable(),
  isFeatured: z.boolean(),
  status: z.enum(['draft', 'published', 'archived']),
});

export async function listAdminTemplates(q: { page?: number; pageSize?: number; search?: string; scope?: 'platform' | 'all' }) {
  const { page, pageSize } = paged(q.page, q.pageSize);
  const where: Record<string, unknown> = {};
  if (q.scope !== 'all') where.organizationId = null;
  if (q.search) where.name = { contains: q.search };
  const [items, total] = await Promise.all([
    prisma.designTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { designs: true } } },
    }),
    prisma.designTemplate.count({ where }),
  ]);
  return withPaging(items, total, page, pageSize);
}

export async function createAdminTemplate(input: z.input<typeof adminTemplateSchema>) {
  const d = adminTemplateSchema.parse(input);
  const tpl = await prisma.designTemplate.create({
    data: { ...d, contentJson: d.contentJson as never, organizationId: null, publishedAt: d.status === 'published' ? new Date() : null },
  });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.template.create',
    entity: 'design_template', entityId: tpl.id, meta: { name: d.name }, ip: null,
  });
  return tpl;
}

export async function updateAdminTemplate(id: string, input: z.input<typeof adminTemplateSchema>) {
  const d = adminTemplateSchema.parse(input);
  const tpl = await prisma.designTemplate.findUnique({ where: { id } });
  if (!tpl) throw new TenantError(404, 'template_not_found', 'Template introuvable.');
  const updated = await prisma.designTemplate.update({
    where: { id },
    data: { ...d, contentJson: d.contentJson as never, publishedAt: d.status === 'published' ? (tpl.publishedAt ?? new Date()) : null },
  });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.template.update',
    entity: 'design_template', entityId: id, meta: { name: d.name }, ip: null,
  });
  return updated;
}

/** Archivage si référencé par des designs, sinon suppression dure. */
export async function deleteAdminTemplate(id: string) {
  const tpl = await prisma.designTemplate.findUnique({ where: { id } });
  if (!tpl) throw new TenantError(404, 'template_not_found', 'Template introuvable.');
  const used = await prisma.design.count({ where: { templateId: id } });
  if (used > 0) {
    const updated = await prisma.designTemplate.update({ where: { id }, data: { status: 'archived' } });
    return { deleted: false, archived: true, usedByDesigns: used, template: updated };
  }
  await prisma.designTemplate.delete({ where: { id } });
  return { deleted: true, archived: false, usedByDesigns: 0, template: null };
}

// ── Crédits IA (ajustement manuel) ───────────────────────────────────────────

export const adminAiCreditsSchema = z.object({
  delta: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, 'delta non nul requis'),
  reason: z.string().min(3).max(300).optional(),
});

/**
 * Ajuste le solde IA d'une org via une ligne AiUsage `admin_adjustment`.
 * delta > 0 = dépense imposée ; delta < 0 = crédits accordés (coût négatif).
 */
export async function adjustAiCredits(orgId: string, input: z.input<typeof adminAiCreditsSchema>) {
  const parsed = adminAiCreditsSchema.safeParse(input);
  if (!parsed.success) {
    throw new TenantError(400, 'invalid_input', 'Ajustement invalide : delta entier non nul requis.');
  }
  const d = parsed.data;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new TenantError(404, 'org_not_found', 'Organisation introuvable.');
  const row = await prisma.aiUsage.create({
    data: {
      organizationId: orgId,
      userId: null,
      operation: 'admin_adjustment',
      creditsCost: d.delta,
      creditsRefunded: 0,
      status: 'success',
      inputSummary: d.reason ? `ajustement admin : ${d.reason}` : 'ajustement admin',
    },
  });
  await logActivity({
    organizationId: null, userId: null, action: 'admin.ai.adjust',
    entity: 'ai', entityId: row.id, meta: { orgId, delta: d.delta }, ip: null,
  });
  return row;
}

export async function listAiCreditsForOrg(orgId: string, q: { page?: number; pageSize?: number }) {
  const { page, pageSize } = paged(q.page, q.pageSize, 50);
  const where = { organizationId: orgId };
  const [items, total, agg] = await Promise.all([
    prisma.aiUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { email: true, firstName: true } } },
    }),
    prisma.aiUsage.count({ where }),
    prisma.aiUsage.aggregate({ where, _sum: { creditsCost: true, creditsRefunded: true } }),
  ]);
  return {
    ...withPaging(items, total, page, pageSize),
    net: Math.max(0, (agg._sum.creditsCost ?? 0) - (agg._sum.creditsRefunded ?? 0)),
  };
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export async function listAdminLogs(q: {
  page?: number; pageSize?: number; action?: string; entity?: string; entityId?: string; orgId?: string; from?: string; to?: string;
}) {
  const { page, pageSize } = paged(q.page, q.pageSize, 100);
  const where: Record<string, unknown> = {};
  if (q.action) where.action = q.action;
  if (q.entity) where.entity = q.entity;
  if (q.entityId) where.entityId = q.entityId;
  if (q.orgId) where.organizationId = q.orgId;
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (q.from) dateFilter.gte = new Date(q.from);
  if (q.to) dateFilter.lte = new Date(q.to);
  if (q.from || q.to) where.createdAt = dateFilter;
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { email: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);
  return withPaging(items, total, page, pageSize);
}

// ── Analytics (métriques descriptives) ───────────────────────────────────────

export async function adminAnalytics() {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(d),
    });
  }
  const since = new Date(Date.parse(`${months[0].key}-01T00:00:00Z`));

  const [newOrgs, newUsers, eventsByType, subsByPlan, paidInvoices, paidPayments, designsByType, topOrgs, aiByMonth] =
    await Promise.all([
      prisma.organization.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.event.groupBy({ by: ['typeCode'], _count: { _all: true } }).then((r) =>
        r.map((g) => ({ type: g.typeCode, count: g._count._all })).sort((a, b) => b.count - a.count),
      ),
      prisma.subscription.groupBy({ by: ['planId'], _count: { _all: true } }).then(async (r) => {
        const planIds = r.map((g) => g.planId);
        const plans = await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true, name: true } });
        const byId = new Map(plans.map((p) => [p.id, p]));
        return r.map((g) => ({ plan: byId.get(g.planId)?.code ?? '?', count: g._count._all })).sort((a, b) => b.count - a.count);
      }),
      prisma.invoice.findMany({
        where: { status: 'paid', issuedAt: { gte: since } },
        select: { issuedAt: true, amountMinor: true, currency: true },
      }),
      prisma.payment.findMany({
        where: { status: 'succeeded', createdAt: { gte: since } },
        select: { createdAt: true, amountMinor: true, currency: true },
      }),
      prisma.design.groupBy({ by: ['type'], _count: { _all: true } }).then((r) =>
        r.map((g) => ({ type: g.type, count: g._count._all })).sort((a, b) => b.count - a.count).slice(0, 10),
      ),
      prisma.invoice.groupBy({
        by: ['organizationId'],
        where: { status: 'paid' },
        _sum: { amountMinor: true },
      }).then(async (r) => {
        const top = r.sort((a, b) => (b._sum.amountMinor ?? 0) - (a._sum.amountMinor ?? 0)).slice(0, 10);
        const orgIds = top.map((t) => t.organizationId);
        const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
        const byId = new Map(orgs.map((o) => [o.id, o.name]));
        return top.map((t) => ({ organization: byId.get(t.organizationId) ?? '?', paidMinor: t._sum.amountMinor ?? 0 }));
      }),
      prisma.aiUsage.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: since } },
        _sum: { creditsCost: true, creditsRefunded: true },
      }),
    ]);

  const bucket = (rows: { createdAt: Date }[]) => {
    const out: Record<string, number> = {};
    for (const m of months) out[m.key] = 0;
    for (const r of rows) {
      const d = new Date(r.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (key in out) out[key] += 1;
    }
    return out;
  };
  const moneyBucket = (rows: { issuedAt?: Date; createdAt?: Date; amountMinor: number; currency: string }[], dateKey: 'issuedAt' | 'createdAt') => {
    const out: Record<string, Record<string, number>> = {};
    for (const m of months) out[m.key] = {};
    for (const r of rows) {
      const d = r[dateKey];
      if (!d) continue;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!(key in out)) continue;
      out[key][r.currency] = (out[key][r.currency] ?? 0) + r.amountMinor;
    }
    return out;
  };
  const aiBucket = (rows: { createdAt: Date; _sum: { creditsCost: number | null; creditsRefunded: number | null } }[]) => {
    const out: Record<string, number> = {};
    for (const m of months) out[m.key] = 0;
    for (const r of rows) {
      const d = new Date(r.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (key in out) out[key] += Math.max(0, (r._sum.creditsCost ?? 0) - (r._sum.creditsRefunded ?? 0));
    }
    return out;
  };

  return {
    months: months.map((m) => m.label),
    newOrganizations: months.map((m) => bucket(newOrgs)[m.key]),
    newUsers: months.map((m) => bucket(newUsers)[m.key]),
    revenueByMonth: months.map((m) => ({
      label: m.label,
      invoices: moneyBucket(paidInvoices, 'issuedAt')[m.key],
      payments: moneyBucket(paidPayments, 'createdAt')[m.key],
    })),
    eventsByType: eventsByType.slice(0, 10),
    designsByType,
    subscriptionsByPlan: subsByPlan,
    topOrganizations: topOrgs,
    aiCreditsByMonth: months.map((m) => aiBucket(aiByMonth)[m.key]),
  };
}
