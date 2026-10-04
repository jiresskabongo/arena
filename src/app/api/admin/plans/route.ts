import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/plans — catalogue plans + prix (super admin).
 * L'écran admin complet arrive en Phase 14 ; l'API est mise en place ici car
 * « plans modifiables par admin » est au périmètre P11 (CDC §60).
 */
export async function GET() {
  try {
    const ctx = await requireTenant();
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ ok: false, error: { code: 'forbidden' } }, { status: 403 });
    }
    const plans = await prisma.plan.findMany({
      where: { isArchived: false },
      include: { prices: { where: { isActive: true }, orderBy: [{ currency: 'asc' }, { interval: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({
      ok: true,
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        trialDays: p.trialDays,
        limits: p.limitsJson as Record<string, number>,
        features: p.featuresJson as Record<string, boolean>,
        isActive: p.isActive,
        prices: p.prices.map((pr) => ({ id: pr.id, currency: pr.currency, amountMinor: pr.amountMinor, interval: pr.interval })),
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
