import { prisma } from '@/lib/prisma';

export interface ActivityInput {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Journal d'activité (CDC §50) — sans données sensibles (pas de mdp,
 * pas de corps d'e-mails, coordonnées tronquées).
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        metaJson: (input.meta ?? {}) as object,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    // Le journal ne doit jamais casser le flux métier
    console.error('[activity] échec de journalisation', err);
  }
}
