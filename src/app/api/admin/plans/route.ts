import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { apiError } from '@/server/http';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/plans — catalogue plans + prix (super admin).
 * L'écran admin complet arrive en Phase 14 ; l'API est mise en place ici car
 * « plans modifiables par admin » est au périmètre P11 (CDC §60).
 */
interface PlanWithPrices {
  id: string; code: string; name: string; description: string; trialDays: number;
  limitsJson: Prisma.JsonValue; featuresJson: Prisma.JsonValue; isActive: boolean; isArchived: boolean;
  prices: { id: string; currency: string; amountMinor: number; interval: string }[];
}

function serialize(p: PlanWithPrices) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    trialDays: p.trialDays,
    limits: p.limitsJson as Record<string, number>,
    features: p.featuresJson as Record<string, boolean>,
    isActive: p.isActive,
    isArchived: p.isArchived,
    prices: p.prices.map((pr) => ({ id: pr.id, currency: pr.currency, amountMinor: pr.amountMinor, interval: pr.interval })),
  };
}

/** GET /api/admin/plans — catalogue plans + prix (super admin). ?all=1 inclut archivés. */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenant();
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ ok: false, error: { code: 'forbidden' } }, { status: 403 });
    }
    const url = new URL(req.url);
    const plans = await prisma.plan.findMany({
      where: url.searchParams.get('all') === '1' ? {} : { isArchived: false },
      include: { prices: { where: { isActive: true }, orderBy: [{ currency: 'asc' }, { interval: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ ok: true, plans: plans.map(serialize) });
  } catch (e) {
    return apiError(e);
  }
}

const CURRENCIES = ['USD', 'EUR', 'CDF'] as const;

/**
 * POST /api/admin/plans — crée un plan (super admin, §47) : code unique,
 * nom, description, trialDays, limites, features, prix × devises.
 * Les quotas s'appliquent immédiatement (calcul à la volée — critère P14).
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant();
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ ok: false, error: { code: 'forbidden' } }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 30) : '';
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
    if (!/^[a-z0-9_]{2,30}$/.test(code) || name.length < 2) {
      return NextResponse.json({ ok: false, error: { code: 'invalid_plan' } }, { status: 400 });
    }
    const exists = await prisma.plan.findUnique({ where: { code } });
    if (exists) {
      return NextResponse.json({ ok: false, error: { code: 'plan_exists' } }, { status: 409 });
    }

    const limits: Record<string, number> = {};
    if (body?.limits && typeof body.limits === 'object') {
      for (const [k, v] of Object.entries(body.limits as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) limits[k] = v;
      }
    }
    const features: Record<string, boolean> = {};
    if (body?.features && typeof body.features === 'object') {
      for (const [k, v] of Object.entries(body.features as Record<string, unknown>)) {
        if (typeof v === 'boolean') features[k] = v;
      }
    }

    const plan = await prisma.plan.create({
      data: {
        code,
        name,
        description: typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : '',
        trialDays: typeof body?.trialDays === 'number' ? Math.min(90, Math.max(0, Math.round(body.trialDays))) : 7,
        limitsJson: limits as never,
        featuresJson: features as never,
      },
    });

    if (Array.isArray(body?.prices)) {
      for (const pr of body.prices.slice(0, 30)) {
        const currency = CURRENCIES.includes(pr?.currency) ? pr.currency : null;
        const amountMinor = typeof pr?.amountMinor === 'number' && Number.isInteger(pr.amountMinor) && pr.amountMinor >= 0 ? pr.amountMinor : null;
        if (!currency || amountMinor === null) continue;
        const interval = pr?.interval === 'yearly' ? 'yearly' : 'monthly';
        await prisma.planPrice.create({ data: { planId: plan.id, currency, amountMinor, interval } }).catch(() => {});
      }
    }

    const saved = await prisma.plan.findUnique({
      where: { id: plan.id },
      include: { prices: { where: { isActive: true }, orderBy: [{ currency: 'asc' }, { interval: 'asc' }] } },
    });
    if (!saved) return NextResponse.json({ ok: false, error: { code: 'plan_not_found' } }, { status: 500 });

    const { logActivity } = await import('@/server/services/activity');
    await logActivity({
      organizationId: null, userId: ctx.user.id, action: 'admin.plan.create',
      entity: 'plan', entityId: saved.id, meta: { code: saved.code },
    });

    return NextResponse.json({ ok: true, plan: serialize(saved) });
  } catch (e) {
    return apiError(e);
  }
}
