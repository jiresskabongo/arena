import { NextResponse } from 'next/server';
import { requireTenant } from '@/server/services/tenant';
import { listPlans } from '@/server/services/subscription';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/organization/plans — catalogue des plans (limites, features,
 * prix par devise) pour l'écran Plan & quotas.
 */
export async function GET() {
  try {
    const ctx = await requireTenant('billing:read');
    const plans = await listPlans();
    const currency = ctx.organization?.currency ?? 'USD';

    return NextResponse.json({
      ok: true,
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
          .sort((a, b) =>
            a.currency === currency
              ? -1
              : b.currency === currency
                ? 1
                : a.currency.localeCompare(b.currency),
          ),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
