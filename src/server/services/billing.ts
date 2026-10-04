import { prisma } from '@/lib/prisma';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { TenantError, type TenantContext } from '@/server/services/tenant';
import { logActivity } from '@/server/services/activity';
import { getPlanByCode, getSubscriptionView } from '@/server/services/subscription';
import { notifyOrg } from '@/server/services/communication';
import {
  createMockCheckout,
  MOCK_PROVIDER,
  processWebhook,
  signWebhook,
  type WebhookPayload,
} from '@/server/providers/payment';

/**
 * Billing (CDC §60, critère O) :
 * - Checkout mock → paiement simulé → **webhook signé + idempotent** modifie
 *   le statut d'abonnement (JAMAIS une réponse navigateur).
 * - Factures PDF, annulation/renouvellement (période), devises USD/CDF/EUR
 *   (CDF sans centimes — réserve §13).
 * - Post-trial : `assertWritable` (quotas.ts) verrouille les écritures ;
 *   les données restent consultables.
 */

export async function listPlansView(ctx: TenantContext) {
  const { listPlans } = await import('@/server/services/subscription');
  const currency = ctx.organization?.currency ?? 'USD';
  const plans = await listPlans();
  return {
    currency,
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description,
      trialDays: p.trialDays,
      limits: p.limits,
      features: p.features,
      prices: p.prices
        .slice()
        .sort((a, b) => (a.currency === currency ? -1 : b.currency === currency ? 1 : a.currency.localeCompare(b.currency))),
    })),
  };
}

/**
 * Crée un checkout mock pour un plan (serveur seul). Le navigateur ne fait
 * que demander ; le statut change uniquement via le webhook.
 */
export async function createCheckout(
  ctx: TenantContext,
  input: { planCode: unknown; interval?: unknown; currency?: unknown },
  ip: string | null = null,
): Promise<{ paymentId: string; amountMinor: number; currency: string; interval: string; planCode: string; mock: true }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const sub = await getSubscriptionView(orgId);
  if (!sub) throw new TenantError(409, 'no_subscription', 'Aucun abonnement.');

  const planCode = typeof input.planCode === 'string' ? input.planCode.trim().toLowerCase() : '';
  const plan = await getPlanByCode(planCode);
  if (!plan) throw new TenantError(400, 'plan_not_found', 'Plan inconnu.');
  if (plan.code === 'starter') throw new TenantError(400, 'plan_not_purchasable', 'Le plan Starter est gratuit.');

  const interval = input.interval === 'yearly' ? 'yearly' : 'monthly';
  const currency =
    typeof input.currency === 'string' && ['USD', 'CDF', 'EUR'].includes(input.currency)
      ? input.currency
      : (ctx.organization?.currency ?? 'USD');

  const price = plan.prices.find((p) => p.currency === currency && p.interval === interval);
  if (!price) throw new TenantError(404, 'price_not_found', `Pas de prix ${currency} (${interval}) pour ce plan.`);

  const row = await prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true } });
  const res = await createMockCheckout({
    organizationId: orgId,
    subscriptionId: row!.id,
    planCode: plan.code,
    interval,
    currency,
    amountMinor: price.amountMinor,
    description: `${plan.name} — ${interval} (${currency})`,
  });

  await logActivity({ organizationId: orgId, userId: ctx.user.id, action: 'billing.checkout', entity: 'payment', entityId: res.paymentId, meta: { planCode, interval, currency }, ip });
  return { ...res, planCode: plan.code, mock: true };
}

/**
 * Simule le retour du fournisseur de paiement : génère le webhook signé et le
 * passe par le MEME chemin idempotent que le POST /api/webhooks/mock.
 * Le navigateur ne décide de rien — l'effet vient du webhook.
 */
export async function confirmCheckout(
  ctx: TenantContext,
  paymentId: string,
  result: 'succeeded' | 'failed',
  ip: string | null = null,
): Promise<{ ok: true; paymentStatus: string; duplicate: boolean }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, organizationId: orgId } });
  if (!payment) throw new TenantError(404, 'payment_not_found', 'Paiement introuvable.');
  if (payment.status !== 'pending') throw new TenantError(409, 'payment_already_settled', 'Ce paiement est déjà réglé.');

  const payload: WebhookPayload = {
    id: `evt_${crypto.randomBytes(12).toString('hex')}`,
    type: result === 'succeeded' ? 'checkout.succeeded' : 'checkout.failed',
    data: {
      providerPaymentId: payment.providerPaymentId,
      ...(result === 'succeeded'
        ? {
            planCode: (payment.rawJson as { planCode?: string })?.planCode,
            interval: (payment.rawJson as { interval?: string })?.interval,
          }
        : {}),
    },
  };
  const body = JSON.stringify(payload);
  const signature = signWebhook(body);
  const res = await processWebhook(body, signature);

  const after = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
  await logActivity({ organizationId: orgId, userId: ctx.user.id, action: `billing.${result}`, entity: 'payment', entityId: payment.id, meta: { duplicate: res.duplicate }, ip });
  return { ok: true, paymentStatus: after!.status, duplicate: res.duplicate };
}

