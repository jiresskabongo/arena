import { prisma } from '@/lib/prisma';
import { tenantWhere, TenantError, type TenantContext } from '@/server/services/tenant';
import { getPlanByCode, getSubscriptionView, planLimit, type PlanView } from '@/server/services/subscription';

/**
 * Quotas par plan (CDC §59) — calculés sur les DONNÉES RÉELLES (toujours
 * honnêtes, pas de compteur fantôme) :
 *  - events            : événements non archivés
 *  - guestsPerEvent    : maximum d'invités sur un même événement
 *  - members           : membres de l'organisation (non retirés)
 *  - storageMb         : taille des fichiers média de l'organisation
 *  - emailsPerMonth    : e-mails de la période courante (MessageLog)
 *  - smsPerMonth       : SMS de la période courante (MessageLog)
 *  - aiCreditsPerMonth : crédits IA consommés moins remboursés (AiUsage)
 */

export type QuotaKey =
  | 'events'
  | 'guestsPerEvent'
  | 'members'
  | 'storageMb'
  | 'emailsPerMonth'
  | 'smsPerMonth'
  | 'aiCreditsPerMonth';

export interface QuotaState {
  key: QuotaKey;
  used: number;
  limit: number;
  remaining: number;
  /** 0..100 (pct > 100 = dépassé) */
  pct: number;
}

export const QUOTA_KEYS: QuotaKey[] = [
  'events',
  'guestsPerEvent',
  'members',
  'storageMb',
  'emailsPerMonth',
  'smsPerMonth',
  'aiCreditsPerMonth',
];

function monthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Usage réel de chaque quota de l'organisation (limite = 0 ⇒ sans limite). */
export async function getQuotas(organizationId: string, plan: PlanView): Promise<QuotaState[]> {
  const where = tenantWhere(organizationId);
  const since = monthStartUtc();

  const [events, guestByEvent, members, storageBytes, emails, sms, aiRows] = await Promise.all([
    prisma.event.count({ where: { ...where, status: { not: 'archived' } } }),
    prisma.guest.groupBy({
      by: ['eventId'],
      where,
      _count: { _all: true },
    }),
    prisma.organizationMember.count({ where: { ...where, status: { not: 'removed' } } }),
    prisma.mediaFile
      .aggregate({ where: { ...where, deletedAt: null }, _sum: { sizeBytes: true } })
      .then((r) => r._sum.sizeBytes ?? 0),
    prisma.messageLog.count({ where: { ...where, channel: 'email', createdAt: { gte: since } } }),
    prisma.messageLog.count({ where: { ...where, channel: 'sms', createdAt: { gte: since } } }),
    prisma.aiUsage
      .aggregate({ where: { ...where, createdAt: { gte: since } }, _sum: { creditsCost: true, creditsRefunded: true } }),
  ]);

  const maxGuests = guestByEvent.length ? Math.max(...guestByEvent.map((g) => g._count._all)) : 0;
  const aiCredits = Math.max(0, (aiRows._sum.creditsCost ?? 0) - (aiRows._sum.creditsRefunded ?? 0));

  const used: Record<QuotaKey, number> = {
    events,
    guestsPerEvent: maxGuests,
    members,
    storageMb: Math.ceil(storageBytes / 1_048_576),
    emailsPerMonth: emails,
    smsPerMonth: sms,
    aiCreditsPerMonth: aiCredits,
  };

  return QUOTA_KEYS.map((key) => {
    // La clé de quota "members" correspond à la limite "collaborators" du plan (seed)
    const limitKey = key === 'members' ? 'collaborators' : key;
    const limit = planLimit(plan, limitKey, 0);
    return {
      key,
      used: used[key],
      limit,
      remaining: limit > 0 ? Math.max(0, limit - used[key]) : 0,
      pct: limit > 0 ? Math.round((used[key] / limit) * 100) : 0,
    };
  });
}

/**
 * Vérifie qu'une souscription est active pour une action de CRÉATION
 * (lectures jamais bloquées) : essai expiré → 403 trial_expired.
 */
export async function assertWritable(organizationId: string): Promise<void> {
  const sub = await getSubscriptionView(organizationId);
  if (sub?.trialExpired) {
    throw new TenantError(403, 'trial_expired', 'Votre période d’essai est terminée. Choisissez un plan pour continuer.');
  }
}

/**
 * Vérifie le quota avant création (consomme `extra` unité(s) virtuelles).
 * Lève TenantError(403, quota_exceeded) si le seuil est atteint.
 * limit = 0 ⇒ sans limite (business illimité n'existe pas dans le seed —
 * la valeur 0 d'une clé absente du plan signifie "non plafonné").
 */
export async function assertQuota(
  ctx: TenantContext,
  key: QuotaKey,
  extra = 1,
): Promise<QuotaState> {
  if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

  const sub = await getSubscriptionView(ctx.organization.id);
  const plan = sub?.plan ?? (await getPlanByCode('starter'))!;

  const quotas = await getQuotas(ctx.organization.id, plan);
  const state = quotas.find((q) => q.key === key)!;

  if (state.limit > 0 && state.used + extra > state.limit) {
    throw new TenantError(
      403,
      'quota_exceeded',
      `Quota atteint : ${state.used}/${state.limit}. Passez à un plan supérieur.`,
    );
  }
  return state;
}
