import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/plans/:id/archive — archive un plan (super admin).
 * Les abonnements existants conservent leur plan (code + limites gelées).
 */
export async function POST(
  _req: Request,
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
    const saved = await prisma.plan.update({ where: { id }, data: { isArchived: true } });
    const { logActivity } = await import('@/server/services/activity');
    await logActivity({
      organizationId: null, userId: ctx.user.id, action: 'admin.plan.archive',
      entity: 'plan', entityId: id, meta: { code: saved.code },
    });
    return NextResponse.json({ ok: true, plan: { id: saved.id, code: saved.code, isArchived: saved.isArchived } });
  } catch (e) {
    return apiError(e);
  }
}