/** Annulation en fin de période (les données + l'accès restent jusqu'au terme). */
export async function cancelAtPeriodEnd(ctx: TenantContext, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const sub = await getSubscriptionView(orgId);
  if (!sub) throw new TenantError(409, 'no_subscription', 'Aucun abonnement.');
  if (sub.inTrial) throw new TenantError(400, 'trial_cannot_cancel', 'L’essai ne se résilie pas — choisissez un plan à la fin.');
  if (sub.cancelAtPeriodEnd) throw new TenantError(409, 'already_canceled', 'Déjà programmé en fin de période.');

  await prisma.subscription.update({ where: { organizationId: orgId }, data: { cancelAtPeriodEnd: true } });
  await prisma.subscriptionsHistory.create({
    data: { organizationId: orgId, planId: sub.plan.id, status: 'active', reason: 'cancel_scheduled', at: new Date() },
  });
  await notifyOrg(orgId, { type: 'billing.canceled', title: 'Abonnement résilié', body: `${sub.plan.name} restera actif jusqu’au terme de la période.` });
  await logActivity({ organizationId: orgId, userId: ctx.user.id, action: 'billing.cancel', entity: 'subscription', entityId: orgId, ip });
  return { ok: true as const };
}

export async function reactivate(ctx: TenantContext, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const sub = await getSubscriptionView(orgId);
  if (!sub) throw new TenantError(409, 'no_subscription', 'Aucun abonnement.');
  if (!sub.cancelAtPeriodEnd) throw new TenantError(409, 'not_canceled', 'Aucune résiliation programmée.');

  await prisma.subscription.update({ where: { organizationId: orgId }, data: { cancelAtPeriodEnd: false } });
  await prisma.subscriptionsHistory.create({
    data: { organizationId: orgId, planId: sub.plan.id, status: 'active', reason: 'reactivated', at: new Date() },
  });
  await logActivity({ organizationId: orgId, userId: ctx.user.id, action: 'billing.reactivate', entity: 'subscription', entityId: orgId, ip });
  return { ok: true as const };
}

/**
 * Rollover lazy (déterministe, sans cron) : appelé à la lecture de l'état.
 * - période terminée + résiliation programmée → `canceled` (+ historique)
 * - période terminée + active → renouvellement mock auto (nouvelle période,
 *   facture payée) — le mock ne connaît pas l'échec de renouvellement.
 */
export async function rollSubscriptionIfDue(organizationId: string): Promise<'none' | 'renewed' | 'canceled'> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub || sub.status !== 'active') return 'none';
  if (sub.currentPeriodEnd.getTime() > Date.now()) return 'none';

  if (sub.cancelAtPeriodEnd) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: sub.id }, data: { status: 'canceled' } }),
      prisma.subscriptionsHistory.create({
        data: { organizationId, planId: sub.planId, status: 'canceled', reason: 'period_end', at: new Date() },
      }),
    ]);
    return 'canceled';
  }

  // Renouvellement mock
  const now = new Date();
  const yearly = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime() > 300 * 24 * 3600 * 1000;
  const periodEnd = new Date(now.getTime() + (yearly ? 365 : 30) * 24 * 3600 * 1000);
  const plan = await prisma.plan.findUnique({ where: { id: sub.planId }, include: { prices: { where: { isActive: true } } } });
  if (!plan) return 'none';
  const price = plan.prices.find((p) => p.interval === (yearly ? 'yearly' : 'monthly')) ?? plan.prices[0];
  if (!price) return 'none';

  const year = now.getUTCFullYear();
  const count = await prisma.invoice.count({ where: { organizationId, number: { startsWith: `INV-${year}-` } } });
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: sub.id }, data: { currentPeriodStart: now, currentPeriodEnd: periodEnd } }),
    prisma.invoice.create({
      data: {
        organizationId,
        subscriptionId: sub.id,
        number: `INV-${year}-${String(count + 1).padStart(4, '0')}`,
        amountMinor: price.amountMinor,
        currency: price.currency,
        status: 'paid',
        issuedAt: now,
        dueAt: now,
        providerInvoiceId: sub.providerSubscriptionId,
      },
    }),
  ]);
  return 'renewed';
}

// ─────────────────────────── Factures ───────────────────────────

