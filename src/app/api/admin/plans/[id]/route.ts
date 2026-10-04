import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { logActivity } from '@/server/services/activity';
import { apiError } from '@/server/http';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/plans/[id] — modifie un plan (super admin) : nom, description,
 * trialDays, limites, features, prix. Les quotas s'appliquent immédiatement
 * (calculés à la volée sur les plans — critère : « un admin modifie un plan et
 * les quotas s'appliquent chez le client »).
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireTenant();
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ ok: false, error: { code: 'forbidden' } }, { status: 403 });
    }
    const { id } = await params;
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) return NextResponse.json({ ok: false, error: { code: 'plan_not_found' } }, { status: 404 });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: { code: 'invalid_body' } }, { status: 400 });
    }

    const data: Prisma.PlanUpdateInput = {};
    if (typeof body.name === 'string' && body.name.trim().length >= 2) data.name = body.name.trim().slice(0, 60);
    if (typeof body.description === 'string') data.description = body.description.trim().slice(0, 300);
    if (typeof body.trialDays === 'number' && Number.isInteger(body.trialDays) && body.trialDays >= 0 && body.trialDays <= 90) {
      data.trialDays = body.trialDays;
    }
    if (body.limits && typeof body.limits === 'object') {
      data.limitsJson = body.limits as Prisma.InputJsonValue;
    }
    if (body.features && typeof body.features === 'object') {
      data.featuresJson = body.features as Prisma.InputJsonValue;
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

    if (Array.isArray(body.prices)) {
      for (const pr of body.prices.slice(0, 30)) {
        const currency = typeof pr?.currency === 'string' && ['USD', 'CDF', 'EUR'].includes(pr.currency) ? pr.currency : null;
        const amountMinor = typeof pr?.amountMinor === 'number' && Number.isInteger(pr.amountMinor) && pr.amountMinor >= 0 ? pr.amountMinor : null;
        const interval = pr?.interval === 'yearly' ? 'yearly' : 'monthly';
        if (!currency || amountMinor === null) {
          return NextResponse.json({ ok: false, error: { code: 'price_invalid' } }, { status: 400 });
        }
        if (typeof pr?.id === 'string') {
          await prisma.planPrice.update({
            where: { id: pr.id },
            data: { planId: plan.id, currency, amountMinor, interval },
          }).catch(() => {});
        } else {
          await prisma.planPrice.upsert({
            where: { planId_currency_interval: { planId: plan.id, currency, interval } },
            update: { amountMinor },
            create: { planId: plan.id, currency, amountMinor, interval },
          });
        }
      }
    }

    const saved = await prisma.plan.update({
      where: { id },
      data,
      include: { prices: { where: { isActive: true } } },
    });

    await logActivity({
      organizationId: null,
      userId: ctx.user.id,
      action: 'admin.plan.update',
      entity: 'plan',
      entityId: saved.id,
      meta: { code: saved.code },
    });

    return NextResponse.json({
      ok: true,
      plan: {
        id: saved.id,
        code: saved.code,
        name: saved.name,
        description: saved.description,
        trialDays: saved.trialDays,
        limits: saved.limitsJson as Record<string, number>,
        features: saved.featuresJson as Record<string, boolean>,
        isActive: saved.isActive,
        prices: saved.prices.map((p) => ({ id: p.id, currency: p.currency, amountMinor: p.amountMinor, interval: p.interval })),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
