import { NextResponse } from 'next/server';
import { requireTenant, TenantError } from '@/server/services/tenant';
import { getSubscriptionView } from '@/server/services/subscription';
import { getQuotas } from '@/server/services/quotas';
import { updateOrgSchema } from '@/lib/schemas/event';
import { logActivity } from '@/server/services/activity';
import { apiError } from '@/server/http';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';

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
    const quotas = sub ? await getQuotas(ctx.organization.id, sub.plan) : [];

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

/**
 * PATCH /api/organization — profil organisation (nom, devise, contact…).
 * Permission settings:org (owner).
 */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireTenant('settings:org');
    if (!ctx.organization) throw new TenantError(409, 'no_active_org', 'Aucune organisation active.');

    const body = await req.json().catch(() => null);
    const parsed = updateOrgSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation',
            message: 'Veuillez corriger les champs indiqués.',
            details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          },
        },
        { status: 400 },
      );
    }

    const updated = await prisma.organization.update({
      where: { id: ctx.organization.id },
      data: {
        name: parsed.data.name,
        currency: parsed.data.currency,
        locale: parsed.data.locale,
        timezone: parsed.data.timezone,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
      },
    });

    const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
    await logActivity({
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      action: 'org.update',
      entity: 'organization',
      entityId: updated.id,
      ip,
    });

    return NextResponse.json({ ok: true, organization: updated });
  } catch (e) {
    return apiError(e);
  }
}