export async function listInvoices(
  ctx: TenantContext,
  q: { page?: number; pageSize?: number },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 25));

  const [items, total] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: orgId },
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { organization: { select: { name: true } } },
    }),
    prisma.invoice.count({ where: { organizationId: orgId } }),
  ]);
  const planIds = [...new Set(items.map((i) => i.subscriptionId).filter(Boolean))] as string[];
  const subs = planIds.length
    ? await prisma.subscription.findMany({ where: { id: { in: planIds } }, select: { id: true, planId: true } })
    : [];
  const planMap = new Map(
    (
      await prisma.plan.findMany({ where: { id: { in: [...new Set(subs.map((x) => x.planId))] } }, select: { id: true, name: true } })
    ).map((pl) => [pl.id, pl.name] as const),
  );

  return {
    items: items.map((i) => ({
      id: i.id,
      number: i.number,
      amountMinor: i.amountMinor,
      currency: i.currency,
      status: i.status,
      planName: (i.subscriptionId && planMap.get(subs.find((x) => x.id === i.subscriptionId)?.planId ?? '')) ?? null,
      issuedAt: i.issuedAt.toISOString(),
      dueAt: i.dueAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * PDF de facture (PDFKit, polices base-14 — réserve §13 #14). En-tête org +
 * plan, montant (CDF sans centimes), badge « DÉMO » (provider mock).
 */
export async function invoicePdf(
  ctx: TenantContext,
  invoiceId: string,
): Promise<{ buffer: Buffer; number: string }> {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { organization: true, subscription: { select: { planId: true } } },
  });
  if (!invoice) throw new TenantError(404, 'invoice_not_found', 'Facture introuvable.');
  const plan = invoice.subscription?.planId
    ? await prisma.plan.findUnique({ where: { id: invoice.subscription.planId }, select: { name: true } })
    : null;

  const fmt = (minor: number, cur: string) =>
    cur === 'CDF'
      ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(minor)} ${cur}`
      : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(minor / 100);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const org = invoice.organization;
  const dFmt = (d: Date) => d.toLocaleDateString('fr-FR');

  doc.rect(0, 0, doc.page.width, 90).fill('#1c1917');
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(22).text('EventFlow', 50, 28);
  doc.font('Helvetica').fontSize(11).fillColor('#d6d3d1').text('Facture — plateforme de gestion d’événements', 50, 58);
  doc.fillColor('#fbbf24').font('Helvetica-Bold').fontSize(9).text('DÉMO — provider mock, aucun débit réel', doc.page.width - 210, 30);

  doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(16).text(`Facture ${invoice.number}`, 50, 120);
  doc.font('Helvetica').fontSize(10).fillColor('#57534e');
  doc.text(`Émise le : ${dFmt(invoice.issuedAt)}`, 50, 150);
  doc.text(`Échéance : ${dFmt(invoice.dueAt)}`, 50, 164);
  doc.text(`Statut : ${invoice.status === 'paid' ? 'Payée' : invoice.status === 'void' ? 'Annulée' : 'Ouverte'}`, 50, 178);
  doc.text(`Provider : ${MOCK_PROVIDER} (démo)`, 50, 192);

  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1c1917').text('Client', 50, 220);
  doc.font('Helvetica').fontSize(10).fillColor('#44403c').text(org?.name ?? '—', 50, 236);

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1c1917').text('Prestation', 300, 220);
  doc.font('Helvetica').fontSize(10).fillColor('#44403c');
  doc.text(`Abonnement ${plan?.name ?? '—'}`, 300, 236);

  // Tableau
  let y = 270;
  doc.rect(50, y, doc.page.width - 100, 24).fill('#f5f5f4');
  doc.fillColor('#1c1917').font('Helvetica-Bold').fontSize(10)
    .text('Désignation', 56, y + 8)
    .text('Montant', doc.page.width - 160, y + 8, { width: 100, align: 'right' });
  y += 24;
  doc.rect(50, y, doc.page.width - 100, 24).fillAndStroke('#ffffff', '#e7e5e4');
  doc.fillColor('#44403c').font('Helvetica')
    .text(plan?.name ?? 'Abonnement', 56, y + 8)
    .text(fmt(invoice.amountMinor, invoice.currency), doc.page.width - 160, y + 8, { width: 100, align: 'right' });
  y += 36;
  doc.font('Helvetica-Bold').fillColor('#1c1917')
    .text('Total', doc.page.width - 220, y, { width: 50, align: 'right' })
    .text(fmt(invoice.amountMinor, invoice.currency), doc.page.width - 160, y, { width: 100, align: 'right' });

  doc.font('Helvetica').fontSize(8).fillColor('#a8a29e')
    .text('Document généré en mode démo (sandbox EventFlow). Aucun montant réel n’est prélevé.', 50, doc.page.height - 60);

  doc.end();
  const buffer = await done;
  return { buffer, number: invoice.number };
}
