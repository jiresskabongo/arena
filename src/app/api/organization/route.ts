import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { getSubscriptionView } from '@/server/services/subscription';
import { getQuotas } from '@/server/services/quotas';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/organization — org active, rôle, abonnement et quotas d'usage.
 * Visible par tous les rôles (les statistiques d'usage ne sont pas sensibles).
 */
export async function GET() {
  try {
    const ctx = await requireTenant();
    if (!ctx.organization) {
      return NextResponse.json({ ok: true, superAdmin: true });
    }

    const sub = await getSubscriptionView(ctx.organization.id);
    const quotas = sub
      ? await getQuotas(ctx.organization.id, sub.plan)
      : [];

    return NextResponse.json({
      ok: true,
      organization: ctx.organization,
      role: ctx.role,
      subscription: sub
        ? {
            status: sub.status,
            planCode: sub.plan.code,
            planName: sub.plan.name,
            trialEndsAt: sub.trialEndsAt,
            inTrial: sub.inTrial,
            daysLeft: sub.daysLeft,
            trialExpired: sub.trialExpired,
          }
        : null,
      quotas,
    });
  } catch (e) {
    return apiError(e);
  }
}
