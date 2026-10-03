/**
 * Tests d'intégration SaaS / multi-tenancy (critère d'acceptation P du CDC)
 * contre la base SQLite de dev. Nettoient après exécution.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { getQuotas, assertQuota, type QuotaKey } from '@/server/services/quotas';
import { getSubscriptionView } from '@/server/services/subscription';
import { tenantWhere, type TenantContext } from '@/server/services/tenant';
import { TenantError } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const emailA = `p3alice.${stamp}@exemple.cd`;
const emailB = `p3bob.${stamp}@exemple.cd`;

let userA: string;
let userB: string;
let orgA: string;
let orgB: string;
const createdEventIds: string[] = [];

async function makeEvent(orgId: string, name: string): Promise<string> {
  const slug = `iso-${Math.random().toString(36).slice(2, 10)}`;
  const e = await prisma.event.create({
    data: {
      organizationId: orgId,
      name,
      typeCode: 'wedding',
      slug,
      date: new Date('2027-06-12T15:00:00Z'),
      startTime: '15:00',
      venue: 'Test Hall',
      optionsJson: { qr: true, rsvp: true } as object,
    },
  });
  createdEventIds.push(e.id);
  return e.id;
}

function ctxFor(orgId: string, userId: string): TenantContext {
  return {
    user: {
      id: userId, email: 'x@y.z', firstName: 'X', lastName: 'Y', passwordHash: '',
      locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false,
      emailVerifiedAt: null,
    } as never,
    isSuperAdmin: false,
    organization: {
      id: orgId, name: 'ISO', slug: 'iso', currency: 'USD', locale: 'fr',
      timezone: 'Africa/Kinshasa', isActive: true,
    },
    role: 'owner',
  };
}

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  for (const orgId of [orgA, orgB]) {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  }
  for (const uid of [userA, userB]) {
    await prisma.user.delete({ where: { id: uid } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('essai gratuit à l’inscription (CDC §59)', () => {
  it('crée l’org, l’owner et une souscription en essai (starter, 7 jours)', async () => {
    const ra = await register(
      { email: emailA, password: 'Event1234', firstName: 'Alice', lastName: 'K', organizationName: `Org A ${stamp}` },
      null,
    );
    const rb = await register(
      { email: emailB, password: 'Event1234', firstName: 'Bob', lastName: 'K', organizationName: `Org B ${stamp}` },
      null,
    );
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    userA = ra.data.userId;
    orgA = ra.data.organizationId;
    userB = rb.data.userId;
    orgB = rb.data.organizationId;
    expect(orgA).not.toBe(orgB);

    const subA = await getSubscriptionView(orgA);
    expect(subA).not.toBeNull();
    expect(subA!.status).toBe('trialing');
    expect(subA!.plan.code).toBe('starter');
    expect(subA!.inTrial).toBe(true);
    expect(subA!.daysLeft).toBeGreaterThanOrEqual(6); // 7 jours au maximum
    expect(subA!.trialExpired).toBe(false);

    // Historique de souscription
    const history = await prisma.subscriptionsHistory.count({ where: { organizationId: orgA } });
    expect(history).toBeGreaterThanOrEqual(1);
  });
});

describe('isolement multi-tenant (critère P)', () => {
  it('les données de l’org A ne sont jamais visibles via l’org B', async () => {
    // A crée un événement + un invité
    await makeEvent(orgA, 'Mariage A');
    await prisma.guest.create({
      data: { eventId: (await prisma.event.findFirst({ where: tenantWhere(orgA) }))!.id, organizationId: orgA, firstName: 'Invité A', lastName: 'A' },
    });

    const usageA = await getQuotas(orgA, (await getSubscriptionView(orgA))!.plan);
    const usageB = await getQuotas(orgB, (await getSubscriptionView(orgB))!.plan);

    expect(usageA.find((q) => q.key === 'events')!.used).toBe(1);
    expect(usageB.find((q) => q.key === 'events')!.used).toBe(0); // B voit 0
    expect(usageB.find((q) => q.key === 'guestsPerEvent')!.used).toBe(0); // B voit 0 invité

    // et inversement
    await makeEvent(orgB, 'Anniv B');
    const usageB2 = await getQuotas(orgB, (await getSubscriptionView(orgB))!.plan);
    expect(usageB2.find((q) => q.key === 'events')!.used).toBe(1);
    const usageA2 = await getQuotas(orgA, (await getSubscriptionView(orgA))!.plan);
    expect(usageA2.find((q) => q.key === 'events')!.used).toBe(1); // A n'a pas grossi
  });

  it('le quota de l’org A est indépendant de B (starter = 1 événement)', async () => {
    // A a déjà 1 événement (limite starter = 1)
    await expect(assertQuota(ctxFor(orgA, userA), 'events' as QuotaKey, 1)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    const err = await assertQuota(ctxFor(orgA, userA), 'events').catch((e) => e);
    expect(err).toBeInstanceOf(TenantError);

    // B, sans événement, est encore autorisé
    await expect(assertQuota(ctxFor(orgB, userB), 'events', 0)).resolves.toMatchObject({ key: 'events' });
  });
});
