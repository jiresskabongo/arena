import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireTenant } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/notifications — notifications produit (in-app) de l'organisation. */
export async function GET() {
  try {
    const ctx = await requireTenant();
    const orgId = ctx.organization?.id;
    if (!orgId) return NextResponse.json({ ok: false, error: { code: 'no_active_org' } }, { status: 409 });

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.notification.count({ where: { organizationId: orgId, readAt: null } }),
    ]);
    return NextResponse.json({
      ok: true,
      notifications: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: unread,
    });
  } catch (e) {
    return apiError(e);
  }
}

/** POST /api/notifications — { action: 'read_all' } → tout marquer lu. */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenant();
    const orgId = ctx.organization?.id;
    if (!orgId) return NextResponse.json({ ok: false, error: { code: 'no_active_org' } }, { status: 409 });

    const body = await req.json().catch(() => null);
    if (body?.action !== 'read_all') {
      return NextResponse.json({ ok: false, error: { code: 'invalid_action' } }, { status: 400 });
    }
    const res = await prisma.notification.updateMany({
      where: { organizationId: orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true, marked: res.count });
  } catch (e) {
    return apiError(e);
  }
}
