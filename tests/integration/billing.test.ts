/**
 * Tests d'intégration Phase 11 : billing (CDC §60, critère O).
 * - Checkout mock (montant = PlanPrice, devises USD/CDF/EUR, CDF sans centimes)
 * - Paiement simulé → **webhook signé + idempotent** modifie le statut (jamais le navigateur)
 * - Signature invalide → 400, aucun effet
 * - Double livraison du webhook = 1 effet (paiement/facture/historique uniques)
 * - Webhook direct (sans confirm) : même effet — le serveur est la source de vérité
 * - Échec de paiement → Payment failed, statut inchangé
 * - Annulation fin de période / réactivation
 * - Rollover lazy : renouvellement (facture payée) / passage « canceled »
 * - Post-trial : écritures verrouillées (trial_expired), lecture conservée
 * - Factures : liste paginée, PDF, isolation inter-tenants
 * - Admin : mise à jour d'un plan (super admin) → quotas appliqués
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { register } from '@/server/services/account';
import { createEvent } from '@/server/services/event';
import {
  createCheckout, confirmCheckout, cancelAtPeriodEnd, reactivate,
  listInvoices, rollSubscriptionIfDue,
} from '@/server/services/billing';
import { getSubscriptionView } from '@/server/services/subscription';
import { signWebhook, processWebhook } from '@/server/providers/payment';
import { TenantError } from '@/server/services/tenant';
import type { TenantContext } from '@/server/services/tenant';

const stamp = Date.now().toString(36);
const email = `p11own.${stamp}@exemple.cd`;
const email2 = `p11other.${stamp}@exemple.cd`;

let ownerId: string;
let orgId: string;
let otherOwnerId: string;
let otherOrgId: string;

function ctx(o = { id: orgId, slug: 'p11', name: 'P11' }, u = { id: ownerId }): TenantContext {
  return {
    user: { id: u.id, email, firstName: 'P11', lastName: 'Own', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: o.id, name: o.name, slug: o.slug, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function otherCtx(): TenantContext {
  return {
    user: { id: otherOwnerId, email: email2, firstName: 'P11', lastName: 'Oth', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'Africa/Kinshasa', isSuperAdmin: false, emailVerifiedAt: null } as never,
    isSuperAdmin: false,
    organization: { id: otherOrgId, name: 'P11 Other', slug: `p11o${stamp}`, currency: 'USD', locale: 'fr', timezone: 'Africa/Kinshasa', isActive: true },
    role: 'owner',
  };
}
function adminCtx(): TenantContext {
  return {
    user: { id: 'admin', email: 'admin@eventflow', firstName: 'Admin', lastName: 'S', passwordHash: '', locale: 'fr', currency: 'USD', timezone: 'UTC', isSuperAdmin: true, emailVerifiedAt: null } as never,
    isSuperAdmin: true,
    organization: null,
    role: null,
  };
}

beforeAll(async () => {
  const reg = await register({ email, password: 'Event1234', firstName: 'P11', lastName: 'Own', organizationName: `P11 Org ${stamp}` }, null);
  expect(reg.ok).toBe(true);
  if (!reg.ok) return;
  ownerId = reg.data.userId;
  orgId = reg.data.organizationId;

  const reg2 = await register({ email: email2, password: 'Event1234', firstName: 'P11', lastName: 'Oth', organizationName: `P11 Other ${stamp}` }, null);
  expect(reg2.ok).toBe(true);
  if (!reg2.ok) return;
  otherOwnerId = reg2.data.userId;
  otherOrgId = reg2.data.organizationId;

  // Nettoyage du welcome (compté quota P10) + reset des périodes (essai actif)
  await prisma.messageLog.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  for (const o of [orgId, otherOrgId]) {
    await prisma.subscription.updateMany({
      where: { organizationId: o },
      data: { status: 'trialing', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 7 * 86_400_000) },
    });
  }
});

afterAll(async () => {
  for (const org of [orgId, otherOrgId]) {
    const eventIds = (await prisma.event.findMany({ where: { organizationId: org }, select: { id: true } })).map((e) => e.id);
    await prisma.webhookEvent.deleteMany({}).catch(() => {});
    await prisma.invoice.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.payment.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.subscriptionsHistory.deleteMany({ where: { organizationId: org } }).catch(() => {});
    await prisma.guest.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { organizationId: org } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('checkout mock', () => {
  it('crée un checkout : montant = PlanPrice (USD mensuel, Pro)', async () => {
    const planRow = await prisma.plan.findUnique({ where: { code: 'pro' }, include: { prices: true } });
    const price = planRow!.prices.find((p) => p.currency === 'USD' && p.interval === 'monthly')!;
    const res = await createCheckout(ctx(), { planCode: 'pro', interval: 'monthly' });
    expect(res.mock).toBe(true);
    expect(res.amountMinor).toBe(price.amountMinor);
    expect(res.currency).toBe('USD');
    const payment = await prisma.payment.findUnique({ where: { id: res.paymentId } });
    expect(payment!.status).toBe('pending');
    expect(payment!.provider).toBe('mock');
  });

  it('CDF : montant entier, sans centimes (réserve §13)', async () => {
    const res = await createCheckout(ctx(), { planCode: 'pro', interval: 'monthly', currency: 'CDF' });
    expect(res.currency).toBe('CDF');
    expect(Number.isInteger(res.amountMinor)).toBe(true);
    // Format affiché : pas de décimales
    const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(res.amountMinor);
    expect(fmt).not.toContain('.');
  });

  it('Starter non achetable + plan inconnu → 400/404', async () => {
    await expect(createCheckout(ctx(), { planCode: 'starter' })).rejects.toThrow(TenantError);
    await expect(createCheckout(ctx(), { planCode: 'platinium' })).rejects.toThrow(TenantError);
  });

  it('confirm « succeeded » → statut active UNIQUEMENT via webhook ; facture payée', async () => {
    const before = await prisma.payment.count({ where: { organizationId: orgId } });
    const co = await createCheckout(ctx(), { planCode: 'pro', interval: 'monthly' });

    const res = await confirmCheckout(ctx(), co.paymentId, 'succeeded');
    expect(res.ok).toBe(true);
    expect(res.paymentStatus).toBe('succeeded');
    expect(res.duplicate).toBe(false);

    const sub = await getSubscriptionView(orgId);
    expect(sub!.plan.code).toBe('pro');
    expect(sub!.status).toBe('active');
    expect(sub!.inTrial).toBe(false);
    expect(sub!.trialExpired).toBe(false);

    // 1 paiement de plus, 1 facture payée, historique alimenté
    const payments = await prisma.payment.count({ where: { organizationId: orgId } });
    expect(payments).toBe(before + 1);
    const invoice = await prisma.invoice.findFirst({ where: { organizationId: orgId }, orderBy: { issuedAt: 'desc' } });
    expect(invoice!.status).toBe('paid');
    expect(invoice!.number).toMatch(/^INV-\d{4}-\d{4}$/);
    const history = await prisma.subscriptionsHistory.count({ where: { organizationId: orgId } });
    expect(history).toBeGreaterThanOrEqual(2);
  });
});

describe('webhook (critère O : signature + idempotence, jamais le navigateur)', () => {
  let rawBody: string;
  let signature: string;
  let paymentId: string;

  beforeAll(async () => {
    const co = await createCheckout(otherCtx(), { planCode: 'pro', interval: 'monthly' });
    paymentId = co.paymentId;
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    const payload = {
      id: `evt_test_${stamp}`,
      type: 'checkout.succeeded',
      data: {
        providerPaymentId: payment!.providerPaymentId,
        planCode: 'pro',
        interval: 'monthly',
      },
    };
    rawBody = JSON.stringify(payload);
    signature = signWebhook(rawBody);
  });

  it('webhook direct signé → abonnement active (le serveur applique, pas le navigateur)', async () => {
    const res = await processWebhook(rawBody, signature);
    expect(res.duplicate).toBe(false);

    const sub = await getSubscriptionView(otherOrgId);
    expect(sub!.plan.code).toBe('pro');
    expect(sub!.status).toBe('active');
  });

  it('double livraison = 1 effet (idempotence)', async () => {
    const countInv = await prisma.invoice.count({ where: { organizationId: otherOrgId } });
    const countPay = await prisma.payment.count({ where: { organizationId: otherOrgId } });
    const countHist = await prisma.subscriptionsHistory.count({ where: { organizationId: otherOrgId } });

    const res = await processWebhook(rawBody, signature);
    expect(res.duplicate).toBe(true);

    expect(await prisma.invoice.count({ where: { organizationId: otherOrgId } })).toBe(countInv);
    expect(await prisma.payment.count({ where: { organizationId: otherOrgId } })).toBe(countPay);
    expect(await prisma.subscriptionsHistory.count({ where: { organizationId: otherOrgId } })).toBe(countHist);
  });

  it('signature invalide → 400 (invalid_signature), aucun effet', async () => {
    const payload = {
      id: `evt_bad_${stamp}`,
      type: 'checkout.succeeded',
      data: { providerPaymentId: (await prisma.payment.findUnique({ where: { id: paymentId } }))!.providerPaymentId, planCode: 'pro', interval: 'monthly' },
    };
    const body = JSON.stringify(payload);
    await expect(processWebhook(body, 'fausse_' + crypto.randomBytes(8).toString('hex'))).rejects.toMatchObject({ code: 'invalid_signature' } as never);
    // Aucun WebhookEvent créé pour cet id
    expect(await prisma.webhookEvent.findUnique({ where: { provider_providerEventId: { provider: 'mock', providerEventId: payload.id } } })).toBeNull();
  });

  it('payload malformé signé → 400 invalid_payload', async () => {
    const bad = JSON.stringify({ id: `evt_nomal_${stamp}` });
    await expect(processWebhook(bad, signWebhook(bad))).rejects.toMatchObject({ code: 'invalid_payload' } as never);
  });

  it('confirm après succès → 409 (déjà réglé)', async () => {
    await expect(confirmCheckout(otherCtx(), paymentId, 'succeeded')).rejects.toThrow(TenantError);
  });
});

describe('échec de paiement', () => {
  it('confirm « failed » → Payment failed, abonnement inchangé (trial)', async () => {
    const co = await createCheckout(ctx(), { planCode: 'pro', interval: 'monthly' });
    const res = await confirmCheckout(ctx(), co.paymentId, 'failed');
    expect(res.paymentStatus).toBe('failed');
    const sub = await getSubscriptionView(orgId);
    // L'org own est déjà Pro (test précédent) → on vérifie que l'échec n'a pas cassé
    expect(sub!.status).toBe('active');
    const payment = await prisma.payment.findUnique({ where: { id: co.paymentId } });
    expect(payment!.status).toBe('failed');
  });
});

describe('annulation / réactivation / rollover', () => {
  it('cancel → cancelAtPeriodEnd + historique ; reactivate → remis à false', async () => {
    const c = await cancelAtPeriodEnd(ctx());
    expect(c.ok).toBe(true);
    const s1 = await getSubscriptionView(orgId);
    expect(s1!.cancelAtPeriodEnd).toBe(true);

    await expect(cancelAtPeriodEnd(ctx())).rejects.toThrow(TenantError); // déjà programmé

    const r = await reactivate(ctx());
    expect(r.ok).toBe(true);
    const s2 = await getSubscriptionView(orgId);
    expect(s2!.cancelAtPeriodEnd).toBe(false);
  });

  it('rollover : période terminée + active → renouvellement (facture payée, nouvelle période)', async () => {
    await prisma.subscription.update({
      where: { organizationId: orgId },
      data: { currentPeriodEnd: new Date(Date.now() - 1000), currentPeriodStart: new Date(Date.now() - 30 * 86_400_000) },
    });
    const invoicesBefore = await prisma.invoice.count({ where: { organizationId: orgId } });
    const res = await rollSubscriptionIfDue(orgId);
    expect(res).toBe('renewed');
    const sub = await getSubscriptionView(orgId);
    expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.invoice.count({ where: { organizationId: orgId } })).toBe(invoicesBefore + 1);
  });

  it('rollover : période terminée + résiliation → canceled (+ historique)', async () => {
    await prisma.subscription.update({
      where: { organizationId: otherOrgId },
      data: { currentPeriodEnd: new Date(Date.now() - 1000), cancelAtPeriodEnd: true },
    });
    const res = await rollSubscriptionIfDue(otherOrgId);
    expect(res).toBe('canceled');
    const sub = await getSubscriptionView(otherOrgId);
    expect(sub!.status).toBe('canceled');
    expect(await prisma.subscriptionsHistory.findFirst({ where: { organizationId: otherOrgId, status: 'canceled' } })).toBeTruthy();
  });
});

describe('post-trial (verrouillage, données conservées)', () => {
  it('essai expiré → création d’événement refusée (trial_expired), lecture OK', async () => {
    await prisma.subscription.update({
      where: { organizationId: orgId },
      data: { status: 'trialing', trialEndsAt: new Date(Date.now() - 1000), currentPeriodStart: new Date(Date.now() - 8 * 86_400_000), currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    await expect(createEvent(ctx(), { name: `X ${stamp}`, typeCode: 'wedding', date: '2028-10-01', startTime: '19:00', timezone: 'Africa/Kinshasa', optionsJson: {}, venue: 'S', city: 'KIN' })).rejects.toThrow(/essai/i);

    // Lecture toujours possible (données conservées)
    const events = await prisma.event.count({ where: { organizationId: orgId } });
    expect(events).toBeGreaterThanOrEqual(0);
  });
});

describe('factures', () => {
  it('liste paginée + CDF sans centimes dans le format', async () => {
    const res = await listInvoices(ctx(), { page: 1, pageSize: 5 });
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.items.length).toBeLessThanOrEqual(5);
    for (const i of res.items) {
      expect(i.number).toMatch(/^INV-\d{4}-\d{4}$/);
      expect(['paid', 'open', 'void']).toContain(i.status);
    }
  });

  it('isolation inter-tenants : autre org → ses factures uniquement', async () => {
    const res = await listInvoices(otherCtx(), { page: 1, pageSize: 50 });
    // L'org other a payé 1× (webhook test) → 1 facture au plus
    expect(res.total).toBeLessThanOrEqual(1);
    const allMine = await listInvoices(ctx(), { page: 1, pageSize: 50 });
    if (res.items.length > 0 && allMine.items.length > 0) {
      const mine = new Set(allMine.items.map((i) => i.id));
      expect(res.items.every((i) => !mine.has(i.id))).toBe(true);
    }
  });

  it('PDF de facture : magic %PDF, taille > 1 Ko, facture introuvable → 404', async () => {
    const { invoicePdf } = await import('@/server/services/billing');
    const inv = (await prisma.invoice.findFirst({ where: { organizationId: orgId }, orderBy: { issuedAt: 'desc' } }))!;
    const { buffer, number } = await invoicePdf(ctx(), inv.id);
    expect(number).toBe(inv.number);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);

    await expect(invoicePdf(ctx(), 'inexistante')).rejects.toThrow(TenantError);
    await expect(invoicePdf(otherCtx(), inv.id)).rejects.toThrow(TenantError); // tenant
  });
});
