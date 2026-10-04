/**
 * Tests d'intégration Phase 14 : super admin (critère : « complet §51, avec
 * gardes »).
 * - Dashboard KPIs cohérents avec la DB
 * - Utilisateurs : recherche, rôle plateforme, suppression protégée (owner)
 * - Organisations : recherche + plan joint (join manuel), activation,
 *   suppression protégée (sub active)
 * - Événements : recherche, statut, invalid status 400, suppression
 * - Abonnements / paiements : filtres + détail
 * - Templates plateforme : CRUD, archivage si référencé
 * - Crédits IA : ajustement admin (dépense / crédit), historique net
 * - Logs : filtres action/date
 * - Analytics : structure 6 mois + cohérence
 * (Garde HTTP requireSuperAdmin vérifiée par le smoke : non-admin → 403.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent } from '@/server/services/event';
import {
  adminDashboard, listAdminUsers, updateAdminUser, deleteAdminUser,
  listAdminOrgs, updateAdminOrg, deleteAdminOrg,
  listAdminEvents, updateAdminEvent, deleteAdminEvent,
  listAdminSubscriptions, listAdminPayments, getAdminPayment,
  listAdminTemplates, createAdminTemplate, updateAdminTemplate, deleteAdminTemplate,
  adjustAiCredits, listAiCreditsForOrg, listAdminLogs, adminAnalytics,
} from '@/server/services/admin';
import { TenantError } from '@/server/services/tenant';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p14own.${stamp}@exemple.cd`;
const email2 = `p14other.${stamp}@exemple.cd`;
const adminEmail = `p14admin.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;
let sandboxUserId: string; // utilisateur sans org active (suppression autorisée)
let adminCtx: TenantContext;
let ownerCtx: TenantContext;

function mkCtx(o: { id: string; name: string; slug: string }, u: { id: string; email: string }, superAdmin = true): TenantContext {
  return {
    user: { id: u.id, email: u.email, firstName: 'P14', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: superAdmin } as never,
    isSuperAdmin: superAdmin,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: superAdmin ? null : 'owner',
  };
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P14', lastName: 'Own', organizationName: `P14 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P14', lastName: 'Oth', organizationName: `P14 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  // Super admin dédié aux tests (plateforme, hors tenant)
  const passwordHash = await import('@/server/auth/password').then((m) => m.hashPassword('Event1234'));
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { isSuperAdmin: true },
    create: { email: adminEmail, passwordHash, firstName: 'P14', lastName: 'Admin', isSuperAdmin: true },
  });

  // Utilisateur sans organisation (suppression autorisée)
  const pw = await import('@/server/auth/password');
  sandboxUserId = (await prisma.user.create({
    data: { email: `p14sandbox.${stamp}@exemple.cd`, passwordHash: await pw.hashPassword('Event1234'), firstName: 'Sandbox', lastName: 'User' },
  })).id;

  ownerCtx = mkCtx({ id: orgId, name: `P14 Org ${stamp}`, slug: `p14o${stamp}` }, { id: ownerId, email }, false);
  adminCtx = mkCtx({ id: orgId, name: `P14 Org ${stamp}`, slug: `p14o${stamp}` }, { id: otherOwnerId, email: adminEmail }, true);

  // Souscription active pour orgA (sub + plan Pro)
  const pro = await prisma.plan.findUnique({ where: { code: 'pro' } });
  if (pro) {
    await prisma.subscription.upsert({
      where: { organizationId: orgId },
      update: { planId: pro.id, status: 'active', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000) },
      create: {
        organizationId: orgId, planId: pro.id, status: 'active',
        currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });
    // orgB : trialing
    const starter = await prisma.plan.findUnique({ where: { code: 'starter' } });
    if (starter) {
      await prisma.subscription.upsert({
        where: { organizationId: otherOrgId },
        update: { status: 'trialing' },
        create: {
          organizationId: otherOrgId, planId: starter.id, status: 'trialing',
          trialEndsAt: new Date(Date.now() + 7 * 86400000),
          currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });
    }
  }

  // Événements + paiements de test
  const d = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
  await createEvent(ownerCtx, {
    name: `Gala P14 ${stamp}`, typeCode: 'gala', date: d, startTime: '19:00',
    timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'Salle A', city: 'KIN',
  });
  await prisma.payment.create({
    data: {
      organizationId: orgId, provider: 'mock', providerPaymentId: `pm_p14_${stamp}`,
      amountMinor: 2999, currency: 'USD', status: 'succeeded', description: 'Pro mensuel',
    },
  });
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    await prisma.payment.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.subscription.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.design.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.aiUsage.deleteMany({ where: { organizationId: org } }).catch(() => {});
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.designTemplate.deleteMany({ where: { organizationId: null, name: { startsWith: 'P14' } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, sandboxUserId] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: adminEmail } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('dashboard & analytics', () => {
  it('KPIs cohérents avec la DB', async () => {
    const d = await adminDashboard();
    const [users, orgs, events, payments] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count({ where: { deletedAt: null } }),
      prisma.event.count(),
      prisma.payment.count(),
    ]);
    expect(d.users.total).toBe(users);
    expect(d.organizations.total).toBe(orgs);
    expect(d.events.total).toBe(events);
    expect(d.payments.total).toBe(payments);
    expect(d.subscriptions.total).toBeGreaterThanOrEqual(2);
    expect(d.subscriptions.byStatus.active ?? 0).toBeGreaterThanOrEqual(1);
    expect(d.payments.succeededAmountMinor).toBeGreaterThanOrEqual(2999);
  });

  it('analytics : structure 6 mois + cohérence événements par type', async () => {
    const a = await adminAnalytics();
    expect(a.months).toHaveLength(6);
    expect(a.newOrganizations).toHaveLength(6);
    expect(a.newUsers).toHaveLength(6);
    expect(a.aiCreditsByMonth).toHaveLength(6);
    expect(a.revenueByMonth).toHaveLength(6);
    const totalEvents = a.eventsByType.reduce((n, e) => n + e.count, 0);
    expect(totalEvents).toBe((await prisma.event.count()));
    expect(a.newOrganizations.reduce((n, x) => n + x, 0)).toBeGreaterThanOrEqual(2); // nos 2 orgs
  });
});

describe('utilisateurs', () => {
  it('recherche par e-mail + membres joints', async () => {
    const res = await listAdminUsers({ search: email, pageSize: 5 });
    expect(res.total).toBe(1);
    expect(res.items[0].email).toBe(email);
    expect(res.items[0].memberships.length).toBeGreaterThanOrEqual(1);
  });

  it('drapeau super admin modifiable ; inconnu → 404', async () => {
    const u = await updateAdminUser(otherOwnerId, { isSuperAdmin: true });
    expect(u.isSuperAdmin).toBe(true);
    await updateAdminUser(otherOwnerId, { isSuperAdmin: false });
    await expect(updateAdminUser('inexistant', { isSuperAdmin: true })).rejects.toThrow(TenantError);
  });

  it('suppression : owner d’org active → 409 ; sans org → supprimé', async () => {
    await expect(deleteAdminUser(ownerId)).rejects.toThrow(/propriétaire/i);
    await expect(deleteAdminUser(sandboxUserId)).resolves.not.toThrow();
    expect(await prisma.user.findUnique({ where: { id: sandboxUserId } })).toBeNull();
  });
});

describe('organisations', () => {
  it('liste avec recherche + plan joint (join manuel)', async () => {
    const res = await listAdminOrgs({ search: `P14 Org ${stamp}` });
    expect(res.total).toBe(1);
    const o = res.items[0];
    expect(o.subscription).not.toBeNull();
    expect(o.subscription!.plan.code).toBe('pro');
    expect(o._count.events).toBeGreaterThanOrEqual(1);
  });

  it('activation/désactivation ; suppression protégée si sub active', async () => {
    const u1 = await updateAdminOrg(otherOrgId, { isActive: false });
    expect(u1.isActive).toBe(false);
    await updateAdminOrg(otherOrgId, { isActive: true });

    await expect(deleteAdminOrg(orgId)).rejects.toThrow(/abonnement actif/i);
    await expect(deleteAdminOrg('inexistant')).rejects.toThrow(TenantError);
  });
});

describe('événements plateforme', () => {
  it('recherche par nom + statuts + suppression', async () => {
    const res = await listAdminEvents({ search: `Gala P14 ${stamp}` });
    expect(res.total).toBe(1);
    const ev = res.items[0];

    await expect(updateAdminEvent(ev.id, 'statut_invalide')).rejects.toThrow(TenantError);
    const upd = await updateAdminEvent(ev.id, 'archived');
    expect(upd.status).toBe('archived');

    await deleteAdminEvent(ev.id);
    expect(await prisma.event.findUnique({ where: { id: ev.id } })).toBeNull();
  });
});

describe('abonnements & paiements', () => {
  it('filtre statut + plan joint', async () => {
    const active = await listAdminSubscriptions({ status: 'active' });
    expect(active.items.length).toBeGreaterThanOrEqual(1);
    expect(active.items.every((s) => s.status === 'active')).toBe(true);
    const org = active.items.find((s) => s.organization.id === orgId);
    expect(org?.plan.code).toBe('pro');

    const trialing = await listAdminSubscriptions({ status: 'trialing' });
    expect(trialing.items.some((s) => s.organization.id === otherOrgId)).toBe(true);
  });

  it('paiements : liste + détail ; inconnu → 404', async () => {
    const res = await listAdminPayments({ status: 'succeeded' });
    const p = res.items.find((x) => x.organization.id === orgId);
    expect(p).toBeDefined();
    expect(p!.amountMinor).toBe(2999);
    const detail = await getAdminPayment(p!.id);
    expect(detail.description).toContain('Pro');
    await expect(getAdminPayment('inexistant')).rejects.toThrow(TenantError);
  });
});

describe('templates plateforme', () => {
  let tplId: string;

  it('création + recherche + update (vedette)', async () => {
    const tpl = await createAdminTemplate({
      name: `P14 Test ${stamp}`, category: 'gala', style: 'luxe', format: 'portrait',
      width: 1080, height: 1350,
      contentJson: { background: { type: 'color', value: '#111111' }, elements: [] },
      isPremium: true, requiredPlan: 'pro', isFeatured: false, status: 'published',
    });
    tplId = tpl.id;
    expect(tpl.organizationId).toBeNull();

    const found = await listAdminTemplates({ search: `P14 Test ${stamp}` });
    expect(found.total).toBe(1);

    const upd = await updateAdminTemplate(tplId, {
      name: `P14 Test ${stamp}`, category: 'gala', style: 'luxe', format: 'portrait',
      width: 1080, height: 1350,
      contentJson: { background: { type: 'color', value: '#222222' }, elements: [] },
      isPremium: true, requiredPlan: 'pro', isFeatured: true, status: 'published',
    });
    expect(upd.isFeatured).toBe(true);
  });

  it('suppression : direct si libre, archivé si référencé par un design', async () => {
    const res = await deleteAdminTemplate(tplId);
    expect(res.deleted).toBe(true);

    const tpl2 = await createAdminTemplate({
      name: `P14 Ref ${stamp}`, category: 'gala', style: 'luxe', format: 'portrait',
      width: 1080, height: 1350,
      contentJson: { background: { type: 'color', value: '#333333' }, elements: [] },
      isPremium: false, requiredPlan: null, isFeatured: false, status: 'published',
    });
    const design = await prisma.design.create({
      data: {
        organizationId: orgId, type: 'invitation', name: `Design réf ${stamp}`,
        format: 'portrait', width: 1080, height: 1350,
        backgroundJson: { type: 'color', value: '#333333' }, elementsJson: [],
        templateId: tpl2.id, createdById: ownerId,
      },
    });
    const res2 = await deleteAdminTemplate(tpl2.id);
    expect(res2.deleted).toBe(false);
    expect(res2.archived).toBe(true);
    expect(res2.usedByDesigns).toBe(1);
    expect((await prisma.designTemplate.findUnique({ where: { id: tpl2.id } }))!.status).toBe('archived');
    expect(design.id).toBeTruthy();
  });
});

describe('crédits IA (ajustement admin)', () => {
  it('dépense imposée (delta > 0) puis crédit (delta < 0) : solde net cohérent', async () => {
    // État initial : 0 usage
    const h0 = await listAiCreditsForOrg(otherOrgId, {});
    expect(h0.net).toBe(0);

    await adjustAiCredits(otherOrgId, { delta: 20, reason: 'rattrapage démo' });
    const h1 = await listAiCreditsForOrg(otherOrgId, {});
    expect(h1.net).toBe(20);

    await adjustAiCredits(otherOrgId, { delta: -8, reason: 'geste commercial' });
    const h2 = await listAiCreditsForOrg(otherOrgId, {});
    expect(h2.net).toBe(12);
    expect(h2.items[0].operation).toBe('admin_adjustment');

    // Ligne admin visible dans l'historique org (côté service AI P13)
    const { getAiUsage } = await import('@/server/services/ai');
    const usage = await getAiUsage(mkCtx({ id: otherOrgId, name: 'X', slug: 'x' }, { id: otherOwnerId, email: email2 }), {});
    expect(usage.items.length).toBe(2);
  });

  it('delta nul → 400 ; org inconnue → 404', async () => {
    await expect(adjustAiCredits(otherOrgId, { delta: 0 })).rejects.toThrow(TenantError);
    await expect(adjustAiCredits('inexistant', { delta: 10 })).rejects.toThrow(TenantError);
  });
});

describe('journal d’activité', () => {
  it('filtres action + org + date', async () => {
    const byAction = await listAdminLogs({ action: 'admin.user.update' });
    expect(byAction.total).toBeGreaterThanOrEqual(1);

    const byOrg = await listAdminLogs({ orgId });
    // Les logs admin utilisent organizationId=null → 0 pour une org
    expect(byOrg.items.every((l) => l.organization === null || l.organization.id === orgId)).toBe(true);

    const future = await listAdminLogs({ from: '2099-01-01' });
    expect(future.total).toBe(0);
  });
});
