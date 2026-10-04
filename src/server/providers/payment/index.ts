import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { TenantError } from '@/server/services/tenant';
import type { Prisma } from '@prisma/client';

/**
 * Provider PAIEMENT mock (CDC §60, réserve « providers mock identifiés »).
 *
 * - Checkout simulé : `Payment` en `pending` (provider='mock'), aucun débit.
 * - Le STATUT d'abonnement n'est modifié QUE par le webhook signé + idempotent
 *   (`applyWebhook`) — jamais par une réponse navigateur (critère O).
 * - Signature : HMAC-SHA256 du corps JSON (clé `MOCK_WEBHOOK_SECRET`).
 * - Idempotence : `WebhookEvent` @@unique([provider, providerEventId]) ; une
 *   double livraison = 1 effet (testé).
 * En production : Stripe (Checkout + webhooks signés) — même contrat.
 */

export const MOCK_PROVIDER = 'mock';
export const WEBHOOK_SECRET = process.env.MOCK_WEBHOOK_SECRET || 'mock-webhook-secret-dev';

export interface WebhookPayload {
  id: string; // providerEventId (unique par provider)
  type: string; // checkout.succeeded | checkout.failed | subscription.updated
  data: Record<string, unknown>;
}

export function signWebhook(body: string, secret: string = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function verifyWebhook(body: string, signature: string | null, secret: string = WEBHOOK_SECRET): boolean {
  if (!signature) return false;
  const expected = signWebhook(body, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/** Crée un checkout mock (Payment pending). Seul le serveur le fait. */
export async function createMockCheckout(input: {
  organizationId: string;
  subscriptionId: string;
  planCode: string;
  interval: 'monthly' | 'yearly';
  currency: string;
  amountMinor: number;
  description: string;
}): Promise<{ paymentId: string; amountMinor: number; currency: string; interval: string }> {
  const providerPaymentId = `ch_mock_${crypto.randomBytes(12).toString('hex')}`;
  const payment = await prisma.payment.create({
    data: {
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      provider: MOCK_PROVIDER,
      providerPaymentId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: 'pending',
      description: input.description,
      rawJson: { checkout: true, planCode: input.planCode, interval: input.interval } as Prisma.InputJsonValue,
    },
  });
  return { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, interval: input.interval };
}

/**
 * Applique un webhook (déjà vérifié + dédupliqué) : c'est le SEUL chemin qui
 * modifie le statut d'abonnement (critère O). Tout dans une transaction.
 */
export async function applyWebhook(
  payload: WebhookPayload,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const d = payload.data;
  const providerPaymentId = typeof d.providerPaymentId === 'string' ? d.providerPaymentId : null;
  if (!providerPaymentId) return;

  const payment = await tx.payment.findFirst({ where: { providerPaymentId } });
  if (!payment) return; // paiement inconnu → ignoré (déjà traité ou erroné)

  if (payload.type === 'checkout.succeeded') {
    const planCode = typeof d.planCode === 'string' ? d.planCode : null;
    const interval = d.interval === 'yearly' ? 'yearly' : 'monthly';
    if (!planCode) return;

    const plan = await tx.plan.findUnique({ where: { code: planCode } });
    if (!plan) return;

    const now = new Date();
    const periodEnd = new Date(now.getTime() + (interval === 'yearly' ? 365 : 30) * 24 * 3600 * 1000);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', rawJson: { ...(payment.rawJson as object ?? {}), webhookId: payload.id } as Prisma.InputJsonValue },
    });

    const sub = await tx.subscription.findUnique({ where: { organizationId: payment.organizationId } });
    if (sub) {
      const changed = sub.planId !== plan.id || sub.status !== 'active';
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: plan.id,
          status: 'active',
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          provider: MOCK_PROVIDER,
          providerSubscriptionId: providerPaymentId,
        },
      });
      if (changed) {
        await tx.subscriptionsHistory.create({
          data: { organizationId: payment.organizationId, planId: plan.id, status: 'active', reason: 'payment_succeeded', at: now },
        });
      }
      // Facture payée
      const year = now.getUTCFullYear();
      const count = await tx.invoice.count({ where: { organizationId: payment.organizationId, number: { startsWith: `INV-${year}-` } } });
      await tx.invoice.create({
        data: {
          organizationId: payment.organizationId,
          subscriptionId: sub.id,
          number: `INV-${year}-${String(count + 1).padStart(4, '0')}`,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          status: 'paid',
          issuedAt: now,
          dueAt: now,
          providerInvoiceId: providerPaymentId,
        },
      });
    }
  } else if (payload.type === 'checkout.failed') {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
  }
  // subscription.updated : réservé prod (Stripe) — ignoré en mock
}

/**
 * Point d'entrée webhook : vérifie la signature, déduplique (idempotent),
 * applique. Retourne `duplicate: true` si l'événement était déjà traité.
 */
export async function processWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ ok: true; duplicate: boolean; type: string }> {
  if (!verifyWebhook(rawBody, signature)) {
    throw new TenantError(400, 'invalid_signature', 'Signature du webhook invalide.');
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    throw new TenantError(400, 'invalid_payload', 'Payload JSON invalide.');
  }
  if (typeof payload.id !== 'string' || typeof payload.type !== 'string' || !payload.data) {
    throw new TenantError(400, 'invalid_payload', 'Payload webhook incomplet.');
  }

  // Déduplication : même (provider, providerEventId) → 1 seul effet
  const existing = await prisma.webhookEvent.findUnique({
    where: { provider_providerEventId: { provider: MOCK_PROVIDER, providerEventId: payload.id } },
  });
  if (existing) {
    return { ok: true, duplicate: true, type: payload.type };
  }

  let processed = false;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.webhookEvent.create({
        data: { provider: MOCK_PROVIDER, providerEventId: payload.id, type: payload.type, payloadJson: payload as unknown as Prisma.InputJsonValue },
      });
      // (create unique = garde-fou anti-course)
      if (!created) return;
      await applyWebhook(payload, tx);
      await tx.webhookEvent.update({ where: { id: created.id }, data: { processedAt: new Date() } });
      processed = true;
    });
  } catch (e) {
    // P2002 = doublon concurrent → idempotent
    if ((e as { code?: string })?.code === 'P2002') {
      return { ok: true, duplicate: true, type: payload.type };
    }
    await prisma.webhookEvent
      .update({ where: { provider_providerEventId: { provider: MOCK_PROVIDER, providerEventId: payload.id } }, data: { error: String((e as Error).message ?? e) } })
      .catch(() => {});
    throw new TenantError(500, 'webhook_processing_failed', 'Échec du traitement du webhook.');
  }
  void processed;
  return { ok: true, duplicate: false, type: payload.type };
}
