import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/server/services/tenant';
import { apiError } from '@/server/http';

export const dynamic = 'force-dynamic';


/** GET /api/admin/logs — journal d'activité plateforme (filtres). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin();
    const { listAdminLogs } = await import('@/server/services/admin');
    const url = new URL(req.url);
    const res = await listAdminLogs({
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 30),
      action: url.searchParams.get('action') ?? undefined,
      entity: url.searchParams.get('entity') ?? undefined,
      entityId: url.searchParams.get('entityId') ?? undefined,
      orgId: url.searchParams.get('orgId') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
