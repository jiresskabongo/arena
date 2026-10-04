/**
 * Service IA — Phase 13 (CDC §18, ARCHITECTURE §5.9).
 *
 * Cycle de crédits complet (critère de sortie : « provider failure =
 * credit refund ») :
 *   1. vérification quota (aiCreditsPerMonth du plan) — 403 quota_exceeded
 *   2. RÉSERVATION : ligne AiUsage `pending` (le coût entre dans le quota au
 *      moment de la création de la ligne)
 *   3. exécution du provider (mock déterministe — réserve §13)
 *   4. succès → `success` (+ design créé / texte retourné)
 *      échec → `failed` + `creditsRefunded = coût` (remboursement : la ligne
 *      ne consomme plus de quota) + 502 `ai_provider_error`
 *
 * `pending` est un état intermédiaire de réservation (extension du modèle :
 * les états finaux restent success|failed, §13).
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { TenantError, type TenantContext } from '@/server/services/tenant';
import { assertQuota, getQuotas } from '@/server/services/quotas';
import { getSubscriptionView } from '@/server/services/subscription';
import { getEventForOrg } from '@/server/services/event';
import { logActivity } from '@/server/services/activity';
import { generateDesign, generateText, AiProviderError } from '@/server/providers/ai';

export const AI_KINDS = ['design', 'text'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** Coût en crédits par opération (tarification démo — MVP). */
export const AI_COSTS: Record<AiKind, number> = { design: 10, text: 5 };

export const aiGenerateSchema = z.object({
  kind: z.enum(AI_KINDS),
  prompt: z.string().min(3).max(1000),
  eventRef: z.string().optional(),
  /** Générer une variante attachée au même événement qu'un design existant. */
  designId: z.string().optional(),
});
export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;

interface EventRefLite {
  name: string;
  date: string;
  startTime: string;
  venue: string | null;
  city: string | null;
}

async function resolveEventRef(ctx: TenantContext, eventRef?: string): Promise<EventRefLite | null> {
  if (!eventRef) return null;
  const ev = await getEventForOrg(eventRef, ctx.organization!.id);
  if (!ev) throw new TenantError(404, 'event_not_found', 'Événement introuvable.');
  return {
    name: ev.name,
    date: ev.date.toISOString().slice(0, 10),
    startTime: ev.startTime,
    venue: ev.venue ?? null,
    city: ev.city ?? null,
  };
}

/**
 * Génère un design ou un texte via le provider IA avec cycle de crédits.
 * design → crée un Design (isAiGenerated) ; text → renvoie le texte.
 */
export async function aiGenerate(ctx: TenantContext, input: AiGenerateInput, ip: string | null = null) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const d = aiGenerateSchema.parse(input);
  const cost = AI_COSTS[d.kind];

  // 1. Quota mensuel (sur données réelles : coût − remboursements)
  const sub = await getSubscriptionView(orgId);
  const plan = sub?.plan ?? null;
  await assertQuota(ctx, 'aiCreditsPerMonth', cost);

  const eventRef = await resolveEventRef(ctx, d.eventRef);

  // Événement hérité d'un design existant (variante)
  let eventId: string | null = d.eventRef ?? null;
  let baseName: string | null = null;
  if (d.designId) {
    const base = await prisma.design.findFirst({
      where: { id: d.designId, organizationId: orgId },
      select: { id: true, eventId: true, name: true },
    });
    if (!base) throw new TenantError(404, 'design_not_found', 'Design introuvable.');
    if (!eventId && base.eventId) eventId = base.eventId;
    baseName = base.name;
  }

  // 2. Réservation
  const usage = await prisma.aiUsage.create({
    data: {
      organizationId: orgId,
      userId: ctx.user.id,
      operation: d.kind,
      creditsCost: cost,
      creditsRefunded: 0,
      status: 'pending',
      inputSummary: d.prompt.slice(0, 300),
    },
  });

  try {
    // 3. Exécution (mock déterministe ; `#fail` dans le prompt = échec simulé)
    let designId: string | null = null;
    let textOut: string | null = null;

    if (d.kind === 'design') {
      const res = generateDesign({
        prompt: d.prompt,
        type: 'invitation',
        width: 1080,
        height: 1350,
        event: eventRef,
      });
      const design = await prisma.design.create({
        data: {
          organizationId: orgId,
          eventId,
          type: 'invitation',
          name: baseName ? `${res.name} (variante)` : res.name,
          format: 'portrait',
          width: 1080,
          height: 1350,
          backgroundJson: res.background,
          elementsJson: res.elements,
          status: 'draft',
          isAiGenerated: true,
          createdById: ctx.user.id,
        },
      });
      designId = design.id;
    } else {
      const text = generateText({ prompt: d.prompt, event: eventRef });
      textOut = text;
    }

    // 4. Succès
    const done = await prisma.aiUsage.update({
      where: { id: usage.id },
      data: { status: 'success', outputDesignId: designId },
    });
    await logActivity({
      organizationId: orgId, userId: ctx.user.id, action: 'ai.generate',
      entity: 'ai', entityId: usage.id,
      meta: { kind: d.kind, credits: cost, designId, prompt: d.prompt.slice(0, 80) }, ip,
    });

    const planForQuota = plan ?? (await getSubscriptionView(orgId))!.plan;
    const quotas = await getQuotas(orgId, planForQuota);
    const remaining = quotas.find((q) => q.key === 'aiCreditsPerMonth')?.remaining ?? 0;

    return {
      usage: { id: done.id, operation: done.operation, creditsCost: done.creditsCost, creditsRefunded: done.creditsRefunded, status: done.status },
      designId,
      text: textOut,
      remainingCredits: remaining,
      monthly: quotas.find((q) => q.key === 'aiCreditsPerMonth') ?? null,
    };
  } catch (e) {
    // Remboursement intégral (la ligne ne consomme plus de quota)
    await prisma.aiUsage.update({
      where: { id: usage.id },
      data: { status: 'failed', creditsRefunded: cost },
    }).catch(() => {});
    await logActivity({
      organizationId: orgId, userId: ctx.user.id, action: 'ai.generate_failed',
      entity: 'ai', entityId: usage.id,
      meta: { kind: d.kind, credits: cost, refunded: cost, error: e instanceof Error ? e.message : 'inconnu' }, ip,
    }).catch(() => {});
    if (e instanceof TenantError) throw e;
    if (e instanceof AiProviderError) {
      throw new TenantError(502, 'ai_provider_error', `Le provider IA a échoué : ${e.message} (crédits remboursés.)`);
    }
    throw new TenantError(502, 'ai_provider_error', 'Le provider IA a échoué. Vos crédits ont été remboursés.');
  }
}

/** Historique des crédits IA (paginé) + total mensuel consommé. */
export async function getAiUsage(
  ctx: TenantContext,
  q: { page?: number; pageSize?: number },
) {
  const orgId = ctx.organization?.id;
  if (!orgId) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, q.pageSize ?? 20));

  const where = { organizationId: orgId };
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  const [items, total, agg] = await Promise.all([
    prisma.aiUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.aiUsage.count({ where }),
    prisma.aiUsage.aggregate({
      where: { ...where, createdAt: { gte: since } },
      _sum: { creditsCost: true, creditsRefunded: true },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    month: {
      consumed: Math.max(0, (agg._sum.creditsCost ?? 0) - (agg._sum.creditsRefunded ?? 0)),
      cost: agg._sum.creditsCost ?? 0,
      refunded: agg._sum.creditsRefunded ?? 0,
    },
  };
}
