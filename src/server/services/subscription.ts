import { prisma } from '@/lib/prisma';
import type { Plan, PlanPrice, Prisma, Subscription } from '@prisma/client';

/**
 * Abonnement & essai (CDC §59 : souscription, essai, plans, quotas).
 * Le fournisseur de paiement reste le mock (Phase 8) ; ici on gère l'état
 * de la souscription et les limites/features du plan.
 */

export type PlanLimits = Record<string, number>;
export type PlanFeatures = Record<string, boolean>;

export interface PlanView {
  code: string;
  name: string;
  description: string;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
  prices: PlanPrice[];
}

export function toPlanView(plan: Plan): PlanView {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    trialDays: plan.trialDays,
    limits: (plan.limitsJson ?? {}) as PlanLimits,
    features: (plan.featuresJson ?? {}) as PlanFeatures,
    prices: [],
  };
}

export async function listPlans(): Promise<PlanView[]> {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, isArchived: false },
    include: { prices: { where: { isActive: true } } },
    orderBy: { code: 'asc' },
  });
  return plans.map((p) => ({ ...toPlanView(p), prices: p.prices }));
}

export async function getPlanByCode(code: string): Promise<PlanView | null> {
  const plan = await prisma.plan.findUnique({
    where: { code },
    include: { prices: { where: { isActive: true } } },
  });
  return plan ? { ...toPlanView(plan), prices: plan.prices } : null;
}

export interface SubscriptionView {
  status: string;
  plan: PlanView;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  inTrial: boolean;
  /** Jours restants de l'essai (0 si expiré / non en essai). */
  daysLeft: number;
  /** Essai expiré (bloque les créations, pas la lecture). */
  trialExpired: boolean;
}

/**
 * État de l'abonnement d'une organisation (null si aucune souscription).
 * Le statut "trialing" expiré est détecté de façon paresseuse sans écrire
 * en base (la bascule de statut est gérée par le fournisseur, Phase 8).
 */
export async function getSubscriptionView(organizationId: string): Promise<SubscriptionView | null> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!sub) return null;

  const planRow = await prisma.plan.findUnique({
    where: { id: sub.planId },
    include: { prices: { where: { isActive: true } } },
  });
  if (!planRow) return null;
  const plan = { ...toPlanView(planRow), prices: planRow.prices };
  const inTrial = sub.status === 'trialing';
  const trialExpired = inTrial && !!sub.trialEndsAt && sub.trialEndsAt.getTime() <= Date.now();
  const daysLeft =
    inTrial && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : 0;

  return { status: sub.status, plan, trialEndsAt: sub.trialEndsAt, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, inTrial, daysLeft, trialExpired };
}

/**
 * Démarre l'essai gratuit d'une organisation (à l'inscription, Phase 2 → 3).
 * Plan par défaut via env DEFAULT_PLAN_CODE (défaut : starter).
 */
export async function startTrial(
  organizationId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Subscription> {
  const code = process.env.DEFAULT_PLAN_CODE ?? 'starter';
  const plan = await tx.plan.findUnique({ where: { code } });
  if (!plan) {
    throw new Error(`Plan par défaut "${code}" introuvable (seed à exécuter ?)`);
  }

  const start = new Date();
  const end = new Date(start.getTime() + plan.trialDays * 86_400_000);

  const sub = await tx.subscription.upsert({
    where: { organizationId },
    // Un essai déjà commencé n'est jamais relancé
    update: {},
    create: {
      organizationId,
      planId: plan.id,
      status: 'trialing',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialEndsAt: end,
      provider: 'mock',
    },
  });

  if (!sub.updatedAt || sub.updatedAt.getTime() === sub.createdAt.getTime()) {
    await tx.subscriptionsHistory.create({
      data: { organizationId, planId: plan.id, status: 'trialing', reason: 'trial_started' },
    });
  }

  return sub;
}

/** Le plan accorde-t-il la feature (gate de fonctionnalité, CDC §59) ? */
export function planHasFeature(plan: { features: PlanFeatures }, feature: string): boolean {
  return Boolean(plan.features[feature]);
}

/** Limite numérique du plan pour une clé (fallback si absente). */
export function planLimit(plan: { limits: PlanLimits }, key: string, fallback = 0): number {
  const v = plan.limits[key];
  return typeof v === 'number' ? v : fallback;
}

/** Prix du plan dans une devise (1er prix actif trouvé). */
export function priceInCurrency(prices: PlanPrice[], currency: string) {
  return prices.find((p) => p.currency === currency) ?? null;
}
